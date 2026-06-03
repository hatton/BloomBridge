import * as fs from "fs";
import { getDocumentProxy } from "unpdf";
import { logger } from "../logger";
import { getPdfPageInfo, isFullPageArtPage } from "./coverDetection";

export interface TextBoxFraction {
  x: number;
  y: number;
  w: number;
  h: number;
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
export async function detectCanvasPages(pdfPath: string): Promise<Map<number, TextBoxFraction>> {
  const result = new Map<number, TextBoxFraction>();
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

  for (let p = 2; p < pageInfo.pageCount; p++) {
    // (skip page 1 and the last page — those are covers)
    try {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const pageW = vp.width;
      const pageH = vp.height;
      const tc = await page.getTextContent();

      // Bounding box of the body text (PDF origin is bottom-left). Exclude
      // pure-numeric items (page numbers) and empty strings.
      let minX = Infinity,
        maxX = -Infinity,
        topFromBottom = -Infinity,
        bottomFromBottom = Infinity;
      let hasBody = false;
      for (const it of tc.items as any[]) {
        if (!("str" in it) || !it.str.trim()) continue;
        if (/^\d+$/.test(it.str.trim())) continue; // page number
        const x = it.transform[4];
        const yBottom = it.transform[5];
        const w = it.width || 0;
        const h = it.height || Math.hypot(it.transform[2], it.transform[3]);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x + w);
        topFromBottom = Math.max(topFromBottom, yBottom + h);
        bottomFromBottom = Math.min(bottomFromBottom, yBottom);
        hasBody = true;
      }
      if (!hasBody) continue;

      // Only treat it as a canvas page if a single image covers (most of) the page.
      if (!(await isFullPageArtPage(pdfPath, p, pageInfo))) continue;

      const left = minX;
      const top = pageH - topFromBottom;
      const width = maxX - minX;
      const height = topFromBottom - bottomFromBottom;
      const clamp = (v: number) => Math.max(0, Math.min(1, v));
      const box: TextBoxFraction = {
        x: clamp(left / pageW),
        y: clamp(top / pageH),
        w: clamp(width / pageW),
        h: clamp(height / pageH),
      };
      result.set(p, {
        x: Math.round(box.x * 1000) / 1000,
        y: Math.round(box.y * 1000) / 1000,
        w: Math.round(box.w * 1000) / 1000,
        h: Math.round(box.h * 1000) / 1000,
      });
      logger.info(
        `Canvas page ${p}: text box at x=${result.get(p)!.x} y=${result.get(p)!.y} w=${result.get(p)!.w} h=${result.get(p)!.h}`,
      );
    } catch (error) {
      logger.warn(`Canvas detection failed for page ${p}: ${error}`);
    }
  }
  return result;
}
