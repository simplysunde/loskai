"""Per-instance launcher icons — the one place Loskai stores binary state.

Everything else Loskai keeps is text (JSON stores, logs, keys); these are images in the
same mounted volume (`<data_dir>/icons/<instance-id>.<ext>`), so they survive a restart and
a move the same way `instances.json` does, and a backup of the volume carries them.

They are served **publicly**, because the Dashboard is: a launcher card has to render its
icon before anyone logs in. That is why the accepted formats are a short allow-list checked
by *magic bytes* rather than by the filename or the browser's `Content-Type`, and why SVG is
not among them — an SVG is a script container, and these are served from Loskai's own origin.
"""

from pathlib import Path

from ..config import settings as env
from .errors import LoskaiError

# (magic bytes, extension, content type). Raster formats only, on purpose.
_FORMATS: list[tuple[bytes, str, str]] = [
    (b"\x89PNG\r\n\x1a\n", "png", "image/png"),
    (b"\xff\xd8\xff", "jpg", "image/jpeg"),
    (b"RIFF", "webp", "image/webp"),  # RIFF....WEBP — the WEBP tag is checked below
]

MAX_BYTES = 512 * 1024


class IconError(LoskaiError, ValueError):
    """Rejected upload."""

    status_code = 422


def sniff(data: bytes) -> tuple[str, str]:
    """`(extension, content_type)` for a supported image, or raise `IconError`.

    Sniffing the bytes is the point: a caller can claim any `Content-Type`, and the file is
    then served back from our own origin, so the stored bytes are what has to be vouched for.
    """
    if not data:
        raise IconError("empty file")
    if len(data) > MAX_BYTES:
        raise IconError(f"image is larger than {MAX_BYTES // 1024} KB")
    for magic, ext, content_type in _FORMATS:
        if data.startswith(magic):
            if ext == "webp" and data[8:12] != b"WEBP":
                continue  # RIFF, but some other RIFF container
            return ext, content_type
    raise IconError("unsupported image — use PNG, JPEG or WebP (SVG is not accepted)")


def icons_dir() -> Path:
    return Path(env.data_dir) / "icons"


def path_for(filename: str) -> Path:
    """Absolute path of a stored icon. `filename` comes from the instance record, never
    from a request, but it is still resolved and bounds-checked: a record is a file a human
    can edit, and `../` in it would otherwise read anything the process can."""
    root = icons_dir().resolve()
    candidate = (root / filename).resolve()
    if not candidate.is_relative_to(root):
        raise IconError("icon path escapes the icons directory")
    return candidate


def save(instance_id: str, data: bytes) -> str:
    """Write the icon for an instance and return its stored filename. One icon per
    instance: writing replaces whatever was there, including a different extension."""
    ext, _ = sniff(data)
    directory = icons_dir()
    directory.mkdir(parents=True, exist_ok=True)
    remove_all(instance_id)
    filename = f"{instance_id}.{ext}"
    tmp = directory / f".{filename}.tmp"
    tmp.write_bytes(data)
    tmp.replace(directory / filename)  # atomic: a reader never sees a half-written icon
    return filename


def remove_all(instance_id: str) -> None:
    """Delete any icon for this instance, whatever extension it was stored under."""
    directory = icons_dir()
    if not directory.is_dir():
        return
    for _, ext, _ in _FORMATS:
        candidate = directory / f"{instance_id}.{ext}"
        if candidate.exists():
            candidate.unlink()


def content_type(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower()
    for _, candidate, ctype in _FORMATS:
        if candidate == ext:
            return ctype
    return "application/octet-stream"
