"""What every terminal WebSocket shares — a container's and a machine's.

WebSockets never pass the HTTP middleware, so `accept` is their gate: the session cookie,
the `Origin` (a browser opens a WebSocket from any page, cookie attached) and the account's
tab, or the socket is closed `1008`. `relay` then carries the terminal both ways until
either side ends or the session does — a logout, or the account's level lowered below the tab. A new terminal
route uses both, never its own copy.
"""

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable

from fastapi import WebSocket

from . import auth

logger = logging.getLogger(__name__)


def clamp(size: int) -> int:
    """A terminal's rows or columns, as a pty takes them: 1 to 1000."""
    return max(1, min(size, 1000))


async def accept(websocket: WebSocket, tab: str) -> str | None:
    """Accept the socket for a session that may use `tab`, and return its cookie — or close
    it `1008` (policy violation) and return None."""
    cookie = websocket.cookies.get(auth.SESSION_COOKIE)
    user = auth.session_user(cookie)
    if not (auth.same_origin(websocket.headers) and user and user.may(tab)):
        await websocket.close(code=1008)
        return None
    auth.act_as(user)
    await websocket.accept()
    return cookie


async def relay(
    websocket: WebSocket,
    cookie: str,
    tab: str,
    read: Callable[[], Awaitable[bytes]],
    write: Callable[[bytes], Awaitable[None]],
    resize: Callable[[int, int], Awaitable[None]],
) -> None:
    """Output to the browser, keystrokes to the shell, and `{"type": "resize", rows, cols}`
    text frames to `resize(rows, cols)` — until the shell's output ends (`read` returns
    b""), the browser goes, or the session ends. The caller closes its own end after."""

    async def to_browser():
        while data := await read():
            await websocket.send_bytes(data)

    async def to_shell():
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                return
            if msg.get("bytes") is not None:
                await write(msg["bytes"])
            elif msg.get("text") is not None:
                try:
                    ctrl = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue
                if isinstance(ctrl, dict) and ctrl.get("type") == "resize":
                    try:
                        rows, cols = clamp(int(ctrl["rows"])), clamp(int(ctrl["cols"]))
                    except (KeyError, TypeError, ValueError):
                        continue  # a malformed frame is dropped, never the terminal
                    try:
                        await resize(rows, cols)
                    except Exception as exc:  # noqa: BLE001 — a size the shell refuses ends nothing
                        logger.debug("resize to %sx%s refused: %s", rows, cols, exc)

    tasks = {
        asyncio.create_task(to_browser()),
        asyncio.create_task(to_shell()),
        asyncio.create_task(auth.session_ended(cookie, tab)),
    }
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in tasks:
            task.cancel()
