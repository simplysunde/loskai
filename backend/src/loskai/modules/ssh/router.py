"""SSH module routes — Loskai's key, and the config file saying how each machine is reached.

Connecting to a machine comes in later steps (TODO Phase 34). Making or replacing the key
asks for the admin password, which encrypts it; nothing here ever returns the private key.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from ...shared import auth
from ...shared import settings as settings_store
from . import client, logic

router = APIRouter(prefix="/api/ssh", tags=["ssh"])


def _key_view() -> dict | None:
    public = client.public_key()
    if public is None:
        return None
    # The Docker host's address is where Loskai's connections come from, so it is what the
    # key is limited to. Unset, the line has no `from=` and the Machines tab says so.
    from_ip = settings_store.value("host_ip")
    return {
        "public_key": public,
        "authorized_keys": logic.authorized_keys_line(public, from_ip),
        "from": from_ip,
    }


@router.get("")
def ssh_status() -> dict:
    """Loskai's key (null before one is made) and each `Host` in the config."""
    return {"key": _key_view(), "hosts": logic.hosts(client.read_config())}


class KeyRequest(BaseModel):
    password: str
    replace: bool = False


@router.post("/key")
def create_key(body: KeyRequest) -> dict | None:
    """Make Loskai's key, or replace it (`replace`). The admin password is checked — with the
    login backoff — and encrypts the new key."""
    if client.public_key() is not None and not body.replace:
        raise HTTPException(status_code=409, detail="Loskai already has a key — use New key to replace it")
    auth.check_password(body.password, wrong_status=403)
    client.create_key(body.password)
    return _key_view()


@router.get("/config")
def export_config() -> PlainTextResponse:
    """The SSH config, for the `ssh` on your own computer. It names no key, so your own
    keys are used."""
    return PlainTextResponse(
        client.read_config(),
        headers={"Content-Disposition": 'attachment; filename="loskai-ssh-config"'},
    )
