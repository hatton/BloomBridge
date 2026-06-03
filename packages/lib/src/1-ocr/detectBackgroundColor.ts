import sharp from "sharp";
import * as path from "path";
import { logger } from "../logger";

/**
 * Decide whether a rendered page has a flat, solid background color and, if so,
 * return it as a hex string. We sample a frame of pixels around the page edge: a
 * true solid background (e.g. a page filled blue/yellow with content on top) is
 * uniform around the border, whereas a full-page illustration has varied edges
 * and a plain page reads as white (which we treat as "no background"). This is
 * deterministic — far more reliable than asking a vision model for a "dominant"
 * color, which returned the average color of illustrations.
 *
 * Used for two things: solid-background pages (vision-formatting) and canvas pages,
 * where the page background fills the page margin so the full-bleed art doesn't
 * leave an ugly white border around the marginBox.
 */
export async function detectSolidBackgroundColor(jpgPath: string): Promise<string | undefined> {
  try {
    const { data, info } = await sharp(jpgPath).raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: c } = info;
    if (w < 10 || h < 10) return undefined;
    const at = (x: number, y: number) => {
      const i = (y * w + x) * c;
      return [data[i], data[i + 1], data[i + 2]] as [number, number, number];
    };
    const inset = Math.max(2, Math.round(Math.min(w, h) * 0.02));
    const step = Math.max(1, Math.floor(w / 40));
    const samples: [number, number, number][] = [];
    for (let x = inset; x < w - inset; x += step) {
      samples.push(at(x, inset), at(x, h - 1 - inset));
    }
    for (let y = inset; y < h - inset; y += step) {
      samples.push(at(inset, y), at(w - 1 - inset, y));
    }
    if (samples.length === 0) return undefined;
    const median = ([0, 1, 2] as const).map((ch) => {
      const sorted = samples.map((s) => s[ch]).sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    }) as [number, number, number];
    // Fraction of border samples close to the median (tolerant of JPG noise).
    const within =
      samples.filter(
        (s) => Math.max(...([0, 1, 2] as const).map((ch) => Math.abs(s[ch] - median[ch]))) <= 24,
      ).length / samples.length;
    const nearWhite = median[0] > 235 && median[1] > 235 && median[2] > 235;
    if (within < 0.85 || nearWhite) return undefined; // not a uniform, non-white border
    return "#" + median.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  } catch (error) {
    logger.warn(`Background-color sampling failed for ${path.basename(jpgPath)}: ${error}`);
    return undefined;
  }
}
