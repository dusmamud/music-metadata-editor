import time
import shutil
import logging
import asyncio
from pathlib import Path
from core.config import STORAGE_DIR, SESSION_TTL_MINUTES, CLEANUP_INTERVAL_MINUTES

logger = logging.getLogger("audiotag.cleanup")

def purge_expired_sessions() -> int:
    """Scans storage directory and deletes session directories older than SESSION_TTL_MINUTES."""
    if not STORAGE_DIR.exists():
        return 0

    now = time.time()
    ttl_seconds = SESSION_TTL_MINUTES * 60
    purged_count = 0

    for session_path in STORAGE_DIR.iterdir():
        if session_path.is_dir():
            try:
                # Use mtime of the session directory
                mtime = session_path.stat().st_mtime
                if (now - mtime) > ttl_seconds:
                    shutil.rmtree(session_path, ignore_errors=True)
                    purged_count += 1
                    logger.info(f"Purged expired session: {session_path.name}")
            except Exception as e:
                logger.warning(f"Error purging session {session_path.name}: {e}")

    return purged_count

async def cleanup_daemon_loop():
    """Asynchronous background loop running periodically during server uptime."""
    logger.info(f"Session auto-cleanup daemon active (TTL: {SESSION_TTL_MINUTES}m, Interval: {CLEANUP_INTERVAL_MINUTES}m)")
    while True:
        try:
            purged = purge_expired_sessions()
            if purged > 0:
                logger.info(f"Auto-purged {purged} expired session(s).")
        except Exception as e:
            logger.error(f"Auto-cleanup error: {e}")
        
        await asyncio.sleep(CLEANUP_INTERVAL_MINUTES * 60)
