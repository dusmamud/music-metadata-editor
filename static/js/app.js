/**
 * AudioTag Pro Main Application Controller
 * Dual Engine: Pure In-Browser Client-Side (Default / GitHub Pages) + Optional Python Backend (FastAPI).
 */

// Toast Notifications
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";

  const iconClass = type === "success" 
    ? "fa-solid fa-circle-check text-emerald-400" 
    : (type === "warning" ? "fa-solid fa-triangle-exclamation text-amber-400" : "fa-solid fa-circle-xmark text-rose-400");

  toast.innerHTML = `
    <i class="${iconClass} text-base flex-shrink-0"></i>
    <span class="text-xs font-medium text-zinc-200">${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Global Theme Management (5 Palettes)
function setTheme(themeName) {
  const validThemes = ["violet", "emerald", "cyan", "amber", "rose"];
  const targetTheme = validThemes.includes(themeName) ? themeName : "violet";
  
  document.documentElement.setAttribute("data-theme", targetTheme);
  try {
    localStorage.setItem("audiotag_theme", targetTheme);
  } catch (e) {}

  // Update active pill button indicators
  document.querySelectorAll(".theme-pill-btn").forEach(btn => {
    if (btn.getAttribute("data-theme-name") === targetTheme) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // Update hero glow color dynamically
  const heroGlow = document.querySelector(".hero-glow");
  if (heroGlow) {
    heroGlow.style.opacity = "0.85";
  }
}

// Restore saved theme on initial script execution
(function initThemeEarly() {
  try {
    const saved = localStorage.getItem("audiotag_theme") || "violet";
    document.documentElement.setAttribute("data-theme", saved);
  } catch (e) {}
})();

document.addEventListener("DOMContentLoaded", () => {
  // Global State (In-Memory)
  let tracks = [];
  let currentTrack = null;
  let selectedCoverFile = null;
  let shouldRemoveCover = false;
  let activeEngine = "client"; // "client" or "python"
  let pythonBackendAvailable = false;

  const player = new StudioPlayer();

  // DOM Elements
  const trackListContainer = document.getElementById("track-list");
  const trackCountBadge = document.getElementById("track-count-badge");
  const emptyState = document.getElementById("empty-state");
  const editorState = document.getElementById("editor-state");

  // Engine Switcher Elements
  const engineBadge = document.getElementById("engine-status-badge");
  const engineToggleBtn = document.getElementById("engine-toggle-btn");
  const engineSelectModal = document.getElementById("engine-mode-select");

  // Form Fields
  const inputTitle = document.getElementById("field-title");
  const inputArtist = document.getElementById("field-artist");
  const inputAlbum = document.getElementById("field-album");
  const inputAlbumArtist = document.getElementById("field-album-artist");
  const inputYear = document.getElementById("field-year");
  const inputGenre = document.getElementById("field-genre");
  const inputTrackNum = document.getElementById("field-track-num");
  const inputDiscNum = document.getElementById("field-disc-num");
  const inputComposer = document.getElementById("field-composer");
  const inputComment = document.getElementById("field-comment");
  const inputLyrics = document.getElementById("field-lyrics");
  const inputSyncedLyrics = document.getElementById("field-synced-lyrics");

  // Lyrics Tabs & Controls
  const tabBtnSynced = document.getElementById("tab-btn-synced");
  const tabBtnPlain = document.getElementById("tab-btn-plain");
  const syncedContainer = document.getElementById("synced-lyrics-container");
  const plainContainer = document.getElementById("plain-lyrics-container");
  const btnUploadLrc = document.getElementById("btn-upload-lrc");
  const lrcFileInput = document.getElementById("lrc-file-input");
  const btnToggleKaraoke = document.getElementById("btn-toggle-karaoke");
  const karaokePreviewBox = document.getElementById("karaoke-preview-box");
  const btnSearchOnlineLyrics = document.getElementById("btn-search-online-lyrics");

  // Technical Info Badges
  const techFormat = document.getElementById("tech-format");
  const techBitrate = document.getElementById("tech-bitrate");
  const techSampleRate = document.getElementById("tech-sample-rate");
  const techDuration = document.getElementById("tech-duration");
  const techSize = document.getElementById("tech-size");

  // Cover Elements
  const coverImg = document.getElementById("editor-cover-img");
  const coverInput = document.getElementById("cover-file-input");
  const btnUploadCover = document.getElementById("btn-upload-cover");
  const btnRemoveCover = document.getElementById("btn-remove-cover");
  const coverDropZone = document.getElementById("cover-dropzone");

  // Action Buttons
  const btnSave = document.getElementById("btn-save-tags");
  const btnDownload = document.getElementById("btn-download-audio");
  const btnDelete = document.getElementById("btn-delete-track");
  const btnClearAll = document.getElementById("btn-clear-all-tracks");
  const btnLoadDemo = document.getElementById("btn-load-demo-track");
  const btnLoadDemoHero = document.getElementById("btn-load-demo-hero");

  // 1. Check Python Backend Availability
  async function detectBackend() {
    try {
      const res = await fetch("/api/health", { method: "GET", signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "healthy" || data.app) {
          pythonBackendAvailable = true;
          updateEngineUI();
          return;
        }
      }
    } catch (e) {
      // Backend not running (e.g. GitHub Pages static hosting)
    }
    pythonBackendAvailable = false;
    activeEngine = "client";
    updateEngineUI();
  }

  function updateEngineUI() {
    if (!engineBadge) return;
    if (activeEngine === "python" && pythonBackendAvailable) {
      engineBadge.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        <span class="font-semibold text-emerald-300">Python FastAPI Engine</span>
      `;
    } else {
      engineBadge.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-cyan-400"></span>
        <span class="font-semibold text-cyan-300">100% In-Browser Engine</span>
        ${pythonBackendAvailable ? '<span class="text-[9px] text-zinc-400">(Python Available)</span>' : '<span class="text-[9px] text-zinc-500">(GitHub Pages Mode)</span>'}
      `;
    }
  }

  if (engineToggleBtn) {
    engineToggleBtn.addEventListener("click", () => {
      if (!pythonBackendAvailable) {
        showToast("Static Mode active. Python backend not detected on this host.", "warning");
        return;
      }
      activeEngine = activeEngine === "client" ? "python" : "client";
      updateEngineUI();
      showToast(`Switched engine to: ${activeEngine === "python" ? "Python Backend (FastAPI)" : "In-Browser Client"}`, "success");
    });
  }

  detectBackend();

  // Initialize Theme Selector Active State
  const currentTheme = document.documentElement.getAttribute("data-theme") || "violet";
  setTheme(currentTheme);

  // 2. Initialize Client-Side Uploader (Zero Server Uploads)
  new TrackUploader(
    document.getElementById("main-dropzone"),
    document.getElementById("audio-file-input"),
    (res) => {
      if (res && res.tracks) {
        tracks = [...tracks, ...res.tracks];
        renderTrackList();
        selectTrack(res.tracks[0].file_id);
        showToast(`Loaded ${res.tracks.length} track(s) in browser!`, "success");
      }
    },
    (err) => {
      showToast(err.message || "Failed to load audio file.", "error");
    }
  );

  // 3. Render Track List with ZERO Overflow Constraints
  function renderTrackList() {
    if (!trackListContainer) return;
    trackListContainer.innerHTML = "";

    trackCountBadge.textContent = `${tracks.length} track${tracks.length === 1 ? "" : "s"}`;

    if (tracks.length === 0) {
      emptyState.classList.remove("hidden");
      editorState.classList.add("hidden");
      player.stop();
      return;
    }

    emptyState.classList.add("hidden");
    editorState.classList.remove("hidden");

    tracks.forEach((t) => {
      const isSelected = currentTrack && currentTrack.file_id === t.file_id;
      const card = document.createElement("div");
      card.className = `p-3 rounded-xl border transition cursor-pointer flex items-center justify-between gap-2.5 w-full min-w-0 ${
        isSelected
          ? "bg-violet-950/40 border-violet-500/60 shadow-md shadow-violet-950/50"
          : "bg-zinc-950/60 border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-900/50"
      }`;

      const title = t.metadata.title || t.original_filename;
      const artist = t.metadata.artist || "Unknown Artist";
      const format = t.technical.format || "AUDIO";

      card.innerHTML = `
        <div class="flex items-center space-x-3 min-w-0 flex-1">
          <div class="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 overflow-hidden flex-shrink-0 flex items-center justify-center">
            ${
              t.cover_url
                ? `<img src="${t.cover_url}" class="w-full h-full object-cover">`
                : `<i class="fa-solid fa-music text-xs text-zinc-500"></i>`
            }
          </div>
          <div class="min-w-0 flex-1">
            <h4 class="text-xs font-semibold text-zinc-100 truncate" title="${title}">${title}</h4>
            <p class="text-[11px] text-zinc-400 truncate" title="${artist}">${artist}</p>
          </div>
        </div>
        <div class="flex items-center space-x-1.5 flex-shrink-0">
          <span class="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-800/90 text-zinc-300 border border-zinc-700 uppercase">${format}</span>
        </div>
      `;

      card.addEventListener("click", () => selectTrack(t.file_id));
      trackListContainer.appendChild(card);
    });
  }

  // 4. Select Track into Editor
  function selectTrack(fileId) {
    const track = tracks.find((t) => t.file_id === fileId);
    if (!track) return;

    currentTrack = track;
    selectedCoverFile = null;
    shouldRemoveCover = false;

    // Load into player
    player.loadTrack(track);

    // Populate Fields
    inputTitle.value = track.metadata.title || "";
    inputArtist.value = track.metadata.artist || "";
    inputAlbum.value = track.metadata.album || "";
    inputAlbumArtist.value = track.metadata.album_artist || "";
    inputYear.value = track.metadata.year || "";
    inputGenre.value = track.metadata.genre || "";
    inputTrackNum.value = track.metadata.track_number || "";
    inputDiscNum.value = track.metadata.disc_number || "";
    inputComposer.value = track.metadata.composer || "";
    inputComment.value = track.metadata.comment || "";
    inputLyrics.value = track.metadata.lyrics || "";
    inputSyncedLyrics.value = track.metadata.synced_lyrics || "";

    // Sync Karaoke Player
    if (track.metadata.synced_lyrics) {
      player.setSyncedLyrics(track.metadata.synced_lyrics);
      if (tabBtnSynced) tabBtnSynced.click();
      if (karaokePreviewBox) karaokePreviewBox.classList.remove("hidden");
    } else {
      player.setSyncedLyrics("");
    }

    // Technical Stats
    techFormat.textContent = track.technical.format || "AUDIO";
    techBitrate.textContent = track.technical.bitrate_kbps ? `${track.technical.bitrate_kbps} kbps` : "320 kbps";
    techSampleRate.textContent = track.technical.sample_rate_hz ? `${track.technical.sample_rate_hz} Hz` : "44100 Hz";
    techDuration.textContent = track.technical.duration_formatted || "0:00";
    techSize.textContent = track.technical.file_size_formatted || "0 MB";

    // Cover Artwork
    updateCoverPreview();
    renderTrackList();
  }

  // 5. Live update synced lyrics to karaoke player
  if (inputSyncedLyrics) {
    inputSyncedLyrics.addEventListener("input", () => {
      player.setSyncedLyrics(inputSyncedLyrics.value);
    });
  }

  // 6. Lyrics Tab Switcher
  if (tabBtnSynced && tabBtnPlain) {
    tabBtnSynced.addEventListener("click", () => {
      tabBtnSynced.className = "px-2.5 py-1 rounded-md text-xs font-semibold text-white bg-violet-600 transition flex items-center gap-1.5";
      tabBtnPlain.className = "px-2.5 py-1 rounded-md text-xs font-medium text-zinc-400 hover:text-white transition flex items-center gap-1.5";
      syncedContainer.classList.remove("hidden");
      plainContainer.classList.add("hidden");
    });

    tabBtnPlain.addEventListener("click", () => {
      tabBtnPlain.className = "px-2.5 py-1 rounded-md text-xs font-semibold text-white bg-violet-600 transition flex items-center gap-1.5";
      tabBtnSynced.className = "px-2.5 py-1 rounded-md text-xs font-medium text-zinc-400 hover:text-white transition flex items-center gap-1.5";
      plainContainer.classList.remove("hidden");
      syncedContainer.classList.add("hidden");
    });
  }

  // 7. Toggle Karaoke Preview Box
  if (btnToggleKaraoke && karaokePreviewBox) {
    btnToggleKaraoke.addEventListener("click", () => {
      karaokePreviewBox.classList.toggle("hidden");
    });
  }

  // 8. Load .LRC File Button
  if (btnUploadLrc && lrcFileInput) {
    btnUploadLrc.addEventListener("click", () => lrcFileInput.click());
    lrcFileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (evt) => {
          inputSyncedLyrics.value = evt.target.result;
          player.setSyncedLyrics(evt.target.result);
          if (tabBtnSynced) tabBtnSynced.click();
          if (karaokePreviewBox) karaokePreviewBox.classList.remove("hidden");
          showToast(`Loaded ${file.name} synced lyrics!`, "success");
        };
        reader.readAsText(file);
      }
    });
  }

  // 9. Online Synced Lyrics Search (LRCLIB Integration - Works 100% Client-Side or via Python)
  if (btnSearchOnlineLyrics) {
    btnSearchOnlineLyrics.addEventListener("click", async () => {
      const title = (inputTitle.value || "").trim();
      const artist = (inputArtist.value || "").trim();

      if (!title) {
        showToast("Please enter a track title to search for lyrics.", "warning");
        return;
      }

      btnSearchOnlineLyrics.disabled = true;
      btnSearchOnlineLyrics.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-xs"></i> <span>Searching...</span>`;

      try {
        let syncedLyrics = "";
        let plainLyrics = "";

        // Query LRCLIB directly (CORS enabled public API)
        const cleanTitle = title.replace(/\s*[\(\[](from|official|audio|video|lyric|full|hd|original|remastered).*?[\)\]]/gi, "").trim();
        const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}${artist ? `&artist_name=${encodeURIComponent(artist)}` : ""}`;
        
        const response = await fetch(searchUrl);
        if (response.ok) {
          const results = await response.json();
          if (Array.isArray(results) && results.length > 0) {
            // Pick candidate with syncedLyrics
            const best = results.find(r => r.syncedLyrics) || results[0];
            syncedLyrics = best.syncedLyrics || "";
            plainLyrics = best.plainLyrics || "";
          }
        }

        if (syncedLyrics) {
          inputSyncedLyrics.value = syncedLyrics;
          player.setSyncedLyrics(syncedLyrics);
          if (tabBtnSynced) tabBtnSynced.click();
          if (karaokePreviewBox) karaokePreviewBox.classList.remove("hidden");
          showToast("Found synchronized karaoke lyrics!", "success");
        } else if (plainLyrics) {
          inputLyrics.value = plainLyrics;
          if (tabBtnPlain) tabBtnPlain.click();
          showToast("Found plain lyrics (no sync timestamps).", "success");
        } else {
          showToast("No matching lyrics found on LRCLIB.", "warning");
        }
      } catch (err) {
        showToast("Lyrics search failed. Check your internet connection.", "error");
      } finally {
        btnSearchOnlineLyrics.disabled = false;
        btnSearchOnlineLyrics.innerHTML = `<i class="fa-solid fa-globe text-xs text-violet-400"></i> <span>Search Online (.LRC)</span>`;
      }
    });
  }

  // 10. Cover Artwork Handlers
  if (btnUploadCover && coverInput) {
    btnUploadCover.addEventListener("click", () => coverInput.click());
    coverInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        handleCoverFile(e.target.files[0]);
      }
    });
  }

  if (coverDropZone) {
    coverDropZone.addEventListener("click", () => coverInput.click());
    coverDropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      coverDropZone.classList.add("dragover");
    });
    coverDropZone.addEventListener("dragleave", () => {
      coverDropZone.classList.remove("dragover");
    });
    coverDropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      coverDropZone.classList.remove("dragover");
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleCoverFile(e.dataTransfer.files[0]);
      }
    });
  }

  if (btnRemoveCover) {
    btnRemoveCover.addEventListener("click", () => {
      selectedCoverFile = null;
      shouldRemoveCover = true;
      coverImg.src = "./static/favicon.svg";
      showToast("Embedded cover artwork marked for removal.", "warning");
    });
  }

  function handleCoverFile(file) {
    if (!file.type.startsWith("image/")) {
      showToast("Please drop a valid image file (JPEG, PNG, WEBP).", "error");
      return;
    }
    selectedCoverFile = file;
    shouldRemoveCover = false;

    const reader = new FileReader();
    reader.onload = (e) => {
      coverImg.src = e.target.result;
    };
    reader.readAsDataURL(file);
    showToast("Selected new cover artwork. Click 'Save & Embed' to apply.", "success");
  }

  function updateCoverPreview() {
    if (!currentTrack) return;
    if (currentTrack.cover_url) {
      coverImg.src = currentTrack.cover_url;
    } else {
      coverImg.src = "./static/favicon.svg";
    }
  }

  // 11. Save Tags & Embed in Browser (Zero Server Uploads)
  if (btnSave) {
    btnSave.addEventListener("click", async () => {
      if (!currentTrack) return;

      btnSave.disabled = true;
      btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-xs"></i> <span>Embedding...</span>`;

      try {
        const metadataUpdates = {
          title: inputTitle.value.trim(),
          artist: inputArtist.value.trim(),
          album: inputAlbum.value.trim(),
          album_artist: inputAlbumArtist.value.trim(),
          year: inputYear.value.trim(),
          genre: inputGenre.value.trim(),
          track_number: inputTrackNum.value.trim(),
          disc_number: inputDiscNum.value.trim(),
          composer: inputComposer.value.trim(),
          comment: inputComment.value.trim(),
          lyrics: inputLyrics.value.trim(),
          synced_lyrics: inputSyncedLyrics.value.trim(),
        };

        if (activeEngine === "python" && pythonBackendAvailable) {
          // Optional Python FastAPI Route Save
          const formData = new FormData();
          formData.append("metadata_json", JSON.stringify(metadataUpdates));
          if (selectedCoverFile) {
            formData.append("cover_file", selectedCoverFile);
          }
          if (shouldRemoveCover) {
            formData.append("remove_cover", "true");
          }

          const res = await fetch(`/api/tags/embed/${currentTrack.file_id}`, {
            method: "POST",
            body: formData
          });

          if (!res.ok) throw new Error("Server error embedding tags");
          const data = await res.json();
          currentTrack.metadata = { ...currentTrack.metadata, ...metadataUpdates };
          if (data.cover_url) currentTrack.cover_url = data.cover_url;
        } else {
          // Default 100% In-Browser Lossless Embedding
          const updatedBuffer = await UniversalBrowserTagger.embedTags(
            currentTrack.arrayBuffer,
            currentTrack.original_filename,
            metadataUpdates,
            selectedCoverFile,
            shouldRemoveCover
          );

          currentTrack.arrayBuffer = updatedBuffer;
          currentTrack.metadata = { ...currentTrack.metadata, ...metadataUpdates };

          if (selectedCoverFile) {
            currentTrack.cover_url = coverImg.src;
          } else if (shouldRemoveCover) {
            currentTrack.cover_url = null;
          }
        }

        selectedCoverFile = null;
        shouldRemoveCover = false;

        // Refresh Player & Queue
        player.loadTrack(currentTrack);
        renderTrackList();
        showToast("Tags & artwork embedded successfully!", "success");
      } catch (err) {
        showToast("Failed to embed tags: " + err.message, "error");
      } finally {
        btnSave.disabled = false;
        btnSave.innerHTML = `<i class="fa-solid fa-floppy-disk text-xs"></i> <span>Save & Embed Tags</span>`;
      }
    });
  }

  // 12. Instant Lossless Download Button
  if (btnDownload) {
    btnDownload.addEventListener("click", () => {
      if (!currentTrack || !currentTrack.arrayBuffer) {
        showToast("No audio loaded to download.", "warning");
        return;
      }

      const mimeType = currentTrack.mime_type || "audio/mpeg";
      const blob = new Blob([currentTrack.arrayBuffer], { type: mimeType });
      const downloadUrl = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = downloadUrl;

      // Clean filename
      const title = (currentTrack.metadata.title || "").trim();
      const artist = (currentTrack.metadata.artist || "").trim();
      const ext = currentTrack.original_filename.split(".").pop() || "mp3";

      if (title && artist) {
        a.download = `${artist} - ${title}.${ext}`.replace(/[\\/*?:"<>|]/g, "_");
      } else if (title) {
        a.download = `${title}.${ext}`.replace(/[\\/*?:"<>|]/g, "_");
      } else {
        a.download = currentTrack.original_filename || `tagged_audio.${ext}`;
      }

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
      showToast(`Downloaded: ${a.download}`, "success");
    });
  }

  // 13. Delete Track from Queue
  if (btnDelete) {
    btnDelete.addEventListener("click", () => {
      if (!currentTrack) return;
      const id = currentTrack.file_id;
      tracks = tracks.filter((t) => t.file_id !== id);
      if (tracks.length > 0) {
        selectTrack(tracks[0].file_id);
      } else {
        currentTrack = null;
        renderTrackList();
      }
      showToast("Track removed from queue.", "warning");
    });
  }

  // 14. Clear All Tracks
  if (btnClearAll) {
    btnClearAll.addEventListener("click", () => {
      tracks = [];
      currentTrack = null;
      player.stop();
      renderTrackList();
      showToast("Queue cleared.", "warning");
    });
  }

  // 15. Load Interactive Demo Track (One-Click Instant Preview)
  async function loadDemoTrack() {
    showToast("Generating demo track in browser...", "success");

    // Generate a simple synthetic tone in an AudioBuffer -> WAV ArrayBuffer
    const sampleRate = 44100;
    const durationSec = 10;
    const numSamples = sampleRate * durationSec;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    // Write WAV header
    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, numSamples * 2, true);

    // Generate melodic sine wave
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const freq = 440 + Math.sin(t * 4) * 60; // 440Hz Vibrato
      const sample = Math.sin(2 * Math.PI * freq * t) * 0.35 * 32767;
      view.setInt16(44 + i * 2, sample, true);
    }

    const demoLrc = `[00:00.50] Welcome to AudioTag Pro Studio!
[00:02.00] In-browser audio metadata & synced lyrics editor
[00:04.50] Real-time karaoke visualizer in sync with audio
[00:07.00] 100% private - your music never leaves your device!
[00:09.00] Ready for lossless export!`;

    const demoTrack = {
      file_id: "demo_" + Date.now(),
      original_filename: "Demo - AudioTag Pro Anthem.wav",
      arrayBuffer: buffer,
      mime_type: "audio/wav",
      metadata: {
        title: "AudioTag Pro Anthem (Demo)",
        artist: "Antigravity Sound Labs",
        album: "Studio Showcase 2026",
        album_artist: "Antigravity",
        year: "2026",
        genre: "Electronic / Synthwave",
        track_number: "1/1",
        disc_number: "1/1",
        composer: "AI Audio Architect",
        comment: "Generated in-browser for zero-upload UI demonstration",
        lyrics: "Welcome to AudioTag Pro Studio\nIn-browser audio metadata & synced lyrics editor\n100% private!",
        synced_lyrics: demoLrc
      },
      cover_url: "./static/favicon.svg",
      technical: {
        format: "WAV",
        bitrate_kbps: 705,
        sample_rate_hz: 44100,
        duration_formatted: "0:10",
        file_size_formatted: "0.85 MB"
      }
    };

    tracks.push(demoTrack);
    renderTrackList();
    selectTrack(demoTrack.file_id);
    showToast("Demo track loaded! Press Play to test karaoke sync.", "success");

    // Scroll to studio
    const studio = document.getElementById("studio-section");
    if (studio) studio.scrollIntoView({ behavior: "smooth" });
  }

  if (btnLoadDemo) btnLoadDemo.addEventListener("click", loadDemoTrack);
  if (btnLoadDemoHero) btnLoadDemoHero.addEventListener("click", loadDemoTrack);
});
