"""Atomic JSON file I/O — the single I/O seam for the flat-file store.

There is no database: `settings.json` and `instances.json` are the persistent state, beside
the accounts and two logs (`append_log`). Keeping read/write here (temp-file + rename) means the store can never be left
half-written, and the pure logic in settings.py / instances.py stays testable against
a `tmp_path` without touching real paths.
"""

import json
import os
import tempfile
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

# Serialises every read-modify-write below. Writers rewrite the whole file, so two
# interleaved cycles silently discard one side's change — and the writers span both
# execution contexts FastAPI uses: sync handlers in the threadpool (PUT /api/settings,
# PATCH /api/instances) and async ones on the event loop (assign, reconcile). That rules
# out an asyncio lock. Reads stay lock-free: the atomic rename in write_json means a
# reader sees the whole old file or the whole new one, never a mix.
_write_lock = threading.Lock()


class CorruptStoreError(RuntimeError):
    """A store file exists but doesn't parse. Always names the path: both files are
    documented as hand-editable, so the operator needs to know *which* one to fix."""


def read_json(path: str | Path, default: Any) -> Any:
    p = Path(path)
    if not p.exists():
        return default
    try:
        with p.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        # Never silently fall back to `default` here — an existing-but-unreadable file
        # is not the same as an absent one, and the callers' recovery differs (see
        # settings.verify_readable and instances.list_instances).
        raise CorruptStoreError(f"{p} is not valid JSON: {exc}") from exc


def write_json(path: str | Path, data: Any) -> None:
    _replace(path, json.dumps(data, indent=2) + "\n")


def replace_private(path: str | Path, text: str) -> None:
    """Replace an owner-only file whole: a reader sees the old text or the new, never an
    empty file. For a secret that is rewritten while in use — the session secret."""
    _replace(path, text)  # mkstemp creates the file 0600


def _replace(path: str | Path, text: str) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    # Write to a temp file in the same directory, then atomically rename over the target.
    fd, tmp = tempfile.mkstemp(dir=str(p.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            # Get the bytes on disk *before* the rename. Without this, a power cut can
            # commit the rename while the data blocks are still in cache, leaving a
            # zero-length file that refuses to parse. Not fsyncing the directory too is
            # deliberate: that would only make the newest write survive a crash, and
            # losing one settings change is fine — losing the file is not.
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, p)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def update_json(path: str | Path, default: Any, mutate: Callable[[Any], Any]) -> Any:
    """Read → mutate → write as one unit. The only supported way to change a store file.

    `mutate` receives the parsed contents (or `default` when the file is absent) and
    returns what to write. It must stay pure and must not touch the store itself — it
    runs holding `_write_lock`, which is not re-entrant.
    """
    with _write_lock:
        data = mutate(read_json(path, default))
        write_json(path, data)
        return data


def update_text(path: str | Path, mutate: Callable[[str], str]) -> str:
    """`update_json` for a text file Loskai edits in place (the SSH config): read, mutate,
    replace whole, under the same lock. An absent file reads as empty; the result is
    owner-only, and an unchanged text is not rewritten."""
    p = Path(path)
    with _write_lock:
        text = p.read_text(encoding="utf-8") if p.exists() else ""
        new = mutate(text)
        if new != text:
            _replace(p, new)
        return new


def write_private(path: str | Path, text: str) -> None:
    """Write a text file only its owner can read — an `.env` or a secret.

    `write_text` would leave it world-readable (0644 under the usual umask), and an existing
    file keeps whatever mode it had, so the mode is set on the open file as well."""
    p = Path(path)
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        os.fchmod(f.fileno(), 0o600)
        f.write(text)


LOG_KEEP = 1000  # entries a log keeps when it is trimmed


def append_log(path: str | Path, entry: dict) -> None:
    """Add one entry to a log — one JSON line each, owner-only. Trimmed to the last
    `LOG_KEEP` once it is twice that, so it never grows without bound."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(p, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    if p.stat().st_size > LOG_KEEP * 2 * 200:  # ~200 bytes a line
        update_text(p, lambda text: "\n".join(text.splitlines()[-LOG_KEEP:]) + "\n")


def read_log(path: str | Path, limit: int, match: dict | None = None) -> list[dict]:
    """A log's last `limit` entries, newest first — only those with each of `match`'s
    values, when given. A line that doesn't parse is skipped."""
    p = Path(path)
    text = p.read_text(encoding="utf-8") if p.exists() else ""
    out: list[dict] = []
    for line in reversed(text.splitlines()):
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if match and any(entry.get(k) != v for k, v in match.items()):
            continue
        out.append(entry)
        if len(out) == limit:
            break
    return out
