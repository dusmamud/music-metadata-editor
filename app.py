import os
import logging
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from core.config import APP_NAME, APP_HOST, APP_PORT, DEBUG, BASE_DIR
from core.cleanup import cleanup_daemon_loop
from routes.audio import router as audio_router
from routes.tags import router as tags_router
from routes.health import router as health_router
from routes.lyrics import router as lyrics_router

logging.basicConfig(
    level=logging.INFO if not DEBUG else logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("audiotag.server")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"==================================================")
    logger.info(f"   {APP_NAME} - Professional Audio Metadata Studio")
    logger.info(f"==================================================")
    logger.info(f"--> Server running at: http://{APP_HOST}:{APP_PORT}")

    # Launch background session auto-cleanup daemon
    cleanup_task = asyncio.create_task(cleanup_daemon_loop())
    yield
    # Cleanup task cancellation on shutdown
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass
    logger.info(f"--> {APP_NAME} server shutdown complete.")

app = FastAPI(
    title="AudioTag Pro API",
    description="Production-grade API for reading, editing, and embedding audio metadata and album artwork.",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware for hosted multi-domain / reverse proxy setups
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
static_dir = BASE_DIR / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

# Mount API routers
app.include_router(health_router)
app.include_router(audio_router)
app.include_router(tags_router)
app.include_router(lyrics_router)

@app.get("/", response_class=HTMLResponse)
async def index_view():
    """Serves the SEO-optimized AudioTag Pro Single Page Studio UI."""
    root_index = BASE_DIR / "index.html"
    if root_index.exists():
        return HTMLResponse(content=root_index.read_text(encoding="utf-8"))
    template_path = BASE_DIR / "templates" / "index.html"
    if template_path.exists():
        return HTMLResponse(content=template_path.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>AudioTag Pro - Template missing</h1>", status_code=500)

if __name__ == "__main__":
    import uvicorn
    import webbrowser

    # Auto-open browser if running locally on Windows/Mac
    if APP_HOST in ("127.0.0.1", "localhost", "0.0.0.0"):
        local_url = f"http://localhost:{APP_PORT}"
        try:
            webbrowser.open(local_url)
        except Exception:
            pass

    uvicorn.run("app:app", host=APP_HOST, port=APP_PORT, reload=DEBUG)
