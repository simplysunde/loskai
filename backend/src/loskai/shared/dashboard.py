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
        # An `http`-scheme route has no certificate by design, so linking it as https
        # would send every dashboard visitor into a failed TLS handshake.
        scheme = "http" if inst.scheme == "http" else "https"
        url = f"{scheme}://{inst.subdomain}.{base}" if base else None
        cards.append({"name": inst.name, "url": url, "icon": None})
    return {
        "services": cards,
        "certificate_tab": settings_store.certificate_tab(),
    }
