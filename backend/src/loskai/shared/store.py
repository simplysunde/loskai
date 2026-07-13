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


def read_json(path: str | Path, default: Any) -> Any:
    p = Path(path)
    if not p.exists():
        return default
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)


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
