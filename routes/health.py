import time
import shutil
from fastapi import APIRouter
from core.config import STORAGE_DIR, APP_NAME, SESSION_TTL_MINUTES

router = APIRouter(tags=["Health & System"])
SERVER_START_TIME = time.time()

@router.get("/health")
def health_check():
    """Returns application health status and storage statistics."""
    total, used, free = shutil.disk_usage(STORAGE_DIR)
    active_sessions = len([d for d in STORAGE_DIR.iterdir() if d.is_dir()]) if STORAGE_DIR.exists() else 0
    uptime_seconds = int(time.time() - SERVER_START_TIME)

    return {
        "status": "healthy",
        "app": APP_NAME,
        "uptime_seconds": uptime_seconds,
        "active_sessions": active_sessions,
        "session_ttl_minutes": SESSION_TTL_MINUTES,
        "storage": {
            "total_gb": round(total / (1024 ** 3), 2),
            "free_gb": round(free / (1024 ** 3), 2),
            "used_gb": round(used / (1024 ** 3), 2)
        }
    }
