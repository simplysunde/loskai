"""FastAPI application entry point.

One process serves the API and (in production) the built React bundle. The auth
middleware gates every `/api/*` except the login flow + public dashboard; the static
SPA is served unauthenticated. Module routers (caddy, adguard, wireguard, docker) are
registered here as each phase adds them.
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse

from .config import settings
from .modules.adguard import router as adguard_router
from .modules.adguard.client import adguard
from .modules.caddy import router as caddy_router
from .modules.caddy.client import caddy
from .modules.docker import router as docker_router
from .modules.docker.discovery import discover_labeled
from .modules.wireguard import router as wireguard_router
from .shared import assign, auth, dashboard, health, instances
from .shared import settings as settings_module

log = logging.getLogger("loskai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Seed the admin password from LOSKAI_PASSWORD once, if provided.
    auth.ensure_seeded()
    # Label auto-discovery: reconcile routes for `loskai.subdomain`-labeled containers.
    # Best-effort — a down Docker/Caddy must never block startup.
    try:
        results = await discover_labeled(caddy, adguard)
        applied = [r for r in results if r["status"] in ("created", "updated")]
        if applied:
            log.info("label auto-discovery: %s", applied)
    except Exception as exc:  # noqa: BLE001 — startup must not fail on discovery
        log.warning("label auto-discovery skipped: %s", exc)
    yield


app = FastAPI(title="Loskai", lifespan=lifespan)
app.add_middleware(auth.AuthMiddleware)

# Shared routers. Module routers are added by their phases.
app.include_router(auth.router)
app.include_router(settings_module.router)
app.include_router(health.router)
app.include_router(dashboard.router)
app.include_router(instances.router)
app.include_router(assign.router)
app.include_router(caddy_router.router)
app.include_router(adguard_router.router)
app.include_router(wireguard_router.router)
app.include_router(docker_router.router)


# --- Static SPA (production only) ---
# Registered last so /api routes always win. In dev the bundle doesn't exist and Vite
# serves the UI on :5173, so this whole block is skipped.
_static = Path(settings.static_dir)
if _static.is_dir():

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        # Never let the catch-all answer for the API namespace.
        if full_path.startswith("api/") or full_path == "api":
            return JSONResponse({"detail": "Not found"}, status_code=404)
        candidate = _static / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        index = _static / "index.html"
        if index.is_file():
            return FileResponse(index)
        return JSONResponse({"detail": "Not found"}, status_code=404)
