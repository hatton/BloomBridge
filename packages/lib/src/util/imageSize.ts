import { readFileSync } from "fs";

/**
 * Intrinsic pixel size of a JPEG or PNG from its header (no decode, no dependency).
 * Returns null for unrecognised data. Used to read illustration aspect ratios — to
 * pick a book's page orientation (EPUB front-end) and to size origami image panes
 * (fitImagePanes).
 */
export function intrinsicSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50)
    // PNG: IHDR width/height
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    // JPEG: scan segments for a Start-Of-Frame marker, which carries height/width.
    let o = 2;
    while (o < buf.length - 8) {
      if (buf[o] !== 0xff) {
        o++;
        continue;
      }
      const m = buf[o + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
      o += 2 + buf.readUInt16BE(o + 2);
    }
  }
  return null;
}

/**
 * Intrinsic pixel size of an image file on disk, or null if the file is missing or
 * its format isn't recognised. Synchronous because Stage 4 HTML generation is
 * synchronous.
 */
export function imageSizeFromFile(absPath: string): { w: number; h: number } | null {
  try {
    return intrinsicSize(readFileSync(absPath));
  } catch {
    return null;
  }
}
