/**
 * AudioTag Pro - Universal Client-Side Engine
 * Magic byte detection, in-memory array buffers, Canvas 1:1 cover art crop, and instant blob downloads.
 * 100% Client-Side. Zero server uploads.
 */

class UniversalBrowserTagger {
  /**
   * Detects the TRUE container format by inspecting binary magic bytes (not just extension).
   */
  static detectContainerFormat(buffer, filename) {
    const view = new DataView(buffer);

    // 1. Check MP4 / M4A container (ftyp box at byte 4)
    if (buffer.byteLength >= 8) {
      const b4 = String.fromCharCode(view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7));
      if (b4 === "ftyp" || b4 === "moov") {
        return "m4a";
      }
    }

    // 2. Check MP3 ID3 header at byte 0
    if (buffer.byteLength >= 3) {
      const b0 = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2));
      if (b0 === "ID3") {
        return "mp3";
      }
    }

    // 3. Check MPEG audio frame sync (11 bits set: 0xFF 0xEx)
    if (buffer.byteLength >= 2) {
      const byte0 = view.getUint8(0);
      const byte1 = view.getUint8(1);
      if (byte0 === 0xFF && (byte1 & 0xE0) === 0xE0) {
        return "mp3";
      }
    }

    // 4. Fallback to extension
    const ext = "." + filename.split(".").pop().toLowerCase();
    if (ext === ".m4a" || ext === ".aac" || ext === ".mp4") {
      return "m4a";
    }
    return "mp3";
  }

  /**
   * Reads audio file metadata completely in browser RAM
   */
  static async loadAudioTrack(file) {
    const fileId = "track-" + Math.random().toString(36).substring(2, 9);
    const buffer = await file.arrayBuffer();
    const detectedFormat = this.detectContainerFormat(buffer, file.name);

    let meta = {
      title: "",
      artist: "",
      album: "",
      album_artist: "",
      year: "",
      genre: "",
      track_number: "",
      disc_number: "",
      composer: "",
      comment: "",
      lyrics: "",
      synced_lyrics: "",
      has_cover: false,
      cover_bytes: null,
      cover_mime: "image/jpeg"
    };

    if (detectedFormat === "m4a") {
      meta = BrowserM4aTagger.parseTags(buffer);
    } else {
      meta = BrowserMp3Tagger.parseTags(buffer);
    }

    // Detect exact duration
    const audioUrl = URL.createObjectURL(file);
    const durationSec = await this._detectDuration(audioUrl);

    // Create persistent cover URL
    let coverUrl = null;
    if (meta.has_cover && meta.cover_bytes && meta.cover_bytes.byteLength > 0) {
      const isPng = (meta.cover_bytes[0] === 0x89 && meta.cover_bytes[1] === 0x50);
      const mime = isPng ? "image/png" : "image/jpeg";
      meta.cover_mime = mime;
      const coverBlob = new Blob([meta.cover_bytes], { type: mime });
      coverUrl = URL.createObjectURL(coverBlob);
    }

    const tech = {
      format: detectedFormat.toUpperCase(),
      file_size_bytes: file.size,
      file_size_formatted: this._formatFileSize(file.size),
      duration_seconds: durationSec,
      duration_formatted: this._formatDuration(durationSec),
      bitrate_kbps: Math.round((file.size * 8) / (durationSec || 1) / 1000) || 0,
      sample_rate_hz: 44100
    };

    return {
      file_id: fileId,
      original_filename: file.name,
      extension: "." + detectedFormat,
      detected_format: detectedFormat,
      file_ref: file,
      buffer_ref: buffer,
      audio_url: audioUrl,
      cover_url: coverUrl,
      technical: tech,
      metadata: meta
    };
  }

  /**
   * Writes updated tags directly into browser ArrayBuffer and returns downloadable Blob
   */
  static async saveAndExportTrack(track, updatedMetadata, newCoverFile, removeCover) {
    let coverBytes = track.metadata.cover_bytes;

    if (newCoverFile) {
      coverBytes = await this.cropAndOptimizeCover(newCoverFile);
    }

    let updatedBuffer = null;
    const format = track.detected_format || this.detectContainerFormat(track.buffer_ref, track.original_filename);

    if (format === "m4a") {
      updatedBuffer = BrowserM4aTagger.writeTags(
        track.buffer_ref,
        updatedMetadata,
        coverBytes,
        removeCover
      );
    } else {
      updatedBuffer = BrowserMp3Tagger.writeTags(
        track.buffer_ref,
        updatedMetadata,
        coverBytes,
        removeCover
      );
    }

    // Update in-memory track buffer
    track.buffer_ref = updatedBuffer;
    track.metadata = {
      ...track.metadata,
      ...updatedMetadata,
      has_cover: !removeCover && (coverBytes && coverBytes.byteLength > 0),
      cover_bytes: removeCover ? null : coverBytes
    };

    // Refresh cover preview URL
    if (track.cover_url) URL.revokeObjectURL(track.cover_url);
    if (track.metadata.has_cover && track.metadata.cover_bytes) {
      const isPng = (track.metadata.cover_bytes[0] === 0x89 && track.metadata.cover_bytes[1] === 0x50);
      const mime = isPng ? "image/png" : "image/jpeg";
      const coverBlob = new Blob([track.metadata.cover_bytes], { type: mime });
      track.cover_url = URL.createObjectURL(coverBlob);
    } else {
      track.cover_url = null;
    }

    // Refresh audio player URL
    if (track.audio_url) URL.revokeObjectURL(track.audio_url);
    const audioBlob = new Blob([updatedBuffer], { type: this._getMime(format) });
    track.audio_url = URL.createObjectURL(audioBlob);

    return {
      updatedTrack: track,
      downloadBlob: audioBlob
    };
  }

  /**
   * HTML5 Canvas: 1:1 square crop & 800x800 JPEG optimization in browser
   */
  static async cropAndOptimizeCover(fileOrBlob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(fileOrBlob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const minDim = Math.min(w, h);
        const left = Math.floor((w - minDim) / 2);
        const top = Math.floor((h - minDim) / 2);

        const canvas = document.createElement("canvas");
        const targetSize = Math.min(minDim, 800);
        canvas.width = targetSize;
        canvas.height = targetSize;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, left, top, minDim, minDim, 0, 0, targetSize, targetSize);

        canvas.toBlob((blob) => {
          if (!blob) return resolve(null);
          blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab))).catch(reject);
        }, "image/jpeg", 0.90);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // --------------------------------------------------------------------------
  // UTILITIES
  // --------------------------------------------------------------------------
  static _detectDuration(audioUrl) {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        const d = Math.round(audio.duration) || 0;
        resolve(d);
      };
      audio.onerror = () => resolve(0);
      audio.src = audioUrl;
    });
  }

  static _formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  static _formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  static _getMime(format) {
    return format === "m4a" ? "audio/mp4" : "audio/mpeg";
  }
}

window.UniversalBrowserTagger = UniversalBrowserTagger;
