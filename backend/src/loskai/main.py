"""FastAPI application entry point.

One process serves the API and (in production) the built React bundle. The auth
middleware gates every `/api/*` except the login flow + public dashboard; the static
SPA is served unauthenticated. All four module routers (caddy, adguard, wireguard,
docker) are registered here.
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse

from .config import settings
from .modules.adguard import router as adguard_router
from .modules.caddy import router as caddy_router
from .modules.docker import router as docker_router
from .modules.wireguard import router as wireguard_router
from .shared import assign, auth, dashboard, export, health, instances
from .shared import settings as settings_module
from .shared.store import CorruptStoreError


# Module loggers (`logging.getLogger(__name__)`) propagate to root, and uvicorn
# configures only its own loggers — without a root handler every warning would land on
# logging.lastResort with no timestamp, level or module name. basicConfig is a no-op if
# a handler is already installed, so this never fights a host that configured logging.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # A settings.json that exists but doesn't parse aborts startup here rather than
    # booting on defaults — an empty dict would mean "no admin password set", which
    # re-opens the public first-run setup route. See settings.verify_readable.
    settings_module.verify_readable()
    # Seed the admin password from LOSKAI_PASSWORD once, if provided.
    auth.ensure_seeded()
    yield


app = FastAPI(title="Loskai", lifespan=lifespan)
app.add_middleware(auth.AuthMiddleware)


@app.exception_handler(CorruptStoreError)
async def corrupt_store(request: Request, exc: CorruptStoreError) -> JSONResponse:
    """Surface a broken store file to whoever hit it, naming the path.

    Both store files are documented as hand-editable, so this is an operator error with
    an operator fix — but the message only ever reached the server log, leaving a dead
    public dashboard and no reason why. Handling it here also means uvicorn no longer
    prints the traceback, so log it explicitly.

    Startup corruption is a separate path: `settings.verify_readable` aborts the boot
    (see the lifespan above). This is for a file edited while the app is running.
    """
    logger.error("corrupt store file: %s", exc, exc_info=True)
    return JSONResponse({"detail": str(exc)}, status_code=500)

# Shared routers first, then the four module routers.
app.include_router(auth.router)
app.include_router(settings_module.router)
app.include_router(health.router)
app.include_router(dashboard.router)
app.include_router(instances.router)
app.include_router(assign.router)
app.include_router(export.router)
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
