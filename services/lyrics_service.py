import re
import json
import logging
import urllib.parse
from typing import Dict, Any, Optional
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger("audiotag.lyrics")

# Persistent HTTP Session for LRCLIB API queries
_http_session = requests.Session()
_http_session.headers.update({
    "User-Agent": "AudioTagPro/2.0 (FastLyricsEngine)",
    "Accept": "application/json"
})
_adapter = HTTPAdapter(pool_connections=10, pool_maxsize=20, max_retries=Retry(total=1, backoff_factor=0.2))
_http_session.mount("https://", _adapter)
_http_session.mount("http://", _adapter)

# In-memory cache for instant repeated queries
_lyrics_memory_cache: Dict[str, Dict[str, Any]] = {}

def format_lrc_with_headers(raw_lrc: str, title: str, artist: str, album: str, author: str, duration_sec: int) -> str:
    """Standardizes LRC header tags [ar:...], [al:...], [ti:...], [length:mm:ss.00]."""
    if not raw_lrc or not raw_lrc.strip():
        return ""

    lines = raw_lrc.strip().split("\n")
    cleaned_lines = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if re.match(r"^\[(ar|al|ti|au|by|length|offset|re|ve|tool):.*\]$", stripped, re.IGNORECASE):
            continue
        cleaned_lines.append(stripped)

    if duration_sec and duration_sec > 0:
        mins = int(duration_sec) // 60
        secs = int(duration_sec) % 60
        len_str = f"{mins:02d}:{secs:02d}.00"
    else:
        len_str = "03:00.00"

    headers = [
        f"[ar:{artist or 'Unknown Artist'}]",
        f"[al:{album or title or 'Single'}]",
        f"[ti:{title or 'Unknown Title'}]",
        f"[au:{author or artist or 'AudioTag Pro'}]",
        f"[length:{len_str}]",
        f"[by:AudioTag Pro]"
    ]

    return "\n".join(headers) + "\n" + "\n".join(cleaned_lines)

def clean_song_title(title: str) -> str:
    """Removes noise tags like (Official Video), [Audio], etc."""
    if not title:
        return ""
    t = re.sub(r'\s*[\(\[](from|official|audio|video|lyric|full|hd|original|remastered|version|ost).*?[\)\]]', '', title, flags=re.IGNORECASE)
    t = re.sub(r'\s*-\s*(single|audio|from|official|remastered).*', '', t, flags=re.IGNORECASE)
    return t.strip()

def get_lrc_max_timestamp(lrc_text: str) -> float:
    """Extracts highest timestamp (in seconds) from LRC string."""
    if not lrc_text or not isinstance(lrc_text, str):
        return 0.0
    time_reg = re.compile(r'\[(\d{1,2}):(\d{2})(?:\.(\d{2,3}))?\]')
    max_sec = 0.0
    for line in lrc_text.split('\n'):
        matches = time_reg.findall(line)
        for m in matches:
            mins = int(m[0])
            secs = int(m[1])
            frac = float('0.' + m[2]) if m[2] else 0.0
            total = mins * 60 + secs + frac
            if total > max_sec:
                max_sec = total
    return max_sec

def fetch_song_lyrics(
    title: str,
    artist: str = "",
    album: str = "",
    duration: int = 0,
    author: str = ""
) -> Dict[str, Any]:
    """Queries LRCLIB with duration tolerance filter for verified synced LRC."""
    title_clean = title.strip()
    c_title = clean_song_title(title_clean)
    artist_clean = artist.strip()
    album_clean = album.strip()

    cache_key = f"{c_title.lower()}:{duration}:{artist_clean[:25].lower()}"
    if cache_key in _lyrics_memory_cache:
        logger.info(f"Lyrics Cache HIT for '{c_title}'")
        return _lyrics_memory_cache[cache_key]

    artists_list = [a.strip() for a in re.split(r'[,;&|/]+', artist_clean) if a.strip()]
    if not artists_list and artist_clean:
        artists_list = [artist_clean]

    candidates = []
    seen_ids = set()

    def fetch_url(url: str):
        try:
            resp = _http_session.get(url, timeout=4.0)
            if resp.status_code == 200:
                data = resp.json()
                items = data if isinstance(data, list) else ([data] if isinstance(data, dict) and data.get("id") else [])
                for item in items:
                    cid = item.get("id")
                    if cid and cid not in seen_ids:
                        seen_ids.add(cid)
                        candidates.append(item)
        except Exception as e:
            logger.debug(f"Lyrics fetch error {url}: {e}")

    # Search LRCLIB
    fetch_url(f"https://lrclib.net/api/search?track_name={urllib.parse.quote(c_title)}")

    has_exact = False
    if duration and duration > 0:
        for c in candidates:
            if abs(float(c.get("duration") or 0) - duration) <= 2.0 and c.get("syncedLyrics"):
                has_exact = True
                break

    if not has_exact and len(candidates) < 8 and artists_list:
        fetch_url(f"https://lrclib.net/api/search?q={urllib.parse.quote(f'{c_title} {artists_list[0]}')}")

    if not has_exact and len(candidates) == 0 and c_title != title_clean:
        fetch_url(f"https://lrclib.net/api/search?track_name={urllib.parse.quote(title_clean)}")

    best_match = None
    min_score = 999999
    norm_title = re.sub(r'[^a-z0-9]', '', c_title.lower())

    for c in candidates:
        c_dur = float(c.get("duration") or 0)
        c_track = (c.get("trackName") or "").lower()
        c_artist = (c.get("artistName") or "").lower()
        norm_c_track = re.sub(r'[^a-z0-9]', '', c_track)

        if norm_title not in norm_c_track and norm_c_track not in norm_title:
            continue

        if duration and duration > 0:
            dur_diff = abs(c_dur - duration)
            if dur_diff > 3.0:
                continue

            synced = c.get("syncedLyrics") or ""
            if synced:
                max_ts = get_lrc_max_timestamp(synced)
                if max_ts > duration + 3.0:
                    continue

        dur_diff = abs(c_dur - duration) if duration else 0
        art_match = any(a.lower() in c_artist or c_artist in a.lower() for a in artists_list)

        score = dur_diff * 10.0
        if not c.get("syncedLyrics"):
            score += 40.0
        if not art_match:
            score += 15.0
        if not c.get("plainLyrics"):
            score += 5.0

        if score < min_score:
            min_score = score
            best_match = c

    if not best_match:
        res = {
            "success": False,
            "plain_lyrics": "",
            "synced_lrc": "",
            "has_synced": False,
            "has_plain": False,
            "matched_duration": 0,
            "message": "No verified lyrics found matching track name and duration.",
            "source": "LRCLIB"
        }
        _lyrics_memory_cache[cache_key] = res
        return res

    synced_lrc = best_match.get("syncedLyrics") or ""
    plain_lyrics = best_match.get("plainLyrics") or ""
    matched_duration = best_match.get("duration") or duration
    source = f"LRCLIB (Match #{best_match.get('id')})"

    formatted_lrc = ""
    if synced_lrc:
        effective_dur = matched_duration if matched_duration > 0 else duration
        formatted_lrc = format_lrc_with_headers(
            raw_lrc=synced_lrc,
            title=title_clean,
            artist=artist_clean,
            album=album_clean,
            author=author or artist_clean,
            duration_sec=effective_dur
        )

    res = {
        "success": bool(formatted_lrc or plain_lyrics),
        "plain_lyrics": plain_lyrics.strip(),
        "synced_lrc": formatted_lrc.strip(),
        "has_synced": bool(formatted_lrc),
        "has_plain": bool(plain_lyrics),
        "matched_duration": matched_duration,
        "source": source
    }
    _lyrics_memory_cache[cache_key] = res
    return res
