/**
 * AudioTag Pro - Client-Side MP3 (ID3v2 & ID3v1) Tag Reader & Writer
 * Operates 100% in browser memory via ArrayBuffer & DataView.
 * Supports ID3v2.3, ID3v2.4, ID3v1, APIC (UTF-16/ISO), and USLT/TXXX lyrics.
 */

class BrowserMp3Tagger {
  /**
   * Parses ID3v2 & ID3v1 tags from an MP3 ArrayBuffer
   */
  static parseTags(buffer) {
    const view = new DataView(buffer);
    const meta = {
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

    // 1. Try parsing ID3v2 tag at the beginning
    if (buffer.byteLength >= 10) {
      const header = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2));
      if (header === "ID3") {
        this._parseId3v2(buffer, meta);
      }
    }

    // 2. If title or artist still missing, fallback to ID3v1 at the end of the file
    if (!meta.title || !meta.artist) {
      this._parseId3v1(buffer, meta);
    }

    return meta;
  }

  static _parseId3v2(buffer, meta) {
    const view = new DataView(buffer);
    const version = view.getUint8(3); // 3 for ID3v2.3, 4 for ID3v2.4
    const flags = view.getUint8(5);
    
    // Syncsafe tag size
    const tagSize = (
      ((view.getUint8(6) & 0x7F) << 21) |
      ((view.getUint8(7) & 0x7F) << 14) |
      ((view.getUint8(8) & 0x7F) << 7) |
      (view.getUint8(9) & 0x7F)
    );

    let offset = 10;
    // Skip extended header if present
    if (flags & 0x40 && offset + 4 <= buffer.byteLength) {
      const extSize = view.getUint32(offset);
      offset += extSize + 4;
    }

    const endOffset = Math.min(10 + tagSize, buffer.byteLength);

    while (offset + 10 < endOffset) {
      const frameId = String.fromCharCode(
        view.getUint8(offset), view.getUint8(offset + 1),
        view.getUint8(offset + 2), view.getUint8(offset + 3)
      );

      // Stop on padding (null bytes)
      if (view.getUint8(offset) === 0) break;

      let frameSize = 0;
      if (version === 4) {
        frameSize = (
          ((view.getUint8(offset + 4) & 0x7F) << 21) |
          ((view.getUint8(offset + 5) & 0x7F) << 14) |
          ((view.getUint8(offset + 6) & 0x7F) << 7) |
          (view.getUint8(offset + 7) & 0x7F)
        );
      } else {
        frameSize = view.getUint32(offset + 4);
      }

      if (frameSize <= 0 || offset + 10 + frameSize > buffer.byteLength) break;

      const frameDataOffset = offset + 10;
      const frameData = new Uint8Array(buffer, frameDataOffset, frameSize);

      try {
        if (frameId === "TIT2") meta.title = meta.title || this._decodeText(frameData);
        else if (frameId === "TPE1") meta.artist = meta.artist || this._decodeText(frameData);
        else if (frameId === "TALB") meta.album = meta.album || this._decodeText(frameData);
        else if (frameId === "TPE2") meta.album_artist = meta.album_artist || this._decodeText(frameData);
        else if (frameId === "TDRC" || frameId === "TYER") meta.year = meta.year || this._decodeText(frameData);
        else if (frameId === "TCON") meta.genre = meta.genre || this._decodeText(frameData);
        else if (frameId === "TRCK") meta.track_number = meta.track_number || this._decodeText(frameData);
        else if (frameId === "TPOS") meta.disc_number = meta.disc_number || this._decodeText(frameData);
        else if (frameId === "TCOM") meta.composer = meta.composer || this._decodeText(frameData);
        else if (frameId === "COMM") meta.comment = meta.comment || this._decodeComm(frameData);
        else if (frameId === "USLT") {
          const lyr = this._decodeUslt(frameData);
          if (/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/.test(lyr)) {
            meta.synced_lyrics = meta.synced_lyrics || lyr;
          } else {
            meta.lyrics = meta.lyrics || lyr;
          }
        }
        else if (frameId === "TXXX") {
          const txxx = this._decodeTxxx(frameData);
          if (txxx && (txxx.desc.toUpperCase() === "LYRICS" || txxx.desc.toUpperCase() === "UNSYNCEDLYRICS")) {
            if (/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/.test(txxx.text)) {
              meta.synced_lyrics = meta.synced_lyrics || txxx.text;
            } else {
              meta.lyrics = meta.lyrics || txxx.text;
            }
          }
        }
        else if (frameId === "APIC" && !meta.has_cover) {
          const pic = this._decodeApic(frameData);
          if (pic) {
            meta.has_cover = true;
            meta.cover_bytes = pic.bytes;
            meta.cover_mime = pic.mime;
          }
        }
      } catch (err) {
        // Continue parsing next frame
      }

      offset += 10 + frameSize;
    }
  }

  static _parseId3v1(buffer, meta) {
    if (buffer.byteLength < 128) return;
    const view = new DataView(buffer);
    const start = buffer.byteLength - 128;
    const tag = String.fromCharCode(view.getUint8(start), view.getUint8(start + 1), view.getUint8(start + 2));
    if (tag !== "TAG") return;

    const readString = (from, len) => {
      let str = "";
      for (let i = 0; i < len; i++) {
        const c = view.getUint8(from + i);
        if (c === 0) break;
        str += String.fromCharCode(c);
      }
      return str.trim();
    };

    if (!meta.title) meta.title = readString(start + 3, 30);
    if (!meta.artist) meta.artist = readString(start + 33, 30);
    if (!meta.album) meta.album = readString(start + 63, 30);
    if (!meta.year) meta.year = readString(start + 93, 4);
    if (!meta.comment) meta.comment = readString(start + 97, 28);
  }

  /**
   * Writes updated ID3v2.3 tags and optional cover art into MP3 ArrayBuffer.
   * Universal compatibility with mobile players (Poweramp, Apple Music, Samsung, VLC).
   */
  static writeTags(originalBuffer, tags, coverBytes, removeCover) {
    const existingTagSize = this._getExistingId3Size(originalBuffer);
    const audioData = new Uint8Array(originalBuffer, existingTagSize);

    const frames = [];

    if (tags.title) frames.push(this._createTextFrame("TIT2", tags.title));
    if (tags.artist) frames.push(this._createTextFrame("TPE1", tags.artist));
    if (tags.album) frames.push(this._createTextFrame("TALB", tags.album));
    if (tags.album_artist) frames.push(this._createTextFrame("TPE2", tags.album_artist));
    if (tags.year) frames.push(this._createTextFrame("TYER", tags.year));
    if (tags.genre) frames.push(this._createTextFrame("TCON", tags.genre));
    if (tags.track_number) frames.push(this._createTextFrame("TRCK", tags.track_number));
    if (tags.disc_number) frames.push(this._createTextFrame("TPOS", tags.disc_number));
    if (tags.composer) frames.push(this._createTextFrame("TCOM", tags.composer));
    if (tags.comment) frames.push(this._createCommFrame(tags.comment));

    // Lyrics writing: Write USLT with language 'eng' and 'XXX', plus TXXX:LYRICS for maximum compatibility
    const lyricContent = (tags.synced_lyrics && tags.synced_lyrics.trim()) ? tags.synced_lyrics.trim() : (tags.lyrics && tags.lyrics.trim() ? tags.lyrics.trim() : "");
    if (lyricContent) {
      frames.push(this._createUsltFrame(lyricContent, "eng"));
      frames.push(this._createUsltFrame(lyricContent, "XXX"));
      frames.push(this._createTxxxFrame("LYRICS", lyricContent));
    }

    // Cover artwork (APIC)
    let finalCover = coverBytes;
    if (!finalCover && !removeCover) {
      const existing = this.parseTags(originalBuffer);
      if (existing.has_cover && existing.cover_bytes) {
        finalCover = existing.cover_bytes;
      }
    }

    if (!removeCover && finalCover && finalCover.byteLength > 0) {
      frames.push(this._createApicFrame(finalCover));
    }

    let framesLength = 0;
    for (const f of frames) framesLength += f.byteLength;

    const padding = 1024;
    const totalTagPayloadSize = framesLength + padding;

    const id3Header = new Uint8Array(10);
    id3Header[0] = 0x49; // 'I'
    id3Header[1] = 0x44; // 'D'
    id3Header[2] = 0x33; // '3'
    id3Header[3] = 0x03; // ID3v2.3
    id3Header[4] = 0x00;
    id3Header[5] = 0x00; // flags

    id3Header[6] = (totalTagPayloadSize >> 21) & 0x7F;
    id3Header[7] = (totalTagPayloadSize >> 14) & 0x7F;
    id3Header[8] = (totalTagPayloadSize >> 7) & 0x7F;
    id3Header[9] = totalTagPayloadSize & 0x7F;

    const outputBuffer = new Uint8Array(10 + totalTagPayloadSize + audioData.byteLength);
    outputBuffer.set(id3Header, 0);

    let currentPos = 10;
    for (const f of frames) {
      outputBuffer.set(f, currentPos);
      currentPos += f.byteLength;
    }

    outputBuffer.set(audioData, 10 + totalTagPayloadSize);
    return outputBuffer.buffer;
  }

  // --------------------------------------------------------------------------
  // FRAME BUILDERS
  // --------------------------------------------------------------------------
  static _createTextFrame(frameId, text) {
    const textBytes = this._encodeUtf16Le(text);
    const payload = new Uint8Array(1 + 2 + textBytes.length);
    payload[0] = 0x01; // UTF-16 with BOM
    payload[1] = 0xFF; // BOM
    payload[2] = 0xFE;
    payload.set(textBytes, 3);
    return this._wrapFrame(frameId, payload);
  }

  static _createCommFrame(text) {
    const textBytes = this._encodeUtf16Le(text);
    const payload = new Uint8Array(1 + 3 + 4 + 2 + textBytes.length);
    payload[0] = 0x01; // UTF-16
    payload[1] = 0x65; payload[2] = 0x6E; payload[3] = 0x67; // 'eng'
    payload[4] = 0xFF; payload[5] = 0xFE; payload[6] = 0x00; payload[7] = 0x00; // Empty desc
    payload[8] = 0xFF; payload[9] = 0xFE; // Text BOM
    payload.set(textBytes, 10);
    return this._wrapFrame("COMM", payload);
  }

  static _createUsltFrame(text, lang = "eng") {
    const textBytes = this._encodeUtf16Le(text);
    // 1 byte encoding + 3 bytes lang + 4 bytes empty descriptor (BOM + double null) + 2 bytes BOM + text
    const payload = new Uint8Array(1 + 3 + 4 + 2 + textBytes.length);
    payload[0] = 0x01; // UTF-16
    payload[1] = lang.charCodeAt(0) || 0x65;
    payload[2] = lang.charCodeAt(1) || 0x6E;
    payload[3] = lang.charCodeAt(2) || 0x67;
    // Empty descriptor: BOM + 0x00 0x00
    payload[4] = 0xFF;
    payload[5] = 0xFE;
    payload[6] = 0x00;
    payload[7] = 0x00;
    // Text BOM
    payload[8] = 0xFF;
    payload[9] = 0xFE;
    payload.set(textBytes, 10);
    return this._wrapFrame("USLT", payload);
  }

  static _createTxxxFrame(description, text) {
    const descBytes = this._encodeUtf16Le(description);
    const textBytes = this._encodeUtf16Le(text);
    const payload = new Uint8Array(1 + 2 + descBytes.length + 2 + 2 + textBytes.length);
    payload[0] = 0x01; // UTF-16
    payload[1] = 0xFF; payload[2] = 0xFE;
    payload.set(descBytes, 3);
    const descEnd = 3 + descBytes.length;
    payload[descEnd] = 0x00; payload[descEnd + 1] = 0x00; // Null terminator
    payload[descEnd + 2] = 0xFF; payload[descEnd + 3] = 0xFE; // Text BOM
    payload.set(textBytes, descEnd + 4);
    return this._wrapFrame("TXXX", payload);
  }

  static _createApicFrame(coverBytes) {
    const isPng = (coverBytes[0] === 0x89 && coverBytes[1] === 0x50);
    const mime = isPng ? "image/png" : "image/jpeg";
    const mimeBytes = [];
    for (let i = 0; i < mime.length; i++) mimeBytes.push(mime.charCodeAt(i));
    mimeBytes.push(0);

    const payload = new Uint8Array(1 + mimeBytes.length + 1 + 1 + coverBytes.byteLength);
    payload[0] = 0x00; // ISO-8859-1 for mime
    payload.set(mimeBytes, 1);
    const picTypePos = 1 + mimeBytes.length;
    payload[picTypePos] = 0x03; // Front Cover
    payload[picTypePos + 1] = 0x00; // Description null
    payload.set(coverBytes, picTypePos + 2);

    return this._wrapFrame("APIC", payload);
  }

  static _wrapFrame(frameId, payload) {
    const frame = new Uint8Array(10 + payload.byteLength);
    for (let i = 0; i < 4; i++) frame[i] = frameId.charCodeAt(i);
    const size = payload.byteLength;
    frame[4] = (size >> 24) & 0xFF;
    frame[5] = (size >> 16) & 0xFF;
    frame[6] = (size >> 8) & 0xFF;
    frame[7] = size & 0xFF;
    frame[8] = 0x00; frame[9] = 0x00;
    frame.set(payload, 10);
    return frame;
  }

  // --------------------------------------------------------------------------
  // DECODERS
  // --------------------------------------------------------------------------
  static _getExistingId3Size(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 10) return 0;
    if (String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2)) !== "ID3") return 0;
    const tagSize = (
      ((view.getUint8(6) & 0x7F) << 21) |
      ((view.getUint8(7) & 0x7F) << 14) |
      ((view.getUint8(8) & 0x7F) << 7) |
      (view.getUint8(9) & 0x7F)
    );
    return 10 + tagSize;
  }

  static _decodeText(data) {
    if (data.length <= 1) return "";
    const encoding = data[0];
    const textData = data.slice(1);
    try {
      if (encoding === 0 || encoding === 3) {
        return new TextDecoder(encoding === 3 ? "utf-8" : "iso-8859-1").decode(textData).replace(/\0+$/, "").trim();
      } else {
        return new TextDecoder("utf-16").decode(textData).replace(/\0+$/, "").trim();
      }
    } catch (e) {
      return "";
    }
  }

  static _decodeComm(data) {
    return this._decodeUslt(data);
  }

  static _decodeUslt(data) {
    if (data.length <= 4) return "";
    const encoding = data[0];
    let offset = 4; // skip encoding(1) + lang(3)

    if (encoding === 1 || encoding === 2) {
      // Skip possible descriptor BOM
      if (offset + 1 < data.length && ((data[offset] === 0xFF && data[offset+1] === 0xFE) || (data[offset] === 0xFE && data[offset+1] === 0xFF))) {
        offset += 2;
      }
      // Skip descriptor until double null
      while (offset + 1 < data.length) {
        if (data[offset] === 0x00 && data[offset + 1] === 0x00) {
          offset += 2;
          break;
        }
        offset += 2;
      }
    } else {
      while (offset < data.length && data[offset] !== 0) offset++;
      offset++;
    }

    if (offset >= data.length) return "";
    const textBytes = data.slice(offset);
    try {
      if (encoding === 1 || encoding === 2) {
        return new TextDecoder("utf-16").decode(textBytes).replace(/\0+$/, "").trim();
      }
      return new TextDecoder(encoding === 3 ? "utf-8" : "iso-8859-1").decode(textBytes).replace(/\0+$/, "").trim();
    } catch (e) {
      return "";
    }
  }

  static _decodeTxxx(data) {
    if (data.length <= 2) return null;
    const encoding = data[0];
    let offset = 1;

    let desc = "";
    if (encoding === 1 || encoding === 2) {
      let descStart = offset;
      while (offset + 1 < data.length) {
        if (data[offset] === 0 && data[offset + 1] === 0) {
          desc = new TextDecoder("utf-16").decode(data.slice(descStart, offset)).trim();
          offset += 2;
          break;
        }
        offset += 2;
      }
      const val = new TextDecoder("utf-16").decode(data.slice(offset)).replace(/\0+$/, "").trim();
      return { desc, text: val };
    } else {
      let descStart = offset;
      while (offset < data.length && data[offset] !== 0) offset++;
      desc = new TextDecoder(encoding === 3 ? "utf-8" : "iso-8859-1").decode(data.slice(descStart, offset)).trim();
      offset++;
      const val = new TextDecoder(encoding === 3 ? "utf-8" : "iso-8859-1").decode(data.slice(offset)).replace(/\0+$/, "").trim();
      return { desc, text: val };
    }
  }

  static _decodeApic(data) {
    if (data.length < 10) return null;
    const encoding = data[0];
    let offset = 1;
    let mime = "";
    while (offset < data.length && data[offset] !== 0) {
      mime += String.fromCharCode(data[offset++]);
    }
    offset++; // skip null
    if (offset >= data.length) return null;
    const picType = data[offset++];

    // Skip description correctly!
    if (encoding === 1 || encoding === 2) {
      if (offset + 1 < data.length && ((data[offset] === 0xFF && data[offset+1] === 0xFE) || (data[offset] === 0xFE && data[offset+1] === 0xFF))) {
        offset += 2;
      }
      while (offset + 1 < data.length) {
        if (data[offset] === 0x00 && data[offset + 1] === 0x00) {
          offset += 2;
          break;
        }
        offset += 2;
      }
    } else {
      while (offset < data.length && data[offset] !== 0) offset++;
      offset++;
    }

    if (offset < data.length) {
      const imgBytes = data.slice(offset);
      // Validate image header (JPEG or PNG)
      const isJpeg = (imgBytes[0] === 0xFF && imgBytes[1] === 0xD8);
      const isPng = (imgBytes[0] === 0x89 && imgBytes[1] === 0x50);
      return {
        mime: isPng ? "image/png" : (isJpeg ? "image/jpeg" : (mime || "image/jpeg")),
        bytes: imgBytes
      };
    }
    return null;
  }

  static _encodeUtf16Le(str) {
    const bytes = new Uint8Array(str.length * 2);
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      bytes[i * 2] = code & 0xFF;
      bytes[i * 2 + 1] = (code >> 8) & 0xFF;
    }
    return bytes;
  }
}

window.BrowserMp3Tagger = BrowserMp3Tagger;
