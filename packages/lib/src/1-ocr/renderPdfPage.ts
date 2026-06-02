import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { logger } from "../logger";
import { runPopplerTool } from "./poppler";

/**
 * Render a single PDF page to a flat raster image using Poppler's `pdftocairo`.
 *
 * Unlike `pdfimages` (which extracts the embedded image objects), this composites
 * everything on the page — background art, overlaid logos/badges, and text — into
 * one image. That is what we want for a full-page-art cover: a faithful snapshot
 * of the page as designed.
 *
 * `pdftocairo` writes `<prefix>-<NN>.jpg`, zero-padding the page number to the
 * width of the document's page count, so we render into a temp dir and then copy
 * the single produced file to `outputPath`.
 */
export async function renderPdfPageToImage(
  pdfPath: string,
  pageNumber: number,
  outputPath: string,
  options: { dpi?: number } = {},
): Promise<void> {
  const dpi = options.dpi ?? 150;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdftocairo-"));

  try {
    const prefix = path.join(tempDir, "page");
    await runPopplerTool("pdftocairo", [
      "-jpeg",
      "-f",
      String(pageNumber),
      "-l",
      String(pageNumber),
      "-r",
      String(dpi),
      pdfPath,
      prefix,
    ]);

    const produced = (await fs.readdir(tempDir)).find((f) => f.toLowerCase().endsWith(".jpg"));
    if (!produced) {
      throw new Error(`pdftocairo produced no output for page ${pageNumber}`);
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    // copyFile (not rename) so this works across volumes (temp dir vs. output dir).
    await fs.copyFile(path.join(tempDir, produced), outputPath);
    logger.info(`Rendered page ${pageNumber} to ${path.basename(outputPath)} at ${dpi} dpi.`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch((error) => {
      logger.warn(`Failed to clean up temp dir ${tempDir}: ${error}`);
    });
  }
}
