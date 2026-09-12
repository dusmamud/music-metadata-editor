from typing import Optional, Any, Dict
from pydantic import BaseModel, Field

class AudioMetadata(BaseModel):
    title: Optional[str] = Field(default="", description="Track title")
    artist: Optional[str] = Field(default="", description="Track artist(s)")
    album: Optional[str] = Field(default="", description="Album name")
    album_artist: Optional[str] = Field(default="", description="Album artist")
    year: Optional[str] = Field(default="", description="Release year or date")
    genre: Optional[str] = Field(default="", description="Genre")
    track_number: Optional[str] = Field(default="", description="Track number (e.g., '1' or '1/12')")
    disc_number: Optional[str] = Field(default="", description="Disc number (e.g., '1' or '1/2')")
    composer: Optional[str] = Field(default="", description="Composer name")
    comment: Optional[str] = Field(default="", description="Comment or description")
    lyrics: Optional[str] = Field(default="", description="Plain text lyrics")
    synced_lyrics: Optional[str] = Field(default="", description="Synced lyrics with [mm:ss.xx] timestamps (.lrc format)")
    has_cover: bool = Field(default=False, description="Whether embedded cover art exists")

class AudioTechnicalInfo(BaseModel):
    duration_seconds: int = 0
    duration_formatted: str = "0:00"
    bitrate_kbps: int = 0
    sample_rate_hz: int = 0
    channels: int = 2
    format: str = "audio"
    file_size_bytes: int = 0
    file_size_formatted: str = "0 MB"

class AudioFileDetails(BaseModel):
    file_id: str
    original_filename: str
    extension: str
    technical: AudioTechnicalInfo
    metadata: AudioMetadata

class UpdateMetadataPayload(BaseModel):
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    album_artist: Optional[str] = None
    year: Optional[str] = None
    genre: Optional[str] = None
    track_number: Optional[str] = None
    disc_number: Optional[str] = None
    composer: Optional[str] = None
    comment: Optional[str] = None
    lyrics: Optional[str] = None
    synced_lyrics: Optional[str] = None
    remove_cover: Optional[bool] = False

class ApiResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    data: Optional[Any] = None
    error: Optional[Dict[str, Any]] = None
