import logging
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Header, Response
from fastapi.responses import FileResponse

from core.config import MAX_UPLOAD_SIZE_MB
from core.security import validate_audio_filename, build_content_disposition_header
from services.session_manager import SessionManager
from services.tagger_engine import TaggerEngine
from models.metadata import AudioFileDetails, ApiResponse

logger = logging.getLogger("audiotag.audio_route")
router = APIRouter(prefix="/api/audio", tags=["Audio Management"])

@router.post("/upload", response_model=ApiResponse)
async def upload_audio_files(
    session_id: Optional[str] = Form(None),
    files: List[UploadFile] = File(...)
):
    """
    Uploads one or multiple audio tracks, isolates them in session,
    and returns parsed metadata and technical specifications for each.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No audio files provided")

    sess_id, _ = SessionManager.get_or_create_session(session_id)
    results: List[AudioFileDetails] = []
    max_bytes = MAX_UPLOAD_SIZE_MB * 1024 * 1024

    for file in files:
        filename = file.filename or "track.mp3"
        if not validate_audio_filename(filename):
            logger.warning(f"Rejected unsupported file extension: {filename}")
            continue

        content = await file.read()
        if len(content) > max_bytes:
            logger.warning(f"File exceeded size limit ({len(content)} bytes): {filename}")
            continue

        # Save to user session
        file_id, dest_path = SessionManager.save_uploaded_audio(sess_id, filename, content)

        # Inspect metadata & technical details
        meta, tech, cover_bytes = TaggerEngine.inspect_file(dest_path)

        # Cache cover art on disk if present
        if cover_bytes:
            cover_path = SessionManager.get_cover_path(sess_id, file_id)
            cover_path.write_bytes(cover_bytes)
            meta.has_cover = True

        results.append(AudioFileDetails(
            file_id=file_id,
            original_filename=filename,
            extension=dest_path.suffix.lower(),
            technical=tech,
            metadata=meta
        ))

    if not results:
        return ApiResponse(
            success=False,
            message="No valid audio files were uploaded or files exceeded size limit."
        )

    return ApiResponse(
        success=True,
        message=f"Successfully loaded {len(results)} audio track(s)",
        data={"session_id": sess_id, "tracks": [r.model_dump() for r in results]}
    )

@router.get("/stream/{session_id}/{file_id}")
def stream_audio(session_id: str, file_id: str):
    """Streams audio file to browser with HTTP Range support for live playback seeking."""
    path = SessionManager.get_audio_file_path(session_id, file_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    ext = path.suffix.lower()
    media_types = {
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".flac": "audio/flac",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".opus": "audio/opus"
    }
    media_type = media_types.get(ext, "application/octet-stream")

    return FileResponse(
        path=str(path),
        media_type=media_type,
        filename=path.name
    )

@router.get("/cover/{session_id}/{file_id}")
def get_cover_artwork(session_id: str, file_id: str):
    """Serves the extracted or updated cover art image for this audio track."""
    cover_path = SessionManager.get_cover_path(session_id, file_id)
    if not cover_path.exists():
        raise HTTPException(status_code=404, detail="Cover artwork not found")

    return FileResponse(path=str(cover_path), media_type="image/jpeg")

@router.get("/download/{session_id}/{file_id}")
def download_audio_file(session_id: str, file_id: str):
    """Downloads the audio track with embedded tags and Unicode-safe formatted filename."""
    path = SessionManager.get_audio_file_path(session_id, file_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    # Read tags to construct clean filename: "Artist - Title.ext" or fallback
    meta, _, _ = TaggerEngine.inspect_file(path)
    clean_title = (meta.title or "").strip()
    clean_artist = (meta.artist or "").strip()
    ext = path.suffix

    if clean_title and clean_artist:
        download_name = f"{clean_artist} - {clean_title}{ext}"
    elif clean_title:
        download_name = f"{clean_title}{ext}"
    else:
        # Strip internal file_id prefix from disk name
        disk_name = path.name
        download_name = disk_name.split("_", 1)[1] if "_" in disk_name else disk_name

    headers = {
        "Content-Disposition": build_content_disposition_header(download_name),
        "Access-Control-Expose-Headers": "Content-Disposition"
    }

    return FileResponse(
        path=str(path),
        filename=download_name,
        headers=headers
    )

@router.delete("/{session_id}/{file_id}", response_model=ApiResponse)
def remove_audio_file(session_id: str, file_id: str):
    """Removes an audio track from the current user session."""
    success = SessionManager.delete_file(session_id, file_id)
    return ApiResponse(
        success=success,
        message="Track deleted successfully" if success else "Track could not be deleted"
    )
