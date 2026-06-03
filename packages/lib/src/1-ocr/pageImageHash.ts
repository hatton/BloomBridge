import { createHash } from "crypto";
import sharp from "sharp";

/**
 * Hashing strategy. "exact" hashes the decoded raw pixels of the page render —
 * stable across image-container re-encodings but sensitive to any pixel change.
 * The enum is the seam for adding a tolerant "perceptual" mode later (downscale →
 * grayscale → aHash/dHash) without touching callers.
 */
export type PageHashMode = "exact";

/**
 * Compute a content hash of a rendered page image, used to recognize that a
 * source PDF page is one of the complex boilerplate pages held in a "master"
 * book (see master/masterPages.ts).
 *
 * We decode to raw pixels first (rather than hashing the JPEG/PNG bytes) so the
 * hash depends on what the page looks like, not on how the renderer happened to
 * encode it.
 */
export async function hashPageImage(
  imagePath: string,
  mode: PageHashMode = "exact",
): Promise<string> {
  // mode is currently always "exact"; kept as a parameter so a perceptual
  // strategy can be slotted in here later.
  void mode;
  const { data, info } = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
  const hash = createHash("sha256");
  // Include dimensions so two different-sized renders can never collide.
  hash.update(`${info.width}x${info.height}x${info.channels}|`);
  hash.update(data);
  return hash.digest("hex");
}
