import { logger } from "../logger";
import { runPopplerTool } from "./poppler";

/**
 * Detecting "full-page art" pages (covers, full-bleed illustrations).
 *
 * Some books have covers (and interior pages) that are a single full-bleed
 * illustration. To reproduce these faithfully we want to capture the whole page
 * as one rendered image rather than relying on OCR, which only extracts the
 * overlaid text (and, for some engines, a downscaled thumbnail of the art).
 *
 * The reliable signal is geometric: does an embedded image cover (nearly) the
 * whole page? We get the page size from `pdfinfo` and each embedded image's
 * displayed size from `pdfimages -list` (pixel dimensions ÷ effective ppi), then
 * compare areas. This is far more robust than looking for a PDF BleedBox, which
 * many digital-first books lack and which doesn't distinguish art from a mostly
 * blank page.
 */

export interface PdfPageInfo {
  pageCount: number;
  // Size of the first page in points (1/72 inch). We assume a uniform page size,
  // which holds for the books this tool targets.
  widthPt: number;
  heightPt: number;
}

/**
 * Get the page count and (first) page size of a PDF via `pdfinfo`.
 */
export async function getPdfPageInfo(pdfPath: string): Promise<PdfPageInfo> {
  const out = await runPopplerTool("pdfinfo", [pdfPath]);

  const pageCountMatch = out.match(/^Pages:\s+(\d+)/m);
  const pageSizeMatch = out.match(/^Page size:\s+([\d.]+)\s*x\s*([\d.]+)\s*pts/m);

  if (!pageCountMatch || !pageSizeMatch) {
    throw new Error(`Could not parse pdfinfo output:\n${out}`);
  }

  return {
    pageCount: parseInt(pageCountMatch[1], 10),
    widthPt: parseFloat(pageSizeMatch[1]),
    heightPt: parseFloat(pageSizeMatch[2]),
  };
}

interface ListedImage {
  page: number;
  type: string; // "image" or "smask"
  width: number; // pixels
  height: number; // pixels
  xppi: number;
  yppi: number;
}

function parsePdfImagesList(listOutput: string): ListedImage[] {
  const lines = listOutput.trim().split("\n");
  const images: ListedImage[] = [];

  // Columns: page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio
  for (let i = 2; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length < 14) continue;

    const page = parseInt(parts[0], 10);
    const type = parts[2];
    const width = parseInt(parts[3], 10);
    const height = parseInt(parts[4], 10);
    const xppi = parseFloat(parts[12]);
    const yppi = parseFloat(parts[13]);

    if (!isNaN(page) && !isNaN(width) && !isNaN(height) && xppi > 0 && yppi > 0) {
      images.push({ page, type, width, height, xppi, yppi });
    }
  }

  return images;
}

/**
 * Returns the fraction (0..1+) of the given page covered by its largest embedded
 * image, based on the image's displayed (not pixel) size. A value ≥ ~0.85 means
 * the page is dominated by a single full-bleed image. Values can slightly exceed
 * 1.0 when the art bleeds past the trim edge.
 */
export async function getLargestImageCoverage(
  pdfPath: string,
  pageNumber: number,
  pageInfo: PdfPageInfo,
): Promise<number> {
  const listOutput = await runPopplerTool("pdfimages", ["-list", pdfPath]);
  const images = parsePdfImagesList(listOutput).filter(
    (img) => img.page === pageNumber && img.type === "image",
  );

  if (images.length === 0) return 0;

  const pageAreaInches = (pageInfo.widthPt / 72) * (pageInfo.heightPt / 72);
  if (pageAreaInches <= 0) return 0;

  let maxCoverage = 0;
  for (const img of images) {
    const displayedAreaInches = (img.width / img.xppi) * (img.height / img.yppi);
    maxCoverage = Math.max(maxCoverage, displayedAreaInches / pageAreaInches);
  }
  return maxCoverage;
}

/**
 * Find the page's largest embedded image (by displayed area) and return its 1-based
 * index *as `extractImagesWithPdfImages` would name it* — i.e. counting only non-smask
 * images in `pdfimages -list` order, so the result maps to `image-<page>-<index>.png`.
 * Also returns that image's coverage fraction. Returns null if the page has no
 * extractable image. Used to record the full-page background of a Canvas page so the
 * picture survives even when the OCR/LLM didn't emit an `![image]` ref for it.
 */
export async function getLargestImageOnPage(
  pdfPath: string,
  pageNumber: number,
  pageInfo: PdfPageInfo,
): Promise<{ imageIndex: number; coverage: number } | null> {
  const listOutput = await runPopplerTool("pdfimages", ["-list", pdfPath]);
  const onPage = parsePdfImagesList(listOutput).filter((img) => img.page === pageNumber);

  const pageAreaInches = (pageInfo.widthPt / 72) * (pageInfo.heightPt / 72);
  if (pageAreaInches <= 0) return null;

  let best: { imageIndex: number; coverage: number } | null = null;
  let indexOnPage = 0; // mirrors pdfToImages: 1-based, smask entries skipped
  for (const img of onPage) {
    if (img.type === "smask") continue;
    indexOnPage += 1;
    const displayedAreaInches = (img.width / img.xppi) * (img.height / img.yppi);
    const coverage = displayedAreaInches / pageAreaInches;
    if (!best || coverage > best.coverage) {
      best = { imageIndex: indexOnPage, coverage };
    }
  }
  return best;
}

/**
 * Decide whether a page is "full-page art" — i.e. a single embedded image covers
 * at least `threshold` of the page area.
 */
export async function isFullPageArtPage(
  pdfPath: string,
  pageNumber: number,
  pageInfo: PdfPageInfo,
  threshold = 0.85,
): Promise<boolean> {
  const coverage = await getLargestImageCoverage(pdfPath, pageNumber, pageInfo);
  logger.info(
    `Page ${pageNumber}: largest image covers ${(coverage * 100).toFixed(0)}% of the page` +
      ` (full-page-art threshold ${(threshold * 100).toFixed(0)}%).`,
  );
  return coverage >= threshold;
}
