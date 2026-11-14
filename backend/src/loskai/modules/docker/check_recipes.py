"""Check recipe folders with the validator the install wizard uses — for authoring.

    uv run --project <loskai>/backend python -m loskai.modules.docker.check_recipes [path ...]

A path holding a `recipe.yml` is one recipe; any other is a source (a recipes repo), and
every recipe folder in it is checked, as a sync would scan it. Defaults to the current
directory. Exits 1 if any recipe would be listed as skipped. Reads files only — no Docker,
no settings, nothing written.
"""

import sys
from pathlib import Path

from .manifest import RecipeError
from .recipes import load_recipe_folder


def check(paths: list[Path]) -> list[tuple[str, str | None]]:
    """(recipe folder, why it would be skipped — or None) for every recipe under `paths`."""
    results: list[tuple[str, str | None]] = []
    for path in paths:
        if (path / "recipe.yml").is_file():
            folders = [path]
        else:
            folders = sorted(p for p in path.iterdir() if p.is_dir() and not p.name.startswith("."))
        for folder in folders:
            try:
                load_recipe_folder(folder, "check", None)
                results.append((folder.name, None))
            except RecipeError as exc:
                results.append((folder.name, str(exc)))
    return results


def main(argv: list[str]) -> int:
    paths = [Path(a) for a in argv] or [Path(".")]
    missing = [str(p) for p in paths if not p.is_dir()]
    if missing:
        print(f"not a folder: {', '.join(missing)}", file=sys.stderr)
        return 2
    results = check(paths)
    for name, error in results:
        print(f"ok    {name}" if error is None else f"FAIL  {name}: {error}")
    failed = sum(1 for _, error in results if error)
    print(f"\n{len(results) - failed} valid, {failed} would be skipped" if results else "no recipes found")
    return 1 if failed or not results else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
