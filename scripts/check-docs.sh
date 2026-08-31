#!/usr/bin/env bash
#
# check-docs.sh — validate the documentation's internal wiring.
# Run FROM anywhere:  bash scripts/check-docs.sh
#
# Three checks, all of which have caught real breakage:
#   1. Relative links that point at a file which doesn't exist.
#   2. Heading anchors (#some-section) that no heading actually produces.
#   3. Orphans — pages under docs/ not reachable from docs/README.md, the index.
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

log "Checking documentation links, anchors and orphans"

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

problems = []
for f, body in bodies.items():
    base = os.path.dirname(f) or "."
    for target in re.findall(r"\]\(([^)\s]+)\)", body):
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
    for target in re.findall(r"\]\(([^)\s]+)\)", bodies[cur]):
        if target.startswith(("http://", "https://", "mailto:")):
            continue
        path = target.split("#")[0]
        if path.endswith(".md"):
            queue.append(os.path.normpath(os.path.join(base, path)))

docs = {f for f in bodies if f.startswith("docs/")}
orphans = sorted(docs - seen)
for o in orphans:
    problems.append(f"  {o}: not reachable from {INDEX} — add it to the index")

print(f"scanned {len(files)} markdown files")
print(f"docs reachable from the index: {len(docs & seen)}/{len(docs)}")
if problems:
    print(f"\n{len(problems)} problem(s):")
    print("\n".join(problems))
    sys.exit(1)
print("\nno broken links, anchors or orphans")
PY

log "Docs OK"
