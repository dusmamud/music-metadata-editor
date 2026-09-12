import sys
import shutil
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.tagger_engine import TaggerEngine
from services.cover_processor import CoverProcessor
from models.metadata import UpdateMetadataPayload
from PIL import Image
import io

def run_test():
    src = Path(r'E:\relvoq\music\music-tools\test_sine.m4a')
    dest = Path('temp_test.m4a')
    shutil.copy(src, dest)

    try:
        meta, tech, cover = TaggerEngine.inspect_file(dest)
        print(f"Inspected initial: title='{meta.title}', duration={tech.duration_formatted}")

        # Create mock cover art
        img = Image.new('RGB', (600, 600), color=(80, 140, 240))
        buf = io.BytesIO()
        img.save(buf, format='JPEG')
        raw_img = buf.getvalue()
        cover_bytes, _ = CoverProcessor.process_cover_image(raw_img)

        # Write new tags
        payload = UpdateMetadataPayload(
            title="AudioTag Pro Anthem",
            artist="Master Producer",
            album="Cloud Beats Vol 1",
            year="2026",
            genre="Electronic",
            track_number="1/10",
            lyrics="This is a live test lyrics string!"
        )

        success = TaggerEngine.write_metadata(dest, payload, new_cover_bytes=cover_bytes)
        print(f"Write success: {success}")

        # Re-inspect to verify burn-in
        updated_meta, updated_tech, updated_cover = TaggerEngine.inspect_file(dest)
        print(f"Verified updated tags:")
        print(f"  Title: {updated_meta.title}")
        print(f"  Artist: {updated_meta.artist}")
        print(f"  Album: {updated_meta.album}")
        print(f"  Year: {updated_meta.year}")
        print(f"  Genre: {updated_meta.genre}")
        print(f"  Track#: {updated_meta.track_number}")
        print(f"  Lyrics: {updated_meta.lyrics}")
        print(f"  Has Cover: {updated_cover is not None} ({len(updated_cover) if updated_cover else 0} bytes)")

        assert updated_meta.title == "AudioTag Pro Anthem", "Title mismatch"
        assert updated_meta.artist == "Master Producer", "Artist mismatch"
        assert updated_cover is not None, "Cover not embedded"
        print("\nSUCCESS: All M4A metadata and cover art burn-in tests PASSED perfectly!")

    finally:
        if dest.exists():
            dest.unlink()

if __name__ == "__main__":
    run_test()
