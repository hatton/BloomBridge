import { createHash } from "crypto";
import sharp from "sharp";

/**
 * Hashing strategy for recognizing that a source PDF page is one of the complex
 * boilerplate pages held in a "master" book (see master/masterPages.ts).
 *
 * - "perceptual" (default): a 64-bit dHash of the page render, compared by Hamming
 *   distance. Robust to re-compression/down-sampling, so a master built from
 *   uncompressed PDFs still matches the same page in a compressed PDF (e.g. the
 *   smaller copies checked into the repo for tests).
 * - "exact": SHA-256 of the decoded pixels, compared for equality. Only matches
 *   byte-identical renders.
 */
export type PageHashMode = "perceptual" | "exact";

export const DEFAULT_HASH_MODE: PageHashMode = "perceptual";

/**
 * Max Hamming distance (out of 64 bits) at which two perceptual hashes are
 * considered the same page. Empirically, the same page across heavy
 * re-compression differs by < 10 bits while distinct pages differ by ≥ 18, so 10
 * sits comfortably in the gap.
 */
export const PERCEPTUAL_MATCH_MAX_DISTANCE = 10;

/** An image to hash: either a path on disk or its raw bytes (e.g. an EPUB zip entry). */
export type ImageInput = string | Buffer;

/** Compute a 64-bit difference hash (dHash) of an image, as 16 hex chars. */
async function perceptualHash(imagePath: ImageInput): Promise<string> {
  // 9x8 grayscale; each bit compares a pixel to its right-hand neighbor.
  const { data } = await sharp(imagePath)
    .greyscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const i = r * 9 + c;
      bits = (bits << 1n) | (data[i] > data[i + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

/** SHA-256 of the decoded raw pixels (exact mode). */
async function exactHash(imagePath: ImageInput): Promise<string> {
  const { data, info } = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
  const hash = createHash("sha256");
  hash.update(`${info.width}x${info.height}x${info.channels}|`);
  hash.update(data);
  return hash.digest("hex");
}

/**
 * Hash a rendered page image. The returned string is stored on the page (and on
 * master-book pages) as `data-import-source-hash` and matched with `hashesMatch`.
 */
export async function hashPageImage(
  imagePath: ImageInput,
  mode: PageHashMode = DEFAULT_HASH_MODE,
): Promise<string> {
  return mode === "exact" ? exactHash(imagePath) : perceptualHash(imagePath);
}

/** Population count of a BigInt (number of set bits). */
function popcount(n: bigint): number {
  let count = 0;
  while (n > 0n) {
    n &= n - 1n;
    count++;
  }
  return count;
}

/** Hamming distance between two equal-length hex hashes, or Infinity if mismatched. */
export function hashDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity; // e.g. perceptual (16) vs exact (64)
  try {
    return popcount(BigInt("0x" + a) ^ BigInt("0x" + b));
  } catch {
    return Infinity;
  }
}

/**
 * Whether two page hashes identify the same page. Perceptual hashes match within
 * `PERCEPTUAL_MATCH_MAX_DISTANCE`; exact hashes must be equal.
 */
export function hashesMatch(a: string, b: string, mode: PageHashMode = DEFAULT_HASH_MODE): boolean {
  if (mode === "exact") return a === b;
  return hashDistance(a, b) <= PERCEPTUAL_MATCH_MAX_DISTANCE;
}
