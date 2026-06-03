import * as fs from "fs";
import { getDocumentProxy } from "unpdf";
import { logger } from "../logger";

export interface NormalStyle {
  /** Dominant body-text font size, in points. */
  fontSizePt?: number;
  /** Dominant body-text font family, cleaned, if one could be determined. */
  fontFamily?: string;
  /** Bloom page-size class matching the PDF page dimensions, e.g. "A4Portrait". */
  pageSize?: string;
}

/**
 * Map a PDF page's dimensions (in points) to the closest Bloom page-size class.
 * Returns undefined if it doesn't match a known size (caller keeps the default).
 */
function pageSizeClass(widthPt: number, heightPt: number): string | undefined {
  const portrait = heightPt >= widthPt;
  const long = Math.max(widthPt, heightPt);
  const short = Math.min(widthPt, heightPt);
  // Standard sizes by [long, short] edge in points (1pt = 1/72").
  const sizes: { name: string; long: number; short: number }[] = [
    { name: "A3", long: 1191, short: 842 },
    { name: "A4", long: 842, short: 595 },
    { name: "A5", long: 595, short: 420 },
    { name: "A6", long: 420, short: 298 },
    { name: "Letter", long: 792, short: 612 },
    { name: "Legal", long: 1008, short: 612 },
  ];
  const match = sizes.find((s) => Math.abs(long - s.long) < 30 && Math.abs(short - s.short) < 30);
  if (!match) return undefined;
  // Bloom's class names: A-series use "<name>Portrait"/"<name>Landscape"; Letter/Legal
  // use the bare name for portrait and "<name>Landscape" for landscape.
  if (match.name === "Letter" || match.name === "Legal") {
    return portrait ? match.name : `${match.name}Landscape`;
  }
  return `${match.name}${portrait ? "Portrait" : "Landscape"}`;
}

/**
 * pdfjs reports embedded/subsetted font names that aren't usable as a CSS family
 * (e.g. "ABCDEE+Calibri", "g_d0_f1", "sans-serif"). Strip the subset prefix and
 * reject internal ids / pure generics. Bloom tolerates a family it doesn't have
 * installed (it falls back), so a clean real-looking name is worth emitting.
 */
function cleanFontFamily(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let name = raw.replace(/^["']|["']$/g, "").trim();
  // Drop a 6-uppercase-letter subset prefix, e.g. "ABCDEE+Calibri" -> "Calibri".
  name = name.replace(/^[A-Z]{6}\+/, "");
  // pdfjs sometimes appends a generic fallback: "Calibri, sans-serif" -> "Calibri".
  name = name.split(",")[0].trim();
  if (!name) return undefined;
  const lower = name.toLowerCase();
  if (lower === "sans-serif" || lower === "serif" || lower === "monospace") return undefined;
  // Internal pdfjs ids like g_d0_f1 / f1 / a0.
  if (/^[a-z]?_?d?\d/.test(lower) || /^[a-z]\d+$/.test(lower)) return undefined;
  return name;
}

/**
 * Inspect the source PDF and determine the dominant body-text style — the font
 * size (pt) and family used by the bulk of the running text. We weight every text
 * run by its character count, so the long interior body text dominates over the
 * shorter front-matter / heading text. No API cost (local pdfjs via unpdf).
 *
 * Returns {} if the PDF has no extractable text layer (e.g. scanned images).
 */
export async function detectNormalStyle(pdfPath: string): Promise<NormalStyle> {
  try {
    const pdfBuffer = new Uint8Array(fs.readFileSync(pdfPath));
    // Use unpdf's bundled, worker-less pdfjs (no definePDFJSModule) — we only need
    // text content + font styles, and this avoids pdf.worker setup issues in dist.
    const pdf = await getDocumentProxy(pdfBuffer);

    // size(pt) -> total chars ; family -> total chars
    const sizeWeight = new Map<number, number>();
    const familyWeight = new Map<string, number>();
    let pageSize: string | undefined;

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      if (p === 1) {
        const vp = page.getViewport({ scale: 1 });
        pageSize = pageSizeClass(vp.width, vp.height);
      }
      const textContent = await page.getTextContent();
      const styles = (textContent as any).styles || {};
      for (const item of textContent.items as any[]) {
        if (!("str" in item) || !item.str || !item.str.trim()) continue;
        const chars = item.str.trim().length;

        // Font size in pt: the vertical scale of the text transform.
        const t = item.transform;
        if (t) {
          const size = Math.round(Math.hypot(t[2], t[3]));
          if (size > 0 && size < 200) {
            sizeWeight.set(size, (sizeWeight.get(size) || 0) + chars);
          }
        }

        const family = cleanFontFamily(styles[item.fontName]?.fontFamily);
        if (family) {
          familyWeight.set(family, (familyWeight.get(family) || 0) + chars);
        }
      }
    }

    const dominant = (m: Map<any, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    const result: NormalStyle = {
      fontSizePt: dominant(sizeWeight),
      fontFamily: dominant(familyWeight),
      pageSize,
    };
    logger.info(
      `Detected normal style: size=${result.fontSizePt ?? "?"}pt family=${result.fontFamily ?? "?"} pageSize=${result.pageSize ?? "?"}`,
    );
    return result;
  } catch (error) {
    logger.warn(`Could not detect normal style from PDF: ${error}`);
    return {};
  }
}
