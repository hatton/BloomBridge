import sharp from "sharp";
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../logger";

/**
 * Strip uniform white(ish) borders from the illustration images in a book folder.
 *
 * Picture-book illustrations are often exported with a generous white margin around
 * the actual artwork, which makes the content look tiny once the image is dropped
 * onto a Bloom page. When the user opts in ("Trim Whitespace"), we crop that margin
 * off the edges of each illustration in place, so the content fills its frame.
 *
 * Scope — what we DON'T touch:
 *  - reserved full-bleed renders: `cover.jpg`, `back-cover.jpg`, and the per-page
 *    flatten snapshots (`page-<N>.jpg`). These are meant to bleed to the page edge;
 *    trimming would change their aspect and leave a border.
 *  - Bloom's own assets: `placeHolder.png`, `thumbnail.*`, `license.png`, branding.
 *  - decorative icons (`i-<n>`, `logo`, `sc.`): the discussion-questions grid keeps
 *    these as foreground images sized from the Markdown's `{width= height=}`, so
 *    trimming them would distort that aspect-driven layout.
 *
 * This is the same exclusion vocabulary the EPUB front-end uses for "decorative"
 * images, kept in sync deliberately.
 *
 * Best-effort: a per-image failure (or a degenerate trim) is logged and skipped; a
 * missing/unusable sharp never aborts the conversion.
 */

/** Near-white background to treat as trimmable margin, with a tolerance for off-white scans. */
const TRIM_BACKGROUND = "#ffffff";
const TRIM_THRESHOLD = 15;
/** Don't accept a trim that would reduce the image to a sliver — that signals a near-blank image. */
const MIN_TRIMMED_PX = 8;

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/** True for files whose whitespace we should leave alone (see the module doc). */
function isExcluded(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (lower === "cover.jpg" || lower === "back-cover.jpg") return true;
  if (lower === "placeholder.png" || lower === "license.png") return true;
  if (lower.startsWith("thumbnail.") || lower.startsWith("branding")) return true;
  // Per-page flatten/cover snapshots are deliberate full-page renders.
  if (/^page-\d+\.jpg$/.test(lower)) return true;
  // Decorative icons / logos (matches the EPUB front-end's isDecorativeImage vocabulary).
  if (/^(i-\d|logo|sc\.)/.test(lower)) return true;
  return false;
}

function isTrimCandidate(filename: string): boolean {
  if (!IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase())) return false;
  return !isExcluded(filename);
}

/**
 * Trim white edges off every illustration image in `bookFolder`, in place. Returns a
 * count of how many images were trimmed vs. left unchanged (for logging/tests).
 */
export async function trimWhitespaceInBookFolder(
  bookFolder: string,
): Promise<{ trimmed: number; unchanged: number }> {
  let trimmed = 0;
  let unchanged = 0;

  let entries: string[];
  try {
    entries = await fs.readdir(bookFolder);
  } catch (error) {
    logger.warn(`Trim whitespace: could not read book folder ${bookFolder}: ${String(error)}`);
    return { trimmed, unchanged };
  }

  for (const name of entries) {
    if (!isTrimCandidate(name)) continue;
    const filePath = path.join(bookFolder, name);
    try {
      const input = await fs.readFile(filePath);
      const before = await sharp(input).metadata();
      const output = await sharp(input)
        .trim({ background: TRIM_BACKGROUND, threshold: TRIM_THRESHOLD })
        .toBuffer({ resolveWithObject: true });

      const { width: newW, height: newH } = output.info;
      // Nothing to trim (no uniform border) — sharp returns the original dimensions.
      if (before.width === newW && before.height === newH) {
        unchanged++;
        continue;
      }
      // Guard against a near-blank image trimming down to a sliver.
      if (newW < MIN_TRIMMED_PX || newH < MIN_TRIMMED_PX) {
        logger.warn(
          `Trim whitespace: skipping ${name} (would shrink to ${newW}×${newH}, likely near-blank).`,
        );
        unchanged++;
        continue;
      }

      await fs.writeFile(filePath, output.data);
      trimmed++;
      logger.verbose(
        `Trim whitespace: ${name} ${before.width}×${before.height} → ${newW}×${newH}.`,
      );
    } catch (error) {
      logger.warn(`Trim whitespace: could not trim ${name}: ${String(error)}`);
      unchanged++;
    }
  }

  if (trimmed) logger.info(`Trimmed whitespace from ${trimmed} image(s) in the book folder.`);
  return { trimmed, unchanged };
}
