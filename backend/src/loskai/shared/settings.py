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

from ..config import DEFAULT_RECIPES_REPO
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
    "recipes_repos",
    "certificate_tab",
    "ssh_unlock_minutes",
    "session_idle_minutes",
]
# Rendered as password inputs in the UI (value still returned over the auth-gated API).
SECRET_KEYS = {"adguard_password"}

# Configurable keys with **no env layer** — stored or unset, never set from the
# environment. `_resolve` needs no special case (there is simply no attribute of that name
# on `config.Settings`); this names them so the three-places enumeration test can tell a
# deliberately stored-only key from one forgotten in `config.Settings`.
#
# `recipes_repos` is the only one. It is a list of rows managed in Settings > General, and
# nothing about recipe sources is needed before the UI is reachable — unlike a service URL
# or the admin password, which are the reason the env layer exists at all. Giving it one
# would mean two ways to say the same thing, and would let the editor go read-only for a
# value you can always just edit.
STORED_ONLY_KEYS = {"recipes_repos"}

# Where the Certificate page appears in the nav. This is presentation, not a security
# boundary: the root CA it hands out is public material (every LAN device installs it),
# so `GET /api/caddy/root-certificate` stays public in all three modes — see
# docs/guides/certificate-setup.md.
CERTIFICATE_TAB_MODES = ("public", "admin", "hidden")
CERTIFICATE_TAB_DEFAULT = "public"

# How long typing your password unlocks Loskai's SSH key (modules/ssh/unlock.py), in
# minutes — a few fixed choices, from a short sudo-like window to a working day and a whole
# one. Logging out locks it whatever this says.
SSH_UNLOCK_CHOICES = ("15", "60", "180", "480", "1440")
SSH_UNLOCK_DEFAULT = "15"

# How long a session lasts without activity, in minutes; each request renews it. 2 hours,
# like Proxmox's ticket, unless chosen otherwise — up to a week.
SESSION_IDLE_CHOICES = ("30", "60", "120", "480", "1440", "10080")
SESSION_IDLE_DEFAULT = "120"

# The settings that are one of a few choices: the choices, the default, and what a value
# outside them is told (`_validate`). The env layer isn't validated, so `choice` reads a
# value outside them as the default.
_CHOICES = {
    "certificate_tab": (CERTIFICATE_TAB_MODES, CERTIFICATE_TAB_DEFAULT, "Certificate tab must be one of {}"),
    "ssh_unlock_minutes": (
        SSH_UNLOCK_CHOICES, SSH_UNLOCK_DEFAULT, "How long the SSH key stays unlocked must be one of {} minutes",
    ),
    "session_idle_minutes": (
        SESSION_IDLE_CHOICES, SESSION_IDLE_DEFAULT, "How long a session lasts idle must be one of {} minutes",
    ),
}

# Recipe sources are the one configurable value that is a list rather than a string: a
# git repo per entry, each independently enabled. Capped only to keep one bad PUT from
# turning "Refresh recipes" into an unbounded pile of git clones.
MAX_RECIPE_SOURCES = 20


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

    Deliberately *not* a fall back to an empty dict: an install from before accounts
    keeps its admin password here until `users.ensure_seeded` moves it, and the first
    write would clobber every other stored key.
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


def choice(key: str) -> str:
    """A choice setting's value — the default when unset or not one of its choices (a typo
    in `CERTIFICATE_TAB` falls back rather than hiding the page by accident)."""
    choices, default, _ = _CHOICES[key]
    val = str(value(key) or "")
    return val if val in choices else default


def certificate_tab() -> str:
    """The Certificate page's nav visibility."""
    return choice("certificate_tab")


def ssh_unlock_seconds() -> int:
    """How long an unlock of the SSH key lasts."""
    return int(choice("ssh_unlock_minutes")) * 60


def session_idle_seconds() -> int:
    """How long a session lives without a request."""
    return int(choice("session_idle_minutes")) * 60


def _source_view(entry: Any) -> dict[str, Any]:
    """One stored source entry, normalised for both the scanner and the UI.

    `builtin` is derived from the URL rather than stored, so the flag can never disagree
    with what `DEFAULT_RECIPES_REPO` currently is — including after that constant moves
    to the public repo, when the old URL simply stops being the built-in one.
    """
    entry = entry if isinstance(entry, dict) else {"url": str(entry)}
    url = str(entry.get("url") or "").strip()
    return {
        "url": url,
        "enabled": bool(entry.get("enabled", True)),
        "name": entry.get("name") or None,
        "builtin": url == DEFAULT_RECIPES_REPO,
    }


def recipe_sources() -> tuple[list[dict[str, Any]], Source]:
    """The install wizard's git sources, in priority order, with their source tag.

    Unset means *nothing configured yet*, not *no sources*: the list is seeded with the
    built-in default so a fresh install has somewhere to sync from. Which is why a stored
    empty list is a real value here and never an unset marker — deleting every source is
    how you say "none", and it has to survive a restart rather than re-seeding itself.

    The local `recipes/` dir is not in this list. It is always scanned, needs no URL, and
    cannot be disabled — see `recipes.py`, which appends it last.
    """
    val, source = _resolve("recipes_repos", _read_stored())
    if source != "unset":
        entries = val if isinstance(val, list) else []
        return [_source_view(e) for e in entries if _source_view(e)["url"]], source
    return [_source_view({"url": DEFAULT_RECIPES_REPO})], "unset"


def get_view() -> dict[str, Any]:
    """Source-tagged settings for GET /api/settings. Never includes the admin hash."""
    stored = _read_stored()  # read once, resolve every key against it
    view: dict[str, Any] = {}
    for key in CONFIGURABLE_KEYS:
        val, source = _resolve(key, stored)
        view[key] = {"value": val, "source": source, "secret": key in SECRET_KEYS}
    # The one structured value: the generic resolve above reports it unset on a fresh
    # install, but the editor has to render the seeded built-in default (and its toggle),
    # so the effective list replaces it. `builtin` on the entry is what labels the default.
    sources, sources_source = recipe_sources()
    view["recipes_repos"] = {"value": sources, "source": sources_source, "secret": False}
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
        # AdGuard hands this answer to every LAN client (`_unreachable`). Both fail as a
        # refused connection, never as a DNS error, which is why they are caught here.
        reason = _unreachable(parsed)
        if reason == "loopback":
            raise ValueError(
                "Caddy LAN IP must be an address other machines can reach — a loopback "
                "address (e.g. 127.0.0.1) makes every client resolve the service to "
                "itself. Use the host's LAN IP (e.g. 192.168.10.100)"
            )
        if reason == "unspecified":
            raise ValueError(
                "Caddy LAN IP must be a specific address — 0.0.0.0 (and ::) means 'any "
                "interface', which is something to listen on, not something to connect "
                "to. Use the host's LAN IP (e.g. 192.168.10.100)"
            )
    if key in _CHOICES and val not in _CHOICES[key][0]:
        choices, _, refusal = _CHOICES[key]
        raise ValueError(refusal.format(", ".join(choices)))
    if key == "recipes_repos":
        if not isinstance(val, list):
            raise ValueError("Recipe sources must be a list")
        if len(val) > MAX_RECIPE_SOURCES:
            raise ValueError(f"At most {MAX_RECIPE_SOURCES} recipe sources")
        seen: set[str] = set()
        for entry in val:
            if not isinstance(entry, dict):
                raise ValueError("Each recipe source must be an object with a 'url'")
            url = str(entry.get("url") or "").strip()
            if not url:
                raise ValueError("A recipe source needs a 'url'")
            # http(s) only. `git clone` would also take ssh:// or a local path, but the
            # sync is deliberately anonymous (public repos, no key material in Loskai),
            # and a bare path would point the wizard at the container's own filesystem.
            if not url.startswith(("http://", "https://")):
                raise ValueError(
                    f"Recipe source must be an http:// or https:// git URL — got '{url}'"
                )
            if url in seen:
                raise ValueError(f"Duplicate recipe source: {url}")
            seen.add(url)
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
                # An empty *list* is not an unset value: `recipes_repos: []` is how "no
                # git sources at all" is stored, and it has to persist rather than let
                # the built-in default re-seed itself on the next read.
                _validate(key, val)  # raises before anything is written
                stored[key] = val
        return stored

    _update_stored(apply)
    return get_view()


# --- Admin password hash (stored, never returned) ---


def admin_password_hash() -> str | None:
    """The one admin password of an install from before accounts — read once, to make it the
    account `admin` (users.ensure_seeded), then dropped."""
    return _read_stored().get("admin_password_hash")


def drop_admin_password_hash() -> None:
    _update_stored(lambda stored: {k: v for k, v in stored.items() if k != "admin_password_hash"})


# --- Answer-IP derivation (used by the AdGuard rewrite / assign flow) ---


def _unreachable(ip) -> str | None:
    """Why no LAN client can connect to this IP, if none can: two parse as valid IPs but
    are not destinations — loopback (every client resolves the service to itself) and the
    unspecified address `0.0.0.0` / `::` (a bind wildcard, a thing to listen on)."""
    return "loopback" if ip.is_loopback else "unspecified" if ip.is_unspecified else None


def _usable_answer_ip(candidate: str, source: str) -> str | None:
    """Drop an answer IP no LAN client can connect to, else pass it through.

    Whether the value is a well-formed IP at all is `_validate`'s job; one that doesn't
    parse is passed through so this stays a single-purpose guard.
    """
    try:
        parsed = ip_address(str(candidate).strip())
    except ValueError:
        return candidate
    reason = _unreachable(parsed)
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


def caddy_host() -> str | None:
    """CADDY_ADMIN_URL's hostname — how Caddy's own container is found among Docker's, to
    decide how it dials each container (`docker/logic.upstream_mode`). An IP host matches
    no container, which is right: Caddy is then off-box."""
    return urlparse(value("caddy_admin_url") or "").hostname


def dns_context() -> tuple[str | None, str | None]:
    """The base domain and the address every DNS rewrite answers with — read together by
    everything that writes, checks or lists a route's rewrite."""
    return value("base_domain"), derive_caddy_host_ip()


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
    """Every tab reads a setting or two (the base domain); only an admin sees the secrets."""
    from .auth import current_user  # auth imports this module

    view = get_view()
    me = current_user()
    if me is None or not me.admin:
        for entry in view.values():
            if entry["secret"]:
                entry["value"] = None
    return view


@router.put("/settings")
def put_settings(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        return update(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
