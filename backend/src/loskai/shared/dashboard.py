"""The public launcher endpoint — GET /api/dashboard.

Non-private routed instances as cards (name, url, icon) only. It exposes no container
detail, module state, or anything sensitive — that all sits behind login.

It also carries `certificate_tab`, because the shell has to decide whether to show the
Certificate link before anyone has logged in, and this is the one public payload the
whole app already reads. It is a nav-visibility mode, not an access grant — the cert
endpoint itself is public in every mode (see `modules/caddy/router.root_certificate`).
"""

from fastapi import APIRouter

from . import instances
from . import settings as settings_store

router = APIRouter(prefix="/api", tags=["dashboard"])


def _card(inst, base: str | None) -> dict:
    """One launcher entry. `id` is here because a desktop launcher builds shortcuts from
    these and needs a key that survives a rename; `name` does not."""
    return {
        "id": inst.id,
        "name": inst.name,
        "url": f"{instances.web_scheme(inst)}://{instances.fqdn(inst.subdomain, base)}" if base else None,
        "icon": f"/api/instances/{inst.id}/icon" if inst.icon else None,
    }


@router.get("/launcher")
def launcher() -> dict:
    """Every routed service, **including private ones** — for a desktop launcher that builds
    shortcuts. Authenticated (it is not in `PUBLIC_ROUTES`), which is the whole difference
    from `/api/dashboard`: `private` means "not on the public wall", not "secret", so a
    client that can prove it holds the admin password may list them.

    A desktop client authenticates the same way the web UI does: `POST /api/login` with the
    password, then send the session cookie back."""
    base = settings_store.value("base_domain")
    return {
        "services": [
            _card(inst, base) | {"private": inst.private}
            for inst in instances.list_routed()
            if not instances.is_machine(inst)
        ]
    }


@router.get("/dashboard")
def dashboard() -> dict:
    base = settings_store.value("base_domain")
    cards: list[dict] = []
    for inst in instances.list_routed():
        if inst.private:
            continue
        # Machines never appear. A machine is an *address*, not a service: the port (or
        # path) its web UI lives on — `:8006` for Proxmox, `:5000` for a NAS, none at all
        # for a box you only SSH to — is not derivable from anything the record holds, so
        # a card for one either links nowhere useful or has to be told separately. A
        # launcher entry that lands on a dead port is worse than no entry. Services on odd
        # ports are unaffected: Caddy fronts those at :443.
        if instances.is_machine(inst):
            continue
        cards.append(_card(inst, base))
    return {
        "services": cards,
        "certificate_tab": settings_store.certificate_tab(),
    }
