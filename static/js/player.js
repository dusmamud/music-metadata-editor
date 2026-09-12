/**
 * AudioTag Pro Embedded Studio Player with Real-Time Synced Karaoke
 */

class StudioPlayer {
  constructor() {
    this.audio = new Audio();
    this.isPlaying = false;
    this.currentTrackId = null;

    // Synced lyrics state
    this.syncedLyrics = [];
    this.currentLyricIndex = -1;

    // DOM Elements
    this.btnPlay = document.getElementById("player-play-btn");
    this.playIcon = document.getElementById("player-play-icon");
    this.seekBar = document.getElementById("player-seek");
    this.timeCurrent = document.getElementById("player-current-time");
    this.timeTotal = document.getElementById("player-total-time");
    this.playerTitle = document.getElementById("player-track-title");
    this.playerArtist = document.getElementById("player-track-artist");
    this.playerCover = document.getElementById("player-track-cover");
    this.karaokeContainer = document.getElementById("karaoke-lines-scroll");

    this._bindEvents();
  }

  _bindEvents() {
    if (this.btnPlay) {
      this.btnPlay.addEventListener("click", () => this.togglePlay());
    }

    this.audio.addEventListener("timeupdate", () => this._onTimeUpdate());
    this.audio.addEventListener("loadedmetadata", () => this._onLoadedMetadata());
    this.audio.addEventListener("ended", () => this.stop());

    if (this.seekBar) {
      this.seekBar.addEventListener("input", () => {
        if (this.audio.duration) {
          const target = (this.seekBar.value / 100) * this.audio.duration;
          this.audio.currentTime = target;
        }
      });
    }
  }

  loadTrack(track) {
    if (!track) return;
    this.currentTrackId = track.file_id;
    this.audio.src = track.audio_url; // 100% in-browser Object URL

    // Update UI info
    if (this.playerTitle) this.playerTitle.textContent = track.metadata.title || track.original_filename;
    if (this.playerArtist) this.playerArtist.textContent = track.metadata.artist || "Unknown Artist";
    if (this.playerCover) {
      if (track.cover_url) {
        this.playerCover.src = track.cover_url;
      } else {
        this.playerCover.src = "/static/favicon.svg";
      }
    }

    if (this.seekBar) this.seekBar.value = 0;
    if (this.timeCurrent) this.timeCurrent.textContent = "0:00";
    if (this.timeTotal) this.timeTotal.textContent = track.technical.duration_formatted || "0:00";
    
    // Load Synced Lyrics if present
    this.setSyncedLyrics(track.metadata.synced_lyrics || "");

    this.pause();
  }

  // Parse and render synced lyrics
  setSyncedLyrics(lrcString) {
    this.syncedLyrics = [];
    this.currentLyricIndex = -1;

    if (!this.karaokeContainer) return;
    this.karaokeContainer.innerHTML = "";

    if (!lrcString || !lrcString.trim()) {
      this.karaokeContainer.innerHTML = `<p class="text-zinc-500 italic py-6">No synced lyrics loaded for this track.</p>`;
      return;
    }

    const pattern = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/;
    const lines = lrcString.split("\n");

    lines.forEach((line) => {
      const match = pattern.exec(line.trim());
      if (match) {
        const mins = parseInt(match[1], 10);
        const secs = parseInt(match[2], 10);
        const fracStr = match[3] || "0";
        const fracSec = parseFloat("0." + fracStr);
        const totalTime = mins * 60 + secs + fracSec;
        const lyricText = (match[4] || "").trim();

        if (lyricText) {
          this.syncedLyrics.push({
            time: totalTime,
            text: lyricText,
            el: null
          });
        }
      }
    });

    this.syncedLyrics.sort((a, b) => a.time - b.time);

    if (this.syncedLyrics.length === 0) {
      this.karaokeContainer.innerHTML = `<p class="text-zinc-500 italic py-6">No valid timestamps found in synced lyrics.</p>`;
      return;
    }

    // Render lines into DOM
    this.syncedLyrics.forEach((item, index) => {
      const p = document.createElement("p");
      p.className = "karaoke-line";
      p.textContent = item.text;
      p.title = `Seek to ${this._formatTime(item.time)}`;
      
      // Click to jump audio
      p.addEventListener("click", () => {
        this.audio.currentTime = item.time;
        if (!this.isPlaying) this.play();
      });

      this.karaokeContainer.appendChild(p);
      item.el = p;
    });
  }

  togglePlay() {
    if (!this.audio.src) return;
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  play() {
    this.audio.play().then(() => {
      this.isPlaying = true;
      this._updateIcon(true);
    }).catch((err) => console.warn("Audio playback interrupted:", err));
  }

  pause() {
    this.audio.pause();
    this.isPlaying = false;
    this._updateIcon(false);
  }

  stop() {
    this.pause();
    this.audio.currentTime = 0;
    if (this.seekBar) this.seekBar.value = 0;
  }

  _updateIcon(playing) {
    if (!this.playIcon) return;
    if (playing) {
      this.playIcon.className = "fa-solid fa-pause text-sm";
    } else {
      this.playIcon.className = "fa-solid fa-play text-sm ml-0.5";
    }
  }

  _onTimeUpdate() {
    if (!this.audio.duration) return;
    const current = this.audio.currentTime;
    const progress = (current / this.audio.duration) * 100;
    if (this.seekBar) this.seekBar.value = progress;
    if (this.timeCurrent) this.timeCurrent.textContent = this._formatTime(current);

    // Karaoke Synced Highlighting
    if (this.syncedLyrics.length > 0) {
      let activeIdx = -1;
      for (let i = 0; i < this.syncedLyrics.length; i++) {
        if (current >= this.syncedLyrics[i].time) {
          activeIdx = i;
        } else {
          break;
        }
      }

      if (activeIdx !== this.currentLyricIndex) {
        // Unhighlight previous
        if (this.currentLyricIndex >= 0 && this.syncedLyrics[this.currentLyricIndex] && this.syncedLyrics[this.currentLyricIndex].el) {
          this.syncedLyrics[this.currentLyricIndex].el.classList.remove("active");
        }

        // Highlight new
        if (activeIdx >= 0 && this.syncedLyrics[activeIdx] && this.syncedLyrics[activeIdx].el) {
          const activeEl = this.syncedLyrics[activeIdx].el;
          activeEl.classList.add("active");
          activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }

        this.currentLyricIndex = activeIdx;
      }
    }
  }

  _onLoadedMetadata() {
    if (this.timeTotal && this.audio.duration) {
      this.timeTotal.textContent = this._formatTime(this.audio.duration);
    }
  }

  _formatTime(secs) {
    const s = Math.floor(secs);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? "0" : ""}${rem}`;
  }
}
