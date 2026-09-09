"""Settings manager — the priority chain: env var > settings.json > unset.

`config.settings` supplies the env layer; `settings.json` (in the data volume) is the
stored layer. Each value is resolved and tagged with its source so the UI can show
env-set values read-only. The admin password is stored only as a hash and is never
returned by the settings API.
"""

import logging
from collections.abc import Callable
from ipaddress import ip_address
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Body, HTTPException

from ..config import settings as env
from . import store

logger = logging.getLogger(__name__)

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
    "certificate_tab",
]
# Rendered as password inputs in the UI (value still returned over the auth-gated API).
SECRET_KEYS = {"adguard_password"}

# Where the Certificate page appears in the nav. This is presentation, not a security
# boundary: the root CA it hands out is public material (every LAN device installs it),
# so `GET /api/caddy/root-certificate` stays public in all three modes — see
# docs/guides/certificate-setup.md.
CERTIFICATE_TAB_MODES = ("public", "admin", "hidden")
CERTIFICATE_TAB_DEFAULT = "public"


def _path() -> Path:
    return Path(env.data_dir) / "settings.json"


def _as_object(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise store.CorruptStoreError(f"{_path()} must contain a JSON object")
    return raw


def _read_stored() -> dict[str, Any]:
    return _as_object(store.read_json(_path(), {}))


def verify_readable() -> None:
    """Fail fast at startup when settings.json exists but doesn't parse.

    Deliberately *not* a fall back to an empty dict: `auth.password_set()` reads
    `admin_password_hash` from here, and `POST /api/auth/setup` is public and only
    refuses once a hash exists — so a silent default would re-open first-run setup on a
    configured install, and the first write would clobber every other stored key.
    Raises `store.CorruptStoreError` (naming the path) — startup then aborts.
    """
    _read_stored()


def _update_stored(mutate: Callable[[dict[str, Any]], dict[str, Any]]) -> None:
    """The one write path for settings.json — read-modify-write under the store lock, so
    two saves in flight can't each write back a dict missing the other's key."""
    store.update_json(_path(), {}, lambda raw: mutate(_as_object(raw)))


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


def certificate_tab() -> str:
    """The Certificate page's nav visibility, normalised. Unset -> the default.

    A stored value can only be one of the modes (`_validate` rejects the rest), but the
    env layer never passes through validation, so a typo in `CERTIFICATE_TAB` falls back
    to the default rather than hiding the page by accident.
    """
    val = value("certificate_tab")
    return val if val in CERTIFICATE_TAB_MODES else CERTIFICATE_TAB_DEFAULT


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
            parsed = ip_address(str(val).strip())
        except ValueError:
            raise ValueError(
                "Caddy LAN IP must be a bare IP address (e.g. 192.168.10.100) — no scheme or port"
            )
        # AdGuard hands this answer to every LAN client, so it has to name a host those
        # clients can open a connection to. Two bare IPs pass the parse above and cannot:
        # loopback points each client at itself, and the unspecified address is a bind
        # wildcard rather than a destination. Both fail as a refused connection, never as
        # a DNS error, which is why they are caught here. See derive_caddy_host_ip.
        if parsed.is_loopback:
            raise ValueError(
                "Caddy LAN IP must be an address other machines can reach — a loopback "
                "address (e.g. 127.0.0.1) makes every client resolve the service to "
                "itself. Use the host's LAN IP (e.g. 192.168.10.100)"
            )
        if parsed.is_unspecified:
            raise ValueError(
                "Caddy LAN IP must be a specific address — 0.0.0.0 (and ::) means 'any "
                "interface', which is something to listen on, not something to connect "
                "to. Use the host's LAN IP (e.g. 192.168.10.100)"
            )
    if key == "certificate_tab" and val not in CERTIFICATE_TAB_MODES:
        raise ValueError(
            f"Certificate tab must be one of {', '.join(CERTIFICATE_TAB_MODES)}"
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

    def apply(stored: dict[str, Any]) -> dict[str, Any]:
        for key, val in payload.items():
            if key not in CONFIGURABLE_KEYS:
                continue
            if _resolve(key, stored)[1] == "env":
                continue  # env wins — never override from the UI
            if val in (None, ""):
                stored.pop(key, None)
            else:
                _validate(key, val)  # raises before anything is written
                stored[key] = val
        return stored

    _update_stored(apply)
    return get_view()


# --- Admin password hash (stored, never returned) ---


def admin_password_hash() -> str | None:
    return _read_stored().get("admin_password_hash")


def set_admin_password_hash(hashed: str) -> None:
    _update_stored(lambda stored: {**stored, "admin_password_hash": hashed})


# --- Answer-IP derivation (used by the AdGuard rewrite / assign flow) ---


def _usable_answer_ip(candidate: str, source: str) -> str | None:
    """Drop an answer IP no LAN client can connect to, else pass it through.

    Two parse as valid IPs but are not destinations: loopback (every client resolves the
    service to itself) and the unspecified address `0.0.0.0` / `::` (a bind wildcard —
    "any interface" is a thing to listen on, not to reach). Whether the value is a
    well-formed IP at all is `_validate`'s job; one that doesn't parse is passed through
    so this stays a single-purpose guard.
    """
    try:
        parsed = ip_address(str(candidate).strip())
    except ValueError:
        return candidate
    reason = (
        "loopback" if parsed.is_loopback
        else "unspecified" if parsed.is_unspecified
        else None
    )
    if reason:
        logger.warning(
            "ignoring %s answer IP %s from %s — set CADDY_HOST_IP to the host's LAN IP, "
            "or routed services resolve to nothing a client can reach",
            reason,
            candidate,
            source,
        )
        return None
    return candidate


def derive_caddy_host_ip() -> str | None:
    """The IP DNS rewrites resolve to: explicit CADDY_HOST_IP, else the host of
    CADDY_ADMIN_URL when that host is an IP. A hostname (Docker mode) returns None —
    CADDY_HOST_IP must be set explicitly there.

    **Never returns a loopback or unspecified address**, from either source. AdGuard hands
    the answer to every LAN client, so `127.0.0.1` makes each one resolve the routed service
    to itself and `0.0.0.0` names no host at all.
    `_validate` blocks that on the way in, but only for the UI: `CADDY_HOST_IP` can also
    arrive from the environment, which never passes through validation, and the derived
    path picks it up silently from a loopback `CADDY_ADMIN_URL`.

    Dropping to None rather than raising is deliberate — it is the same state as an unset
    answer IP, which every caller already handles (the rewrite is skipped, the UI reports
    it unconfigured). Raising would fail an /api/health poll and an assign for what is a
    configuration problem, not a runtime one.
    """
    explicit = value("caddy_host_ip")
    if explicit:
        return _usable_answer_ip(explicit, "CADDY_HOST_IP")
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
    return _usable_answer_ip(host, "CADDY_ADMIN_URL")


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
