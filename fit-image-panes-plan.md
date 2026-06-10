# Implementation plan: auto-size the origami splitter ("Fit image panes")

> Status: **planned, not implemented**. This document is self-contained — it names every
> file, line anchor, constant, and verification step. Read `conversion-process.md` first
> for pipeline orientation. Delete this file when the feature ships.

## 1. Problem and goal

When we import a book whose content pages are an illustration above a text block (e.g.
`large-local-test-inputs/LFA Vanuatu English/A Thief In The Night - L4.epub`, page 7),
the origami split between image pane and text pane is left at Bloom's default **50/50**.
For a portrait illustration with a few lines of text, that wastes a large empty band
below the text while the artwork stays small. If the image pane were taller, the
(portrait) image would grow until it touched the page's left/right edges and everything
would still fit.

Goal: pick a better **initial** splitter position per page:

- Grow the image pane only when it helps (a wide image already touching both sides at
  50% gains nothing from a taller pane).
- **Never cause text overflow.** This is the governing constraint (see §2). Wasted
  space is a quality ding; overflowing text is a process failure because it forces a
  human to review every page. When in doubt, leave the splitter at 50%.
- New setting, **on by default**, can be turned off: key `fitImagePanes`, CLI
  `--fit-image-panes` / `--no-fit-image-panes`, GUI toggle.

## 2. Verified facts you can rely on (do not re-derive)

These were verified against BloomDesktop source and this repo in June 2026:

1. **Splitter HTML format.** Bloom stores the splitter as inline styles. For a
   horizontal split (vertical stack), with the bottom pane taking B% of the height:

   ```html
   <div class="split-pane horizontal-percent">
     <div class="split-pane-component position-top" style="bottom: B%">…</div>
     <div class="split-pane-divider horizontal-divider" style="bottom: B%"></div>
     <div class="split-pane-component position-bottom" style="height: B%">…</div>
   </div>
   ```

   Our generator (`packages/lib/src/4-generate-html/origami.ts`) currently emits **no**
   inline styles, so Bloom's CSS defaults to 50%. (`title`/`data-splitter-label` on the
   divider are cosmetic; Bloom regenerates them on drag — do not emit them.)

2. **Bloom marks overflow with CSS classes that persist into the saved .htm.**
   From BloomDesktop `src/BloomBrowserUI/bookEdit/OverflowChecker/OverflowChecker.ts`:
   - `overflow` — on a `.bloom-editable` that overflows itself;
   - `thisOverflowingParent` / `childOverflowingThis` — an editable overflowing an
     ancestor;
   - `pageOverflows` — page-level rollup, **but deliberately removed on
     `Device16x9Portrait`/`Device16x9Landscape` pages** (BL-11949: device layouts scroll
     instead). EPUB imports default to Device16x9, so **never rely on `pageOverflows`;
     detect via the editable-level classes**, which are applied on every page size.
     The classes are only cleaned at the _next_ edit-page load, so they survive in the
     saved file. The check runs at edit-page load (queued via `setTimeout` per editable
     from `AddOverflowHandlers`, called by `SetupElements` in `bookEdit/js/bloomEditing.ts`).
     `process-book` (see fact 4) loads each page off-screen with the edit-mode fix-ups, so
     it _should_ bake the markers into the .htm it writes back. **One assumption is
     unverified**: that process-book waits for the queued async checks before saving.
     Step 0 below tests this empirically before anything depends on it.

3. **Page size may not be Device16x9.** A master book overrides the page size at
   `packages/lib/src/run/runConversion.ts:941-943` _before_ HTML generation — e.g. LFA
   books become `A5Portrait` per their master. The splitter math must use the _final_
   `book.frontMatterMetadata.pageSize` (it will automatically, because the computation
   lives inside Stage 4 page generation, which reads that field). On print sizes,
   overflow means clipped text — worse than the device-layout scrollbar — so the
   conservative bias matters most exactly on master-sized books.

4. **process-book.** `processBookInBloom` (`packages/lib/src/5-notify-bloom/notifyBloom.ts:223`)
   POSTs `external/process-book` to a running Bloom; Bloom processes every page
   off-screen in a real browser and writes the fixed .htm back, returning `htmPath`.
   It is invoked from the GUI server only: `processBookInBloomForRun`
   (`packages/gui/server/engine.ts:430`), called from `apiPlugin.ts:1055` and
   `engine.ts:685`. The CLI pipeline does **not** call process-book (Stage 5 only
   notifies), so the overflow guard (§4 step 6) lives in the GUI server path.

5. **Master-page substitution replaces whole pages.** `applyMasterPages`
   (`runConversion.ts:951-961`) swaps generated pages for hand-perfected master pages
   keyed by `data-import-source-hash`, _after_ generation. A substituted page loses our
   splitter styles wholesale — that is correct (the master's splitter already encodes
   the right answer); no special handling needed.

6. **Image files on disk are already trimmed** when Stage 4 runs:
   `trimWhitespaceInBookFolder` runs at `runConversion.ts:633` (EPUB) / `:793` (PDF),
   both before Stage 4 (`:930`). Reading dimensions from the book-folder files gives the
   aspect ratio that will actually render. (The `{width= height=}` markdown attributes
   only exist for table-canvas icons and are _pre-trim_ — do not use them for this.)

## 3. Design

Two layers:

- **A conservative heuristic at Stage 4** picks the splitter percentage. It must be a
  good first guess, biased hard toward not overflowing.
- **An overflow guard after process-book** (GUI path) uses Bloom's _own_ overflow
  detection — the classes from fact 2 — to revert any adjusted page that overflowed
  back to 50/50 and reprocess. The guard is the safety mechanism; the heuristic only
  needs to avoid wasting retry round-trips. On the CLI path (no process-book) only the
  heuristic runs, which is why it must be safe on its own.

### Heuristic (pure function)

Inputs: image aspect `A` (w/h, from the trimmed file on disk), canvas size
`canvasW × canvasH` px (from `HtmlGenerator.pagePx(pageSize)`,
`packages/lib/src/4-generate-html/html-generator.ts:528`), and the text block's
per-language markdown strings.

```
usefulFrac  = (canvasW / A) / canvasH        // pane height at which the image touches both sides
textPx      = estimateTextHeightPx(texts)    // see below
textFrac    = max(textPx / canvasH, MIN_TEXT_FRAC)
imageFrac   = min(usefulFrac, MAX_IMAGE_FRAC, 1 - textFrac)
if imageFrac < 0.5 + MIN_GAIN: return null   // not worth moving / can't safely move
return floor(imageFrac * 100)                // integer percent for the image pane
```

`estimateTextHeightPx`: for each language present in the text block's content, for each
paragraph, `lines = max(1, ceil(paragraphChars / charsPerLine))` with
`charsPerLine = floor(canvasW / (FONT_PX * AVG_CHAR_EM))`; language height =
`totalLines * FONT_PX * LINE_HEIGHT`. **Sum across all languages present** (not max —
we can't know at conversion time whether the collection displays the book bilingually;
summing is the conservative choice), then `* SAFETY + PAD_PX`.

Starting constants (centralize in the new module; calibrate later, see §6):

| Constant         | Value | Meaning                                                                             |
| ---------------- | ----- | ----------------------------------------------------------------------------------- |
| `FONT_PX`        | 21    | ≈16pt default Bloom text; collections often go bigger — SAFETY absorbs some of that |
| `LINE_HEIGHT`    | 1.6   | em multiplier                                                                       |
| `AVG_CHAR_EM`    | 0.5   | average character advance as a fraction of font size                                |
| `SAFETY`         | 1.4   | multiplier on the whole text estimate                                               |
| `PAD_PX`         | 24    | translationGroup padding/margins allowance                                          |
| `MIN_TEXT_FRAC`  | 0.25  | text pane never below 25% of canvas height                                          |
| `MAX_IMAGE_FRAC` | 0.75  | image pane never above 75%                                                          |
| `MIN_GAIN`       | 0.06  | don't move the splitter for less than 6 points of gain                              |

v1 scope — apply only when ALL of:

- the setting is on;
- the page's origami items are **exactly two**: one `image` + one `text` (either order —
  the percent math is symmetric; for `[text, image]` the first-pane percent is the text
  pane's `100 − imagePct`);
- the image file's dimensions are readable (else return null).

Explicitly out of scope for v1 (leave at default 50/50, note in code): three-item
stacks (bilingual text–image–text pages), multi-image pages, canvas/table pages,
full-bleed pages (those never reach origami anyway).

### Overflow guard (GUI server, after process-book)

In `processBookInBloomForRun` after a successful process: read the processed .htm
(`result.htmPath`, falling back to `<basename>.htm` in the returned folder). For each
`.bloom-page` that carries our marker attribute `data-auto-split` **and** contains any
of `class~="overflow" | "thisOverflowingParent" | "childOverflowingThis"`:

1. reset the page's **top-level** split back to 50%: rewrite the `bottom: N%` (×2,
   component + divider) and `height: N%` inline styles of the first
   `split-pane horizontal-percent` in that page;
2. remove the three overflow marker classes within that page (so stale markers don't
   re-trigger) and replace `data-auto-split="N"` with `data-auto-split-reverted="N"`;
3. after the loop, if anything was reverted: write the file, call
   `processBookInBloom` **once** more (no further retries — the 50% fallback is
   today's behavior and known-safe), and log
   `Fit image panes: reverted N page(s) whose text overflowed.`

Parse pages the same way `packages/lib/src/master/masterPages.ts` splits the document
into page divs (reuse/extract its helper rather than inventing a new parser). Pages
without `data-auto-split` are never touched — overflow that we didn't cause is not ours
to "fix" silently (it predates this feature and the user should see it).

## 4. Implementation steps, in order

### Step 0 — empirical spike (BLOCKING)

Before building the guard, verify fact 2's one assumption with a running Bloom:

1. Take any already-converted book folder (or convert `test-inputs/pineapple.pdf` to a
   scratch output), hand-edit one page's `.bloom-editable` to contain ~3000 characters.
2. Call process-book on it (via the GUI, or a 10-line script calling
   `processBookInBloom` from `@bloombridge/lib`).
3. Grep the returned .htm for `overflow` / `thisOverflowingParent` / `childOverflowingThis`.

If the classes are present → proceed. If absent (likely cause: Bloom saves the page
before the queued `setTimeout` overflow checks fire), **stop and report** — the guard
needs a Bloom-side change (or a CDP-measurement fallback), and the heuristic-only
version should then ship with more conservative constants (raise `SAFETY` to 1.6,
lower `MAX_IMAGE_FRAC` to 0.7).

### Step 1 — shared image-size util

Lift `intrinsicSize(buf)` from `packages/lib/src/epub/epubToBloomMarkdown.ts:112`
(PNG IHDR + JPEG SOF reader) into a new `packages/lib/src/util/imageSize.ts`:

- `export function intrinsicSize(buf: Buffer): { w: number; h: number } | null` (moved as-is);
- `export function imageSizeFromFile(absPath: string): { w: number; h: number } | null`
  (sync `readFileSync` + `intrinsicSize`; Stage 4 generation is synchronous).

Re-import in `epubToBloomMarkdown.ts`. The existing test at
`epubToBloomMarkdown.test.ts:258` shows how to fabricate a minimal real JPEG header for
unit tests — reuse that trick for the util's own tests.

### Step 2 — origami.ts: emit an explicit first-split percentage

`packages/lib/src/4-generate-html/origami.ts`: add an optional parameter to
`generateOrigamiHtml(blocks, orientation, firstPaneSharePct?: number)` and thread it to
`buildSplitPane` for the **top-level split only** (nested splits keep default). When
present, with `B = 100 − firstPaneSharePct`, emit ` style="bottom: B%"` on the
position-top component and the divider, and ` style="height: B%"` on the
position-bottom component (exact format in §2 fact 1). When absent, emit byte-identical
output to today (don't break `origami.test.ts` snapshots — extend that file with cases
for the new parameter).

### Step 3 — the heuristic module

New `packages/lib/src/4-generate-html/fitImagePanes.ts`:

```ts
export function computeImagePaneSharePct(args: {
  imageAspect: number; // w/h of the trimmed image
  canvasW: number;
  canvasH: number;
  texts: Record<string, string>; // the text block's per-language markdown
}): number | null;
```

Pure function implementing §3 exactly, constants exported for tests/calibration.
Unit-test with a table: portrait image + short text → ~70; wide image (A=2) on a
portrait page → null (useful max < 56%); long text → null; portrait image + medium
text → clamped by text estimate; two languages → summed estimate.

### Step 4 — wire into page generation

`packages/lib/src/4-generate-html/html-generator.ts`:

- `generateHtmlDocument(book)` (and the call chain down to `generatePage`) gains an
  optional `opts?: { bookFolder?: string; fitImagePanes?: boolean }`. Caller:
  `runConversion.ts:947` passes `{ bookFolder: plan.bookFolderPath!, fitImagePanes: plan.fitImagePanes }`.
  Existing tests that call without opts get the old behavior.
- In `generatePage` where origami items are assembled (`html-generator.ts:993-1051`):
  when opts allow and the v1 conditions hold (exactly one image + one text item),
  resolve the image's absolute path (`path.join(bookFolder, imageElement.src)`), read
  its size via `imageSizeFromFile`, call `computeImagePaneSharePct`, and if non-null:
  - pass the first-pane percent to `generateOrigamiHtml` (for `[text, image]` order the
    first pane is the text: pass `100 − imagePct`);
  - add `data-auto-split="<imagePct>"` to the `.bloom-page` div's attributes (next to
    the existing `sourceHashAttr`/`pageStyleAttr` mechanism, ~line 1064-1072) — this is
    the guard's marker;
  - make the image's `canvasElementStyle` preview rect match: `origamiPaneRect`
    (`:570-585`) needs an optional override so the image pane's height share is
    `imagePct/100` instead of the hardcoded `1/2^(i+1)` (only the 2-item case matters).

### Step 5 — settings plumbing (follow `trimWhitespace` everywhere)

`git grep -n trimWhitespace` is the authoritative checklist; the same ~15 sites, same
pattern, new key `fitImagePanes`, default **true**:

- `packages/lib/src/options/optionsSchema.ts` — new `OptionSpec` after `trimWhitespace`
  (`:95-102`): key `fitImagePanes`, cliFlag `--fit-image-panes`, label
  "Fit image panes", type boolean, default true, stage `"html"`, help: "When a page is
  an illustration plus a text block, grow the image pane past 50% when the image's
  shape benefits and the text clearly still fits. Conservative; overflow detected after
  Bloom processing reverts the page to 50%. Turn off if it causes layout problems."
- `packages/cli/src/index.ts` — `--no-fit-image-panes` option (mirror `:83-86`) and
  `fitImagePanes: options.fitImagePanes` in the `Arguments` literal (mirror `:114-116`,
  Commander defaults it true because only the `--no-` flag is declared).
- `packages/cli/src/process.ts` — `fitImagePanes?: boolean` on `Arguments` (`:28`) and
  pass-through (`:69`).
- `packages/lib/src/run/runConversion.ts` — mirror `trimWhitespace` at `:104` (args
  type), `:133` (plan type), `:159` and `:552` (`?? true` defaulting), and pass to
  `generateHtmlDocument` at `:947` (step 4).
- GUI: `packages/gui/src/types.ts:46` area (params type, with the cli-flag comment),
  `App.tsx:26` (defaults) and `:37` (persisted-keys list), `data/mockData.ts:74`,
  `server/engine.ts:647` (param → CLI args), `components/panels.tsx` (DetailRow `:432`,
  command preview `:1235`, summary `:1270`, Toggle `:1625-1641` — put it in the HTML
  stage group), `components/table.tsx:803` (differs-from-default chip),
  `components/modals.tsx:714` and `:747`.

### Step 6 — overflow guard

`packages/gui/server/engine.ts`, inside `processBookInBloomForRun` (`:430-461`), after
the `result.ok` check and folder-rename tracking: implement §3's guard. Suggested
shape: a new exported helper in `packages/lib` (e.g.
`revertOverflowingAutoSplits(htmPath): Promise<number>` in a new
`packages/lib/src/4-generate-html/fitImagePanesGuard.ts`, exported from
`packages/lib/src/index.ts`) so it's unit-testable with fixture HTML, with engine.ts
doing: `const n = await revertOverflowingAutoSplits(htmPath); if (n > 0) { log(...); await processBookInBloom(...) once more; }`.
Unit-test the helper with fixture HTML covering: adjusted page with `overflow` class →
reverted; adjusted page clean → untouched; _unadjusted_ page with overflow → untouched;
nested split untouched when only top-level reverts.

Caveat to verify in step 0's spike: that Bloom's process-book **preserves**
`data-auto-split` through its rewrite (it preserves `data-conversion-note` and other
custom data attributes today, so this is expected). If it doesn't, fall back to
matching adjusted pages by "top-level split-pane with a non-50 percent" instead of the
attribute.

### Step 7 — docs

- `conversion-process.md`: add `--fit-image-panes` to the CLI option table (Stage 4
  row), and a short subsection in the Stage 4 section describing the heuristic, the
  guard, and the v1 scope/skips.
- `packages/cli/README.md` if it lists flags.

### Step 8 — verification

1. `pnpm build && vp check && vp test run` (new tests: imageSize util, origami percent
   emission, heuristic table, guard fixtures; existing origami/html-generator tests
   unchanged when the feature is off or opts are omitted).
2. End-to-end:
   `pnpm cli "large-local-test-inputs/LFA Vanuatu English/A Thief In The Night - L4.epub" --output test-outputs/fit-panes/`
   — inspect the page-7 HTML: expect `data-auto-split` ≈ 65-72, matching inline
   `bottom:`/`height:` styles, and a `canvasElementStyle` whose height matches the
   share. Then re-run with `--no-fit-image-panes` and confirm byte-identical-to-old
   output (no styles, no attribute).
3. With Bloom running: process the book (GUI "Process in Bloom"), confirm no overflow
   classes on adjusted pages, and visually screenshot page 7 via the CDP harness (see
   auto-memory "Verify Bloom page render via CDP") — image larger, text below, no
   clipping.
4. Negative path: hand-edit the book's `.bloom.md` to give page 7 several paragraphs,
   re-run from `.bloom.md`, process in Bloom → expect the guard log line and the final
   .htm back at 50% for that page.

## 5. Acceptance criteria

- Portrait-image + short-text pages (Thief p.7) get an image pane of ~65-75% instead of 50%.
- Wide-image pages and long-text pages are left at exactly today's output.
- `--no-fit-image-panes` (CLI) and the GUI toggle produce byte-identical output to today.
- The guard reverts a deliberately-overflowed adjusted page and never touches
  unadjusted pages.
- No existing test regresses; `vp check` clean.

## 6. Follow-ups (not v1)

- Calibrate `FONT_PX`/`AVG_CHAR_EM`/`SAFETY` against real rendered text heights using
  the CDP harness across the corpus (acceptance bar: zero overflow on every corpus book
  _without_ the guard).
- Extend to text–image–text (bilingual) three-pane stacks.
- Read the master book's font size (its head styles are already parsed in
  `masterPages.ts` `readMasterAppearance`) to replace the `FONT_PX` guess on
  master-backed imports.
- Consider an opt-in process-book + guard step for the CLI path.
