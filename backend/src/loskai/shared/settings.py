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

from fastapi import APIRouter, Body, HTTPException

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
    "host_ip",
    "recipes_repo_url",
]
# Rendered as password inputs in the UI (value still returned over the auth-gated API).
SECRET_KEYS = {"adguard_password"}


def _path() -> Path:
    return Path(env.data_dir) / "settings.json"


def _read_stored() -> dict[str, Any]:
    stored = store.read_json(_path(), {})
    if not isinstance(stored, dict):
        raise store.CorruptStoreError(f"{_path()} must contain a JSON object")
    return stored


def verify_readable() -> None:
    """Fail fast at startup when settings.json exists but doesn't parse.

    Deliberately *not* a fall back to an empty dict: `auth.password_set()` reads
    `admin_password_hash` from here, and `POST /api/auth/setup` is public and only
    refuses once a hash exists — so a silent default would re-open first-run setup on a
    configured install, and the first write would clobber every other stored key.
    Raises `store.CorruptStoreError` (naming the path) — startup then aborts.
    """
    _read_stored()


def _write_stored(data: dict[str, Any]) -> None:
    store.write_json(_path(), data)


def _resolve(key: str, stored: dict[str, Any]) -> tuple[Any, Source]:
    """Resolve one key against an already-read stored dict (avoids re-reading the file)."""
    env_val = getattr(env, key, None)
    if env_val not in (None, ""):
        return env_val, "env"
    stored_val = stored.get(key)
    if stored_val not in (None, ""):
        return stored_val, "stored"
    return None, "unset"


def resolve(key: str) -> tuple[Any, Source]:
    """Return (value, source) for a configurable key following the priority chain."""
    return _resolve(key, _read_stored())


def value(key: str) -> Any:
    return resolve(key)[0]


def get_view() -> dict[str, Any]:
    """Source-tagged settings for GET /api/settings. Never includes the admin hash."""
    stored = _read_stored()  # read once, resolve every key against it
    view: dict[str, Any] = {}
    for key in CONFIGURABLE_KEYS:
        val, source = _resolve(key, stored)
        view[key] = {"value": val, "source": source, "secret": key in SECRET_KEYS}
    # stacks_dir is env-only (drives the compose mount) — always shown read-only.
    view["stacks_dir"] = {"value": env.stacks_dir, "source": "env", "secret": False}
    return view


def _validate(key: str, val: Any) -> None:
    """Reject values that would corrupt downstream use. Raises ValueError (→ 422)."""
    if key == "caddy_host_ip":
        # This becomes the answer for every AdGuard rewrite, so it must be a bare IP —
        # a scheme or port (e.g. 'http://10.0.0.5') produces unresolvable rewrites.
        try:
            ip_address(str(val).strip())
        except ValueError:
            raise ValueError(
                "Caddy LAN IP must be a bare IP address (e.g. 192.168.10.100) — no scheme or port"
            )
    if key == "host_ip":
        # Prefixed onto a published port to form a container upstream, so it must be a bare IP.
        try:
            ip_address(str(val).strip())
        except ValueError:
            raise ValueError(
                "Host IP must be a bare IP address (e.g. 192.168.10.50) — no scheme or port"
            )


def update(payload: dict[str, Any]) -> dict[str, Any]:
    """Persist stored settings. Env-sourced and non-configurable keys are ignored."""
    stored = _read_stored()
    for key, val in payload.items():
        if key not in CONFIGURABLE_KEYS:
            continue
        if _resolve(key, stored)[1] == "env":
            continue  # env wins — never override from the UI
        if val in (None, ""):
            stored.pop(key, None)
        else:
            _validate(key, val)
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
    try:
        return update(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
