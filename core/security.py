import re
import urllib.parse
from pathlib import Path
from core.config import ALLOWED_EXTENSIONS, ALLOWED_IMAGE_EXTENSIONS

def sanitize_filename(filename: str) -> str:
    """Removes path traversal components and illegal characters for Windows/Linux filesystems."""
    # Strip directory components
    name = Path(filename).name
    # Remove control characters and illegal symbols
    cleaned = re.sub(r'[\\/*?:"<>|]', "", name)
    cleaned = cleaned.strip(" .")
    return cleaned or "audio_track"

def validate_audio_filename(filename: str) -> bool:
    """Verifies that the file has an allowed audio extension."""
    suffix = Path(filename).suffix.lower()
    return suffix in ALLOWED_EXTENSIONS

def validate_image_filename(filename: str) -> bool:
    """Verifies that the cover image has an allowed image extension."""
    suffix = Path(filename).suffix.lower()
    return suffix in ALLOWED_IMAGE_EXTENSIONS

def build_content_disposition_header(filename: str) -> str:
    """Generates an RFC 5987 compliant Content-Disposition header supporting UTF-8 and ASCII fallback."""
    clean = sanitize_filename(filename)
    ascii_name = "".join(c for c in clean if ord(c) < 128 and (c.isalnum() or c in (" ", "-", "_", "."))).strip()
    if not ascii_name:
        ascii_name = "audio_track" + Path(clean).suffix

    encoded_utf8 = urllib.parse.quote(clean)
    return f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{encoded_utf8}'
