"""Single-password auth — the real security boundary.

The gate is server-side: middleware rejects every unauthenticated `/api/*` request
except the login flow and the public dashboard. The React `RequireAuth` wrapper is
UX only. There are no accounts — one admin password, stored hashed (argon2), verified
into a signed HttpOnly session cookie. The static bundle is served unauthenticated.
"""

import math
import re
import secrets
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error
from fastapi import APIRouter, HTTPException, Request, Response
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from ..config import settings as env
from . import settings as settings_store
from . import store

_ph = PasswordHasher()

SESSION_COOKIE = "loskai_session"
SESSION_MAX_AGE = 7 * 24 * 3600  # seconds
_SESSION_SALT = "loskai-session-v1"
MIN_PASSWORD_LEN = 8

# The only endpoints reachable without a session: the public dashboard + the login
# flow (you can't authenticate if login itself requires auth). Everything else 401s.
# Public routes whose path carries a parameter, so they cannot be exact tuples above.
# Deliberately a short, anchored list: everything here is readable by anyone who can reach
# Loskai. `scripts/check-docs.sh` asserts each one is named in CLAUDE.md, same as the set.
PUBLIC_PATTERNS = [
    # Launcher icons. The Dashboard is unauthenticated, so a card has to render its icon
    # before anyone logs in. Images only, sniffed on upload (see shared/icons.py).
    ("GET", re.compile(r"^/api/instances/[^/]+/icon$")),
]

PUBLIC_ROUTES = {
    ("GET", "/api/dashboard"),
    ("GET", "/api/caddy/root-certificate"),
    ("GET", "/api/auth/status"),
    ("POST", "/api/login"),
    ("POST", "/api/logout"),
    ("POST", "/api/auth/setup"),
}


# --- Password hashing ---


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(hashed: str, password: str) -> bool:
    try:
        return _ph.verify(hashed, password)
    except Argon2Error:
        return False


# --- Session cookie (signed, not encrypted — payload is just a marker) ---


def _secret_path() -> Path:
    return Path(env.data_dir) / "session_secret"


def _session_secret() -> str:
    """Read the persisted session secret, generating it once on first use so sessions
    survive restarts. Lives in the data volume, outside the settings API surface."""
    path = _secret_path()
    if path.exists():
        secret = path.read_text(encoding="utf-8").strip()
        # Never sign with an empty key: itsdangerous accepts one, and anyone could then
        # sign a session. An empty file is treated as no file.
        if secret:
            return secret
    return _new_secret()


def _new_secret() -> str:
    secret = secrets.token_urlsafe(48)
    # Replaced whole, never truncated in place: logout rewrites it while it is in use.
    store.replace_private(_secret_path(), secret)
    return secret


def end_all_sessions() -> None:
    """Every cookie is signed with the secret, so a new one invalidates them all. A cookie
    holds no id to revoke one by, and with one admin there is no one else's session to keep."""
    _new_secret()


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(_session_secret(), salt=_SESSION_SALT)


def make_session() -> str:
    return _serializer().dumps({"authed": True})


def valid_session(token: str | None) -> bool:
    if not token:
        return False
    try:
        _serializer().loads(token, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return False
    return True


# --- Origin check ---

# Methods that never change anything; every other one is checked against the Origin.
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def same_origin(headers) -> bool:
    """Whether a request comes from one of Loskai's own pages, or from no page at all.

    SameSite=Lax stops other *sites*, but an app on a sibling subdomain is the same site:
    the browser sends it the session cookie too. Its page can't read Loskai's answers, but it
    can send a body-less POST and open a WebSocket — a root shell — with the cookie attached.
    Browsers name the sending page in `Origin`; it has to be the address the request was
    sent to. A request without one is not from a browser page, and still needs the cookie.
    """
    origin = headers.get("origin")
    if origin is None:
        return True
    return urlsplit(origin).netloc.lower() == headers.get("host", "").lower()


# --- First-run seeding + state ---


def password_set() -> bool:
    return settings_store.admin_password_hash() is not None


def ensure_seeded() -> None:
    """If LOSKAI_PASSWORD is set in the env and no hash exists yet, seed it once."""
    if not password_set() and env.loskai_password:
        settings_store.set_admin_password_hash(hash_password(env.loskai_password))


# --- Middleware ---


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if (
            path.startswith("/api/")
            and request.method not in SAFE_METHODS
            and not same_origin(request.headers)
        ):
            return JSONResponse({"detail": "Cross-origin request refused"}, status_code=403)
        public = (request.method, path) in PUBLIC_ROUTES or any(
            request.method == verb and pattern.match(path)
            for verb, pattern in PUBLIC_PATTERNS
        )
        if path.startswith("/api/") and not public:
            if not valid_session(request.cookies.get(SESSION_COOKIE)):
                return JSONResponse(
                    {"detail": "Authentication required"}, status_code=401
                )
        return await call_next(request)


# --- Login backoff ---

# Wrong passwords allowed before each one costs a wait, which then doubles up to the cap.
FREE_FAILURES = 5
MAX_WAIT = 60  # seconds


class _Backoff:
    """One counter for every client, not one per IP: behind Caddy every request comes from
    Caddy's address. The price is that someone guessing also delays the admin — by a minute
    at most per attempt, where the guesser gets one try a minute. In memory: a restart clears it."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.failures = 0
        self.until = 0.0

    def wait_left(self) -> float:
        return self.until - time.monotonic()

    def failed(self) -> None:
        self.failures += 1
        if self.failures > FREE_FAILURES:
            self.until = time.monotonic() + min(2 ** (self.failures - FREE_FAILURES), MAX_WAIT)

    def reset(self) -> None:
        self.failures = 0
        self.until = 0.0


_backoff = _Backoff()


# --- Routes ---

router = APIRouter(prefix="/api", tags=["auth"])


class PasswordBody(BaseModel):
    password: str


def _over_https(request: Request) -> bool:
    """Whether the browser reached Loskai over HTTPS. Caddy terminates TLS and says so in
    `X-Forwarded-Proto`. Anyone can send that header, but a `Secure` cookie on a plain-HTTP
    answer only means their own browser won't send it back."""
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"


def _issue_session(request: Request, response: Response) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        make_session(),
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        # Secure when it was set over HTTPS, so it is never sent in the clear; a login on
        # plain `:8080` (dev, or before Loskai is routed) has to get one that works there.
        secure=_over_https(request),
    )


@router.get("/auth/status")
def auth_status(request: Request) -> dict[str, bool]:
    return {
        "authed": valid_session(request.cookies.get(SESSION_COOKIE)),
        "password_set": password_set(),
    }


@router.post("/login")
def login(body: PasswordBody, request: Request, response: Response) -> dict[str, bool]:
    hashed = settings_store.admin_password_hash()
    if hashed is None:
        raise HTTPException(status_code=409, detail="No admin password set — complete first-run setup")
    # Held across the check, so parallel guesses queue instead of all landing before the
    # first failure counts.
    with _backoff.lock:
        wait = _backoff.wait_left()
        if wait > 0:
            seconds = math.ceil(wait)
            raise HTTPException(
                status_code=429,
                detail=f"Too many wrong passwords. Try again in {seconds} s.",
                headers={"Retry-After": str(seconds)},
            )
        if not verify_password(hashed, body.password):
            _backoff.failed()
            raise HTTPException(status_code=401, detail="Invalid password")
        _backoff.reset()
    _issue_session(request, response)
    return {"authed": True}


@router.post("/logout")
def logout(request: Request, response: Response) -> dict[str, bool]:
    # Deleting the cookie only forgets this browser's copy; a stolen one would live out its
    # 7 days. Only a signed-in logout ends them, or anyone on the LAN could sign the admin out.
    if valid_session(request.cookies.get(SESSION_COOKIE)):
        end_all_sessions()
    response.delete_cookie(SESSION_COOKIE)
    return {"authed": False}


@router.post("/auth/setup")
def setup(body: PasswordBody, request: Request, response: Response) -> dict[str, bool]:
    """First-run: set the initial admin password. Refuses once one exists."""
    if password_set():
        raise HTTPException(status_code=409, detail="Admin password already set")
    if len(body.password) < MIN_PASSWORD_LEN:
        raise HTTPException(
            status_code=422,
            detail=f"Password must be at least {MIN_PASSWORD_LEN} characters",
        )
    settings_store.set_admin_password_hash(hash_password(body.password))
    _issue_session(request, response)
    return {"authed": True, "password_set": True}
