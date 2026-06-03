import * as fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import { getDocumentProxy } from "unpdf";
import { logger } from "../logger";
import { getPdfPageInfo, isFullPageArtPage } from "./coverDetection";
import { renderPdfPageToImage } from "./renderPdfPage";
import { detectSolidBackgroundColor } from "./detectBackgroundColor";

export interface TextBoxFraction {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanvasPageInfo extends TextBoxFraction {
  /**
   * A solid page background color (hex), if the full-bleed art sits on a uniform
   * background. Set on the page so Bloom fills the page margin with it — otherwise
   * the canvas art (which fills only the marginBox) leaves a white border.
   */
  backgroundColor?: string;
  /**
   * One box per visually-separated text block (clustered by vertical gaps), in
   * reading order. A canvas page can carry several text chunks (e.g. a heading plus
   * a list of discussion questions); each is positioned independently. The outer
   * `{x,y,w,h}` remains the union of all blocks.
   */
  textBoxes: TextBoxFraction[];
}

/** A text item's box in top-down pixel coordinates. */
interface ItemBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  h: number;
}

/** Cluster text items into vertical blocks separated by gaps larger than a line. */
function clusterIntoBlocks(items: ItemBox[]): ItemBox[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.top - b.top || a.left - b.left);
  const heights = sorted.map((i) => i.h).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 0;
  const gapThreshold = 1.6 * medianH; // merge lines within a block; split between blocks
  const blocks: ItemBox[] = [];
  for (const it of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && it.top - last.bottom <= gapThreshold) {
      last.left = Math.min(last.left, it.left);
      last.right = Math.max(last.right, it.right);
      last.top = Math.min(last.top, it.top);
      last.bottom = Math.max(last.bottom, it.bottom);
      last.h = Math.max(last.h, it.h);
    } else {
      blocks.push({ ...it });
    }
  }
  return blocks;
}

/**
 * Detect "canvas" pages: interior pages that are a full-page background image with
 * a block of text floating on top (e.g. a picture-book scene with a caption). For
 * each such page we return where the text sits, as a fraction of the page
 * (origin top-left), read from the PDF's text layer via pdfjs.
 *
 * Front/back covers (first and last page) are excluded — those are handled as
 * full-bleed cover pages. Pages with no full-page image, or no body text, are
 * skipped (they stay normal origami pages).
 */
export async function detectCanvasPages(pdfPath: string): Promise<Map<number, CanvasPageInfo>> {
  const result = new Map<number, CanvasPageInfo>();
  let pageInfo;
  try {
    pageInfo = await getPdfPageInfo(pdfPath);
  } catch (error) {
    logger.warn(`Canvas detection: could not read PDF page info: ${error}`);
    return result;
  }

  let pdf;
  try {
    const buf = new Uint8Array(fs.readFileSync(pdfPath));
    pdf = await getDocumentProxy(buf);
  } catch (error) {
    logger.warn(`Canvas detection: could not open PDF with pdfjs: ${error}`);
    return result;
  }

  // Temp dir for rendering canvas pages to sample their background color.
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "canvas-bg-"));
  try {
    for (let p = 2; p < pageInfo.pageCount; p++) {
      // (skip page 1 and the last page — those are covers)
      try {
        const page = await pdf.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const pageW = vp.width;
        const pageH = vp.height;
        const tc = await page.getTextContent();

        // Collect each text item's box (PDF origin is bottom-left → convert to
        // top-down). Exclude pure-numeric items (page numbers) and empty strings.
        const items: ItemBox[] = [];
        for (const it of tc.items as any[]) {
          if (!("str" in it) || !it.str.trim()) continue;
          if (/^\d+$/.test(it.str.trim())) continue; // page number
          const x = it.transform[4];
          const yBottom = it.transform[5];
          const w = it.width || 0;
          const h = it.height || Math.hypot(it.transform[2], it.transform[3]);
          items.push({
            left: x,
            right: x + w,
            top: pageH - (yBottom + h),
            bottom: pageH - yBottom,
            h,
          });
        }
        if (items.length === 0) continue;

        // Only treat it as a canvas page if a single image covers (most of) the page.
        if (!(await isFullPageArtPage(pdfPath, p, pageInfo))) continue;

        const clamp = (v: number) => Math.max(0, Math.min(1, v));
        const round3 = (v: number) => Math.round(v * 1000) / 1000;
        const toBox = (b: ItemBox): TextBoxFraction => ({
          x: round3(clamp(b.left / pageW)),
          y: round3(clamp(b.top / pageH)),
          w: round3(clamp((b.right - b.left) / pageW)),
          h: round3(clamp((b.bottom - b.top) / pageH)),
        });

        const blocks = clusterIntoBlocks(items);
        const textBoxes = blocks.map(toBox);
        const union: ItemBox = {
          left: Math.min(...blocks.map((b) => b.left)),
          right: Math.max(...blocks.map((b) => b.right)),
          top: Math.min(...blocks.map((b) => b.top)),
          bottom: Math.max(...blocks.map((b) => b.bottom)),
          h: 0,
        };
        const box = toBox(union);

        // Sample the page's background color so Bloom can fill the page margin with
        // it; without this the full-bleed canvas art (which fills only the marginBox)
        // leaves a white border around the page.
        let backgroundColor: string | undefined;
        try {
          const jpgPath = path.join(tempDir, `canvas-${p}.jpg`);
          await renderPdfPageToImage(pdfPath, p, jpgPath, { dpi: 100 });
          backgroundColor = await detectSolidBackgroundColor(jpgPath);
          await fsp.rm(jpgPath, { force: true }).catch(() => {});
        } catch (error) {
          logger.warn(`Canvas page ${p}: background-color sampling failed: ${error}`);
        }

        result.set(p, { ...box, backgroundColor, textBoxes });
        logger.info(
          `Canvas page ${p}: ${textBoxes.length} text block(s), union x=${box.x} y=${box.y} w=${box.w} h=${box.h}, bg=${backgroundColor ?? "none"}`,
        );
      } catch (error) {
        logger.warn(`Canvas detection failed for page ${p}: ${error}`);
      }
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
  return result;
}
