#!/usr/bin/env bash
# sync-recipe-schema.sh — copy the recipe schema into the loskai-recipes repo.
#
#   bash scripts/sync-recipe-schema.sh           # write the copy
#   bash scripts/sync-recipe-schema.sh --check   # exit 1 if the copy differs (check-docs runs this)
#
# docs/reference/recipe-schema.md is the contract, and it lives here because the validator
# does: a schema change lands in the same commit as the code that enforces it. The recipes
# repo keeps a copy so a session working there has the rules without this checkout open.
# The copy is never edited by hand — this script is the only writer, and check-docs fails
# when the two differ, so drift is a failed check rather than a surprise.
#
# The recipes repo is found at ../loskai-recipes, or LOSKAI_RECIPES_DIR.
set -euo pipefail

cd "$(dirname "$0")/.."

SRC=docs/reference/recipe-schema.md
RECIPES="${LOSKAI_RECIPES_DIR:-../loskai-recipes}"
# At the repo's root, as a file: every folder there is read as a recipe.
DEST="$RECIPES/$(basename "$SRC")"

render() {
  printf '%s\n%s\n\n' \
    "> **A copy** of loskai's \`docs/reference/recipe-schema.md\`, written by its" \
    "> \`scripts/sync-recipe-schema.sh\`. Don't edit it here — change it in loskai and re-run that script."
  cat "$SRC"
}

if [ ! -d "$RECIPES" ]; then
  echo "no recipes repo at $RECIPES (set LOSKAI_RECIPES_DIR)" >&2
  exit 2
fi

if [ "${1:-}" = "--check" ]; then
  if ! render | cmp -s - "$DEST"; then
    echo "  $DEST differs from $SRC — run: bash scripts/sync-recipe-schema.sh" >&2
    exit 1
  fi
  echo "$DEST matches $SRC"
  exit 0
fi

render > "$DEST"
echo "wrote $DEST"
