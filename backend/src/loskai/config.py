"""Startup configuration — the env layer of the settings priority chain.

Every value is optional: Loskai boots with nothing set and is configured through the
UI on first run. `settings.py` merges these env values (highest priority) with
`settings.json` (stored) to produce the resolved, source-tagged view.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=False, extra="ignore")

    # --- Service connections (also settable via settings.json / the UI) ---
    caddy_admin_url: str | None = None
    adguard_url: str | None = None
    adguard_user: str | None = None
    adguard_password: str | None = None
    wireguard_dashboard_url: str | None = None
    base_domain: str | None = None
    # DNS-rewrite answer IP; derived from caddy_admin_url's host when omitted.
    caddy_host_ip: str | None = None
    # Public git repo the install wizard syncs recipes from.
    recipes_repo_url: str | None = None

    # --- Env-only settings (never written to settings.json) ---
    # Drives the compose bind mount, so it lives in the compose/env only.
    stacks_dir: str = "/opt/stacks"
    # Seeds the admin password hash at first run; only ever stored hashed.
    loskai_password: str | None = None
    # Where settings.json + instances.json + the session secret live.
    data_dir: str = Field(default="/opt/loskai", validation_alias="LOSKAI_DATA_DIR")
    # Built React bundle served in production; absent in dev (Vite serves the UI).
    static_dir: str = Field(default="static", validation_alias="LOSKAI_STATIC_DIR")


settings = Settings()
