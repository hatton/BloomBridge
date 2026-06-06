/**
 * Minimal, dependency-free ZIP reader — enough to read an EPUB (which is just a
 * ZIP). Handles the two compression methods EPUBs use (stored=0, deflate=8) via
 * Node's built-in `zlib`. Not a general-purpose ZIP library: no zip64, no
 * encryption, no spanning. We read the whole archive into memory (EPUBs are small)
 * and parse the central directory.
 *
 * Why hand-rolled: the codebase has no zip dependency, EPUBs are simple/standard
 * archives, and a ~90-line reader avoids a new supply-chain dependency.
 */
import * as fs from "fs";
import * as zlib from "zlib";

const SIG_EOCD = 0x06054b50; // End Of Central Directory
const SIG_CDH = 0x02014b50; // Central Directory file Header
const SIG_LFH = 0x04034b50; // Local File Header

/** Read a ZIP file and return a map of entry path → uncompressed bytes. */
export function readZip(zipPath: string): Map<string, Buffer> {
  const buf = fs.readFileSync(zipPath);
  const entries = new Map<string, Buffer>();

  // Find the End-Of-Central-Directory record by scanning backwards (it ends the
  // file, possibly followed by a comment of up to 0xffff bytes).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid ZIP/EPUB: no end-of-central-directory record found");

  const cdCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff) throw new Error("ZIP64 archives are not supported");

  let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== SIG_CDH) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    // Directory entries (trailing slash) carry no data.
    if (name.endsWith("/")) continue;

    // Jump to the local file header to find where the data actually starts (the
    // local header's name/extra lengths can differ from the central directory's).
    if (buf.readUInt32LE(localOffset) !== SIG_LFH) continue;
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);

    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`Unsupported ZIP compression method ${method} for entry "${name}"`);

    entries.set(name, data);
  }

  return entries;
}
