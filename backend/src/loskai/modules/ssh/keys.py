"""Loskai's main SSH key behind key slots — one per account that may unlock it.

The private key file is encrypted with a random *key-encryption key* (KEK). `keyslots.json`
holds that KEK once per account, each sealed with the account's own password (scrypt, then
AES-GCM). So everyone with the Machines tab unlocks the key with their own password, a
copy of `data/` without a password is useless, and changing a password re-seals one slot
without touching the key — the way a LUKS disk keeps its key slots.

A slot is made when someone may use the key and the KEK is at hand: by whoever makes the
key; for a new account, or a reset password, while an admin has it unlocked; and for an
account with none, the first time it unlocks while someone else has it unlocked. A key from
before accounts — encrypted with the admin password itself — moves to slots the first time
that password opens it.
"""

import base64
import os
from pathlib import Path

import asyncssh
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from ...shared import store
from . import client

_SCRYPT = {"n": 2**15, "r": 8, "p": 1}  # ~32 MiB and a tenth of a second per try


class NoSlot(Exception):
    """This account can't open the key yet: it has no slot, and no one has it unlocked."""


def _slots_path() -> Path:
    return client.ssh_dir() / "keyslots.json"


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _passphrase(kek: bytes) -> str:
    """The KEK as the key file's passphrase."""
    return base64.urlsafe_b64encode(kek).decode()


def _seal_key(password: str, salt: bytes) -> bytes:
    return Scrypt(salt=salt, length=32, **_SCRYPT).derive(password.encode())


def seal(kek: bytes, password: str) -> dict[str, str]:
    """The KEK sealed with a password: a slot."""
    salt, nonce = os.urandom(16), os.urandom(12)
    box = AESGCM(_seal_key(password, salt)).encrypt(nonce, kek, None)
    return {"salt": _b64(salt), "nonce": _b64(nonce), "box": _b64(box)}


def unseal(slot: dict[str, str], password: str) -> bytes | None:
    """The KEK, or None when `password` isn't the one the slot was sealed with."""
    try:
        key = _seal_key(password, base64.b64decode(slot["salt"]))
        return AESGCM(key).decrypt(base64.b64decode(slot["nonce"]), base64.b64decode(slot["box"]), None)
    except (InvalidTag, KeyError, ValueError):
        return None


def _slots() -> dict[str, dict[str, str]]:
    return store.read_json(_slots_path(), {})


def _set_slots(mutate) -> None:
    """Read → change → write under the store lock; owner-only, replaced whole."""
    store.update_json(_slots_path(), {}, mutate)


def has_slot(username: str) -> bool:
    return username in _slots()


def create(username: str, password: str, kek: bytes | None) -> tuple[asyncssh.SSHKey, bytes]:
    """A new key pair, replacing any old one. Given the KEK in use (`kek`), every slot stays
    good; without it, a fresh KEK and only this account's slot."""
    fresh = kek is None
    kek = kek or os.urandom(32)
    client.create_key(_passphrase(kek))
    _set_slots(lambda slots: {**({} if fresh else slots), username: seal(kek, password)})
    return client.load_key(_passphrase(kek)), kek


def open_for(username: str, password: str, kek_in_use: bytes | None) -> tuple[asyncssh.SSHKey, bytes]:
    """The key and its KEK, for an account whose password was just checked. Raises NoSlot
    when it can't be opened; FileNotFoundError before there is a key."""
    slots = _slots()
    kek = unseal(slots[username], password) if username in slots else None
    if kek is None and not _slots_path().exists():
        # A key from before accounts, encrypted with the admin password: if this is that
        # password, it moves to slots now.
        try:
            key = client.load_key(password)
        except (asyncssh.KeyImportError, asyncssh.KeyEncryptionError):
            raise NoSlot()
        kek = os.urandom(32)
        client.store_key(key, _passphrase(kek))
        _set_slots(lambda _: {username: seal(kek, password)})
        return key, kek
    if kek is None:
        # No slot of its own (or a stale one): someone else has it unlocked, so this account
        # gets one now — its password was just checked.
        if kek_in_use is None:
            raise NoSlot()
        kek = kek_in_use
        grant(username, password, kek)
    return client.load_key(_passphrase(kek)), kek


def grant(username: str, password: str, kek: bytes) -> None:
    _set_slots(lambda slots: {**slots, username: seal(kek, password)})


def reseal(username: str, old: str, new: str) -> None:
    """A user's own password change: their slot re-sealed, the key untouched."""
    slots = _slots()
    if username in slots and (kek := unseal(slots[username], old)) is not None:
        grant(username, new, kek)


def drop(username: str) -> None:
    """An account removed, its password reset with no KEK at hand, or its Machines tab taken
    away: its slot goes — an old password must not open the key."""
    if _slots_path().exists() and has_slot(username):
        _set_slots(lambda slots: {k: v for k, v in slots.items() if k != username})
