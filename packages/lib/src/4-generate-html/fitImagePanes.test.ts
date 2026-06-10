import { describe, it, expect } from "vite-plus/test";
import { computeImagePaneSharePct, estimateTextHeightPx } from "./fitImagePanes";

// A5Portrait marginBox at 96dpi (see HtmlGenerator.pagePx): ~468 × 703 px.
const W = 468;
const H = 703;

const SHORT = "Once upon a time.";
// ~5 lines at this canvas width (charsPerLine ≈ 44).
const MEDIUM = "x".repeat(220);
const LONG = "y".repeat(2000);

describe("computeImagePaneSharePct", () => {
  it("grows the pane for a portrait image + short text", () => {
    const pct = computeImagePaneSharePct({
      imageAspect: 0.7,
      canvasW: W,
      canvasH: H,
      texts: { en: SHORT },
    });
    expect(pct).not.toBeNull();
    expect(pct!).toBeGreaterThanOrEqual(65);
    expect(pct!).toBeLessThanOrEqual(75);
  });

  it("returns null for a wide image (nothing gained from a taller pane)", () => {
    const pct = computeImagePaneSharePct({
      imageAspect: 2,
      canvasW: W,
      canvasH: H,
      texts: { en: SHORT },
    });
    expect(pct).toBeNull();
  });

  it("returns null when the text is long (would overflow)", () => {
    const pct = computeImagePaneSharePct({
      imageAspect: 0.7,
      canvasW: W,
      canvasH: H,
      texts: { en: LONG },
    });
    expect(pct).toBeNull();
  });

  it("clamps the pane by the text estimate for medium text", () => {
    const short = computeImagePaneSharePct({
      imageAspect: 0.7,
      canvasW: W,
      canvasH: H,
      texts: { en: SHORT },
    })!;
    const medium = computeImagePaneSharePct({
      imageAspect: 0.7,
      canvasW: W,
      canvasH: H,
      texts: { en: MEDIUM },
    });
    expect(medium).not.toBeNull();
    expect(medium!).toBeGreaterThan(56);
    expect(medium!).toBeLessThan(short); // more text → less room for the image
  });

  it("sums across languages (bilingual leaves less room than monolingual)", () => {
    const mono = computeImagePaneSharePct({
      imageAspect: 0.7,
      canvasW: W,
      canvasH: H,
      texts: { en: MEDIUM },
    })!;
    const bi = computeImagePaneSharePct({
      imageAspect: 0.7,
      canvasW: W,
      canvasH: H,
      texts: { en: MEDIUM, fr: MEDIUM },
    });
    // Either it shrank the image pane, or it gave up entirely (null).
    if (bi !== null) expect(bi).toBeLessThan(mono);
  });

  it("returns null for unreadable/degenerate inputs", () => {
    expect(
      computeImagePaneSharePct({ imageAspect: 0, canvasW: W, canvasH: H, texts: { en: SHORT } }),
    ).toBeNull();
    expect(
      computeImagePaneSharePct({ imageAspect: 0.7, canvasW: 0, canvasH: H, texts: { en: SHORT } }),
    ).toBeNull();
  });
});

describe("estimateTextHeightPx", () => {
  it("grows with paragraph count", () => {
    const one = estimateTextHeightPx({ en: "hello world" }, W);
    const three = estimateTextHeightPx({ en: "a\n\nb\n\nc" }, W);
    expect(three).toBeGreaterThan(one);
  });
  it("sums languages", () => {
    const one = estimateTextHeightPx({ en: MEDIUM }, W);
    const two = estimateTextHeightPx({ en: MEDIUM, fr: MEDIUM }, W);
    expect(two).toBeGreaterThan(one);
  });
});
