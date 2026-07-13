"""Settings manager — the priority chain: env var > settings.json > unset.

`config.settings` supplies the env layer; `settings.json` (in the data volume) is the
stored layer. Each value is resolved and tagged with its source so the UI can show
env-set values read-only. The admin password is stored only as a hash and is never
returned by the settings API.
"""

from ipaddress import ip_address
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Body

from ..config import settings as env
from . import store

Source = Literal["env", "stored", "unset"]

# Keys that can come from either env or settings.json (source-tracked, UI-editable).
CONFIGURABLE_KEYS = [
    "caddy_admin_url",
    "adguard_url",
    "adguard_user",
    "adguard_password",
    "wireguard_dashboard_url",
    "base_domain",
    "caddy_host_ip",
    "recipes_repo_url",
]
# Rendered as password inputs in the UI (value still returned over the auth-gated API).
SECRET_KEYS = {"adguard_password"}


def _path() -> Path:
    return Path(env.data_dir) / "settings.json"


def _read_stored() -> dict[str, Any]:
    return store.read_json(_path(), {})


def _write_stored(data: dict[str, Any]) -> None:
    store.write_json(_path(), data)


def resolve(key: str) -> tuple[Any, Source]:
    """Return (value, source) for a configurable key following the priority chain."""
    env_val = getattr(env, key, None)
    if env_val not in (None, ""):
        return env_val, "env"
    stored = _read_stored().get(key)
    if stored not in (None, ""):
        return stored, "stored"
    return None, "unset"


def value(key: str) -> Any:
    return resolve(key)[0]


def get_view() -> dict[str, Any]:
    """Source-tagged settings for GET /api/settings. Never includes the admin hash."""
    view: dict[str, Any] = {}
    for key in CONFIGURABLE_KEYS:
        val, source = resolve(key)
        view[key] = {"value": val, "source": source, "secret": key in SECRET_KEYS}
    # stacks_dir is env-only (drives the compose mount) — always shown read-only.
    view["stacks_dir"] = {"value": env.stacks_dir, "source": "env", "secret": False}
    return view


def update(payload: dict[str, Any]) -> dict[str, Any]:
    """Persist stored settings. Env-sourced and non-configurable keys are ignored."""
    stored = _read_stored()
    for key, val in payload.items():
        if key not in CONFIGURABLE_KEYS:
            continue
        if resolve(key)[1] == "env":
            continue  # env wins — never override from the UI
        if val in (None, ""):
            stored.pop(key, None)
        else:
            stored[key] = val
    _write_stored(stored)
    return get_view()


# --- Admin password hash (stored, never returned) ---


def admin_password_hash() -> str | None:
    return _read_stored().get("admin_password_hash")


def set_admin_password_hash(hashed: str) -> None:
    stored = _read_stored()
    stored["admin_password_hash"] = hashed
    _write_stored(stored)


# --- Answer-IP derivation (used by the AdGuard rewrite / assign flow) ---


def derive_caddy_host_ip() -> str | None:
    """The IP DNS rewrites resolve to: explicit CADDY_HOST_IP, else the host of
    CADDY_ADMIN_URL when that host is an IP. A hostname (Docker mode) returns None —
    CADDY_HOST_IP must be set explicitly there."""
    explicit = value("caddy_host_ip")
    if explicit:
        return explicit
    admin = value("caddy_admin_url")
    if not admin:
        return None
    host = urlparse(admin).hostname
    if not host:
        return None
    try:
        ip_address(host)
    except ValueError:
        return None
    return host


router = APIRouter(prefix="/api", tags=["settings"])


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return get_view()


@router.put("/settings")
def put_settings(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return update(payload)
