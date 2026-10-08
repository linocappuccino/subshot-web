/** 2026-10-08, Lino: "lädt man GIFs hoch … sie loopen immer" — browsers play
 * a GIF exactly as often as its NETSCAPE2.0 loop block says (a GIF without
 * that block plays once). Before a GIF goes onto the board, its loop count
 * is set to 0 (= forever), adding the block when it's missing. Only these
 * few header bytes change; the frames themselves stay untouched. */
export async function forceGifLoop(file: File): Promise<File> {
  try {
    const src = new Uint8Array(await file.arrayBuffer());
    const sig = String.fromCharCode(...src.slice(0, 6));
    if (sig !== "GIF89a" && sig !== "GIF87a") return file;
    const bytes = src.slice();
    // the loop block is an extension — those need the 89a header
    if (sig === "GIF87a") bytes.set([0x38, 0x39], 3);

    const appId = [0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30]; // "NETSCAPE2.0"
    for (let i = 13; i < bytes.length - 16; i++) {
      if (bytes[i] !== 0x21 || bytes[i + 1] !== 0xff || bytes[i + 2] !== 0x0b) continue;
      if (!appId.every((b, k) => bytes[i + 3 + k] === b)) continue;
      // 21 FF 0B "NETSCAPE2.0" 03 01 <lo> <hi> 00
      if (bytes[i + 14] === 0x03 && bytes[i + 15] === 0x01) {
        if (bytes[i + 16] === 0 && bytes[i + 17] === 0 && sig === "GIF89a") return file;
        bytes[i + 16] = 0;
        bytes[i + 17] = 0;
        return new File([bytes], file.name, { type: "image/gif", lastModified: file.lastModified });
      }
    }

    // no loop block: insert one right after the header + global color table
    const packed = bytes[10];
    const gct = packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0;
    const at = 13 + gct;
    if (at > bytes.length) return file;
    const block = new Uint8Array([0x21, 0xff, 0x0b, ...appId, 0x03, 0x01, 0x00, 0x00, 0x00]);
    const out = new Uint8Array(bytes.length + block.length);
    out.set(bytes.slice(0, at), 0);
    out.set(block, at);
    out.set(bytes.slice(at), at + block.length);
    return new File([out], file.name, { type: "image/gif", lastModified: file.lastModified });
  } catch {
    return file;
  }
}
