"""`.env` text — read as Compose reads it, changed line by line, and written so that Compose
reads back exactly what was typed (`render_env`). The install writes it, the stack form
edits it, and an update adds a line for a new question; all three come here.
"""

import re

_ENV_LINE_RE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")
KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")  # a variable name
_UNESCAPE = {"n": "\n", "r": "\r", "t": "\t"}


def _env_value(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith('"') and raw.endswith('"') and len(raw) > 1:
        return re.sub(r"\\(.)", lambda m: _UNESCAPE.get(m[1], m[1]), raw[1:-1])
    if raw.startswith("'") and raw.endswith("'") and len(raw) > 1:
        return raw[1:-1]
    return re.split(r"\s+#", raw, maxsplit=1)[0].strip()


def parse_env(text: str) -> dict[str, str]:
    """`.env` text → values, as Compose reads them."""
    values: dict[str, str] = {}
    for line in text.splitlines():
        m = _ENV_LINE_RE.match(line)
        if m and not line.lstrip().startswith("#"):
            values[m[1]] = _env_value(m[2])
    return values


def set_env(text: str, changes: dict[str, str]) -> str:
    """Apply changed values to `.env` text: a changed key's line is rewritten in place, a
    new one appended, a cleared one removed — so the default applies again. Every other
    line, comments included, stays as written."""
    lines: list[str] = []
    done: set[str] = set()
    for line in text.splitlines():
        m = _ENV_LINE_RE.match(line)
        key = m[1] if m and not line.lstrip().startswith("#") else None
        if key in changes:
            if key not in done and changes[key] != "":
                lines.append(render_env({key: changes[key]}).rstrip("\n"))
            done.add(key)
            continue
        lines.append(line)
    lines += [render_env({k: v}).rstrip("\n") for k, v in changes.items() if k not in done and v != ""]
    return "\n".join(lines) + "\n" if lines else ""


def _env_escape(value: str) -> str:
    # Backslash first, or the escapes added after it would be doubled.
    return (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("$", "\\$")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
    )


def render_env(values: dict[str, str]) -> str:
    r"""Install values -> .env text, every value double-quoted and escaped so Compose reads
    back exactly what was typed.

    Written verbatim, Compose interpolates `$` (`pa$word1` arrives as `pa`), reads ` #` as
    a comment (`correct horse #battery` arrives as `correct horse`), and a newline starts
    a new `KEY=` line. All of these *succeed* — `up` exits 0 and the app simply has a
    different password. Single quotes would fix the first two but cannot hold a `'`.
    Double quotes with `\\`, `\"`, `\$`, `\n` and `\r` escaped round-trip all of it,
    checked against `docker compose config` and a real container's environment on
    2026-10-03.
    """
    return "".join(f'{k}="{_env_escape(v)}"\n' for k, v in values.items())
