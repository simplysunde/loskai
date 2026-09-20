"""AdGuard module logic — the reconcile (the trickiest code in the app) + orchestration.

One explicit rewrite per routed instance; there is no wildcard rewrite. `answer` is the
shared Caddy LAN IP for a `route_mode: "proxy"` instance, or that instance's own IP for
`"dns_only"` — see `target_answer()`, the one place every function below gets its
per-instance answer from. Identity is the `(domain, answer)` pair (no ID). `dns_answer` on
the instance records the answer Loskai last wrote, which is what separates *our* stale
entry (safe to delete) from a *manual* entry on the same domain (leave + warn).

`plan_reconcile` is pure — it does the diffing with no I/O so it is unit-tested directly.
The orchestration functions apply a plan through the client.
"""

import logging
from dataclasses import dataclass, field

import httpx

from ...shared import instances as instances_store
from ...shared.instances import Instance
from .client import AdGuardClient, AdGuardError, describe_error

logger = logging.getLogger(__name__)


def rewrite_domain(instance: Instance, base_domain: str) -> str:
    return f"{instance.subdomain}.{base_domain}"


def target_answer(instance: Instance, current_ip: str | None) -> str | None:
    """The AdGuard answer this instance's rewrite should resolve to: its own bare upstream
    IP for `dns_only` (no Caddy involved — the upstream IS the answer), or the shared Caddy
    LAN IP for `proxy`. None if undeterminable (a `proxy` instance with no answer IP set)."""
    if instance.route_mode == "dns_only":
        return instance.upstream
    return current_ip


def is_loskai_domain(domain: str, base_domain: str) -> bool:
    """True if `domain` sits under `.base_domain` in Loskai's own namespace — a `proxy`
    instance's single label, or a `dns_only` instance's dot-separated multi-label name (no
    cert constraint applies to those). Used to scope the orphan sweep so it can only ever
    touch names Loskai could plausibly have written — never an unrelated hand-added rewrite
    that happens to share an answer IP."""
    suffix = f".{base_domain}"
    if not domain.endswith(suffix):
        return False
    label = domain[: -len(suffix)]
    return bool(label)


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
    sweeps: list[tuple[str, str]] = field(default_factory=list)  # (domain, answer) orphan
    conflicts: list[dict] = field(default_factory=list)  # {id, domain, answers}
    in_sync: list[str] = field(default_factory=list)  # instance ids already correct


def plan_reconcile(
    instances: list[Instance],
    rewrites: list[dict],
    base_domain: str,
    current_ip: str | None,
) -> ReconcilePlan:
    """Diff routed instances against AdGuard's rewrite list. Pure — no I/O.

    Per instance: ensure `(domain, target)` exists, where `target` is the shared Caddy IP
    for `proxy` or the instance's own upstream IP for `dns_only` (`target_answer`). If the
    instance's stored `dns_answer` differs from `target` and that stale pair is present,
    delete it (orphan migration — a Caddy-IP change, or a proxy/dns_only mode switch); any
    same-domain answer that is neither `target` nor the stored `dns_answer` is a manual
    entry — reported as a conflict, never touched. A `proxy` instance with no derivable
    `current_ip` is skipped entirely (nothing to reconcile it against).

    Orphan sweep: a rewrite in Loskai's `<label(s)>.<base>` namespace, pointing at the
    shared Caddy IP or at any currently-routed instance's own recorded `dns_answer`, that
    belongs to no routed instance is a Loskai leftover (a teardown whose best-effort DNS
    delete failed while AdGuard was down) — queue it for deletion. Restricting the match set
    to answers Loskai is known to have written means a hand-added rewrite pointing anywhere
    else is safe.
    """
    plan = ReconcilePlan()
    by_domain = _index_by_domain(rewrites)
    routed_domains = {
        rewrite_domain(inst, base_domain) for inst in instances if inst.subdomain
    }

    for inst in instances:
        if not inst.subdomain:
            continue
        target = target_answer(inst, current_ip)
        if not target:
            continue
        domain = rewrite_domain(inst, base_domain)
        answers = by_domain.get(domain, set())
        stored = inst.dns_answer

        if target in answers:
            plan.in_sync.append(inst.id)
        else:
            plan.adds.append((domain, target))

        if stored and stored != target and stored in answers:
            plan.deletes.append((domain, stored))

        foreign = sorted(a for a in answers if a != target and a != stored)
        if foreign:
            plan.conflicts.append({"id": inst.id, "domain": domain, "answers": foreign})

    known_answers = {current_ip} if current_ip else set()
    known_answers |= {inst.dns_answer for inst in instances if inst.dns_answer}
    for domain, answers in by_domain.items():
        if domain in routed_domains or not is_loskai_domain(domain, base_domain):
            continue
        for answer in sorted(answers & known_answers):
            plan.sweeps.append((domain, answer))

    return plan


def dns_status_rows(
    instances: list[Instance],
    rewrites: list[dict] | None,
    base_domain: str | None,
    current_ip: str | None,
) -> list[dict]:
    """Display-only per-instance DNS status for the routing table's DNS column. `present`
    is None when it can't be determined (AdGuard down, no base domain, or — for a `proxy`
    instance — no answer IP configured; a `dns_only` instance needs no answer IP at all)."""
    by_domain = _index_by_domain(rewrites) if rewrites is not None else None
    rows: list[dict] = []
    for inst in instances:
        if not inst.subdomain:
            continue
        domain = rewrite_domain(inst, base_domain) if base_domain else inst.subdomain
        target = target_answer(inst, current_ip)
        if by_domain is None or target is None or not base_domain:
            rows.append(
                {"id": inst.id, "domain": domain, "present": None, "conflict": False, "target": target}
            )
            continue
        answers = by_domain.get(domain, set())
        rows.append(
            {
                "id": inst.id,
                "domain": domain,
                "present": target in answers,
                "conflict": any(a != target and a != inst.dns_answer for a in answers),
                "target": target,
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
                          f"{row['target']}; it won't resolve on the LAN until one is added.",
            })
        if row["conflict"]:
            warnings.append({
                "id": row["id"],
                "domain": row["domain"],
                "kind": "dns_conflict",
                "detail": f"{row['domain']} has a DNS rewrite pointing somewhere other "
                          f"than {row['target']}; resolve it manually — Loskai won't overwrite it.",
            })
    return warnings


# --- Orchestration (I/O via the client) ---


def annotate_rewrites(
    rewrites: list[dict],
    routed: list[Instance],
    base_domain: str | None,
    current_ip: str | None,
) -> list[dict]:
    """Every rewrite AdGuard holds, each marked `managed`: true when the exact
    `(domain, answer)` pair is one a routed instance would have reconcile write back.

    The distinction is the whole point of showing the list before a clear — a managed entry
    is restored seconds later, an unmanaged one is gone for good. Pure, so the "would it
    come back" question is answered by the same `rewrite_domain`/`target_answer` pair the
    restore itself uses, not by a second guess at the rule."""
    managed = set()
    if base_domain:
        for inst in routed:
            target = target_answer(inst, current_ip)
            if target:
                managed.add((rewrite_domain(inst, base_domain), target))
    return [
        {
            "domain": entry.get("domain", ""),
            "answer": entry.get("answer", ""),
            "managed": (entry.get("domain", ""), entry.get("answer", "")) in managed,
        }
        for entry in rewrites
    ]


async def list_rewrites(
    client: AdGuardClient, base_domain: str | None, current_ip: str | None
) -> dict:
    """The raw rewrite list, annotated. Read-only — it is what the clear dialog shows."""
    rewrites = await client.list_rewrites()
    return {
        "rewrites": annotate_rewrites(
            rewrites, instances_store.list_routed(), base_domain, current_ip
        )
    }


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


def _check_reconcilable(
    base_domain: str | None, current_ip: str | None
) -> list[Instance]:
    """Preconditions for writing rewrites, shared by `reconcile` and `clear_and_restore`,
    returning the routed instances. Raising *before* any write is the point: it is what
    lets the clear refuse a run that would delete every rewrite and then fail to put
    Loskai's own back.

    `current_ip` is only required when at least one routed instance is `proxy` — a LAN made
    entirely of `dns_only` instances needs no `CADDY_HOST_IP` configured at all."""
    if not base_domain:
        raise ValueError("base_domain is not set")
    routed = instances_store.list_routed()
    if any(inst.route_mode == "proxy" for inst in routed) and not current_ip:
        raise ValueError("Caddy answer IP is not derivable — set CADDY_HOST_IP")
    return routed


async def reconcile(
    client: AdGuardClient, base_domain: str | None, current_ip: str | None
) -> dict:
    """Apply the plan best-effort and persist `dns_answer` for every domain that now
    resolves to its target. Only ever deletes answers Loskai itself wrote: a stale pair
    from an IP or mode change (`deletes`), or an orphaned `<label(s)>.<base>` rewrite that
    no live route owns (`sweeps`).

    Preconditions — base domain set, answer IP derivable — are `_check_reconcilable`."""
    routed = _check_reconcilable(base_domain, current_ip)

    rewrites = await client.list_rewrites()
    plan = plan_reconcile(routed, rewrites, base_domain, current_ip)
    by_domain = _index_by_domain(rewrites)

    # Domains already resolving to their target, plus any we successfully add below.
    ensured: set[str] = set()
    for inst in routed:
        target = target_answer(inst, current_ip)
        if not target:
            continue
        domain = rewrite_domain(inst, base_domain)
        if target in by_domain.get(domain, set()):
            ensured.add(domain)
    added: list[str] = []
    deleted: list[str] = []
    swept: list[str] = []
    errors: list[dict] = []

    for domain, answer in plan.adds:
        try:
            await client.add_rewrite(domain, answer)
            added.append(domain)
            ensured.add(domain)
        except (httpx.HTTPError, AdGuardError) as exc:
            logger.warning(
                "reconcile: add %s -> %s failed: %s", domain, answer, describe_error(exc)
            )
            errors.append({"domain": domain, "op": "add", "detail": describe_error(exc)})

    for domain, answer in plan.deletes:
        try:
            await client.delete_rewrite(domain, answer)  # best-effort
            deleted.append(domain)
        except (httpx.HTTPError, AdGuardError) as exc:
            # May already be gone — harmless, but not silent: an unreported miss here is
            # exactly how a stale rewrite outlives the route it belonged to.
            logger.warning(
                "reconcile: delete %s -> %s failed: %s", domain, answer, describe_error(exc)
            )

    for domain, answer in plan.sweeps:
        try:
            await client.delete_rewrite(domain, answer)  # best-effort
            swept.append(domain)
        except (httpx.HTTPError, AdGuardError) as exc:
            logger.warning(
                "reconcile: sweep %s -> %s failed: %s", domain, answer, describe_error(exc)
            )

    # Persist dns_answer for instances whose name now resolves to their target.
    for inst in routed:
        domain = rewrite_domain(inst, base_domain)
        target = target_answer(inst, current_ip)
        if domain in ensured and target and inst.dns_answer != target:
            instances_store.upsert_instance(
                inst.model_copy(update={"dns_answer": target})
            )

    return {
        "added": added,
        "deleted": deleted,
        "swept": swept,
        "conflicts": plan.conflicts,
        "errors": errors,
    }


async def clear_and_restore(
    client: AdGuardClient, base_domain: str | None, current_ip: str | None
) -> dict:
    """Delete **every** rewrite AdGuard holds — hand-added ones included — then reconcile,
    so the list ends up as exactly what the instance list says it should be.

    This is the one place Loskai removes an entry it did not write. The exact-pair rule is
    not weakened: each delete still names its `(domain, answer)` pair, and no automatic
    path (assign, teardown, the orphan sweep) touches a foreign rewrite. What changed is
    that the user can now ask for a wholesale reset — the escape hatch for adopting an
    AdGuard that already carries rewrites, from before Loskai or from a different naming
    scheme. It is destructive and explicit, never a side effect of anything else.

    Restoring is part of the same call, for two reasons. A clear on its own leaves the LAN
    with no working names until someone remembers to Sync; and reconciling against a list
    we just emptied is what makes duplicates impossible, since every routed name is missing
    and so is added exactly once.
    """
    _check_reconcilable(base_domain, current_ip)  # refuse before deleting, not after

    cleared: list[str] = []
    errors: list[dict] = []
    for entry in await client.list_rewrites():
        domain, answer = entry.get("domain", ""), entry.get("answer", "")
        try:
            await client.delete_rewrite(domain, answer)
            cleared.append(domain)
        except (httpx.HTTPError, AdGuardError) as exc:
            logger.warning(
                "clear: delete %s -> %s failed: %s", domain, answer, describe_error(exc)
            )
            errors.append(
                {"domain": domain, "op": "delete", "detail": describe_error(exc)}
            )

    # Re-lists from AdGuard, so anything a failed delete left behind is still accounted
    # for — as a conflict if it shadows one of ours, rather than silently.
    restored = await reconcile(client, base_domain, current_ip)
    return {
        "cleared": cleared,
        "restored": restored["added"],
        "conflicts": restored["conflicts"],
        "errors": errors + restored["errors"],
    }
