"""The public launcher endpoint — GET /api/dashboard.

Non-private routed instances as cards (name, url, icon) only. It exposes no container
detail, module state, or anything sensitive — that all sits behind login.

It also carries `certificate_tab`, because the shell has to decide whether to show the
Certificate link before anyone has logged in, and this is the one public payload the
whole app already reads. It is a nav-visibility mode, not an access grant — the cert
endpoint itself is public in every mode (see `modules/caddy/router.root_certificate`).
And `ui_look`, for the same reason: the login page and the Dashboard wear the look too.
"""

from fastapi import APIRouter

from . import instances as instances_store
from . import settings as settings_store

router = APIRouter(prefix="/api", tags=["dashboard"])


def _card(inst, base: str | None) -> dict:
    """One launcher entry. `id` is here because a desktop launcher builds shortcuts from
    these and needs a key that survives a rename; `name` does not."""
    return {
        "id": inst.id,
        "name": inst.name,
        "url": instances_store.open_url(inst, base),
        "icon": instances_store.icon_url(inst),
    }


def _entries() -> list:
    """What the Dashboard and the launcher list: every routed service and every link.

    Machines never appear. A machine is an *address*, not a service: the port (or path) its
    web UI lives on — `:8006` for Proxmox, `:5000` for a NAS, none at all for a box you only
    SSH to — is not derivable from anything the record holds, so a card for one either
    links nowhere useful or has to be told separately. A launcher entry that lands on a dead
    port is worse than no entry. A service on a machine is a route or a link of its own."""
    return [
        inst for inst in instances_store.list_instances()
        if not instances_store.is_machine(inst) and (inst.subdomain or instances_store.is_link(inst))
    ]


@router.get("/launcher")
def launcher() -> dict:
    """Every routed service and link, **including private ones** — for a desktop launcher that builds
    shortcuts. Authenticated (it is not in `PUBLIC_ROUTES`), which is the whole difference
    from `/api/dashboard`: `private` means "not on the public wall", not "secret", so a
    client that can prove it holds the admin password may list them.

    A desktop client authenticates the same way the web UI does: `POST /api/login` with the
    password, then send the session cookie back."""
    base = settings_store.value("base_domain")
    return {
        "services": [
            _card(inst, base) | {"private": inst.private}
            for inst in _entries()
        ]
    }


@router.get("/dashboard")
def dashboard() -> dict:
    base = settings_store.value("base_domain")
    cards: list[dict] = []
    for inst in _entries():
        if inst.private:
            continue
        cards.append(_card(inst, base))
    return {
        "services": cards,
        "certificate_tab": settings_store.certificate_tab(),
        "ui_look": settings_store.choice("ui_look"),
    }
