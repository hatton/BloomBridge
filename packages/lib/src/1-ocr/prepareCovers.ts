import * as path from "path";
import { logger } from "../logger";
import { BACK_COVER_IMAGE_FILENAME, FRONT_COVER_IMAGE_FILENAME } from "../types";
import { getPdfPageInfo, isFullPageArtPage } from "./coverDetection";
import { renderPdfPageToImage } from "./renderPdfPage";

/**
 * How to treat full-page-art covers:
 * - "auto": render the front/back cover to an image only when detection finds a
 *   full-bleed image covering the page.
 * - "render": always render the front/back cover pages to images.
 * - "none": never render; leave covers to OCR / Bloom's default xMatter.
 */
export type CoverMode = "auto" | "render" | "none";

const COVER_DPI = 150;

/**
 * Insert a markdown image reference immediately after the `<!-- page index=N -->`
 * comment for the given page, so it becomes the first element on that page.
 * Returns the markdown unchanged if the page comment isn't found.
 */
function injectImageAtTopOfPage(markdown: string, pageIndex: number, imageFile: string): string {
  const pageComment = new RegExp(`(<!--\\s*page\\s+index=${pageIndex}\\b[^>]*-->)`);
  if (!pageComment.test(markdown)) {
    logger.warn(`Could not find page index=${pageIndex} to inject cover image "${imageFile}".`);
    return markdown;
  }
  return markdown.replace(pageComment, `$1\n\n![${imageFile}](${imageFile})`);
}

/**
 * Detect and render full-page-art covers for a PDF, writing the rendered images
 * into the book folder and wiring the front cover into the markdown so the rest
 * of the pipeline (and Bloom) treats it as the cover image.
 *
 * This runs during the PDF stage (the only stage with the PDF in hand). The
 * resulting `cover.jpg` and the injected markdown reference are persisted in the
 * `.ocr.md`, so later runs that start from the markdown don't need the PDF — and
 * don't re-run OCR.
 *
 * Returns the (possibly modified) markdown.
 */
export async function prepareCovers(
  pdfPath: string,
  markdown: string,
  bookFolderPath: string,
  mode: CoverMode,
): Promise<string> {
  if (mode === "none") {
    logger.info("Cover mode is 'none'; skipping full-page cover rendering.");
    return markdown;
  }

  let pageInfo;
  try {
    pageInfo = await getPdfPageInfo(pdfPath);
  } catch (error) {
    logger.warn(`Could not read PDF page info for cover detection: ${error}`);
    return markdown;
  }

  const force = mode === "render";

  // Front cover = first page; back cover = last page.
  const targets: Array<{ page: number; file: string; label: string }> = [
    { page: 1, file: FRONT_COVER_IMAGE_FILENAME, label: "front cover" },
  ];
  if (pageInfo.pageCount > 1) {
    targets.push({
      page: pageInfo.pageCount,
      file: BACK_COVER_IMAGE_FILENAME,
      label: "back cover",
    });
  }

  let result = markdown;
  for (const target of targets) {
    const isFullArt = force || (await isFullPageArtPage(pdfPath, target.page, pageInfo));
    if (!isFullArt) {
      logger.info(
        `${target.label} (page ${target.page}) is not full-page art; leaving to xMatter.`,
      );
      continue;
    }

    try {
      await renderPdfPageToImage(pdfPath, target.page, path.join(bookFolderPath, target.file), {
        dpi: COVER_DPI,
      });
      logger.info(`Captured ${target.label} as "${target.file}".`);
      result = injectImageAtTopOfPage(result, target.page, target.file);
    } catch (error) {
      logger.warn(`Failed to render ${target.label} (page ${target.page}): ${error}`);
    }
  }

  return result;
}
