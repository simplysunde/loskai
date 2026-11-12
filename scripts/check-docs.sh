#!/usr/bin/env bash
#
# check-docs.sh — validate the documentation's internal wiring.
# Run FROM anywhere:  bash scripts/check-docs.sh
#
# Nine checks:
#   1. Relative links (inline or reference-style) that point at a file which doesn't exist.
#   2. Heading anchors (#some-section) that no heading actually produces.
#   3. Orphans — pages under docs/ not reachable from docs/README.md, the index.
#   4. docs/ paths cited from source and config (comments in .py, compose files, .env.example)
#      that no longer resolve. Phase 17's move left 11 of these, and checks 1-3 could not see
#      them because they only ever read .md files.
#   5. docs/ paths *written out* in the current-state docs — in prose, backticks, or a link's
#      display text. Check 1 validates where a link points, not what it claims to point at, so
#      a link labelled with a pre-move path passed while displaying one that 404s. Five of
#      those survived Phase 17 in PLAN.md and lxc-script-authoring.md.
#   6. The loskai-recipes repo's copy of recipe-schema.md, when that repo is checked out
#      beside this one (scripts/sync-recipe-schema.sh). Skipped, not failed, without it.
#   7. Every page under docs/ opens the same way: a breadcrumb linking back to the index,
#      the title, then a `**Read this when**` line (docs/README.md, Conventions).
#   8. The docs' enumerations against the code: the modules and the HTTP route count
#      wherever a current page states them, the admin tabs and public routes named in
#      CLAUDE.md, and every route against its row in docs/reference/api.md.
#   9. docs/contributing/where-logic-lives.md: each decision's owner is still defined in the
#      file its row names, and its Used by column is what scripts/where-used.py finds.
#
# Docs are segmented by audience (docs/guides, docs/reference, docs/contributing), so a
# link's correct depth depends on where its file sits. That is easy to get wrong by hand
# and invisible until someone clicks — hence this script. Run it after moving, renaming,
# or adding any .md file.
#
# Exits non-zero if anything is broken, so it can gate CI later.

set -euo pipefail

cd "$(dirname "$0")/.."

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

log "Checking documentation links, anchors, orphans and source citations"

python3 - <<'PY'
import os
import pathlib
import re
import sys

SKIP_DIRS = {".git", ".venv", "node_modules", "dist", "__pycache__", ".pytest_cache"}
INDEX = "docs/README.md"


def strip_code(text: str) -> str:
    """Blank out fenced code blocks — a link inside one is display text, not a reference."""
    return re.sub(r"^```.*?^```", "", text, flags=re.S | re.M)


def slug(heading: str) -> str:
    """GitHub's heading -> anchor conversion: drop the #s and any markdown link syntax,
    lowercase, strip punctuation, spaces to hyphens."""
    s = re.sub(r"^#+\s*", "", heading).strip().lower()
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)
    s = re.sub(r"[^\w\s-]", "", s)
    return re.sub(r"\s", "-", s)


files = sorted(
    p for p in pathlib.Path(".").rglob("*.md")
    if not SKIP_DIRS & set(p.parts)
)
bodies = {p.as_posix(): strip_code(p.read_text()) for p in files}
anchors = {
    f: {slug(line) for line in body.splitlines() if line.startswith("#")}
    for f, body in bodies.items()
}

def links(body: str) -> list[str]:
    """Inline link targets, `[text](target)`, and reference definitions, `[label]: target`
    — the second form was invisible here until a broken one turned up in api.md."""
    return re.findall(r"\]\(([^)\s]+)\)", body) + re.findall(r"^\[[^\]]+\]:\s*(\S+)", body, re.M)


problems = []
for f, body in bodies.items():
    base = os.path.dirname(f) or "."
    for target in links(body):
        if target.startswith(("http://", "https://", "mailto:")):
            continue
        path, _, frag = target.partition("#")
        dest = f if not path else os.path.normpath(os.path.join(base, path))
        if path and not pathlib.Path(dest).exists():
            problems.append(f"  {f}: missing file -> {target}")
        elif frag and dest in anchors and frag not in anchors[dest]:
            problems.append(f"  {f}: no such heading -> {target}")

# Orphans: walk the .md graph out from the index and see what docs/ it never reaches.
seen, queue = set(), [INDEX]
while queue:
    cur = queue.pop()
    if cur in seen or cur not in bodies:
        continue
    seen.add(cur)
    base = os.path.dirname(cur) or "."
    for target in links(bodies[cur]):
        if target.startswith(("http://", "https://", "mailto:")):
            continue
        path = target.split("#")[0]
        if path.endswith(".md"):
            queue.append(os.path.normpath(os.path.join(base, path)))

docs = {f for f in bodies if f.startswith("docs/")}
orphans = sorted(docs - seen)
for o in orphans:
    problems.append(f"  {o}: not reachable from {INDEX} — add it to the index")

# Every page opens with a breadcrumb back to the index, its title, and when to read it — the
# index's Conventions. Without the check, the rule was claimed and almost no page followed it.
for f in sorted(docs - {INDEX}):
    lines = [l for l in bodies[f].splitlines() if l.strip()][:3]
    rel = os.path.relpath(INDEX, os.path.dirname(f))
    if len(lines) < 3 or not lines[0].startswith(f"[Docs]({rel})") or not lines[1].startswith("# ") \
            or not lines[2].startswith("**Read this when**"):
        problems.append(f"  {f}: must open with a [Docs]({rel}) breadcrumb, the title, then **Read this when**")

# Source and config cite docs by path in comments ("see docs/guides/deployment.md"). Those
# are pointers a reader follows, and nothing above reads them — .md files are the only input
# to checks 1-3. Restricted to docs/ paths: a bare filename in prose is not a path.
SOURCE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx", ".yml", ".yaml", ".sh", ".toml"}
SOURCE_NAMES = {"Dockerfile", "Makefile", ".env.example"}
cited = 0
for p in sorted(pathlib.Path(".").rglob("*")):
    if SKIP_DIRS & set(p.parts) or not p.is_file():
        continue
    if p.suffix not in SOURCE_SUFFIXES and p.name not in SOURCE_NAMES:
        continue
    try:
        text = p.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        continue
    for ref in re.findall(r"docs/[\w./-]+\.md", text):
        cited += 1
        if not pathlib.Path(ref).exists():
            problems.append(f"  {p.as_posix()}: cites a doc that moved or is gone -> {ref}")

# Paths written out in the docs that describe the repo as it is now. TODO, HISTORY and the
# archive are excluded on purpose: they are chronological records, and a completed phase
# naming the path a file had at the time is correct, not stale.
CHRONOLOGICAL = {"docs/project/TODO.md", "docs/project/HISTORY.md", "docs/project/todo-archive.md"}
ROOT_PAGES = ("README.md", "CLAUDE.md", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md")
CURRENT_STATE = [f for f in bodies if (f.startswith("docs/") and f not in CHRONOLOGICAL) or f in ROOT_PAGES]
written = 0
for f in CURRENT_STATE:
    for ref in set(re.findall(r"docs/[\w./-]+\.md", bodies[f])):
        written += 1
        if not pathlib.Path(ref).exists():
            problems.append(f"  {f}: names a doc path that does not resolve -> {ref}")

print(f"scanned {len(files)} markdown files")
print(f"docs reachable from the index: {len(docs & seen)}/{len(docs)}")
print(f"docs cited from source and config: {cited} · written out in the docs: {written}")
if problems:
    print(f"\n{len(problems)} problem(s):")
    print("\n".join(problems))
    sys.exit(1)
print("\nno broken links, anchors, orphans, stale source citations or unheaded pages")
PY

log "Checking the docs' enumerations against the code"

python3 - <<'PY'
import pathlib
import re
import sys

# CLAUDE.md is read as ground truth at the start of every session, so a wrong fact here
# propagates into new work — which is why Phase 15 rated the same class of error (F13) the
# highest-value finding in that audit. Four had still accumulated by 2026-09-02: a stale
# phase status, a nav tab that no longer exists, an incomplete list of public routes, and a
# moved archive path.
#
# Most prose can't be verified mechanically. But every one of those four was an
# *enumeration* — a list or count that the code also enumerates — and those can be pinned.
# This checks only that class. A wrong sentence elsewhere still needs a human read.

claude = pathlib.Path("CLAUDE.md").read_text()
problems = []


def listed(pattern: str) -> list[str] | None:
    """The comma-separated items inside a parenthesised claim, or None if absent."""
    m = re.search(pattern, claude)
    if not m:
        return None
    return [i.strip(" `*") for i in re.split(r",| and ", m.group(1)) if i.strip(" `*")]


# Every page that says how things are now: the history files are left out, since a count
# there was true when it was written.
HISTORICAL = {"docs/project/HISTORY.md", "docs/project/TODO.md", "docs/project/todo-archive.md"}
import subprocess
current = [f for f in subprocess.run(["git", "ls-files", "*.md"], capture_output=True, text=True,
           check=True).stdout.split() if f not in HISTORICAL and pathlib.Path(f).is_file()]

# 1. The modules, against backend/src/loskai/modules/ — every "N modules" and every
#    "modules (A, B, …)" in CLAUDE.md and the two READMEs a visitor starts from, and every
#    "N independent modules" or "the backend has N modules" anywhere else. Elsewhere a plain
#    "two modules" is a part of them ("Routing uses two modules"), not the total.
mods = sorted(
    d.name for d in pathlib.Path("backend/src/loskai/modules").iterdir()
    if d.is_dir() and not d.name.startswith("__")
)
if listed(r"modules \(([^)]*)\)") is None:
    problems.append("  CLAUDE.md: no 'modules (...)' list found — did the wording change?")
NUMBERS = {w: n for n, w in enumerate("zero one two three four five six seven eight nine ten".split())}
for doc in current:
    text = re.sub(r"\s+", " ", pathlib.Path(doc).read_text())
    entry = doc in ("CLAUDE.md", "README.md", "docs/README.md")
    claim = r"\b(\w+) (?:independent )?modules\b" if entry else r"\b(\w+) independent modules\b|backend has (\w+) modules\b"
    for word in ("".join(m) for m in re.findall(claim, text, re.I)):
        count = NUMBERS.get(word.lower(), int(word) if word.isdigit() else None)
        if count is not None and count != len(mods):
            problems.append(f"  {doc}: says {word} modules, there are {len(mods)}")
    for items in re.findall(r"modules \(([^)]*)\)", text) if entry else ():
        claimed = sorted(i.strip(" `*").lower() for i in re.split(r",| and ", items) if i.strip(" `*"))
        if claimed != mods:
            problems.append(f"  {doc}: modules ({items}) != {mods} on disk")

# 2. The admin tab list, against NAV in the frontend layout. Tabs marked `public: true`
#    are excluded — the Dashboard launcher and the Certificate page are things a
#    logged-out visitor is meant to reach, not admin tabs.
layout = pathlib.Path("frontend/src/components/shared/Layout.tsx").read_text()
nav_block = re.search(r"const NAV = \[(.*?)\] as const", layout, re.S)
entries = re.findall(r"\{([^}]*)\}", nav_block.group(1) if nav_block else "")
nav, admin_nav = [], []
for entry in entries:
    label = re.search(r'label:\s*"([^"]+)"', entry)
    if not label:
        continue
    nav.append(label.group(1))
    if "public: true" not in entry:
        admin_nav.append(label.group(1))
tabs = listed(r"admin tabs \(([^)]*)\)")
if not nav:
    problems.append("  Layout.tsx: could not parse NAV — the check needs updating")
elif tabs is None:
    problems.append("  CLAUDE.md: no 'admin tabs (...)' list found — did the wording change?")
elif tabs != admin_nav:
    problems.append(f"  CLAUDE.md: admin tabs {tabs} != NAV {admin_nav} (public tabs excluded)")

# 3. The HTTP route count. Drifts the moment a route is added — the two terminal
#    WebSockets are not counted, because CLAUDE.md names them separately. CLAUDE.md must
#    say it; every other "N routes" or "N HTTP routes" on a current page must agree.
routes = 0
for f in pathlib.Path("backend/src/loskai").rglob("*.py"):
    routes += len(re.findall(r"@router\.(?:get|post|put|patch|delete)\(", f.read_text()))
m = re.search(r"(\d+) HTTP routes", claude)
if not m:
    problems.append("  CLAUDE.md: no 'N HTTP routes' claim found — did the wording change?")
elif int(m.group(1)) != routes:
    problems.append(f"  CLAUDE.md: claims {m.group(1)} HTTP routes, code has {routes}")
for doc in current:
    text = re.sub(r"\s+", " ", pathlib.Path(doc).read_text())
    for n in re.findall(r"\b(\d+) (?:HTTP )?routes\b", text):
        if doc != "CLAUDE.md" and int(n) != routes:
            problems.append(f"  {doc}: says {n} routes, code has {routes}")

# 4. Every unauthenticated route named. This is the security boundary; an omission here
#    reads as "that route is gated" when it isn't.
auth = pathlib.Path("backend/src/loskai/shared/auth.py").read_text()
pub = re.search(r"PUBLIC_ROUTES = \{(.*?)\}", auth, re.S)
for verb, path in re.findall(r'\("(\w+)",\s*"([^"]+)"\)', pub.group(1) if pub else ""):
    if f"{verb} {path}" not in claude:
        problems.append(f"  CLAUDE.md: public route {verb} {path} is not named in the security section")

# Public routes whose path carries a parameter live in PUBLIC_PATTERNS instead, and are just
# as public. Turn each regex back into the path shape CLAUDE.md should name — otherwise a
# whole class of unauthenticated surface could be added without the enumeration noticing.
pat = re.search(r"PUBLIC_PATTERNS = \[(.*?)\n\]", auth, re.S)
for verb, rx in re.findall(r'\("(\w+)",\s*re\.compile\(r"([^"]+)"\)\)', pat.group(1) if pat else ""):
    readable = rx.strip("^$").replace("[^/]+", "{id}")
    if f"{verb} {readable}" not in claude:
        problems.append(
            f"  CLAUDE.md: public route pattern {verb} {readable} is not named in the security section"
        )

# 5. Every route in the code has its row in api.md, and every row there is a route. A row
#    is `METHOD /path`: a path starting /api is whole, any other is under its section's
#    `/api/...` heading; `· /stop · /restart` lists siblings of the row's last segment.
code_routes = set()
for f in pathlib.Path("backend/src/loskai").rglob("*.py"):
    text = f.read_text()
    prefix = re.search(r'APIRouter\(prefix="([^"]*)"', text)
    for verb, path in re.findall(r'@router\.(get|post|put|patch|delete|websocket)\(\s*"([^"]*)"', text):
        full = (prefix.group(1) if prefix else "") + path
        code_routes.add(("WS" if verb == "websocket" else verb.upper(), re.sub(r"\{[^}]+\}", "{}", full)))
doc_routes, section = set(), ""
for line in pathlib.Path("docs/reference/api.md").read_text().splitlines():
    if line.startswith("#"):
        heading = re.search(r"`(/api[^`]*)`", line)
        if line.startswith("## "):
            section = heading.group(1) if heading else ""
        continue
    row = re.match(r"\| `(GET|POST|PUT|PATCH|DELETE|WS) (/[^`]*)`((?: · `/[^`]*`)*) \|", line)
    if not row:
        continue
    verb, path = row.group(1), row.group(2)
    full = path if path.startswith("/api") else section + path
    paths = [full] + [full.rsplit("/", 1)[0] + alt for alt in re.findall(r"`(/[^`]*)`", row.group(3))]
    doc_routes |= {(verb, re.sub(r"\{[^}]+\}", "{}", p)) for p in paths}
for verb, path in sorted(code_routes - doc_routes):
    problems.append(f"  docs/reference/api.md: {verb} {path} is a route with no row")
for verb, path in sorted(doc_routes - code_routes):
    problems.append(f"  docs/reference/api.md: a row for {verb} {path}, which no route serves")

print(f"modules: {len(mods)} · admin tabs: {len(admin_nav)} · HTTP routes: {routes} · api.md rows: {len(doc_routes)}")
if problems:
    print(f"\n{len(problems)} problem(s):")
    print("\n".join(problems))
    sys.exit(1)
print("\nThe docs' enumerations match the code")
PY

log "Checking where-logic-lives.md against the code"
python3 scripts/where-used.py --check

log "Checking the recipes repo's copy of the schema"
if [ -d "${LOSKAI_RECIPES_DIR:-../loskai-recipes}" ]; then
  bash scripts/sync-recipe-schema.sh --check
else
  echo "skipped — no loskai-recipes checkout beside this one"
fi

log "Docs OK"
