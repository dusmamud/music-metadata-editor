import io
import logging
from typing import Optional, Tuple
from PIL import Image

logger = logging.getLogger("audiotag.cover")

class CoverProcessor:
    """Processes, standardizes, and prepares album art images for binary tag embedding."""

    MAX_DIMENSION = 800
    JPEG_QUALITY = 88

    @classmethod
    def process_cover_image(cls, image_bytes: bytes) -> Optional[Tuple[bytes, str]]:
        """
        Takes raw image bytes, converts to RGB, center-crops to 1:1 square,
        resizes to max 800x800, and returns (optimized_jpeg_bytes, 'image/jpeg').
        """
        if not image_bytes:
            return None

        try:
            with Image.open(io.BytesIO(image_bytes)) as img:
                # Convert to RGB (handles RGBA PNGs, Palette, CMYK)
                if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                    # White background for transparent PNGs
                    bg = Image.new("RGB", img.size, (255, 255, 255))
                    alpha = img.convert("RGBA").split()[-1]
                    bg.paste(img, mask=alpha)
                    img = bg
                else:
                    img = img.convert("RGB")

                # Center crop to 1:1 square
                w, h = img.size
                if w != h:
                    min_dim = min(w, h)
                    left = (w - min_dim) // 2
                    top = (h - min_dim) // 2
                    right = left + min_dim
                    bottom = top + min_dim
                    img = img.crop((left, top, right, bottom))

                # Resize to standard studio max dimension
                if img.size[0] > cls.MAX_DIMENSION:
                    img = img.resize((cls.MAX_DIMENSION, cls.MAX_DIMENSION), Image.Resampling.LANCZOS)

                # Save to optimized JPEG bytes
                out_buf = io.BytesIO()
                img.save(out_buf, format="JPEG", quality=cls.JPEG_QUALITY, optimize=True)
                return out_buf.getvalue(), "image/jpeg"
        except Exception as e:
            logger.error(f"Failed to process cover image: {e}")
            return None
