"""Atomic JSON file I/O — the single I/O seam for the flat-file store.

There is no database: `settings.json` and `instances.json` are the only persistent
state. Keeping read/write here (temp-file + rename) means the store can never be left
half-written, and the pure logic in settings.py / instances.py stays testable against
a `tmp_path` without touching real paths.
"""

import json
import os
import tempfile
from pathlib import Path
from typing import Any


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
        os.replace(tmp, p)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
