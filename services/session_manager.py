import uuid
import json
import shutil
from pathlib import Path
from typing import Optional, Tuple, List, Dict
from core.config import STORAGE_DIR
from core.security import sanitize_filename

class SessionManager:
    """Manages isolated session storage directories and files for multi-user web hosting."""

    @staticmethod
    def get_or_create_session(session_id: Optional[str] = None) -> Tuple[str, Path]:
        """Returns verified session_id and its dedicated storage directory."""
        if not session_id or not session_id.strip():
            session_id = str(uuid.uuid4())
        else:
            # Prevent path traversal in session_id
            session_id = "".join(c for c in session_id if c.isalnum() or c == "-")
            if not session_id:
                session_id = str(uuid.uuid4())

        session_dir = STORAGE_DIR / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        return session_id, session_dir

    @staticmethod
    def get_session_dir(session_id: str) -> Optional[Path]:
        """Returns session directory if exists."""
        clean_id = "".join(c for c in session_id if c.isalnum() or c == "-")
        session_dir = STORAGE_DIR / clean_id
        return session_dir if session_dir.exists() else None

    @classmethod
    def save_uploaded_audio(cls, session_id: str, filename: str, content: bytes) -> Tuple[str, Path]:
        """Saves uploaded audio file into user's isolated session folder."""
        _, session_dir = cls.get_or_create_session(session_id)
        file_id = str(uuid.uuid4())[:8]
        clean_name = sanitize_filename(filename)
        ext = Path(clean_name).suffix.lower()

        # Storage filename includes file_id to prevent collision
        stored_filename = f"{file_id}_{clean_name}"
        dest_path = session_dir / stored_filename
        dest_path.write_bytes(content)

        # Update index map in session
        cls._record_file(session_dir, file_id, clean_name, stored_filename)

        return file_id, dest_path

    @classmethod
    def get_audio_file_path(cls, session_id: str, file_id: str) -> Optional[Path]:
        """Locates the audio file path corresponding to file_id in the session."""
        session_dir = cls.get_session_dir(session_id)
        if not session_dir:
            return None

        index = cls._read_index(session_dir)
        file_info = index.get(file_id)
        if file_info:
            target = session_dir / file_info["stored_filename"]
            if target.exists():
                return target

        # Fallback search by prefix
        matches = list(session_dir.glob(f"{file_id}_*"))
        return matches[0] if matches else None

    @classmethod
    def get_cover_path(cls, session_id: str, file_id: str) -> Path:
        """Returns designated path for temporary extracted cover art in session."""
        _, session_dir = cls.get_or_create_session(session_id)
        return session_dir / f"{file_id}_cover.jpg"

    @classmethod
    def delete_file(cls, session_id: str, file_id: str) -> bool:
        """Removes an audio file and its cover cache from session."""
        session_dir = cls.get_session_dir(session_id)
        if not session_dir:
            return False

        # Delete audio file
        path = cls.get_audio_file_path(session_id, file_id)
        if path and path.exists():
            path.unlink(missing_ok=True)

        # Delete cached cover
        cover = cls.get_cover_path(session_id, file_id)
        cover.unlink(missing_ok=True)

        # Update index
        index = cls._read_index(session_dir)
        if file_id in index:
            del index[file_id]
            cls._write_index(session_dir, index)

        return True

    @classmethod
    def list_session_files(cls, session_id: str) -> List[Dict]:
        """Lists active files in user session."""
        session_dir = cls.get_session_dir(session_id)
        if not session_dir:
            return []
        index = cls._read_index(session_dir)
        return [{"file_id": fid, **info} for fid, info in index.items()]

    @staticmethod
    def _read_index(session_dir: Path) -> Dict:
        idx_file = session_dir / "index.json"
        if idx_file.exists():
            try:
                return json.loads(idx_file.read_text(encoding="utf-8"))
            except Exception:
                return {}
        return {}

    @staticmethod
    def _write_index(session_dir: Path, data: Dict):
        idx_file = session_dir / "index.json"
        idx_file.write_text(json.dumps(data, indent=2), encoding="utf-8")

    @classmethod
    def _record_file(cls, session_dir: Path, file_id: str, original_filename: str, stored_filename: str):
        index = cls._read_index(session_dir)
        index[file_id] = {
            "original_filename": original_filename,
            "stored_filename": stored_filename
        }
        cls._write_index(session_dir, index)
