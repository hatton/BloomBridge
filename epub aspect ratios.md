# EPUB page aspect ratios — notes & open questions

Working notes from the 2026-06-07 change that forced EPUB imports to a 16:9 device
page (`Device16x9Portrait` / `Device16x9Landscape`). Captures what we learned, the
cropping problem it surfaced, the current decision, and what we may want to do later.

## The problem we hit

We changed `orientationFromAspects` (in
[epubToBloomMarkdown.ts](packages/lib/src/epub/epubToBloomMarkdown.ts)) so every EPUB
is sized as a 16:9 device page instead of A5. Immediately, illustrations lost large
strips — e.g. the bottom flower band and the dog on a StoryWeaver page were cut off.

Two distinct causes:

1. **Stale A5 table in the GUI preview.** The paired-preview component had its own copy
   of the page-dimensions table ([panels.tsx `PAGE_DIMS_MM`](packages/gui/src/components/panels.tsx))
   that lacked `Device16x9`, so a device page fell back to A5's 1.41 aspect when sizing
   the preview box. Fixed by adding the `Device16x9` entry (mirrors html-generator's
   `pagePx`). _Lesson: there are **two** page-dimension tables — lib and GUI — keep them
   in sync._

2. **`object-fit: cover` against a mismatched aspect (the real issue).** The full-bleed
   canvas image used `bloom-imageObjectFit-cover`, which scales the art to _fill_ the page
   and crops the overflow. The artwork is ~1.4; the device page is 1.78. Cover therefore
   crops ~21% off the top+bottom (≈10% each edge) — exactly the lost flowers/dog. This
   happens in Bloom itself, not just the preview.

## The key data: Pratham/StoryWeaver landscape art is ~1.41 (A-series), not 16:9

Measured the dominant (median) illustration aspect across our corpus:

| Book (source)                                  | Main illustration | Aspect             |
| ---------------------------------------------- | ----------------- | ------------------ |
| 317894 paahaacha (StoryWeaver / Pratham, Odia) | 959×687           | 1.396              |
| 4811 Why Rat and Cat (StoryWeaver)             | 1200×849 (×11)    | **1.413**          |
| 4800 Angie Visits the Volcano (StoryWeaver)    | 1200×849 (×7)     | **1.413**          |
| cole-voyage-of-life                            | mixed             | 1.33 / 1.47 / 0.80 |
| alice-gutenberg (novel)                        | 800×1104          | 0.725 (portrait)   |

The StoryWeaver/Pratham **landscape** picture books cluster tightly on **√2 ≈ 1.414**
— i.e. **A-series Landscape (A5Landscape / A4Landscape)**. Their **portrait** art shows up
as ~0.70 (= A-series portrait). So Bloom's existing A-series sizes already match Pratham
artwork almost exactly; `Device16x9` does not.

Caveat — it's **not** a single universal ratio:

- The **cover** of paahaacha is 959×457 = **2.098** (a wide panorama spread), and
  StoryWeaver's published illustration guideline is **11.17″ × 5.35″ ≈ 2.09** — a
  double-spread template, not the per-page ratio.
- `cole-voyage-of-life` (a non-Pratham book) is all over the place (1.33–1.47, plus
  portraits). So "~1.41" is a strong tendency for **Pratham/StoryWeaver landscape readers**,
  not a guarantee for arbitrary EPUBs.

### These are reflowable EPUBs, not fixed-layout

Worth correcting a premise: the StoryWeaver EPUBs we handle are **reflowable**, not
fixed-layout (FXL). The OPF has no `rendition:layout=pre-paginated` and no viewport; the
XHTML positions content in percentages (`viewbox="0 0 100 100"`, image at
`width:100%;height:100%`). So the EPUB itself declares **no page geometry** — the only
aspect signal is the **intrinsic size of the illustration files** (which is why
`orientationFromAspects` reads the artwork). A true FXL EPUB _would_ carry a viewport
(e.g. `<meta name="viewport" content="width=1200, height=849">`); if we start importing
those, read the viewport directly instead of inferring from images.

## What Bloom Reader actually does on a phone

From Bloom docs: _"most phones have a 16×9 aspect ratio, Bloom Reader will resize
BloomPUBs to conform to a 'Device 16x9' size,"_ **but** _"if you create a comic book with
A5 size … the A5 orientation is maintained rather than switching to 16x9."_ So Bloom
Reader already adapts a non-16:9 page to the phone at **display** time (letterboxing /
fitting), while preserving the authored aspect. This means authoring at the **artwork's
true aspect** (A5Landscape for Pratham) is not penalised on phones — Bloom handles the
device fit — and it stays correct in the Bloom editor and in print/PDF.

Bloom's current page-size list (from our regexes in `engine.ts`/`apiPlugin.ts`):
`A3, A4, A5, A6, Letter, Legal, Device16x9, HalfLetter, QuarterLetter` × `Portrait/Landscape`.
Note A-series **is** √2 ≈ 1.414, so **no new Bloom size is needed to match ~1.41 art** —
`A5Landscape`/`A4Landscape` already are that ratio.

## Current decision (2026-06-07)

- Always size EPUBs as `Device16x9Portrait` / `Device16x9Landscape` (orientation from the
  median illustration aspect, threshold 1.15).
- For full-bleed canvas images on a **device** page, use Bloom's default `object-fit:
contain` instead of `cover` (see `fullBleedImageClass` in
  [html-generator.ts](packages/lib/src/4-generate-html/html-generator.ts)) — the **whole**
  illustration stays visible, with the page background filling the aspect gap (pillarbox
  bars). Print sizes (PDF flow) keep `cover` for a true full bleed.

Result: nothing is cropped, but ~1.4 art on a 1.78 page shows side bars.

## Options for the future (in rough order of preference)

1. **Size the page to the artwork aspect instead of forcing 16:9.** For Pratham landscape
   readers this means `A5Landscape` (1.41) — a near-perfect fit: no crop _and_ no bars,
   and Bloom Reader still adapts it to the phone. This is the most faithful result and
   reverses the "always Device16x9" rule. Could be a heuristic: snap the measured median
   aspect to the closest Bloom size (≈1.41 → A-series Landscape; ≈1.78 → Device16x9;
   ≈0.71 → A-series Portrait; ≈0.56 → Device16x9Portrait).
2. **Keep Device16x9 but make the fit configurable** (`contain` vs `cover`) per book or
   via a CLI flag, so a user can choose "show all (bars)" vs "fill (crop)".
3. **Add a Bloom page size only if a real Pratham ratio isn't already covered.** A-series
   already gives 1.414, so this is likely unnecessary for landscape. Revisit only if we
   confirm a distinct, common ratio (e.g. the ~2.09 spread format) that no existing size
   matches — and that's a layout/spread question, not a single-page size.
4. **Handle the wide cover (≈2.09) separately** from interior pages — its aspect differs
   from the body, so a single book-level page size can't fit both the cover spread and the
   1.4 interior without compromise.

## Verify-anytime checklist

- Reconvert a StoryWeaver book; confirm interior canvas `<img>` has no
  `bloom-imageObjectFit-cover` (→ contain) on a `Device16x9*` page.
- Open the paired preview; the Bloom page box should be 16:9 (not A5-shaped) and the
  whole illustration visible.
- Render in real Bloom (CDP harness, see `verify-bloom-page-render-via-cdp` memory) to
  confirm no cropping after Bloom recomputes canvas geometry.

## Sources

- StoryWeaver FAQ / illustration guidance: <https://storyweaver.org.in/en/faqs>,
  <https://storyweaver.org.in/blog_posts/84> (Spotathon: 11.17″ × 5.35″ template ≈ 2.09)
- Bloom docs — Reader resizes to Device16x9 on phones, preserves A5:
  <https://docs.bloomlibrary.org/about-bloom-reader/>,
  <https://docs.bloomlibrary.org/older-release-notes/>
- Measured artwork aspects: this repo's `large-local-test-inputs/` corpus (see table).
