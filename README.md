# 🎵 AudioTag Pro – Free Audio & MP3/M4A Metadata Studio

<p align="center">
  <a href="https://github.com/dusmamud/music-metadata-editor/actions/workflows/deploy.yml">
    <img src="https://github.com/dusmamud/music-metadata-editor/actions/workflows/deploy.yml/badge.svg" alt="GitHub Pages Deployment" />
  </a>
  <img src="https://img.shields.io/badge/Python-3.10%20%7C%203.11%20%7C%203.12-3776AB?logo=python&logoColor=white" alt="Python Versions" />
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-success.svg" alt="License: MIT" />
  </a>
  <img src="https://img.shields.io/badge/Engine-FastAPI%20%2B%20Web%20Audio%20API-009688?logo=fastapi&logoColor=white" alt="Engine" />
  <img src="https://img.shields.io/badge/Platform-Browser%20%7C%20Windows%20%7C%20Linux%20%7C%20macOS-0078D6" alt="Platforms" />
</p>

<p align="center">
  <strong>Live Web Demo:</strong> <a href="https://dusmamud.github.io/music-metadata-editor/"><strong>https://dusmamud.github.io/music-metadata-editor/</strong></a>
</p>

**AudioTag Pro** is a modern, high-performance audio metadata editor and synced karaoke lyrics studio. It features a **Dual-Engine Architecture**:
1. ⚡ **100% In-Browser Engine (Default / GitHub Pages)**: Runs completely in client memory using Web Audio API, ArrayBuffer, HTML5 Canvas, and pure JS binary taggers. **Zero files are uploaded to any server.**
2. 🐍 **Python FastAPI Backend Engine**: Full-featured server deployment with Mutagen, isolated UUID workspaces, session cleanup daemon, and REST API.

---

## ✨ Features

- **Zero Server Uploads (Privacy First)**: Process entire audio files locally in your browser memory with zero network latency.
- **Synced Karaoke Lyrics (.LRC)**:
  - Embed timestamped `[mm:ss.xx]` lyrics into standard ID3 `SYLT`/`USLT` and MP4 `©lyr` atoms.
  - Real-time auto-scrolling karaoke visualizer.
  - Built-in online synced lyrics search powered by LRCLIB.
- **1:1 HD Album Artwork Studio**:
  - Automatically center-crops any image aspect ratio to an exact 1:1 HD square.
  - Standardizes resolution before embedding.
- **Lossless Binary Tag Injection**:
  - Only metadata containers and atom tables are modified.
  - Audio streams (MP3/AAC/FLAC) are **never re-encoded or compressed**.
- **Smart Binary Sniffing**:
  - Direct inspection of container magic bytes (e.g. `ftypisom` vs MPEG sync), preventing corruption when files downloaded from YouTube or Telegram with `.mp3` extension are actually MP4/AAC streams.
- **5 Theme Palettes**:
  - 🟣 Neon Violet
  - 🟢 Cyber Emerald
  - 🔵 Electric Cyan
  - 🟠 Sunset Amber
  - 🔴 Crimson Rose
- **Universal Mobile & Car Audio Player Compatibility**:
  - Poweramp, Apple Music, Samsung Music, VLC, Musixmatch, Windows Media Player, and modern car entertainment units.

---

## 🌐 Deploy to GitHub Pages (Static Hosting, Zero Python)

This repository is ready for **GitHub Pages** out-of-the-box!

1. Push this repository to GitHub:
   ```bash
   git init
   git add .
   git commit -m "feat: AudioTag Pro Studio"
   git remote add origin https://github.com/dusmamud/music-metadata-editor.git
   git push -u origin main
   ```
2. In your GitHub repository:
   - Go to **Settings** $\to$ **Pages**.
   - Under **Build and deployment** $\to$ **Source**, choose **GitHub Actions** (uses `.github/workflows/deploy.yml`) or choose **Deploy from a branch** $\to$ `main` / `root`.
3. Your site will be live instantly with 100% client-side functionality!

---

## 🐍 Local Python Backend (FastAPI)

If you prefer running with a Python backend:

### Quick Run (Windows)
Double-click `start.bat`.

### Command Line
```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start server
python app.py
```
Open **`http://localhost:8000`** in your browser. The UI will automatically detect the Python backend on `/api/health`.

---

## 🐳 Docker Deployment

```bash
docker-compose up -d --build
```
The server will run on `http://localhost:8000`.

---

## 📁 Repository Structure

```
.
├── index.html                  # Root static entrypoint for GitHub Pages
├── .nojekyll                   # Bypasses Jekyll on GitHub Pages
├── .github/
│   └── workflows/deploy.yml    # Automatic GitHub Pages deployment workflow
├── app.py                      # FastAPI server entrypoint
├── core/
│   ├── config.py               # Environment configuration
│   ├── security.py             # Filename validation & sanitization
│   └── cleanup.py              # Background session auto-cleanup daemon
├── models/
│   └── metadata.py             # Pydantic schemas
├── routes/
│   ├── audio.py                # Audio upload & download endpoints
│   ├── tags.py                 # Metadata extraction & embedding endpoints
│   ├── lyrics.py               # LRCLIB online lyrics search endpoint
│   └── health.py               # Health check endpoint
├── services/
│   ├── session_manager.py      # Session file management
│   ├── tagger_engine.py        # Mutagen audio engine
│   ├── cover_processor.py      # Pillow cover art square cropper
│   └── lyrics_service.py       # Synced lyrics fetching & verification
├── static/
│   ├── css/studio.css          # Glassmorphic stylesheet with 5 themes & zero-overflow
│   └── js/
│       ├── tagger/
│       │   ├── mp3_tagger.js   # Pure JS ID3v2/v1 parser & binary writer
│       │   ├── m4a_tagger.js   # Pure JS MP4 atom parser & binary writer
│       │   └── universal_tagger.js # Magic-byte sniffer & canvas 1:1 cropper
│       ├── player.js           # Audio player & real-time karaoke scroller
│       ├── uploader.js         # Client-side ArrayBuffer drag & drop handler
│       └── app.js              # Master UI controller with theme & demo track
└── templates/
    └── index.html              # FastAPI template mirror
```

---

## 📄 License
MIT License. Free for personal and commercial use.
