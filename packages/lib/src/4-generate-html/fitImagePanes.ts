/**
 * "Fit image panes" heuristic (Stage 4).
 *
 * When a content page is a single illustration above a single text block, Bloom's
 * default origami split is an even 50/50. For a PORTRAIT illustration with only a few
 * lines of text that wastes a large empty band below the text while the artwork stays
 * small. This pure function picks a better INITIAL split: it grows the image pane only
 * when the image's shape benefits (a wide image already touching both page edges at 50%
 * gains nothing from a taller pane) AND the text clearly still fits.
 *
 * The governing constraint is **never cause text overflow**: overflowing text forces a
 * human to review every page, whereas wasted space is only a quality ding. So the text
 * estimate is biased hard toward over-estimating (SAFETY + PAD_PX, summing every
 * language present), and when in doubt the function returns null (leave it at 50/50).
 *
 * Returns the integer percentage the IMAGE pane should occupy, or null when the splitter
 * should be left at Bloom's default. See `fit-image-panes-plan.md` (§3) for the model.
 */

/** ≈16pt default Bloom text at 96dpi; collections often go bigger — SAFETY absorbs some. */
export const FONT_PX = 21;
/** line-height em multiplier */
export const LINE_HEIGHT = 1.6;
/** average character advance as a fraction of the font size */
export const AVG_CHAR_EM = 0.5;
/** multiplier on the whole text estimate (conservative bias) */
export const SAFETY = 1.4;
/** translationGroup padding/margins allowance, in px */
export const PAD_PX = 24;
/** the text pane is never sized below this fraction of the canvas height */
export const MIN_TEXT_FRAC = 0.25;
/** the image pane is never sized above this fraction of the canvas height */
export const MAX_IMAGE_FRAC = 0.75;
/** don't move the splitter for less than this many points of gain over 50% */
export const MIN_GAIN = 0.06;

/**
 * Estimate the rendered height in px of a text block (all languages present summed).
 * Summing rather than max'ing is deliberate: at conversion time we can't know whether
 * the collection will display the book monolingually or bilingually, so we assume the
 * worst (both shown). Each paragraph wraps to `ceil(chars / charsPerLine)` lines.
 */
export function estimateTextHeightPx(texts: Record<string, string>, canvasW: number): number {
  const charsPerLine = Math.max(1, Math.floor(canvasW / (FONT_PX * AVG_CHAR_EM)));
  let totalLines = 0;
  for (const text of Object.values(texts)) {
    if (!text) continue;
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const para of paragraphs) {
      totalLines += Math.max(1, Math.ceil(para.length / charsPerLine));
    }
  }
  if (totalLines === 0) return PAD_PX;
  return totalLines * FONT_PX * LINE_HEIGHT * SAFETY + PAD_PX;
}

export function computeImagePaneSharePct(args: {
  /** w/h of the trimmed image */
  imageAspect: number;
  canvasW: number;
  canvasH: number;
  /** the text block's per-language markdown */
  texts: Record<string, string>;
}): number | null {
  const { imageAspect, canvasW, canvasH, texts } = args;
  if (!(imageAspect > 0) || !(canvasW > 0) || !(canvasH > 0)) return null;

  // Pane-height fraction at which the (full-width) image touches both page edges.
  // A wide image is short at full width, so this is small and the page gains nothing
  // from a taller pane → we'll return null below.
  const usefulFrac = canvasW / imageAspect / canvasH;

  const textFrac = Math.max(estimateTextHeightPx(texts, canvasW) / canvasH, MIN_TEXT_FRAC);
  const imageFrac = Math.min(usefulFrac, MAX_IMAGE_FRAC, 1 - textFrac);

  // Not worth moving, or can't safely move (text needs more than half the page).
  if (imageFrac < 0.5 + MIN_GAIN) return null;

  return Math.floor(imageFrac * 100);
}
