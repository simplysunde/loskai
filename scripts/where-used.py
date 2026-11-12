#!/usr/bin/env python3
"""Who uses a function — and the Used by column of docs/contributing/where-logic-lives.md.

    python3 scripts/where-used.py on_address machineAt   # where each is defined, who uses it
    python3 scripts/where-used.py --write                # fill in the page's Used by column
    python3 scripts/where-used.py --check                # fail if the page is out of date

Uses are found by following imports, not by matching words: in Python, `from . import x`
and `from .x import y` (aliases included), then `x.name` or `name`; in TypeScript, the
`import { name } from "./file"` lines. A file that reads a backend name as a field uses it
too: in Python, a string that is exactly the name (`row["suggested_upstream"]`); in the
frontend, the name anywhere — the API's fields are snake_case, the frontend's own names
never are.
Tests are not uses. A file's uses of its own names are left out.
"""

import ast
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend/src/loskai"
FRONTEND = ROOT / "frontend/src"
PAGE = ROOT / "docs/contributing/where-logic-lives.md"
MAX_LISTED = 10  # past this, the cell says how many and how to list them


def is_test(path: Path) -> bool:
    return "test" in path.name or path.name == "setupTests.ts" or "test" in path.parts


def rel(path: Path) -> str:
    return path.relative_to(BACKEND if path.suffix == ".py" else FRONTEND).as_posix()


# --- Python -------------------------------------------------------------------------------

def module_of(path: Path) -> str:
    parts = ["loskai", *path.relative_to(BACKEND).with_suffix("").parts]
    return ".".join(parts[:-1] if parts[-1] == "__init__" else parts)


PY_FILES = {module_of(p): p for p in BACKEND.rglob("*.py") if "__pycache__" not in p.parts}


def python_defs(path: Path) -> set[str]:
    names = set()
    for node in ast.parse(path.read_text()).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            names |= {t.id for t in node.targets if isinstance(t, ast.Name)}
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
    return names


def python_uses(path: Path) -> set[tuple[str, str]]:
    """(file, name) pairs this file uses from other backend files."""
    tree = ast.parse(path.read_text())
    package = module_of(path) if path.name == "__init__.py" else module_of(path).rpartition(".")[0]
    modules, names = {}, {}  # local name -> module; local name -> (module, name)
    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom) or not node.level:
            continue
        base = package.split(".")
        base = base[: len(base) - (node.level - 1)]
        source = ".".join(base + ([node.module] if node.module else []))
        for alias in node.names:
            local = alias.asname or alias.name
            if f"{source}.{alias.name}" in PY_FILES:
                modules[local] = f"{source}.{alias.name}"
            elif source in PY_FILES:
                names[local] = (source, alias.name)
    used = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and FIELD.fullmatch(node.value):
            used.add((None, node.value))  # a field read by its key: any file filling it
        elif isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id in modules:
            used.add((modules[node.value.id], node.attr))
        elif isinstance(node, ast.Name) and node.id in names:
            used.add(names[node.id])
    return {(rel(PY_FILES[m]) if m else None, n) for m, n in used}


# --- TypeScript ---------------------------------------------------------------------------

TS_FILES = [p for p in FRONTEND.rglob("*") if p.suffix in (".ts", ".tsx")]
IMPORT = re.compile(r"import\s+(?:type\s+)?(?:\w+\s*,\s*)?\{([^}]*)\}\s*from\s*[\"'](\.[^\"']*)[\"']")
TS_DEF = r"(?m)^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+{}\b"


def ts_code(path: Path) -> str:
    """The file without its comment lines, so a mention in prose isn't a use."""
    return "\n".join(
        line for line in path.read_text().splitlines()
        if not line.strip().startswith(("//", "*", "/*"))
    )


def resolve_ts(path: Path, spec: str) -> Path | None:
    base = (path.parent / spec).resolve()
    for candidate in (base.with_name(base.name + ".ts"), base.with_name(base.name + ".tsx"),
                      base / "index.ts", base / "index.tsx", base):
        if candidate.is_file():
            return candidate
    return None


def ts_uses(path: Path) -> set[tuple[str, str]]:
    used = set()
    for names, spec in IMPORT.findall(path.read_text()):
        target = resolve_ts(path, spec)
        if not target:
            continue
        for name in names.split(","):
            name = re.sub(r"^\s*type\s+", "", name).split(" as ")[0].strip()
            if name:
                used.add((rel(target), name))
    return used


# --- Both ---------------------------------------------------------------------------------

def index() -> dict[tuple[str, str], set[str]]:
    """(file, name) -> the files that use it."""
    users = defaultdict(set)
    for path in PY_FILES.values():
        if not is_test(path):
            for key in python_uses(path):
                users[key].add(rel(path))
    for path in TS_FILES:
        if not is_test(path):
            for key in ts_uses(path):
                users[key].add(rel(path))
    return users


FIELD = re.compile(r"[a-z]+(?:_[a-z0-9]+)+")


def field_readers(name: str, uses) -> set[str]:
    """Files reading a backend name as a field: a Python string that is exactly the name, or
    the name anywhere in frontend code."""
    if not FIELD.fullmatch(name):
        return set()
    readers = set(uses.get((None, name), set()))
    return readers | {rel(p) for p in TS_FILES if not is_test(p) and re.search(rf"\b{name}\b", ts_code(p))}


def defined_in(path: Path, name: str) -> bool:
    if path.suffix == ".py":
        return name in python_defs(path)
    return re.search(TS_DEF.format(re.escape(name)), path.read_text()) is not None


def source_path(file: str) -> Path:
    return (BACKEND if file.endswith(".py") else FRONTEND) / file


def users_of(file: str, names: list[str], uses) -> list[str]:
    found = set()
    for name in names:
        found |= uses.get((file, name), set())
        if file.endswith(".py"):
            found |= field_readers(name, uses)
    found.discard(file)
    return sorted(found, key=lambda f: (not f.endswith(".py"), f))


def cell(file: str, names: list[str], users: list[str]) -> str:
    if not users:
        return "only its own file"
    if len(users) > MAX_LISTED:
        return f"{len(users)} files: `python3 scripts/where-used.py {' '.join(names)}`"
    return " ".join(f"`{u}`" for u in users)


ROW = re.compile(r"^\| (?P<decision>[^|]+) \| (?P<owner>`[^`]+/[^`]+\.(?:py|tsx?)`(?: `[^`]+`)+) \| (?P<used>[^|]*) \|$")


def render_page(uses) -> tuple[str, list[str]]:
    problems, out = [], []
    for line in PAGE.read_text().splitlines():
        row = ROW.match(line)
        if row:
            file, *names = re.findall(r"`([^`]+)`", row["owner"])
            path = source_path(file)
            if not path.is_file():
                problems.append(f"{file} is not a file")
            else:
                problems += [f"{file} no longer defines {n}" for n in names if not defined_in(path, n)]
                line = f"| {row['decision']} | {row['owner']} | {cell(file, names, users_of(file, names, uses))} |"
        out.append(line)
    return "\n".join(out) + "\n", problems


def main(args: list[str]) -> int:
    if not args or args[0] in ("-h", "--help"):
        print(__doc__.strip())
        return 0
    uses = index()
    if args[0] in ("--write", "--check"):
        page, problems = render_page(uses)
        for p in problems:
            print(f"  {PAGE.relative_to(ROOT)}: {p}")
        if problems:
            return 1
        rows = sum(bool(ROW.match(l)) for l in page.splitlines())
        if args[0] == "--write":
            PAGE.write_text(page)
            print(f"owners: {rows} — Used by written")
            return 0
        if page != PAGE.read_text():
            for old, new in zip(PAGE.read_text().splitlines(), page.splitlines()):
                if old != new:
                    print(f"  {ROW.match(new)['decision']} ({ROW.match(new)['owner']}):\n    page:  {ROW.match(old)['used'] if ROW.match(old) else old}\n    code:  {ROW.match(new)['used']}")
            print(f"  {PAGE.relative_to(ROOT)}: Used by is out of date — run python3 scripts/where-used.py --write")
            return 1
        print(f"owners: {rows} — every owner is where its row says, and Used by is current")
        return 0
    for name in args:
        homes = [p for p in [*PY_FILES.values(), *TS_FILES] if not is_test(p) and defined_in(p, name)]
        if not homes:
            print(f"{name}: not defined anywhere")
        for path in homes:
            users = users_of(rel(path), [name], uses)
            print(f"{name} — {rel(path)}")
            print("\n".join(f"  {u}" for u in users) or "  only its own file")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
