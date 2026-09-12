import logging
from typing import Optional
from fastapi import APIRouter, Form, UploadFile, File, HTTPException

from services.session_manager import SessionManager
from services.tagger_engine import TaggerEngine
from services.cover_processor import CoverProcessor
from models.metadata import UpdateMetadataPayload, ApiResponse, AudioFileDetails

logger = logging.getLogger("audiotag.tags_route")
router = APIRouter(prefix="/api/tags", tags=["Metadata Tags"])

@router.post("/save/{session_id}/{file_id}", response_model=ApiResponse)
async def save_audio_metadata(
    session_id: str,
    file_id: str,
    title: Optional[str] = Form(None),
    artist: Optional[str] = Form(None),
    album: Optional[str] = Form(None),
    album_artist: Optional[str] = Form(None),
    year: Optional[str] = Form(None),
    genre: Optional[str] = Form(None),
    track_number: Optional[str] = Form(None),
    disc_number: Optional[str] = Form(None),
    composer: Optional[str] = Form(None),
    comment: Optional[str] = Form(None),
    lyrics: Optional[str] = Form(None),
    synced_lyrics: Optional[str] = Form(None),
    remove_cover: Optional[bool] = Form(False),
    cover_image: Optional[UploadFile] = File(None)
):
    """
    Burns updated metadata tags and optional cover artwork directly into the audio file binary.
    Zero audio re-encoding is performed; original stream quality is preserved 100%.
    """
    path = SessionManager.get_audio_file_path(session_id, file_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found in session")

    payload = UpdateMetadataPayload(
        title=title,
        artist=artist,
        album=album,
        album_artist=album_artist,
        year=year,
        genre=genre,
        track_number=track_number,
        disc_number=disc_number,
        composer=composer,
        comment=comment,
        lyrics=lyrics,
        synced_lyrics=synced_lyrics,
        remove_cover=remove_cover
    )

    new_cover_bytes: Optional[bytes] = None
    cover_mime = "image/jpeg"

    # Process new cover art if uploaded
    if cover_image and cover_image.filename:
        raw_img = await cover_image.read()
        if raw_img:
            processed = CoverProcessor.process_cover_image(raw_img)
            if processed:
                new_cover_bytes, cover_mime = processed
                # Update disk cache for browser preview
                cover_path = SessionManager.get_cover_path(session_id, file_id)
                cover_path.write_bytes(new_cover_bytes)
    elif remove_cover:
        # Delete cover cache on disk
        cover_path = SessionManager.get_cover_path(session_id, file_id)
        cover_path.unlink(missing_ok=True)

    # Burn tags into audio binary
    success = TaggerEngine.write_metadata(
        file_path=path,
        payload=payload,
        new_cover_bytes=new_cover_bytes,
        cover_mime=cover_mime
    )

    if not success:
        return ApiResponse(
            success=False,
            message="Failed to write metadata tags into the audio file."
        )

    # Re-inspect to obtain fresh verified data
    updated_meta, tech, _ = TaggerEngine.inspect_file(path)
    # Check if cover exists on disk
    updated_meta.has_cover = SessionManager.get_cover_path(session_id, file_id).exists()

    file_details = AudioFileDetails(
        file_id=file_id,
        original_filename=path.name,
        extension=path.suffix.lower(),
        technical=tech,
        metadata=updated_meta
    )

    return ApiResponse(
        success=True,
        message="Tags saved and embedded successfully into audio file!",
        data=file_details.model_dump()
    )
