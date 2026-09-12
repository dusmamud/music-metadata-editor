/**
 * AudioTag Pro API Client
 * Manages HTTP communication with the FastAPI backend.
 */

const API = {
  // Retrieve or generate persistent session ID in localStorage
  getSessionId() {
    let sid = localStorage.getItem("audiotag_session_id");
    if (!sid) {
      sid = "sess-" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      localStorage.setItem("audiotag_session_id", sid);
    }
    return sid;
  },

  // Upload one or multiple audio tracks
  async uploadFiles(fileList, onProgress) {
    const sid = this.getSessionId();
    const formData = new FormData();
    formData.append("session_id", sid);

    for (let i = 0; i < fileList.length; i++) {
      formData.append("files", fileList[i]);
    }

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/audio/upload");

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            const percent = Math.round((evt.loaded / evt.total) * 100);
            onProgress(percent);
          }
        };
      }

      xhr.onload = () => {
        try {
          const res = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && res.success) {
            resolve(res);
          } else {
            reject(new Error(res.message || "Upload failed."));
          }
        } catch (err) {
          reject(new Error("Server returned invalid response."));
        }
      };

      xhr.onerror = () => reject(new Error("Network error during upload."));
      xhr.send(formData);
    });
  },

  // Save updated metadata & optional cover artwork
  async saveMetadata(fileId, formData) {
    const sid = this.getSessionId();
    const response = await fetch(`/api/tags/save/${sid}/${fileId}`, {
      method: "POST",
      body: formData
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.message || "Failed to save tags.");
    }
    return data;
  },

  // Delete track from session
  async deleteTrack(fileId) {
    const sid = this.getSessionId();
    const response = await fetch(`/api/audio/${sid}/${fileId}`, {
      method: "DELETE"
    });
    return await response.json();
  },

  // Construct stream URL
  getStreamUrl(fileId) {
    const sid = this.getSessionId();
    return `/api/audio/stream/${sid}/${fileId}?t=${Date.now()}`;
  },

  // Construct cover image URL
  getCoverUrl(fileId) {
    const sid = this.getSessionId();
    return `/api/audio/cover/${sid}/${fileId}?t=${Date.now()}`;
  },

  // Construct download URL
  getDownloadUrl(fileId) {
    const sid = this.getSessionId();
    return `/api/audio/download/${sid}/${fileId}`;
  }
};
