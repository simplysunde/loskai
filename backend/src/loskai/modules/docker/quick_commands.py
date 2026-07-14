"""Preset terminal commands for the browser exec — pure image-name → command map.

Clickable buttons above the terminal that lower the barrier for beginners: a generic set
for every container plus image-specific extras detected from the image name.
"""

# (label, command) available on every container.
GENERIC: list[tuple[str, str]] = [
    ("List processes", "ps aux"),
    ("Env vars", "env"),
    ("Disk usage", "df -h"),
    ("List files", "ls -la"),
]

# Substring in the image name -> extra commands.
IMAGE_SPECIFIC: list[tuple[str, list[tuple[str, str]]]] = [
    ("redis", [("Redis CLI", "redis-cli")]),
    ("postgres", [("psql", "psql -U postgres")]),
    ("mariadb", [("MySQL shell", "mysql -u root -p")]),
    ("mysql", [("MySQL shell", "mysql -u root -p")]),
    ("nginx", [("Test config", "nginx -t"), ("Reload", "nginx -s reload")]),
]


def quick_commands_for(image: str | None) -> list[dict]:
    """Generic commands first, then any matching the image name (deduped, first match
    per DB family wins so mariadb/mysql don't double up)."""
    commands = list(GENERIC)
    name = (image or "").lower()
    seen_labels = {label for label, _ in commands}
    for needle, extras in IMAGE_SPECIFIC:
        if needle in name:
            for label, cmd in extras:
                if label not in seen_labels:
                    commands.append((label, cmd))
                    seen_labels.add(label)
    return [{"label": label, "command": cmd} for label, cmd in commands]
