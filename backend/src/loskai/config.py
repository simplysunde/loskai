"""Startup configuration — the env layer of the settings priority chain.

Every value is optional: Loskai boots with nothing set and is configured through the
UI on first run. `settings.py` merges these env values (highest priority) with
`settings.json` (stored) to produce the resolved, source-tagged view.
"""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Anchored to this file rather than the process CWD, so `uv run uvicorn` finds the
# repo-root .env regardless of which directory it's launched from (e.g. backend/).
# In the built image this resolves to a path that never exists (no .env ships there —
# see Dockerfile), which is harmless: pydantic-settings silently skips a missing
# env_file and production gets its config from real env vars via compose either way.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_REPO_ROOT_ENV = _REPO_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        case_sensitive=False,
        extra="ignore",
        env_file=_REPO_ROOT_ENV,
        env_file_encoding="utf-8",
    )

    # --- Service connections (also settable via settings.json / the UI) ---
    caddy_admin_url: str | None = None
    adguard_url: str | None = None
    adguard_user: str | None = None
    adguard_password: str | None = None
    wireguard_dashboard_url: str | None = None
    base_domain: str | None = None
    # DNS-rewrite answer IP; derived from caddy_admin_url's host when omitted. Also the
    # host of the by-IP cert-onboarding link (http://<caddy_host_ip>/).
    caddy_host_ip: str | None = None
    # This Docker host's LAN IP. Wherever Caddy can't reach a container by name — always in
    # split-LXC, and per container elsewhere (logic.upstream_mode) — a route needs
    # <host_ip>:<published-port>; a bridged container can't detect its own host IP, so it's
    # set here once and used to auto-fill those upstreams.
    host_ip: str | None = None
    # Public git repo the install wizard syncs recipes from.
    recipes_repo_url: str | None = None
    # Where the Certificate page appears in the nav: "public" (everyone, like the
    # dashboard), "admin" (only once logged in), "hidden". Unset means public — the
    # internal CA is the default TLS mode, so the page is useful out of the box. An ACME
    # deployment has no internal root to hand out and sets this to "hidden".
    certificate_tab: str | None = None

    # --- Env-only settings (never written to settings.json) ---
    # Drives the compose bind mount, so it lives in the compose/env only. The default is
    # the repo's own `stacks/` (anchored like `_REPO_ROOT_ENV`, not the process CWD), which
    # is what makes `make backend` work with nothing set. Every compose file passes this
    # explicitly, so in a container the default only shows up when something is misconfigured
    # — and that unmounted fallback (`/stacks`: the image installs the source at `/app/src`,
    # so `_REPO_ROOT` is `/` there, not `/app`) surfaces as `stacks_dir_ok: false` rather
    # than silently scanning the wrong place.
    stacks_dir: str = str(_REPO_ROOT / "stacks")
    # Seeds the admin password hash at first run; only ever stored hashed.
    loskai_password: str | None = None
    # Where settings.json + instances.json + the session secret live — and `recipes/`,
    # the folder recipes are hand-added to, which is why this is a host bind mount
    # (compose: `./data:/data`) and not a path inside the image. Anchored to the repo's own
    # `data/` for the same reason as `stacks_dir`: running the backend directly needs no
    # config. The Dockerfile sets `LOSKAI_DATA_DIR=/data` and every compose file passes it
    # too, to match the mount — do not lean on this default landing on `/data` in the
    # image, which it would only do by accident of how deep the source happens to sit.
    data_dir: str = Field(
        default=str(_REPO_ROOT / "data"), validation_alias="LOSKAI_DATA_DIR"
    )
    # Built React bundle served in production; absent in dev (Vite serves the UI).
    static_dir: str = Field(default="static", validation_alias="LOSKAI_STATIC_DIR")


settings = Settings()
