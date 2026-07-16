"""AdGuard module logic — the reconcile (the trickiest code in the app) + orchestration.

One explicit rewrite per routed instance, `answer` = the shared Caddy LAN IP; there is
no wildcard rewrite. Identity is the `(domain, answer)` pair (no ID). `dns_answer` on the
instance records the answer Loskai last wrote, which is what separates *our* stale entry
(safe to delete) from a *manual* entry on the same domain (leave + warn).

`plan_reconcile` is pure — it does the diffing with no I/O so it is unit-tested directly.
The orchestration functions apply a plan through the client.
"""

from dataclasses import dataclass, field

import httpx

from ...shared import instances as instances_store
from ...shared.instances import Instance
from .client import AdGuardClient, AdGuardError, describe_error


def rewrite_domain(instance: Instance, base_domain: str) -> str:
    return f"{instance.subdomain}.{base_domain}"


def _index_by_domain(rewrites: list[dict]) -> dict[str, set[str]]:
    """domain -> set of answers currently in AdGuard."""
    by_domain: dict[str, set[str]] = {}
    for entry in rewrites:
        domain = entry.get("domain")
        answer = entry.get("answer")
        if domain is None or answer is None:
            continue
        by_domain.setdefault(domain, set()).add(answer)
    return by_domain


@dataclass
class ReconcilePlan:
    adds: list[tuple[str, str]] = field(default_factory=list)  # (domain, answer)
    deletes: list[tuple[str, str]] = field(default_factory=list)  # (domain, stale answer)
    conflicts: list[dict] = field(default_factory=list)  # {id, domain, answers}
    in_sync: list[str] = field(default_factory=list)  # instance ids already correct


def plan_reconcile(
    instances: list[Instance],
    rewrites: list[dict],
    base_domain: str,
    current_ip: str,
) -> ReconcilePlan:
    """Diff routed instances against AdGuard's rewrite list. Pure — no I/O.

    Per instance: ensure `(domain, current_ip)` exists; if the instance's stored
    `dns_answer` differs from `current_ip` and that stale pair is present, delete it
    (orphan migration on a Caddy-IP change); any same-domain answer that is neither
    `current_ip` nor the stored `dns_answer` is a manual entry — reported as a conflict,
    never touched.
    """
    plan = ReconcilePlan()
    by_domain = _index_by_domain(rewrites)

    for inst in instances:
        if not inst.subdomain:
            continue
        domain = rewrite_domain(inst, base_domain)
        answers = by_domain.get(domain, set())
        stored = inst.dns_answer

        if current_ip in answers:
            plan.in_sync.append(inst.id)
        else:
            plan.adds.append((domain, current_ip))

        if stored and stored != current_ip and stored in answers:
            plan.deletes.append((domain, stored))

        foreign = sorted(a for a in answers if a != current_ip and a != stored)
        if foreign:
            plan.conflicts.append({"id": inst.id, "domain": domain, "answers": foreign})

    return plan


def dns_status_rows(
    instances: list[Instance],
    rewrites: list[dict] | None,
    base_domain: str | None,
    current_ip: str | None,
) -> list[dict]:
    """Display-only per-instance DNS status for the routing table's DNS column.
    `present` is None when it can't be determined (AdGuard down or no answer IP)."""
    by_domain = _index_by_domain(rewrites) if rewrites is not None else None
    rows: list[dict] = []
    for inst in instances:
        if not inst.subdomain:
            continue
        domain = rewrite_domain(inst, base_domain) if base_domain else inst.subdomain
        if by_domain is None or current_ip is None or not base_domain:
            rows.append({"id": inst.id, "domain": domain, "present": None, "conflict": False})
            continue
        answers = by_domain.get(domain, set())
        rows.append(
            {
                "id": inst.id,
                "domain": domain,
                "present": current_ip in answers,
                "conflict": any(a != current_ip and a != inst.dns_answer for a in answers),
            }
        )
    return rows


def consistency_warnings(
    instances: list[Instance],
    rewrites: list[dict] | None,
    base_domain: str | None,
    current_ip: str | None,
) -> list[dict]:
    """Cross-module drift warnings for `/api/health`. Pure.

    Flags a routed instance whose LAN name won't resolve (a route exists but no AdGuard
    rewrite points at the Caddy IP) or whose domain also carries a foreign answer (a
    manual conflict — Loskai never auto-overwrites it). Returns `[]` when drift can't be
    determined (AdGuard unreachable, or no base domain / answer IP)."""
    warnings: list[dict] = []
    for row in dns_status_rows(instances, rewrites, base_domain, current_ip):
        if row["present"] is None:
            continue  # undeterminable — say nothing rather than cry wolf
        if not row["present"]:
            warnings.append({
                "id": row["id"],
                "domain": row["domain"],
                "kind": "dns_missing",
                "detail": f"{row['domain']} has a route but no AdGuard rewrite to "
                          f"{current_ip}; it won't resolve on the LAN until one is added.",
            })
        if row["conflict"]:
            warnings.append({
                "id": row["id"],
                "domain": row["domain"],
                "kind": "dns_conflict",
                "detail": f"{row['domain']} has a DNS rewrite pointing somewhere other "
                          f"than {current_ip}; resolve it manually — Loskai won't overwrite it.",
            })
    return warnings


# --- Orchestration (I/O via the client) ---


async def get_status(
    client: AdGuardClient, base_domain: str | None, current_ip: str | None
) -> dict:
    routed = instances_store.list_routed()
    rewrites: list[dict] | None
    try:
        rewrites = await client.list_rewrites()
    except (httpx.HTTPError, AdGuardError):
        rewrites = None  # AdGuard unreachable — status unknown, not "missing"
    return {
        "answer_ip": current_ip,
        "instances": dns_status_rows(routed, rewrites, base_domain, current_ip),
    }


async def reconcile(
    client: AdGuardClient, base_domain: str | None, current_ip: str | None
) -> dict:
    """Apply the plan best-effort and persist `dns_answer` for every domain that now
    resolves to `current_ip`. Only ever deletes answers Loskai itself wrote."""
    if not base_domain:
        raise ValueError("base_domain is not set")
    if not current_ip:
        raise ValueError("Caddy answer IP is not derivable — set CADDY_HOST_IP")

    routed = instances_store.list_routed()
    rewrites = await client.list_rewrites()
    plan = plan_reconcile(routed, rewrites, base_domain, current_ip)

    # Domains already resolving to current_ip, plus any we successfully add below.
    ensured = {e["domain"] for e in rewrites if e.get("answer") == current_ip}
    added: list[str] = []
    deleted: list[str] = []
    errors: list[dict] = []

    for domain, answer in plan.adds:
        try:
            await client.add_rewrite(domain, answer)
            added.append(domain)
            ensured.add(domain)
        except (httpx.HTTPError, AdGuardError) as exc:
            errors.append({"domain": domain, "op": "add", "detail": describe_error(exc)})

    for domain, answer in plan.deletes:
        try:
            await client.delete_rewrite(domain, answer)  # best-effort
            deleted.append(domain)
        except (httpx.HTTPError, AdGuardError):
            pass  # may already be gone — harmless

    # Persist dns_answer for instances whose name now resolves to current_ip.
    for inst in routed:
        domain = rewrite_domain(inst, base_domain)
        if domain in ensured and inst.dns_answer != current_ip:
            instances_store.upsert_instance(
                inst.model_copy(update={"dns_answer": current_ip})
            )

    return {
        "added": added,
        "deleted": deleted,
        "conflicts": plan.conflicts,
        "errors": errors,
    }
