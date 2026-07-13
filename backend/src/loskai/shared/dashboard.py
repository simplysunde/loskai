"""The one public endpoint — GET /api/dashboard.

A launcher: non-private routed instances as cards (name, url, icon) only. It exposes
no container detail, module state, or anything sensitive — that all sits behind login.
"""

from fastapi import APIRouter

from . import instances
from . import settings as settings_store

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard")
def dashboard() -> dict[str, list[dict]]:
    base = settings_store.value("base_domain")
    cards: list[dict] = []
    for inst in instances.list_routed():
        if inst.private:
            continue
        url = f"https://{inst.subdomain}.{base}" if base else None
        cards.append({"name": inst.name, "url": url, "icon": None})
    return {"services": cards}
