/**
 * AudioTag Pro - Client-Side Drag-and-Drop & File Processor
 * Loads files directly into browser memory with zero network uploads.
 */

class TrackUploader {
  constructor(dropZoneEl, fileInputEl, onUploadSuccess, onUploadError) {
    this.dropZone = dropZoneEl;
    this.fileInput = fileInputEl;
    this.onSuccess = onUploadSuccess;
    this.onError = onUploadError;

    this.progressBar = document.getElementById("upload-progress-bar");
    this.progressContainer = document.getElementById("upload-progress-container");
    this.progressText = document.getElementById("upload-progress-text");

    this._initEvents();
  }

  _initEvents() {
    if (!this.dropZone) return;

    // Prevent default drag behaviors
    ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
      this.dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, false);
    });

    // Drag styling
    ["dragenter", "dragover"].forEach((eventName) => {
      this.dropZone.addEventListener(eventName, () => this.dropZone.classList.add("dragover"), false);
    });

    ["dragleave", "drop"].forEach((eventName) => {
      this.dropZone.addEventListener(eventName, () => this.dropZone.classList.remove("dragover"), false);
    });

    // Drop handler
    this.dropZone.addEventListener("drop", (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      if (files && files.length > 0) {
        this.handleFiles(files);
      }
    });

    // File input change
    if (this.fileInput) {
      this.fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.handleFiles(e.target.files);
        }
      });
    }
  }

  async handleFiles(files) {
    this._showProgress(true);
    const loadedTracks = [];
    const total = files.length;

    try {
      for (let i = 0; i < total; i++) {
        const file = files[i];
        const track = await UniversalBrowserTagger.loadAudioTrack(file);
        loadedTracks.push(track);
        this._updateProgress(Math.round(((i + 1) / total) * 100));
      }

      this._showProgress(false);
      if (this.onSuccess) this.onSuccess({ success: true, tracks: loadedTracks });
    } catch (err) {
      this._showProgress(false);
      if (this.onError) this.onError(err);
    } finally {
      if (this.fileInput) this.fileInput.value = "";
    }
  }

  _showProgress(show) {
    if (this.progressContainer) {
      this.progressContainer.classList.toggle("hidden", !show);
    }
    if (show) this._updateProgress(0);
  }

  _updateProgress(percent) {
    if (this.progressBar) this.progressBar.style.width = `${percent}%`;
    if (this.progressText) this.progressText.textContent = `Reading audio tags in browser... ${percent}%`;
  }
}
