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
        url = f"https://{inst.subdomain}.{base}" if base else None
        cards.append({"name": inst.name, "url": url, "icon": None})
    return {
        "services": cards,
        "certificate_tab": settings_store.certificate_tab(),
    }
