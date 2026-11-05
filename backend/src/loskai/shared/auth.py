"""Accounts and sessions — the real security boundary.

The gate is server-side: middleware rejects every unauthenticated `/api/*` request except
the login flow and the public dashboard, and `access.py` decides what a signed-in user may
call. The React `RequireAuth` wrapper is UX only. An account (`users.py`) logs in with its
username and password into a signed HttpOnly cookie naming it; the static bundle is served
unauthenticated.
"""

import asyncio
import contextvars
import math
import re
import secrets
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, Response
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from ..config import settings as env
from . import access
from . import settings as settings_store
from . import store
from . import users
from .users import User

SESSION_COOKIE = "loskai_session"
# v2: the cookie names an account and its generation (v1 said only "authed").
_SESSION_SALT = "loskai-session-v2"
# A session is renewed — a fresh cookie, a fresh idle clock — on a request at least this
# long after its last renewal, so an active one never ends and an idle one does.
RENEW_AFTER = 60  # seconds

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


# --- Session cookie (signed, not encrypted — it names an account, nothing secret) ---


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


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(_session_secret(), salt=_SESSION_SALT)


def make_session(user: User) -> str:
    """A cookie for `user` under its current generation: logging out, a new password or the
    account removed bumps the generation, and every cookie of that user stops working."""
    return _serializer().dumps({"u": user.username, "g": user.generation})


def _read_session(token: str | None) -> tuple[User, float] | None:
    """The account a cookie names and when it was issued, while it is valid: signed by
    Loskai, younger than the idle time, its account still there under the same generation."""
    if not token:
        return None
    try:
        payload, issued = _serializer().loads(
            token, max_age=settings_store.session_idle_seconds(), return_timestamp=True
        )
    except (BadSignature, SignatureExpired):
        return None
    if not isinstance(payload, dict):
        return None
    user = users.get(str(payload.get("u")))
    if user is None or user.generation != payload.get("g"):
        return None
    return user, issued.timestamp()


def session_user(token: str | None) -> User | None:
    found = _read_session(token)
    return found[0] if found else None


# The account a request acts as — set by the middleware for HTTP, by each WebSocket for
# itself — so code far from the request (Loskai's SSH key, the log) knows who.
_current: contextvars.ContextVar[User | None] = contextvars.ContextVar("loskai_user", default=None)


def current_user() -> User | None:
    return _current.get()


def act_as(user: User | None) -> None:
    _current.set(user)


# How often an open terminal re-checks its session: logging out (which ends the user's
# sessions) or losing the tab closes it within this many seconds.
SESSION_RECHECK = 5.0


async def session_ended(token: str | None, tab: str) -> None:
    """Returns once the session `token` opened a terminal with is over: its account gone, its
    sessions ended (logout, a new password) or `tab` taken away. Not the idle time: a
    terminal lives in an open page, and an open page keeps its session — the cookie the
    terminal was opened with is never renewed, the browser's is. A WebSocket checks the
    cookie once, at connect; a shell must not outlive the session, so every terminal waits
    on this."""
    found = _read_session(token)
    if found is None:
        return
    opened = found[0]
    while True:
        await asyncio.sleep(SESSION_RECHECK)
        user = users.get(opened.username)
        if user is None or user.generation != opened.generation or not user.may(tab):
            return


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

    That address is `Host`, or `X-Forwarded-Host` behind a proxy that rewrites `Host`. A page
    can't forge the latter: a WebSocket takes no custom headers, and a request with one needs
    a CORS preflight, which Loskai never grants.
    """
    origin = headers.get("origin")
    if origin is None:
        return True
    sent_to = [headers.get("host", ""), *headers.get("x-forwarded-host", "").split(",")]
    return urlsplit(origin).netloc.lower() in {h.strip().lower() for h in sent_to if h.strip()}


# --- First-run seeding + state ---


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
        if not path.startswith("/api/"):
            return await call_next(request)  # the page and its files: served to anyone, no session
        public = (request.method, path) in PUBLIC_ROUTES or any(
            request.method == verb and pattern.match(path)
            for verb, pattern in PUBLIC_PATTERNS
        )
        found = _read_session(request.cookies.get(SESSION_COOKIE))
        if not public:
            if found is None:
                return JSONResponse({"detail": "Authentication required"}, status_code=401)
            # Signed in — but may this account call this? (access.py, one line per route)
            need = access.rule_for(request.method, path)
            if not access.allows(found[0], need):
                return JSONResponse({"detail": access.refusal(need)}, status_code=403)
        act_as(found[0] if found else None)
        response = await call_next(request)
        # In use: a fresh cookie, so the idle clock starts again — unless the request ended
        # the session (logout) or replaced it (a new password).
        if found and time.time() - found[1] > RENEW_AFTER and not any(c.startswith(SESSION_COOKIE + "=") for c in response.headers.getlist("set-cookie")):
            user = users.get(found[0].username)
            if user is not None and user.generation == found[0].generation:
                set_cookie(request, response, user)
        return response


# --- Login backoff ---

# Wrong passwords allowed before each one costs a wait, which then doubles up to the cap.
FREE_FAILURES = 5
MAX_WAIT = 60  # seconds
# A wrong password this long after the last one starts the count again: a guesser who gave
# up must not cost the admin's typo a minute, days later.
QUIET_RESET = 15 * 60  # seconds


class _Backoff:
    """Wrong passwords counted per username — not per IP: behind Caddy every request comes from
    Caddy's address — so a right password clears only its own account's count: an operator
    signing in can't wipe the count of someone guessing the admin's. The price is that a
    guesser's waits are that account's too — one who keeps guessing keeps it out. One check
    at a time, for everyone (`lock`). In memory: a restart clears it."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.counts: dict[str, list[float]] = {}  # username → [failures, until, last failure]

    def wait_left(self, username: str) -> float:
        return self.counts.get(username, [0, 0.0, 0.0])[1] - time.monotonic()

    def failed(self, username: str) -> None:
        now = time.monotonic()
        # Names nobody has guessed for a while go, so made-up ones can't pile up.
        for name in [n for n, (_, until, last) in self.counts.items() if now - last > QUIET_RESET and until < now]:
            del self.counts[name]
        count = self.counts.setdefault(username, [0, 0.0, 0.0])
        if now - count[2] > QUIET_RESET:
            count[0] = 0
        count[2] = now
        count[0] += 1
        if count[0] > FREE_FAILURES:
            count[1] = now + min(2 ** (count[0] - FREE_FAILURES), MAX_WAIT)

    def reset(self, username: str) -> None:
        self.counts.pop(username, None)


_backoff = _Backoff()


def check_password(password: str, wrong_status: int = 401, username: str | None = None) -> User:
    """The one place a typed password is checked — at login (`username` given), and again
    before an action that asks for it (Loskai's SSH key: the signed-in user's own) — so the
    backoff covers both: a stolen cookie can't guess through the second. `wrong_status` is
    403 there, since a 401 sends the page to /login. Returns the account."""
    if username is None:
        me = current_user()
        if me is None:
            raise HTTPException(status_code=401, detail="Authentication required")
        username = me.username
    # One password check at a time, so parallel guesses can't all land before the first
    # failure counts. The rest are turned away, not queued: a queue would hold a worker
    # thread each, which every other sync route needs too.
    if not _backoff.lock.acquire(blocking=False):
        raise HTTPException(
            status_code=429,
            detail="Another password is being checked. Try again.",
            headers={"Retry-After": "1"},
        )
    try:
        wait = _backoff.wait_left(username)
        if wait > 0:
            seconds = math.ceil(wait)
            raise HTTPException(
                status_code=429,
                detail=f"Too many wrong passwords. Try again in {seconds} s.",
                headers={"Retry-After": str(seconds)},
            )
        user = users.verify(username, password)
        if user is None:
            _backoff.failed(username)
            raise HTTPException(status_code=wrong_status, detail="Wrong username or password" if wrong_status == 401 else "Wrong password")
        _backoff.reset(username)
        return user
    finally:
        _backoff.lock.release()


# --- Routes ---

router = APIRouter(prefix="/api", tags=["auth"])


class LoginBody(BaseModel):
    username: str
    password: str


class NewPassword(BaseModel):
    current: str
    new: str


def _over_https(request: Request) -> bool:
    """Whether the browser reached Loskai over HTTPS. Caddy terminates TLS and says so in
    `X-Forwarded-Proto`. Anyone can send that header, but a `Secure` cookie on a plain-HTTP
    answer only means their own browser won't send it back."""
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"


def set_cookie(request: Request, response: Response, user: User) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        make_session(user),
        max_age=settings_store.session_idle_seconds(),
        httponly=True,
        samesite="lax",
        # Secure when it was set over HTTPS, so it is never sent in the clear; a login on
        # plain `:8080` (dev, or before Loskai is routed) has to get one that works there.
        secure=_over_https(request),
    )


@router.get("/auth/status")
def auth_status(request: Request) -> dict:
    """Whether this browser is signed in, as whom, and whether first-run setup is due."""
    user = session_user(request.cookies.get(SESSION_COOKIE))
    return {"authed": user is not None, "needs_setup": not users.any_users(), "user": user.view() if user else None}


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response) -> dict:
    user = check_password(body.password, username=body.username.strip().lower())
    set_cookie(request, response, user)
    return {"authed": True, "user": user.view()}


@router.post("/logout")
def logout(request: Request, response: Response) -> dict[str, bool]:
    # Deleting the cookie only forgets this browser's copy; a stolen one would live on.
    # Ending the user's sessions ends it too — on every device, theirs and nobody else's.
    # Only a signed-in logout does, or anyone on the LAN could sign a user out.
    user = session_user(request.cookies.get(SESSION_COOKIE))
    if user is not None:
        users.end_sessions(user.username)
    response.delete_cookie(SESSION_COOKIE)
    return {"authed": False}


@router.post("/auth/setup")
def setup(body: LoginBody, request: Request, response: Response) -> dict:
    """First run: create the admin account and sign in as it. Refuses once any account exists."""
    if users.any_users():  # early, before hashing; `first` is the check that holds
        raise HTTPException(status_code=409, detail="Loskai is already set up")
    user = users.create(body.username.strip().lower(), body.password, "admin", first=True)
    set_cookie(request, response, user)
    return {"authed": True, "user": user.view()}


@router.post("/auth/password")
def change_password(body: NewPassword, request: Request, response: Response) -> dict:
    """Change your own password, given the current one. Your other sessions end; this one
    goes on with a fresh cookie."""
    me = check_password(body.current, wrong_status=403)
    user = users.set_password(me.username, body.new)
    set_cookie(request, response, user)
    return {"user": user.view()}
