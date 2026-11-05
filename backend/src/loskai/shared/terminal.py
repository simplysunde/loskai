"""What every terminal WebSocket shares — a container's and a machine's.

WebSockets never pass the HTTP middleware, so `accept` is their gate: the session cookie,
the `Origin` (a browser opens a WebSocket from any page, cookie attached) and the account's
tab, or the socket is closed `1008`. `relay` then carries the terminal both ways until
either side ends or the session does — a logout, or the tab taken away. A new terminal
route uses both, never its own copy.
"""

import asyncio
import json
from collections.abc import Awaitable, Callable

from fastapi import WebSocket

from . import auth


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
                if ctrl.get("type") == "resize":
                    await resize(int(ctrl["rows"]), int(ctrl["cols"]))

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
