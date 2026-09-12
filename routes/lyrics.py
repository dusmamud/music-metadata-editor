from fastapi import APIRouter, Query
from pydantic import BaseModel
from typing import Optional

from services.lyrics_service import fetch_song_lyrics

router = APIRouter(prefix="/api/lyrics", tags=["lyrics"])

class LyricsSearchRequest(BaseModel):
    title: str
    artist: Optional[str] = ""
    album: Optional[str] = ""
    duration: Optional[int] = 0

@router.get("/search")
async def search_lyrics(
    title: str = Query(..., description="Song Title"),
    artist: str = Query("", description="Artist Name"),
    album: str = Query("", description="Album Name"),
    duration: int = Query(0, description="Duration in seconds")
):
    """Searches LRCLIB for verified synchronized LRC and plain lyrics."""
    return fetch_song_lyrics(
        title=title,
        artist=artist,
        album=album,
        duration=duration
    )
