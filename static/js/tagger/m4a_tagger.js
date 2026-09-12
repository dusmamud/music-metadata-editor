/**
 * AudioTag Pro - Client-Side M4A/MP4 Tag Reader & Writer
 * Manipulates MP4 atoms (moov.udta.meta.ilst) 100% in browser memory via ArrayBuffer.
 * Includes standard 'hdlr' atom inside 'meta' for universal mobile & desktop player support.
 */

class BrowserM4aTagger {
  /**
   * Parses metadata tags from an M4A ArrayBuffer
   */
  static parseTags(buffer) {
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

    const ilstAtom = this._findIlst(buffer);
    if (!ilstAtom) return meta;

    const view = new DataView(buffer);
    let offset = ilstAtom.offset + 8; // skip ilst size and name
    const endOffset = ilstAtom.offset + ilstAtom.size;

    while (offset + 8 <= endOffset) {
      const atomSize = view.getUint32(offset);
      if (atomSize <= 0 || offset + atomSize > endOffset) break;

      const atomName = String.fromCharCode(
        view.getUint8(offset + 4), view.getUint8(offset + 5),
        view.getUint8(offset + 6), view.getUint8(offset + 7)
      );

      const dataAtom = this._findChildAtom(buffer, offset + 8, offset + atomSize, "data");
      if (dataAtom) {
        const payloadOffset = dataAtom.offset + 16; // skip size(4), 'data'(4), type(4), locale(4)
        const payloadSize = dataAtom.size - 16;

        if (payloadSize > 0 && payloadOffset + payloadSize <= buffer.byteLength) {
          const payloadBytes = new Uint8Array(buffer, payloadOffset, payloadSize);

          if (atomName === "\xa9nam") meta.title = new TextDecoder("utf-8").decode(payloadBytes).trim();
          else if (atomName === "\xa9ART") meta.artist = new TextDecoder("utf-8").decode(payloadBytes).trim();
          else if (atomName === "\xa9alb") meta.album = new TextDecoder("utf-8").decode(payloadBytes).trim();
          else if (atomName === "aART") meta.album_artist = new TextDecoder("utf-8").decode(payloadBytes).trim();
          else if (atomName === "\xa9day") meta.year = new TextDecoder("utf-8").decode(payloadBytes).trim();
          else if (atomName === "\xa9gen") meta.genre = new TextDecoder("utf-8").decode(payloadBytes).trim();
          else if (atomName === "\xa9wrt") meta.composer = new TextDecoder("utf-8").decode(payloadBytes).trim();
          else if (atomName === "\xa9cmt") meta.comment = new TextDecoder("utf-8").decode(payloadBytes).trim();
          else if (atomName === "\xa9lyr") {
            const lyr = new TextDecoder("utf-8").decode(payloadBytes).trim();
            if (/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/.test(lyr)) {
              meta.synced_lyrics = lyr;
            } else {
              meta.lyrics = lyr;
            }
          }
          else if (atomName === "trkn" && payloadSize >= 4) {
            const trkView = new DataView(buffer, payloadOffset, payloadSize);
            const num = trkView.getUint16(2);
            const tot = trkView.getUint16(4);
            meta.track_number = tot ? `${num}/${tot}` : (num ? `${num}` : "");
          }
          else if (atomName === "disk" && payloadSize >= 4) {
            const diskView = new DataView(buffer, payloadOffset, payloadSize);
            const num = diskView.getUint16(2);
            const tot = diskView.getUint16(4);
            meta.disc_number = tot ? `${num}/${tot}` : (num ? `${num}` : "");
          }
          else if (atomName === "covr") {
            meta.has_cover = true;
            meta.cover_bytes = payloadBytes;
            const isPng = (payloadBytes[0] === 0x89 && payloadBytes[1] === 0x50);
            meta.cover_mime = isPng ? "image/png" : "image/jpeg";
          }
        }
      }

      offset += atomSize;
    }

    return meta;
  }

  /**
   * Writes updated MP4 atoms into M4A ArrayBuffer.
   */
  static writeTags(originalBuffer, tags, coverBytes, removeCover) {
    const moovAtom = this._findTopAtom(originalBuffer, "moov");
    if (!moovAtom) return originalBuffer;

    // 1. Build new ilst atom
    const ilstBytes = this._buildIlst(tags, coverBytes, removeCover, originalBuffer);

    // 2. Rebuild moov with new udta/meta/hdlr/ilst
    const newMoovBytes = this._replaceIlstInMoov(originalBuffer, moovAtom, ilstBytes);

    const oldMoovSize = moovAtom.size;
    const newMoovSize = newMoovBytes.byteLength;
    const delta = newMoovSize - oldMoovSize;

    // 3. Assemble new output buffer
    let outputBuffer = null;
    const moovOffset = moovAtom.offset;

    if (delta === 0) {
      outputBuffer = new Uint8Array(originalBuffer.slice(0));
      outputBuffer.set(newMoovBytes, moovOffset);
      return outputBuffer.buffer;
    }

    const newTotalSize = originalBuffer.byteLength + delta;
    outputBuffer = new Uint8Array(newTotalSize);

    outputBuffer.set(new Uint8Array(originalBuffer, 0, moovOffset), 0);
    outputBuffer.set(newMoovBytes, moovOffset);
    outputBuffer.set(
      new Uint8Array(originalBuffer, moovOffset + oldMoovSize),
      moovOffset + newMoovSize
    );

    // 4. Adjust stco / co64 chunk offsets
    this._adjustChunkOffsets(outputBuffer.buffer, moovOffset, delta);

    return outputBuffer.buffer;
  }

  static _buildIlst(tags, coverBytes, removeCover, originalBuffer) {
    const atomParts = [];

    const addTextAtom = (name, val) => {
      if (!val || !val.trim()) return;
      const textBytes = new TextEncoder().encode(val.trim());
      const dataSize = 16 + textBytes.length;
      const totalAtomSize = 8 + dataSize;
      const atom = new Uint8Array(totalAtomSize);
      const v = new DataView(atom.buffer);

      v.setUint32(0, totalAtomSize);
      for (let i = 0; i < 4; i++) atom[4 + i] = name.charCodeAt(i);

      v.setUint32(8, dataSize);
      atom[12] = 0x64; atom[13] = 0x61; atom[14] = 0x74; atom[15] = 0x61; // 'data'
      v.setUint32(16, 1); // type 1 = UTF-8
      v.setUint32(20, 0); // locale 0
      atom.set(textBytes, 24);

      atomParts.push(atom);
    };

    addTextAtom("\xa9nam", tags.title);
    addTextAtom("\xa9ART", tags.artist);
    addTextAtom("\xa9alb", tags.album);
    addTextAtom("aART", tags.album_artist);
    addTextAtom("\xa9day", tags.year);
    addTextAtom("\xa9gen", tags.genre);
    addTextAtom("\xa9wrt", tags.composer);
    addTextAtom("\xa9cmt", tags.comment);

    // Lyrics writing: \xa9lyr atom
    const lyricContent = (tags.synced_lyrics && tags.synced_lyrics.trim()) ? tags.synced_lyrics.trim() : (tags.lyrics && tags.lyrics.trim() ? tags.lyrics.trim() : "");
    if (lyricContent) {
      addTextAtom("\xa9lyr", lyricContent);
    }

    // Track number (trkn)
    if (tags.track_number && tags.track_number.trim()) {
      const parts = tags.track_number.trim().split("/");
      const num = parseInt(parts[0], 10) || 0;
      const tot = parseInt(parts[1], 10) || 0;
      const trkAtom = new Uint8Array(32);
      const tv = new DataView(trkAtom.buffer);
      tv.setUint32(0, 32);
      trkAtom[4] = 0x74; trkAtom[5] = 0x72; trkAtom[6] = 0x6B; trkAtom[7] = 0x6E; // 'trkn'
      tv.setUint32(8, 24);
      trkAtom[12] = 0x64; trkAtom[13] = 0x61; trkAtom[14] = 0x74; trkAtom[15] = 0x61;
      tv.setUint32(16, 0);
      tv.setUint32(20, 0);
      tv.setUint16(26, num);
      tv.setUint16(28, tot);
      atomParts.push(trkAtom);
    }

    // Cover Artwork (covr)
    let finalCover = coverBytes;
    if (!finalCover && !removeCover) {
      const existing = this.parseTags(originalBuffer);
      if (existing.has_cover && existing.cover_bytes) {
        finalCover = existing.cover_bytes;
      }
    }

    if (!removeCover && finalCover && finalCover.byteLength > 0) {
      const isPng = (finalCover[0] === 0x89 && finalCover[1] === 0x50);
      const imgType = isPng ? 14 : 13; // 13 = JPEG, 14 = PNG
      const dataSize = 16 + finalCover.byteLength;
      const totalAtomSize = 8 + dataSize;
      const covrAtom = new Uint8Array(totalAtomSize);
      const cv = new DataView(covrAtom.buffer);

      cv.setUint32(0, totalAtomSize);
      covrAtom[4] = 0x63; covrAtom[5] = 0x6F; covrAtom[6] = 0x76; covrAtom[7] = 0x72; // 'covr'
      cv.setUint32(8, dataSize);
      covrAtom[12] = 0x64; covrAtom[13] = 0x61; covrAtom[14] = 0x74; covrAtom[15] = 0x61;
      cv.setUint32(16, imgType);
      cv.setUint32(20, 0);
      covrAtom.set(finalCover, 24);

      atomParts.push(covrAtom);
    }

    let payloadLen = 0;
    for (const p of atomParts) payloadLen += p.byteLength;

    const ilstAtom = new Uint8Array(8 + payloadLen);
    const iv = new DataView(ilstAtom.buffer);
    iv.setUint32(0, 8 + payloadLen);
    ilstAtom[4] = 0x69; ilstAtom[5] = 0x6C; ilstAtom[6] = 0x73; ilstAtom[7] = 0x74; // 'ilst'

    let cur = 8;
    for (const p of atomParts) {
      ilstAtom.set(p, cur);
      cur += p.byteLength;
    }

    return ilstAtom;
  }

  static _replaceIlstInMoov(buffer, moovAtom, newIlstBytes) {
    const moovData = new Uint8Array(buffer, moovAtom.offset, moovAtom.size);
    const existingUdta = this._findChildAtom(buffer, moovAtom.offset + 8, moovAtom.offset + moovAtom.size, "udta");

    const newUdtaBytes = this._wrapIlstInUdta(newIlstBytes);

    if (existingUdta) {
      const udtaOffsetInMoov = existingUdta.offset - moovAtom.offset;
      const oldUdtaSize = existingUdta.size;

      const newMoovSize = moovAtom.size - oldUdtaSize + newUdtaBytes.byteLength;
      const outMoov = new Uint8Array(newMoovSize);
      const mv = new DataView(outMoov.buffer);

      outMoov.set(moovData.subarray(0, udtaOffsetInMoov), 0);
      outMoov.set(newUdtaBytes, udtaOffsetInMoov);
      outMoov.set(moovData.subarray(udtaOffsetInMoov + oldUdtaSize), udtaOffsetInMoov + newUdtaBytes.byteLength);

      mv.setUint32(0, newMoovSize);
      return outMoov;
    } else {
      const newMoovSize = moovAtom.size + newUdtaBytes.byteLength;
      const outMoov = new Uint8Array(newMoovSize);
      const mv = new DataView(outMoov.buffer);

      outMoov.set(moovData, 0);
      outMoov.set(newUdtaBytes, moovAtom.size);
      mv.setUint32(0, newMoovSize);
      return outMoov;
    }
  }

  static _createHdlrAtom() {
    // 33 bytes: size(4), 'hdlr'(4), version/flags(4), predefined(4), 'mdir'(4), 'appl'(4), flags(4), mask(4), name null(1)
    const hdlr = new Uint8Array(33);
    const v = new DataView(hdlr.buffer);
    v.setUint32(0, 33);
    hdlr[4] = 0x68; hdlr[5] = 0x64; hdlr[6] = 0x6C; hdlr[7] = 0x72; // 'hdlr'
    v.setUint32(8, 0); // version/flags 0
    v.setUint32(12, 0); // predefined 0
    hdlr[16] = 0x6D; hdlr[17] = 0x64; hdlr[18] = 0x69; hdlr[19] = 0x72; // 'mdir'
    hdlr[20] = 0x61; hdlr[21] = 0x70; hdlr[22] = 0x70; hdlr[23] = 0x6C; // 'appl'
    v.setUint32(24, 0);
    v.setUint32(28, 0);
    hdlr[32] = 0; // null terminator
    return hdlr;
  }

  static _wrapIlstInUdta(ilstBytes) {
    const hdlrAtom = this._createHdlrAtom();

    // meta atom: 4 size, 'meta'(4), 4 version/flags(0) + hdlr + ilst
    const metaSize = 12 + hdlrAtom.byteLength + ilstBytes.byteLength;
    const metaAtom = new Uint8Array(metaSize);
    const mv = new DataView(metaAtom.buffer);
    mv.setUint32(0, metaSize);
    metaAtom[4] = 0x6D; metaAtom[5] = 0x65; metaAtom[6] = 0x74; metaAtom[7] = 0x61; // 'meta'
    mv.setUint32(8, 0); // flags 0
    metaAtom.set(hdlrAtom, 12);
    metaAtom.set(ilstBytes, 12 + hdlrAtom.byteLength);

    // udta atom: 4 size, 'udta'(4) + meta
    const udtaSize = 8 + metaSize;
    const udtaAtom = new Uint8Array(udtaSize);
    const uv = new DataView(udtaAtom.buffer);
    uv.setUint32(0, udtaSize);
    udtaAtom[4] = 0x75; udtaAtom[5] = 0x64; udtaAtom[6] = 0x74; udtaAtom[7] = 0x61; // 'udta'
    udtaAtom.set(metaAtom, 8);

    return udtaAtom;
  }

  static _adjustChunkOffsets(buffer, moovOffset, delta) {
    if (delta === 0) return;
    const view = new DataView(buffer);

    const scan = (start, end) => {
      let off = start;
      while (off + 8 <= end) {
        const size = view.getUint32(off);
        if (size <= 0 || off + size > end) break;
        const name = String.fromCharCode(
          view.getUint8(off + 4), view.getUint8(off + 5),
          view.getUint8(off + 6), view.getUint8(off + 7)
        );

        if (name === "stco") {
          const entryCount = view.getUint32(off + 12);
          for (let i = 0; i < entryCount; i++) {
            const entryPos = off + 16 + i * 4;
            const curVal = view.getUint32(entryPos);
            if (curVal > moovOffset) {
              view.setUint32(entryPos, curVal + delta);
            }
          }
        } else if (name === "moov" || name === "trak" || name === "mdia" || name === "minf" || name === "stbl") {
          scan(off + 8, off + size);
        }

        off += size;
      }
    };

    scan(0, buffer.byteLength);
  }

  // --------------------------------------------------------------------------
  // ATOM NAVIGATION
  // --------------------------------------------------------------------------
  static _findTopAtom(buffer, targetName) {
    const view = new DataView(buffer);
    let offset = 0;
    while (offset + 8 <= buffer.byteLength) {
      const size = view.getUint32(offset);
      if (size <= 0 || offset + size > buffer.byteLength) break;
      const name = String.fromCharCode(
        view.getUint8(offset + 4), view.getUint8(offset + 5),
        view.getUint8(offset + 6), view.getUint8(offset + 7)
      );
      if (name === targetName) return { offset, size, name };
      offset += size;
    }
    return null;
  }

  static _findChildAtom(buffer, start, end, targetName) {
    const view = new DataView(buffer);
    let offset = start;
    while (offset + 8 <= end) {
      const size = view.getUint32(offset);
      if (size <= 0 || offset + size > end) break;
      const name = String.fromCharCode(
        view.getUint8(offset + 4), view.getUint8(offset + 5),
        view.getUint8(offset + 6), view.getUint8(offset + 7)
      );
      if (name === targetName) return { offset, size, name };
      offset += size;
    }
    return null;
  }

  static _findIlst(buffer) {
    const moov = this._findTopAtom(buffer, "moov");
    if (!moov) return null;

    const udta = this._findChildAtom(buffer, moov.offset + 8, moov.offset + moov.size, "udta");
    if (!udta) return null;

    const meta = this._findChildAtom(buffer, udta.offset + 8, udta.offset + udta.size, "meta");
    if (!meta) return null;

    // Inside meta, search for ilst
    return this._findChildAtom(buffer, meta.offset + 12, meta.offset + meta.size, "ilst");
  }
}

window.BrowserM4aTagger = BrowserM4aTagger;
