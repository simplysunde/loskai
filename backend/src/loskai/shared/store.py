"""Atomic JSON file I/O — the single I/O seam for the flat-file store.

There is no database: `settings.json` and `instances.json` are the only persistent
state. Keeping read/write here (temp-file + rename) means the store can never be left
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
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    # Write to a temp file in the same directory, then atomically rename over the target.
    fd, tmp = tempfile.mkstemp(dir=str(p.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
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
