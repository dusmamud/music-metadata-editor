import logging
from pathlib import Path
from typing import Tuple, Optional, Any, Dict
import re
import mutagen
from mutagen.id3 import (
    ID3, TIT2, TPE1, TALB, TPE2, TDRC, TCON, TRCK, TPOS, TCOM, COMM, USLT, SYLT, TXXX, APIC, ID3NoHeaderError
)
from mutagen.mp4 import MP4, MP4Cover
from mutagen.flac import FLAC, Picture
from mutagen.wave import WAVE
from mutagen.oggvorbis import OggVorbis
from mutagen.oggopus import OggOpus

from models.metadata import AudioMetadata, AudioTechnicalInfo, UpdateMetadataPayload

logger = logging.getLogger("audiotag.tagger")

def is_lrc_formatted(text: str) -> bool:
    """Checks if text contains synced LRC timestamps like [01:23.45]."""
    if not text:
        return False
    return bool(re.search(r'\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]', text))

def parse_lrc_to_sylt_entries(lrc_text: str):
    """Converts LRC string into Mutagen SYLT format list: [(text, milliseconds), ...]"""
    entries = []
    pattern = re.compile(r'\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)')
    for line in lrc_text.splitlines():
        line = line.strip()
        match = pattern.match(line)
        if match:
            mins = int(match.group(1))
            secs = int(match.group(2))
            frac_str = match.group(3) or "0"
            frac_ms = int(frac_str.ljust(3, "0")[:3])
            total_ms = (mins * 60 + secs) * 1000 + frac_ms
            lyric = match.group(4).strip()
            entries.append((lyric, total_ms))
    return sorted(entries, key=lambda x: x[1])

def parse_sylt_to_lrc(sylt_frame) -> str:
    """Converts Mutagen SYLT frame entries into standard LRC string."""
    lines = []
    for text, ms in sylt_frame.text:
        total_secs = ms / 1000.0
        m = int(total_secs // 60)
        s = total_secs % 60
        lines.append(f"[{m:02d}:{s:05.2f}] {text}")
    return "\n".join(lines)

def format_file_size(size_bytes: int) -> str:
    """Formats bytes into human readable string."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} MB"

def format_duration(seconds: int) -> str:
    """Formats seconds into mm:ss format."""
    mins = seconds // 60
    secs = seconds % 60
    return f"{mins}:{secs:02d}"

class TaggerEngine:
    """Robust audio metadata extraction and binary tag embedding engine."""

    @classmethod
    def inspect_file(cls, file_path: Path) -> Tuple[AudioMetadata, AudioTechnicalInfo, Optional[bytes]]:
        """
        Extracts technical audio properties, metadata tags, and raw embedded cover artwork bytes.
        """
        ext = file_path.suffix.lower()
        file_size = file_path.stat().st_size
        
        # 1. Technical Info defaults
        tech = AudioTechnicalInfo(
            format=ext.replace(".", "").upper(),
            file_size_bytes=file_size,
            file_size_formatted=format_file_size(file_size)
        )
        meta = AudioMetadata()
        cover_bytes: Optional[bytes] = None

        try:
            audio = mutagen.File(str(file_path))
            if audio is None:
                logger.warning(f"Mutagen could not recognize audio container: {file_path.name}")
                return meta, tech, None

            # Extract audio technical details
            if hasattr(audio, "info") and audio.info:
                duration_sec = int(round(getattr(audio.info, "length", 0)))
                bitrate = int(round(getattr(audio.info, "bitrate", 0) / 1000)) if getattr(audio.info, "bitrate", 0) else 0
                sample_rate = int(getattr(audio.info, "sample_rate", 0))
                channels = int(getattr(audio.info, "channels", 2))

                tech.duration_seconds = duration_sec
                tech.duration_formatted = format_duration(duration_sec)
                tech.bitrate_kbps = bitrate
                tech.sample_rate_hz = sample_rate
                tech.channels = channels

            # Route by format
            if ext == ".mp3":
                meta, cover_bytes = cls._inspect_mp3(file_path)
            elif ext in (".m4a", ".aac", ".mp4"):
                meta, cover_bytes = cls._inspect_m4a(audio)
            elif ext == ".flac":
                meta, cover_bytes = cls._inspect_flac(audio)
            elif ext == ".wav":
                meta, cover_bytes = cls._inspect_wav(file_path)
            elif ext in (".ogg", ".opus"):
                meta, cover_bytes = cls._inspect_ogg(audio)
            else:
                meta, cover_bytes = cls._inspect_generic(audio)

            if cover_bytes:
                meta.has_cover = True

        except Exception as e:
            logger.error(f"Error inspecting {file_path.name}: {e}")

        return meta, tech, cover_bytes

    # -------------------------------------------------------------
    # FORMAT INSPECTORS
    # -------------------------------------------------------------
    @staticmethod
    def _inspect_mp3(file_path: Path) -> Tuple[AudioMetadata, Optional[bytes]]:
        meta = AudioMetadata()
        cover: Optional[bytes] = None

        try:
            id3 = ID3(str(file_path))
        except ID3NoHeaderError:
            return meta, None
        except Exception as e:
            logger.warning(f"Could not load ID3 tags from {file_path.name}: {e}")
            return meta, None

        if "TIT2" in id3: meta.title = str(id3["TIT2"])
        if "TPE1" in id3: meta.artist = str(id3["TPE1"])
        if "TALB" in id3: meta.album = str(id3["TALB"])
        if "TPE2" in id3: meta.album_artist = str(id3["TPE2"])
        if "TDRC" in id3: meta.year = str(id3["TDRC"])
        if "TCON" in id3: meta.genre = str(id3["TCON"])
        if "TRCK" in id3: meta.track_number = str(id3["TRCK"])
        if "TPOS" in id3: meta.disc_number = str(id3["TPOS"])
        if "TCOM" in id3: meta.composer = str(id3["TCOM"])

        # Comment
        for frame_key in id3.keys():
            if frame_key.startswith("COMM"):
                meta.comment = str(id3[frame_key])
                break

        # Synced lyrics (SYLT frame)
        for frame_key in id3.keys():
            if frame_key.startswith("SYLT"):
                sylt_frame = id3[frame_key]
                if hasattr(sylt_frame, "text") and sylt_frame.text:
                    try:
                        meta.synced_lyrics = parse_sylt_to_lrc(sylt_frame)
                    except Exception as e:
                        logger.debug(f"Could not parse SYLT frame: {e}")
                break

        # Lyrics (USLT frame)
        for frame_key in id3.keys():
            if frame_key.startswith("USLT"):
                lyrics_val = str(id3[frame_key])
                if is_lrc_formatted(lyrics_val):
                    if not meta.synced_lyrics:
                        meta.synced_lyrics = lyrics_val
                else:
                    meta.lyrics = lyrics_val
                break

        # Check TXXX:LYRICS fallback
        if not meta.synced_lyrics:
            for frame_key in id3.keys():
                if frame_key.startswith("TXXX"):
                    txxx = id3[frame_key]
                    desc = getattr(txxx, "desc", "").lower()
                    if desc in ("lyrics", "syncedlyrics", "lrc") and is_lrc_formatted(str(txxx)):
                        meta.synced_lyrics = str(txxx)
                        break

        # Cover art (APIC)
        for frame_key in id3.keys():
            if frame_key.startswith("APIC"):
                apic_frame = id3[frame_key]
                if hasattr(apic_frame, "data"):
                    cover = apic_frame.data
                    break

        return meta, cover

    @staticmethod
    def _inspect_m4a(audio: Any) -> Tuple[AudioMetadata, Optional[bytes]]:
        meta = AudioMetadata()
        cover: Optional[bytes] = None
        tags = getattr(audio, "tags", None) or {}

        def get_first(key: str) -> str:
            val = tags.get(key)
            if val and isinstance(val, list) and len(val) > 0:
                return str(val[0])
            return str(val) if val is not None else ""

        meta.title = get_first("\xa9nam")
        meta.artist = get_first("\xa9ART")
        meta.album = get_first("\xa9alb")
        meta.album_artist = get_first("aART")
        meta.year = get_first("\xa9day")
        meta.genre = get_first("\xa9gen")
        meta.composer = get_first("\xa9wrt")
        meta.comment = get_first("\xa9cmt")

        raw_lyr = get_first("\xa9lyr")
        if is_lrc_formatted(raw_lyr):
            meta.synced_lyrics = raw_lyr
        else:
            meta.lyrics = raw_lyr

        # Track number in MP4: list of tuples [(track_num, total_tracks)]
        trkn = tags.get("trkn")
        if trkn and isinstance(trkn, list) and len(trkn) > 0 and isinstance(trkn[0], tuple):
            t_num, t_tot = trkn[0]
            meta.track_number = f"{t_num}/{t_tot}" if t_tot else str(t_num)

        disk = tags.get("disk")
        if disk and isinstance(disk, list) and len(disk) > 0 and isinstance(disk[0], tuple):
            d_num, d_tot = disk[0]
            meta.disc_number = f"{d_num}/{d_tot}" if d_tot else str(d_num)

        # Artwork: covr is a list of MP4Cover objects
        covr = tags.get("covr")
        if covr and isinstance(covr, list) and len(covr) > 0:
            cover = bytes(covr[0])

        return meta, cover

    @staticmethod
    def _inspect_flac(audio: Any) -> Tuple[AudioMetadata, Optional[bytes]]:
        meta = AudioMetadata()
        cover: Optional[bytes] = None

        def get_val(key: str) -> str:
            val = audio.get(key)
            return str(val[0]) if val and len(val) > 0 else ""

        meta.title = get_val("title")
        meta.artist = get_val("artist")
        meta.album = get_val("album")
        meta.album_artist = get_val("albumartist")
        meta.year = get_val("date") or get_val("year")
        meta.genre = get_val("genre")
        meta.track_number = get_val("tracknumber")
        meta.disc_number = get_val("discnumber")
        meta.composer = get_val("composer")
        meta.comment = get_val("comment")
        meta.lyrics = get_val("lyrics")

        # Pictures in FLAC
        if hasattr(audio, "pictures") and audio.pictures:
            cover = audio.pictures[0].data

        return meta, cover

    @classmethod
    def _inspect_wav(cls, file_path: Path) -> Tuple[AudioMetadata, Optional[bytes]]:
        return cls._inspect_mp3(file_path)

    @classmethod
    def _inspect_ogg(cls, audio: Any) -> Tuple[AudioMetadata, Optional[bytes]]:
        return cls._inspect_flac(audio)

    @staticmethod
    def _inspect_generic(audio: Any) -> Tuple[AudioMetadata, Optional[bytes]]:
        meta = AudioMetadata()
        if hasattr(audio, "tags") and audio.tags:
            for k in ("title", "artist", "album", "date", "genre"):
                if k in audio.tags:
                    setattr(meta, k if k != "date" else "year", str(audio.tags[k][0]))
        return meta, None

    # -------------------------------------------------------------
    # FORMAT TAG WRITERS
    # -------------------------------------------------------------
    @classmethod
    def write_metadata(
        cls,
        file_path: Path,
        payload: UpdateMetadataPayload,
        new_cover_bytes: Optional[bytes] = None,
        cover_mime: str = "image/jpeg"
    ) -> bool:
        """
        Burns updated metadata tags and optional cover art directly into the audio file binary.
        Zero re-encoding; preserves original audio stream quality 100%.
        """
        ext = file_path.suffix.lower()

        try:
            if ext == ".mp3":
                return cls._write_mp3(file_path, payload, new_cover_bytes, cover_mime)
            elif ext in (".m4a", ".aac", ".mp4"):
                return cls._write_m4a(file_path, payload, new_cover_bytes)
            elif ext == ".flac":
                return cls._write_flac(file_path, payload, new_cover_bytes, cover_mime)
            elif ext == ".wav":
                return cls._write_wav(file_path, payload, new_cover_bytes, cover_mime)
            elif ext in (".ogg", ".opus"):
                return cls._write_ogg(file_path, payload)
            else:
                logger.warning(f"Unsupported write format: {ext}")
                return False
        except Exception as e:
            logger.error(f"Failed to write metadata to {file_path.name}: {e}", exc_info=True)
            return False

    @staticmethod
    def _write_mp3(
        file_path: Path,
        payload: UpdateMetadataPayload,
        new_cover_bytes: Optional[bytes],
        cover_mime: str
    ) -> bool:
        try:
            id3 = ID3(str(file_path))
        except ID3NoHeaderError:
            id3 = ID3()

        # Helper to set text frame
        def set_frame(FrameClass, frame_id, val):
            if val is not None:
                cleaned = str(val).strip()
                if cleaned:
                    id3.setall(frame_id, [FrameClass(encoding=3, text=[cleaned])])
                else:
                    id3.delall(frame_id)

        set_frame(TIT2, "TIT2", payload.title)
        set_frame(TPE1, "TPE1", payload.artist)
        set_frame(TALB, "TALB", payload.album)
        set_frame(TPE2, "TPE2", payload.album_artist)
        set_frame(TDRC, "TDRC", payload.year)
        set_frame(TCON, "TCON", payload.genre)
        set_frame(TRCK, "TRCK", payload.track_number)
        set_frame(TPOS, "TPOS", payload.disc_number)
        set_frame(TCOM, "TCOM", payload.composer)

        if payload.comment is not None:
            id3.delall("COMM")
            if payload.comment.strip():
                id3.add(COMM(encoding=3, lang="eng", desc="", text=[payload.comment.strip()]))

        # Synced and plain lyrics
        if payload.synced_lyrics is not None and payload.synced_lyrics.strip():
            cleaned_lrc = payload.synced_lyrics.strip()
            # 1. Write standard SYLT frame (Karaoke / Synced)
            id3.delall("SYLT")
            entries = parse_lrc_to_sylt_entries(cleaned_lrc)
            if entries:
                try:
                    id3.add(SYLT(encoding=3, lang="eng", format=2, type=1, desc="", text=entries))
                except Exception as e:
                    logger.warning(f"Could not encode SYLT frame: {e}")
            # 2. Write timestamped text to USLT & TXXX:LYRICS for wide mobile & car player support
            id3.delall("USLT")
            id3.add(USLT(encoding=3, lang="eng", desc="", text=cleaned_lrc))
            id3.delall("TXXX:LYRICS")
            id3.add(TXXX(encoding=3, desc="LYRICS", text=[cleaned_lrc]))
        elif payload.lyrics is not None:
            id3.delall("USLT")
            id3.delall("SYLT")
            id3.delall("TXXX:LYRICS")
            if payload.lyrics.strip():
                id3.add(USLT(encoding=3, lang="eng", desc="", text=payload.lyrics.strip()))

        # Cover artwork
        if payload.remove_cover:
            id3.delall("APIC")
        elif new_cover_bytes:
            id3.delall("APIC")
            id3.add(APIC(
                encoding=3,
                mime=cover_mime,
                type=3,  # Cover (front)
                desc="Cover",
                data=new_cover_bytes
            ))

        id3.save(str(file_path), v2_version=3)  # ID3v2.3 for broad player compatibility
        return True

    @staticmethod
    def _write_m4a(
        file_path: Path,
        payload: UpdateMetadataPayload,
        new_cover_bytes: Optional[bytes]
    ) -> bool:
        mp4 = MP4(str(file_path))
        if mp4.tags is None:
            mp4.add_tags()

        tags = mp4.tags

        def set_m4a_str(atom: str, val: Optional[str]):
            if val is not None:
                cleaned = str(val).strip()
                if cleaned:
                    tags[atom] = [cleaned]
                elif atom in tags:
                    del tags[atom]

        set_m4a_str("\xa9nam", payload.title)
        set_m4a_str("\xa9ART", payload.artist)
        set_m4a_str("\xa9alb", payload.album)
        set_m4a_str("aART", payload.album_artist)
        set_m4a_str("\xa9day", payload.year)
        set_m4a_str("\xa9gen", payload.genre)
        set_m4a_str("\xa9wrt", payload.composer)
        set_m4a_str("\xa9cmt", payload.comment)
        if payload.synced_lyrics is not None and payload.synced_lyrics.strip():
            set_m4a_str("\xa9lyr", payload.synced_lyrics)
        else:
            set_m4a_str("\xa9lyr", payload.lyrics)

        # Track number parsing
        if payload.track_number is not None:
            cleaned = payload.track_number.strip()
            if cleaned:
                parts = cleaned.split("/")
                try:
                    num = int(parts[0])
                    tot = int(parts[1]) if len(parts) > 1 else 0
                    tags["trkn"] = [(num, tot)]
                except Exception:
                    pass
            elif "trkn" in tags:
                del tags["trkn"]

        # Disc number parsing
        if payload.disc_number is not None:
            cleaned = payload.disc_number.strip()
            if cleaned:
                parts = cleaned.split("/")
                try:
                    num = int(parts[0])
                    tot = int(parts[1]) if len(parts) > 1 else 0
                    tags["disk"] = [(num, tot)]
                except Exception:
                    pass
            elif "disk" in tags:
                del tags["disk"]

        # Cover Artwork
        if payload.remove_cover:
            if "covr" in tags:
                del tags["covr"]
        elif new_cover_bytes:
            # MP4Cover format
            img_format = MP4Cover.FORMAT_PNG if new_cover_bytes.startswith(b"\x89PNG") else MP4Cover.FORMAT_JPEG
            tags["covr"] = [MP4Cover(new_cover_bytes, imageformat=img_format)]

        mp4.save()
        return True

    @staticmethod
    def _write_flac(
        file_path: Path,
        payload: UpdateMetadataPayload,
        new_cover_bytes: Optional[bytes],
        cover_mime: str
    ) -> bool:
        flac = FLAC(str(file_path))

        def set_flac_val(key: str, val: Optional[str]):
            if val is not None:
                cleaned = str(val).strip()
                if cleaned:
                    flac[key] = [cleaned]
                elif key in flac:
                    del flac[key]

        set_flac_val("title", payload.title)
        set_flac_val("artist", payload.artist)
        set_flac_val("album", payload.album)
        set_flac_val("albumartist", payload.album_artist)
        set_flac_val("date", payload.year)
        set_flac_val("genre", payload.genre)
        set_flac_val("tracknumber", payload.track_number)
        set_flac_val("discnumber", payload.disc_number)
        set_flac_val("composer", payload.composer)
        set_flac_val("comment", payload.comment)
        set_flac_val("lyrics", payload.lyrics)

        if payload.remove_cover:
            flac.clear_pictures()
        elif new_cover_bytes:
            flac.clear_pictures()
            pic = Picture()
            pic.data = new_cover_bytes
            pic.type = 3
            pic.mime = cover_mime
            flac.add_picture(pic)

        flac.save()
        return True

    @classmethod
    def _write_wav(cls, file_path: Path, payload: UpdateMetadataPayload, new_cover_bytes: Optional[bytes], cover_mime: str) -> bool:
        # Standard ID3 tagging for WAV
        return cls._write_mp3(file_path, payload, new_cover_bytes, cover_mime)

    @classmethod
    def _write_ogg(cls, file_path: Path, payload: UpdateMetadataPayload) -> bool:
        ogg = mutagen.File(str(file_path))
        if ogg and hasattr(ogg, "tags") and ogg.tags is not None:
            if payload.title: ogg.tags["title"] = [payload.title.strip()]
            if payload.artist: ogg.tags["artist"] = [payload.artist.strip()]
            if payload.album: ogg.tags["album"] = [payload.album.strip()]
            if payload.year: ogg.tags["date"] = [payload.year.strip()]
            if payload.genre: ogg.tags["genre"] = [payload.genre.strip()]
            ogg.save()
            return True
        return False
