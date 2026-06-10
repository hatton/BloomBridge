# BloomBridge Conversion Process

This is the orientation doc for the conversion pipeline. It explains **what we are
doing, why, and how every stage works**, the CLI parameters that influence each
stage, the intermediate file format that ties the stages together, and the variety
of real-world inputs we handle and how. Read this first; it points at the code for
detail.

> Companion docs: `CLAUDE.md` (toolchain, build, test), `packages/cli/README.md`
> (user-facing CLI usage). This doc is the architectural/“how it works” reference.

---

## 1. The big picture

We convert a **PDF picture/reader book** into a **Bloom book** (a folder containing
an HTML file + images + CSS + `meta.json`). Bloom is an authoring app; a Bloom book
is HTML where each page is a `.bloom-page` div, text lives in `.bloom-editable`
divs grouped in `.bloom-translationGroup`s, and the book’s metadata (title, author,
license, languages, cover) lives in a `#bloomDataDiv` that **Bloom regenerates the
“xMatter” pages (cover, title, credits) from at runtime**.

Key consequence that shapes everything downstream: **we don’t hand Bloom finished
front/back-matter pages — we hand it the data, and Bloom builds those pages.** We
only emit content pages (plus full-bleed covers as a special custom layout).

The pipeline is **4 stages**, and the artifact between each stage is a Markdown file
on disk. Markdown is deliberately the interchange format because a human can read
and inspect the “plan” before it becomes hard-to-read HTML, and because it doubles
as a **cache**: expensive steps (OCR, vision) bake their results into the Markdown so
re-runs from a later stage are free.

```
PDF ──Stage1 OCR──▶ .ocr.md ──Stage2 LLM──▶ .raw-llm.md ▶ .llm.md ──Stage3 plan──▶ .bloom.md ──Stage4 HTML──▶ <book>.htm (+ meta.json) ──Stage5──▶ notify running Bloom
```

You can **start at any artifact** (the CLI infers the stage from the file
extension) and **stop at any artifact** (`--target`). That makes iteration cheap:
fix the LLM output by hand in `.llm.md` and re-run from there, etc.

---

## 2. Pipeline at a glance: artifacts, files, start/stop

The `Artifact` enum (in `packages/cli/src/process.ts`) is ordered; the pipeline runs
from the input artifact up to the target artifact.

| Artifact (enum order)    | File suffix   | Produced by              | `--target` value   |
| ------------------------ | ------------- | ------------------------ | ------------------ |
| `EPUB`                   | `.epub`       | (input)                  | —                  |
| `PDF`                    | `.pdf`        | (input)                  | —                  |
| `Images`                 | (image files) | Stage 1 image extraction | `images`           |
| `MarkdownFromOCR`        | `.ocr.md`     | Stage 1                  | `ocr` / `markdown` |
| `MarkdownFromLLMRaw`     | `.raw-llm.md` | Stage 2 (raw LLM output) | —                  |
| `MarkdownFromLLMCleaned` | `.llm.md`     | Stage 2 (after cleanup)  | —                  |
| `MarkdownReadyForBloom`  | `.bloom.md`   | Stage 3                  | `tagged`           |
| `HTML`                   | `<book>.htm`  | Stage 4                  | `bloom` (default)  |

**Input-type detection** (`makeThePlan` in `process.ts`) looks at the **last two**
extensions so it can tell `.ocr.md` from `.llm.md` from `.bloom.md`. A bare `.md` is
treated as `.ocr.md`.

All intermediate files are written into the **book folder** (named after the input
file’s base name, inside the chosen output/collection directory), so you can inspect
every stage: `Foo.ocr.md`, `Foo.raw-llm.md`, `Foo.llm.md`, `Foo.bloom.md`, `Foo.htm`,
`meta.json`, plus extracted `image-*.png`, `cover.jpg`, `back-cover.jpg`.

---

## 3. CLI reference and how each option influences the stages

Entry point: `packages/cli/src/index.ts` (Commander) → `Arguments` → `makeThePlan`
→ `processConversion` (`process.ts`).

| Option                                           | Default                         | Stage(s) affected           | Effect                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<input>` (positional)                           | —                               | all                         | Path ending in `.pdf`, `.ocr.md`, `.raw-llm.md`, `.llm.md`, or `.bloom.md`. Determines the **start** stage.                                                                                                                                                                                                                                                                                                 |
| `-t, --target`                                   | `bloom`                         | end of pipeline             | `images` \| `ocr`/`markdown` \| `tagged` \| `bloom`. Determines the **stop** stage.                                                                                                                                                                                                                                                                                                                         |
| `-c, --collection`                               | (most-recent)                   | Stage 0 + 2                 | Where the book is created **and** the source of L1/L2/L3 language hints (read from the `.bloomCollection` XML). Accepts a full path, a bare name (expands under `~/Documents/Bloom/` or OneDrive Documents), or `recent`. Mutually exclusive with `--output`.                                                                                                                                               |
| `-o, --output`                                   | —                               | Stage 0                     | Custom output directory (no language hints).                                                                                                                                                                                                                                                                                                                                                                |
| `--mistral-api-key`                              | `$MISTRAL_API_KEY`              | Stage 1                     | Needed for `--ocr mistral`.                                                                                                                                                                                                                                                                                                                                                                                 |
| `--openrouter-key`                               | `$OPENROUTER_KEY`               | Stage 1, 2                  | Needed for GPT/OpenRouter OCR, the LLM enrichment, and vision-formatting.                                                                                                                                                                                                                                                                                                                                   |
| `--ocr <method>`                                 | `gpt`                           | Stage 1                     | `gpt` (OpenRouter vision, page-by-page), `mistral` (Mistral OCR API), `unpdf` (local pdfjs text extraction, no API), or any OpenRouter model name/alias.                                                                                                                                                                                                                                                    |
| `--parser <engine>`                              | `native`                        | Stage 1                     | Only meaningful for the (unused) OpenRouter file-parser path: `native`/`mistral-ocr`/`pdf-text`. The live GPT path renders pages to images and ignores this.                                                                                                                                                                                                                                                |
| `--imager <method>`                              | `poppler`                       | Stage 1 / `images`          | Image extraction method. Only `poppler` is implemented (the old `pdfjs` imager was removed; any other value falls back to poppler).                                                                                                                                                                                                                                                                         |
| `--cover <mode>`                                 | `auto`                          | Stage 1                     | `auto` (render front/back cover to an image only if a full-bleed image is detected), `render` (always render first+last page), `none` (leave covers to Bloom xMatter).                                                                                                                                                                                                                                      |
| `--vision-formatting` / `--no-vision-formatting` | **on**                          | Stage 1                     | **On by default** (disable with `--no-vision-formatting`): a vision model detects per-page text alignment; a deterministic sampler detects solid page background color. Needs `--openrouter-key` and a PDF input — if either is missing it's skipped with a warning (not an error). Results cached in `.ocr.md`.                                                                                            |
| `--vision-model <model>`                         | `google/gemini-3.1-pro-preview` | Stage 1                     | Model for the vision-formatting pass, **independent of `--model`**.                                                                                                                                                                                                                                                                                                                                         |
| `--model <model>`                                | `google/gemini-3.1-pro-preview` | Stage 2                     | OpenRouter model for the LLM **enrichment** stage.                                                                                                                                                                                                                                                                                                                                                          |
| `--prompt <path>`                                | (built-in)                      | Stage 1 (GPT OCR) + Stage 2 | Override prompt file. Used as the per-page OCR prompt on the GPT path and/or the enrichment prompt.                                                                                                                                                                                                                                                                                                         |
| `--complex-becomes-image <which>`                | `busy`                          | Stage 1 (+ Stage 4 render)  | Which pages to snapshot as full-page images instead of reconstructing text (translatability↔fidelity). `covers` never flattens interior pages; `busy` (default) flattens canvas pages with ≥`BUSY_THRESHOLD` text blocks; `anyCanvas` flattens every canvas page; `all` imports **every** page as an image with only minimal OCR/LLM for metadata. Legacy `off`/`0`–`5`/`always` still accepted (see §5.7). |
| `--emit-source-hashes`                           | off                             | Stage 4                     | **Master-creation mode** (see §9.7). Keeps the `data-import-source-hash` on every page and **skips** master substitution. Use it once to build a master book; off (the default) for normal imports.                                                                                                                                                                                                         |
| `--trim-whitespace`                              | off                             | Stage 1 / EPUB extraction   | Crop uniform white margins off the edges of each extracted illustration so the artwork fills its frame (see §5.8). Off by default. Skips full-bleed covers, per-page flatten snapshots, and decorative icons.                                                                                                                                                                                               |
| `--verbose`                                      | off                             | all                         | Verbose logging via the log callback.                                                                                                                                                                                                                                                                                                                                                                       |

**API-key gating** (`makeThePlan`): Mistral OCR needs the Mistral key; OpenRouter
OCR / enrichment / vision need the OpenRouter key. The checks only fire for stages
that will actually run given the start/stop artifacts.

---

## 4. Stage 0 — input resolution, collections, the Plan

`makeThePlan` builds a `Plan` (all paths, keys, modes) and resolves **where** the
book goes:

- `--collection <name|path|recent>` → `validateAndResolveCollectionPath`
  (`processUtils.ts`). `recent` uses `getMostRecentBloomCollection` (reads Bloom’s
  settings). A bare name expands to `~/Documents/Bloom/<name>` (OneDrive Documents
  tried first on Windows).
- If the input is already inside the collection (and not a PDF), the existing book
  folder is reused.
- `--output` is the escape hatch for a plain directory with no collection.
- If neither is given, it defaults to the most-recent collection, falling back to cwd.

`readBloomCollectionSettingsIfFound` parses the `.bloomCollection` XML for
`Language1/2/3Name` + `Iso639Code`, producing `{ l1, l2, l3 }` `{tag,name}` objects
that are passed to the LLM in Stage 2 as **language hints** (greatly improves
minority-language tagging and ensures consistent BCP-47 codes).

`makeThePlan` also looks for a **master book** in the collection (or `--output`
directory): a sibling folder whose name ends in `master` (`findMasterBookFolder`,
`master/masterPages.ts`). If found — and we're not in `--emit-source-hashes` mode —
its hashes are loaded so matched pages can be substituted (see §9.7).

---

## 5. Stage 1 — OCR (PDF → `.ocr.md`) and all PDF analysis

This stage turns the PDF into Markdown, extracts images, and runs several
**PDF-analysis passes** whose results are baked into the Markdown. Everything here
needs the PDF in hand, so it’s the only place these can run; later stages rely on
the cached results.

### 5.1 OCR method (`--ocr`)

Three real paths (plus vestigial ones):

- **`gpt` (default) — OpenRouter vision, page-by-page** (`pdfToMarkdown.ts`).
  Renders each page to a JPEG (`pdftocairo`, 200 DPI), sends each page image to an
  OpenRouter vision model with a per-page prompt, streams the response (SSE), and
  assembles. **Page-by-page** (concurrency ~5) avoids HTTP timeouts on big books.
  Model aliases: `gpt` → `openai/gpt-5.4`, `gemini` → `google/3.1-pro-preview`
  (note: that alias string looks like a typo for `google/gemini-3.1-pro-preview`);
  any full OpenRouter model name is passed through. After OCR it extracts images
  separately (poppler). Captures only **visually rendered** text (like a human).
- **`mistral` — Mistral OCR API** (`pdfToMarkdownAndImageFiles-Mistral.ts`). Sends
  the whole PDF (base64) to `mistral-ocr-latest`; Mistral returns per-page markdown
  **and** the embedded images (base64) with bounding boxes; we save the images and
  annotate `{width=…}` from the boxes. Also vision-style (rendered text only). The
  model id is hard-coded.
- **`unpdf` — local structural extraction** (`pdfToMarkdownWithUnpdf.ts`). No API.
  Uses pdfjs to read the PDF’s text layer + embedded image XObjects directly, with a
  hybrid line-break/word-gap heuristic (handles complex scripts). **Caveat:** it
  extracts _all_ text in the PDF structure, **including invisible/hidden layers** —
  diverges from what a human sees (documented limitation).

All three emit the same page-marker convention:

```
<!-- page index=1 import-source-hash="…" -->
…page 1 content (headings via #, images via ![image](image-1-1.png){width=400})…

<!-- page index=2 import-source-hash="…" -->
…
```

Image filename convention: `image-<page>-<indexOnPage>.png`. Page numbers are meant
to be dropped by OCR; if they leak through they’re marked later (Stage 2 cleanup).

**Per-page source hash (GPT path only).** As each page is rendered, `pageImageHash.ts`
computes a **perceptual hash** (a 64-bit dHash, 16 hex chars) of its raster and
records it on the page comment as `import-source-hash="…"`. This is the key for
**master-page substitution** (§9.7): if the hash is within a small Hamming distance
of one provided by a master book, that page **skips OCR** entirely (a short
placeholder body + `master-page="true"`) — its real content is spliced in from the
master in Stage 4. A perceptual hash (rather than an exact one) means a master built
from full-resolution PDFs still matches the same page in a re-compressed/downsampled
copy (e.g. the smaller PDFs checked into the repo). The hashing is local and free;
only the GPT path renders full pages, so Mistral/unpdf inputs don't get hashes (and
can't match). `pageImageHash.ts` also offers an `"exact"` mode (SHA-256) behind the
same API.

Vestigial: `unused-pdfToMarkdownAndImageFiles-OpenRouter.ts` (OpenRouter file-parser
plugin — never worked/wired; this is what `--parser` was for) and
`unused-PdfToImages-pdfjsextractImagesFromPdf.ts` (replaced by poppler `pdfimages`).

### 5.2 Image extraction (`--imager`, poppler)

`pdfToImages.ts` runs `pdfimages -list` (metadata) + `pdfimages -png` (force PNG),
then renames to `image-<page>-<n>.png`. Skips SMASK (transparency) entries. The
`Images` target stops here.

### 5.3 Covers (`--cover`) — `prepareCovers.ts` + `coverDetection.ts`

- `coverDetection`: `pdfinfo` for page size/count; `pdfimages -list` to measure the
  largest embedded image’s displayed area vs the page. `isFullPageArtPage` returns
  true at **≥ 85%** coverage (full-bleed art). This is geometry-based and robust.
- `prepareCovers`: front = page 1, back = last page. In `auto`, render to an image
  only when full-page art is detected; in `render`, always; in `none`, skip. Renders
  via `pdftocairo` (150 DPI) to `cover.jpg` / `back-cover.jpg` and **injects a
  markdown image ref** right after that page’s `<!-- page -->` comment. These
  reserved filenames are the signal Stage 4 uses to emit full-bleed cover pages.

### 5.4 Vision-formatting (`--vision-formatting`) — `visionFormatting.ts`

Opt-in. For each page it renders a low-DPI (100) image and:

- asks a vision model (default `gemini-3.1-pro-preview`, override `--vision-model`)
  for **vertical alignment** (top/center/bottom) and **horizontal alignment**
  (left/center/right) of the main text block; and
- **deterministically** detects a solid **page background color** by border-sampling
  the rendered page (uniform, non-white border ⇒ solid bg). This replaced an earlier
  approach of asking the model for a “dominant color,” which wrongly tinted
  illustration pages.

Results are injected as page-comment attributes (`vertical-align`,
`horizontal-align`, `background-color`) and **cached**: a page that already has
`vertical-align=` is skipped, so re-runs don’t re-pay. Background color uses Bloom’s
`--page-background-color` custom property at render time (see 8.5); a plain inline
`background-color` does **not** survive Bloom’s import.

### 5.5 Normal-style detection — `detectNormalStyle.ts` (always, local, no API)

Reads the PDF with pdfjs and returns, weighted by character count (so interior body
text dominates): the dominant **font size (pt)**, dominant **font family** (cleaned
of subset prefixes like `ABCDEE+`, dropping generic/internal ids), and the **page
size** mapped to a Bloom class (`A3/A4/A5/A6 Portrait/Landscape`, `Letter`, `Legal`,
±30 pt tolerance). These ride in a **book-level comment** at the top of the markdown:

```
<!-- book normal-font-size="28" normal-font-family="Andika" page-size="A4Portrait" -->
```

### 5.6 Canvas-page detection — `detectCanvasPages.ts`

For interior pages (excludes first/last = covers) that are a **full-page background
image with floating text** (e.g. a picture-book scene with a caption, or a page of
discussion questions), it reads the body text from the PDF text layer (excluding
pure-numeric page numbers), **clusters it into vertical blocks** (separated by gaps
larger than a line), and confirms a full-page image via `isFullPageArtPage`. It
records one box per block (page fractions, reading order) in the page comment as a
`;`-separated list:

```
<!-- page index=3 … canvas-text-boxes="0.10,0.24,0.69,0.13" -->
<!-- page index=6 … canvas-text-boxes="0.19,0.07,0.61,0.14;0.24,0.29,0.46,0.02;…" -->
```

Stage 4 uses this to build a Bloom “Canvas” page (8.4). It also **renders each
canvas page and samples its solid background color** (the same deterministic
border-sampling used by vision-formatting, `detectBackgroundColor.ts`) and emits
`background-color` on the page comment — so Stage 4 can fill the page margin and
the full-bleed art doesn’t leave a white border (see 9.4). Skipped if
vision-formatting already set a `background-color`.

It also records the page’s **full-page background image** as
`canvas-background-image="image-<page>-<n>.png"` — the page’s largest embedded image
(`getLargestImageOnPage`, indexed to match the extracted file names). This makes the
canvas background **independent of whether the OCR/LLM emitted an `![image]` ref**:
on a page whose art is scattered clip-art (the Library-For-All “comprehension
questions” page — “You can use these questions…”), a vision OCR transcribes the
questions as text and often omits the picture entirely, which used to drop it from
the Bloom page. Stage 4 prefers this attribute over the first image element (9.4).

### 5.7 Flatten pages to images — `--complex-becomes-image` (`flattenComplexPages` / `flattenAllPages`)

Some pages are too intricate to rebuild as editable text. Rather than approximate
them, we render the page to a **single full-page image** and import that instead. The
decision and rendering happen here in Stage 1; the marker rides through the rest of
the pipeline and Stage 4 turns it into a full-page image page (§9.2/§9.3). The flag has
two distinct modes:

- **Per-page choices `covers` / `busy` / `anyCanvas`.** Only **canvas** pages (§5.6) are
  candidates. `complexThreshold` maps the value to a score threshold (`covers` → none,
  `busy` → `BUSY_THRESHOLD`, `anyCanvas` → 1; legacy `0`–`5` → `level + 1`), the score is
  the canvas page's text-box count, and any page at/above the threshold is rendered to
  `page-<N>.jpg` and tagged `flatten-as-image="…" flatten-score="…" flatten-level="…"`.
  Lower threshold flattens more readily (`anyCanvas` = every canvas page).
- **`all` — every page as an image** (legacy `always`). A different mode: we render **every** page to
  `page-<N>.jpg` and tag every page comment `flatten-as-image`. To still recover the
  book's metadata + languages we OCR only a handful of pages — the **first 4 and last
  2** (`pagesForMetadata`, passed to `pdfToMarkdown` as `ocrOnlyPages`); every other
  page gets a `_(page imported as image)_` placeholder body (no hash) so it parses as a
  page and survives the LLM round-trip. All per-page analysis is skipped: `prepareCovers`,
  `addVisionFormatting`, and `detectCanvasPages` don't run (and image extraction is
  skipped — the per-page images aren't referenced). `detectNormalStyle` still runs (page
  size is needed). On the `mistral`/`unpdf` OCR paths the OCR can't be limited to a few
  pages, so the cost saving applies only to the default `gpt` path; every page is still
  imported as an image.

Either way, flattened pages carry a `data-conversion-note` in the HTML recording why
and how to revert (see §9.2). The `flatten-as-image`/`flatten-score`/`flatten-level`
attributes round-trip through `parseMarkdown`/`generateMarkdown`, and the LLM prompt is
told to preserve them.

> Stage 1 ordering in `process.ts`: OCR → `prepareCovers` → (optional)
> `addVisionFormatting` → `detectNormalStyle` (prepends the book comment) →
> `detectCanvasPages` (injects `canvas-text-boxes`) → flatten (`flattenComplexPages`,
> or `flattenAllPages` when `all`) → (optional) trim whitespace → write `.ocr.md`. In
> `all` mode only OCR, `detectNormalStyle`, and `flattenAllPages` run.

### 5.8 Trim whitespace off illustrations — `--trim-whitespace` (`trimImageWhitespace.ts`)

Opt-in. Picture-book illustrations are often exported with a generous white margin
around the actual artwork, which makes the content look tiny once dropped onto a
Bloom page. When enabled, `trimWhitespaceInBookFolder` crops the uniform near-white
border off every illustration **in the book folder, in place**, using `sharp`'s
`.trim()` (background white, threshold 15). It runs **after** all per-page analysis
(which reads the PDF / rendered pages, not the extracted PNGs, so order doesn't
matter) and is **skipped in `--complex-becomes-image all`** mode (every page is
already a full-bleed snapshot). The same call also runs in the **EPUB front-end**,
right after `epubToBloomMarkdown` copies the illustrations.

It deliberately leaves alone: full-bleed `cover.jpg`/`back-cover.jpg`, per-page
flatten/cover renders (`page-<N>.jpg`), Bloom's own assets
(`placeHolder.png`/`thumbnail.*`/`license.png`/branding), and **decorative icons**
(`i-<n>`, `logo`, `sc.`) — the last because the discussion-questions grid sizes those
foreground icons from the Markdown's `{width= height=}` (§9.4), so trimming would
distort that aspect-driven layout. (This is the same "decorative" vocabulary the EPUB
front-end uses.) Stage 4 derives illustration layout from the page size and Markdown
attributes — not from re-reading the trimmed pixels — so cropping after extraction is
safe. Best-effort: a per-image failure or a degenerate (near-blank) trim is logged and
skipped. Because it only affects image files (not the Markdown), it's attributed to the
`ocr` stage for provenance, so toggling it re-extracts a PDF.

---

## 5A. EPUB front-end (`.epub` → `.llm.md`, no OCR/LLM)

A reflowable EPUB already carries what a PDF makes us reconstruct: the story text as
**digital text**, the illustrations as **separate image files**, and the
bibliographic data as **structured OPF metadata**. So an `.epub` input skips Stages
1–2 entirely — `epubToBloomMarkdown` (`epub/epubToBloomMarkdown.ts`) deterministically
emits the tagged `.llm.md` (YAML front matter + `<!-- text lang field -->` blocks +
image refs) and copies the illustrations into the book folder. No OCR, no LLM, no API
key; `planConversion` maps `.epub` to the `EPUB` artifact whose floor stage is
**plan**, so the run continues straight into Stage 3 → 4.

- **Zip reading** is a small dependency-free reader (`epub/zipReader.ts`, store +
  deflate via Node `zlib`). **Parsing** is regex over the OPF + XHTML (the markup is
  regular); HTML numeric entities (`&#x0254;` etc.) are decoded so non-Latin
  orthographies survive.
- **Page roles** are detected from the spine filenames (`cover`/`title`/`copy`/`back`)
  with a generic `<p>`/`div.p` fallback for non-LFA templates. Cover/back use the
  reserved `cover.jpg`/`back-cover.jpg` names (§5.3) so Stage 4 makes full-bleed
  covers; OPF metadata (title, author, illustrator, ISBN, CC license, publisher,
  funding, topic) becomes `field=` blocks that flow to the dataDiv.
- **Canvas pages (fixed-layout picture books).** When a content page absolutely-positions
  its prose over a full-bleed illustration (StoryWeaver, Library-For-All, …),
  `extractCanvasLayout` reads each block's box from its inline `position:absolute;
left/top/width/height:%` and emits a `canvas-text-boxes="x,y,w,h;…"` page comment + the
  illustration + one text block per box — so Stage 4's `generateCanvasPage` (§9.4)
  reproduces the exact size and location of the picture and each text. A **wordless** page
  of such a book (illustration, no prose — a bare "10/13" page number is not prose) is
  emitted as `full-page-image="true"` → Stage 4 renders a background-only full-bleed page
  (§9.4). This is gated on a per-book "is any content page positioned?" check, so a generic
  reflowable EPUB keeps the document-order origami flow below.
- **Discussion-questions grid (`extractTableCanvas`).** A content page whose prose lives in
  a `<table>` (an icon column beside a question column — the LFA "You can use these
  questions…" page) becomes a canvas too: a synthesized heading box at top, then one
  text box per question, AND **each row's icon kept** as a positioned foreground image
  (`canvas-image-boxes`, §9.4) beside its question. The rows do **not** use even bands:
  like the source table (which sizes every icon to one width and lets each row's height
  follow the figure), each iconned row gets a band whose height is the figure's
  proportional height at the shared icon-column width, so tall standing figures stay big
  and don't overlap their neighbours (icon-less rows get a single text-line band; the
  shared width is solved to fill the page, then scaled down if the stack would overflow).
  (The
  icons are content; dropping them as "decorative" was a bug.) Because the rows are a
  **table**, every question's text shares ONE left edge (a column) and is left-aligned —
  the `tableRows` named style (§9.6) — even an icon-less row, which keeps the column and
  just leaves its icon slot empty (vs. Bloom's centered `Bubble-style` default, which is
  wrong for table cells). The heading is a separate centered paragraph, not a `tableRows`
  row. A links-heavy table is treated as a table-of-contents and left to origami; the
  canvas only triggers for a short (3–12 block) grid.
- **Document-order fallback.** A page without positioned prose is walked in document order
  (`extractContentFlow`): block-level leaves by source position, decorative images skipped,
  consecutive prose grouped, bold/centering recovered from the EPUB's own CSS — so a
  text→image→text page lays out as that origami stack, not one picture over dumped text.
- **Page size.** EPUBs are screen-first, reflowable books, so we always size them as a
  16:9 device page rather than a print A5: `orientationFromAspects` reads the dominant
  illustration aspect (median w/h) and picks `Device16x9Landscape` (median > 1.15) or
  else `Device16x9Portrait` (the default, also when there's too little artwork to judge).
  This is emitted as a `<!-- book page-size=… -->` hint — the same channel the PDF stage
  uses — so Stage 3/4 and the GUI preview honor it.
- **Source alignment for the GUI:** every emitted page carries
  `source-pdf-page="<spine index>"`, and `getEpubPageImage`/`getEpubPageCount` serve
  each spine page's illustration so the GUI's paired preview compares EPUB↔Bloom the
  same way it compares PDF↔Bloom (§13). `process`/`preview`/notify operate on the
  produced book folder, so they work unchanged for EPUB-derived books. The paired
  preview renders spine pages faithfully through a resource proxy; `readEpubEntry`
  strips `<img>`s whose `src` can't resolve in the archive (website-only loaders / remote
  CDN logos) so they don't show as broken-image boxes.
- **Tuning:** the role/text heuristics target the Library-For-All / Vanuatu template;
  other templates convert best-effort (text captured where it's in `<p>`/`div.p`).
  Language is taken verbatim from OPF `dc:language` (a mislabeled OPF carries through).

## 6. Stage 2 — LLM enrichment (`.ocr.md` → `.raw-llm.md` → `.llm.md`)

`llmMarkdown.ts` sends the OCR markdown to an OpenRouter model (default
`google/gemini-3.1-pro-preview`, override `--model`) with the prompt in
`2-llm/llmPrompt.txt` (override with `--prompt`), plus the collection’s language
hints. It is **deterministic** (temperature 0) and sizes `maxTokens` generously
(minority scripts tokenize poorly and we must not truncate “thinking”). Non-`stop`
finish reasons (`length`, `payment`, `content-filter`, …) throw with clear messages.

The LLM’s job (two parts):

1. **Generate YAML front matter** with the languages it finds: `l1`, optional `l2`,
   and a `languages:` map of BCP-47 tag → native name. Unidentifiable text → `unk`;
   non-linguistic → `zxx`.
2. **Annotate text blocks** with `<!-- text lang="…" field="…" -->` comments,
   grouping contiguous same-language/same-field text under one comment, and
   **preserving** the `<!-- page … -->` and `<!-- book … -->` comments and all their
   attributes verbatim (the prompt explicitly lists `type`, `bilingual`,
   `vertical-align`, `horizontal-align`, `background-color`, `canvas-text-boxes`).

**Metadata field names** the LLM may tag (these become `meta.json` / dataDiv fields
in Stage 4): `bookTitle, isbn, license, licenseUrl, licenseDescription,
licenseNotes, copyright, originalCopyright, smallCoverCredits, topic, credits,
versionAcknowledgments, originalContributions, originalAcknowledgments, funding,
country, province, district, author, illustrator, originalPublisher, language`.
(`illustrator`, `copyright`, `licenseNotes`, and the CC `license` also flow into each
image file's XMP in Stage 4 — see 9.6.) Special rule: if there’s **no explicit
copyright but a publisher line** (“Published
by X”), use the organization as the copyright (Stage 4 then strips the “Published
by” prefix deterministically — see 8.6).

Then `post-llm-cleanup.ts` (`attemptCleanup`) fixes common LLM slips and validates:

- strips stray ` ```markdown ` code fences;
- repairs a missing YAML opening `---`;
- reorders a `<!-- text -->` comment that the model put **before** an image to be
  **after** it;
- marks the **last** pure-numeric `zxx` block on each page as `field="pageNumber"`
  (so it’s treated as metadata, not body text; Unicode digit scripts supported);
- validates: no code fences, bounded YAML, has `lang=`, has `l1:` and `languages:`.

`.raw-llm.md` is the model’s raw output; `.llm.md` is the cleaned result. Starting
from `.raw-llm.md` re-runs only the cleanup (deterministic, no API cost).

---

## 7. Stage 3 — Bloom plan (`.llm.md` → `.bloom.md`)

`addBloomPlan.ts` parses the markdown to a `Book`, runs two classifiers, and
re-serializes (so the file stays human-inspectable):

- **`AddPageTypes`** → each page becomes `front-matter` | `back-matter` | `content`
  | `empty`. Heuristic: a page with a metadata `field` (other than `pageNumber`) is
  front-matter if no content page has been seen yet, otherwise back-matter; the
  first page with real (non-`unk`-only) body text flips into `content` and stays
  there. Empty pages (no elements) are `empty`.
- **`isBilingualPage`** → sets `appearsToBeBilingualPage` when a page has two
  consecutive text blocks in different languages (uninterrupted by an image) or a
  single text block carrying more than one language.

These drive Stage 4’s page filtering and the bilingual ordering (V/N1).

---

## 8. The intermediate Markdown format (the contract between stages)

This is the single most important thing to understand. Parse → `Book` → generate is
designed to **round-trip**: `parseMarkdown.ts` reads it into a `Book`,
`generateMarkdown.ts` writes it back. **Anything parsed but not re-emitted is lost** —
that has bitten us, so every page attribute must be handled in both files.

```
---
l1: "en"
l2: "bi"
languages:
  en: "English"
  bi: "Bislama"
normalFontSizePt: 28          # mirrored into the <!-- book --> comment
---

<!-- book normal-font-size="28" normal-font-family="Andika" page-size="A4Portrait" -->

<!-- page index=1 type="front-matter" -->
![cover.jpg](cover.jpg)
<!-- text lang="en" field="bookTitle" -->
# A Thief in the Night

<!-- page index=3 type="content" vertical-align="center" horizontal-align="left"
     background-color="#ffffff" canvas-text-boxes="0.10,0.24,0.69,0.13" -->
![image](image-3-1.png){width=400}
<!-- text lang="en" -->
"Wow, Mum, look!" said Angie.
<!-- text lang="en" field="pageNumber" -->
2
```

- **`<!-- book … -->`** carries `normal-font-size`, `normal-font-family`,
  `page-size`. It is parsed into `FrontMatterMetadata` and **stripped from the body
  before page-splitting** (leaving it in would shift the page-comment↔content
  alignment by one — a real bug we fixed).
- **`<!-- page index=N … -->`** attributes: `type`, `bilingual`, `vertical-align`,
  `horizontal-align`, `background-color`, `canvas-text-boxes` (a `;`-separated list of
  `x,y,w,h` boxes — one per floating text block; the older singular `canvas-text-box`
  is still accepted), `canvas-background-image` (the detected full-page background
  image of a canvas page, §5.6/§9.4), `canvas-image-boxes` (a `;`-separated list of
  `x,y,w,h` boxes for _foreground_ images positioned on a canvas — e.g. the row icons of
  a discussion-questions grid; the page's image elements pair to these in order, §9.4),
  `import-source-hash` (the page-render hash, §5.1/§9.7), and `master-page` (set on a
  page that matched a master and so skipped OCR).
- **`<!-- text lang="X" field="Y" -->`** introduces a text block; `field` is
  optional. One block per contiguous same-lang/same-field run. A block whose content
  is multiple languages is represented as one `TextBlockElement` with a
  `content: { lang: text }` map.
- **Images**: standard `![alt](src){attrs}`; alt/src/attrs preserved verbatim.
- **Untagged text** before the first comment/image becomes a `lang="unk"` block.
  Untagged text **after** an image (mid-page) starts a fresh block in the
  last-seen language rather than being dropped — this is how the separate text
  chunks on a multi-text canvas page (e.g. discussion questions interleaved with
  little figures) survive, since the LLM tags only the first chunk.
- **Page numbers** (`field="pageNumber"`) and **empty pages** do not survive to HTML.

`Book`/`Page`/`PageElement` types live in `packages/lib/src/types.ts`;
`FrontMatterMetadata` in `3-add-bloom-plan/bloomMetadata.ts`.

---

## 9. Stage 4 — HTML generation (`.bloom.md` → `<book>.htm` + `meta.json`)

`html-generator.ts` parses the markdown to a `Book` and emits a Bloom HTML document:
`<head>` (title + `userModifiedStyles`), then `#bloomDataDiv`, then the rendered
pages.

### 9.1 Which pages render — `shouldRenderPage`

- **front-matter / back-matter pages are NOT rendered** as pages. Their field text
  is collected into the dataDiv and **Bloom regenerates the cover/title/credits
  xMatter** from that. (Rendering them caused duplicate title pages — fixed.)
- **Exception:** a page holding `cover.jpg`/`back-cover.jpg` is rendered (full-bleed
  cover, 8.3).
- content (and empty) pages render.

### 9.2 The per-page decision tree — `generatePage`

1. **Cover?** page has `cover.jpg`/`back-cover.jpg` → `generateFullPageCoverPage`.
2. **Canvas?** page has `canvasTextBoxes` (and an image + non-empty text) →
   `generateCanvasPage`; falls through if it can’t be built.
3. **Otherwise → origami** (`origami.ts`): build `OrigamiItem[]` from the page’s
   elements, **dropping page-number blocks and empty text blocks** (an image-only
   page renders as just the image, not an image-over-empty-box split), then recurse
   into split-panes.

Every rendered content page is wrapped as `bloom-page numberedPage customPage
<pageSize>`. The **`numberedPage` class is load-bearing for layout** — and not for
the reason its name suggests: Bloom only assigns the `side-left`/`side-right` classes
to numbered pages, and in `basePage.css` those side classes are what apply the
horizontal page margin (`.bloom-page.side-left { padding-left: var(--page-margin-left) }`;
`.bloom-page` itself sets only top/bottom padding). So a content page **without**
`numberedPage` gets zero left/right padding and its text sits hard against the page
edge (the symptom that prompted this; Bloom's "repair" fixes it by adding
`numberedPage`, after which Bloom adds the side class). Coupling a layout margin to a
"page number" class is arguably a Bloom CSS bug, but fixing that isn't this project's
job. We deliberately **don't** emit the other things Bloom's repair adds
(`data-pagelineage`, `pageLabel`, `pageDescription`) — they don't affect layout and
Bloom regenerates them. `validateBloomHtml.ts` checks the generated HTML for the two
things that matter (every content page has `numberedPage` and a non-empty `id`) and
logs each problem (non-fatal), so the regression can't return silently.

### 9.3 Full-bleed covers — `generateFullPageCoverPage` + dataDiv entries

Bloom’s current cover mechanism is **custom layout**, not the old
`data-book="coverImage"`. We emit, in the dataDiv,
`data-book="customOutsideFrontCover"` / `customOutsideBackCover` containing a
`bloom-canvas`/`bloom-backgroundImage` with the cover image, and a matching visible
`bloom-customLayout` cover page. The cover `<img>` carries
`data-copyright/creator/license` + `onerror` (without these Bloom prunes the image
file on import) and `data-book-inactive="coverImage"`. Bloom regenerates the visible
cover from the dataDiv entry on import.

When a full-page front cover is present we also (a) emit a head
`appearanceCoverBackgroundColor` style forcing `--cover-background-color: white`
(so Bloom doesn't paint the branding color around the art or behind the unused
inside covers), (b) emit `<meta name="preserveCoverColor" content="true">` — without
it Bloom's `Book.InitCoverColor()` assigns a **random** cover color on load
(overwriting our white), because its cover-color gate only recognizes the legacy
`.coverColor` rule, not our `--cover-background-color` variable — and (c) write
`appearance.json` (see 9.6) with `cover-background-color: white`. And because a full
cover (or any canvas page) means the art runs to the edge, `appearance.json` sets
`fullBleed: true` so Bloom drops the page margins — without it the cover sits inside
the 12 mm margin and shows a white border.

### 9.4 Canvas pages — `generateCanvasPage`

For a background image + one or more floating text blocks. The background image is
taken from **`canvas-background-image`** (the Stage-1-detected full-page image,
§5.6) when present, otherwise the page's first image element — so the picture
survives even when the OCR/LLM emitted no `![image]` ref for it. Emits the reference
structure: a `bloom-page numberedPage … bloom-combinedPage` with
`data-tool-id="canvas"` and the Canvas template `data-pagelineage`; inside, a
`bloom-backgroundImage` canvas-element filling the canvas, plus **one
absolutely-positioned `bloom-canvas-element` per text block** (`left/top/width/height`
px from that block's box), each holding a `bloom-translationGroup` with a
`Bubble-style` editable. The canvas (`data-imgsizebasedon`) is sized to the page
aspect ratio so the full-bleed image fills it with no letterbox, and each box's
fractions map straight to px. When the number of text blocks doesn't match the
number of detected boxes, it first **splits the blocks into paragraphs** (blank-line
separated) and uses those if the paragraph count matches the boxes — this recovers
the common case where the LLM tagged two visually-separate chunks (e.g. the last
question and the footer) as one block; only if that still doesn't line up does it
merge all the text into one box so nothing is dropped. Validated on `volcano.pdf`
(single caption) and the LFA "discussion questions" page (heading + five questions +
footer → 7 separate positioned elements).

**Foreground images (`canvas-image-boxes`).** Besides the single background, a canvas
page can carry _positioned foreground images_: the page's image elements pair, in order,
to the boxes in `canvas-image-boxes`, each rendered as its own `bloom-canvas-element`
(image container, no object-fit-cover, so the figure is contained not cropped) stacked
above the text. This is how the EPUB discussion-questions grid keeps the little
reader-figure icon beside each question (§5A) — they are content, not decoration. When
`canvas-image-boxes` is present the image elements are foreground icons, so the
element-based background fallback is suppressed (the background comes only from
`canvas-background-image`, or there is none — the white questions page).

These icons came from one table column where the source sized them all to a single width
(heights following each figure's own aspect). The EPUB front-end (§5A) reproduces that by
giving every icon's box the **same column width** and a band height equal to that figure's
proportional height — so Stage 4 simply fills each box's width and takes the height from
the figure's own aspect (`width = box width`, `height = width / aspect`): same width across
icons, no cropping, no distortion. This replaced an earlier scheme that fitted a common
width into fixed even-height bands, where a single tall figure dragged every icon's width
down to a fraction of the column. The figures' intrinsic pixel sizes ride to Stage 4 on
the image's markdown `{width=… height=…}` attributes (the EPUB front-end reads them from
the image headers); when a size is unknown the icon just fills its box.

If the page has a detected `background-color` (5.6), it is applied to the page div
as Bloom’s `--page-background-color` custom property — the canvas art fills only
the marginBox, so without this the 12 mm page margin shows an ugly white border.

### 9.5 Origami layout — `origami.ts`

Recursive split-panes (`split-pane` / `split-pane-component` / `split-pane-divider`).
`generateTextBlock` emits a `bloom-translationGroup` with one `bloom-editable
normal-style` per language; `generateImageBlock` emits a `bloom-canvas` background
image with **precomputed canvas-element px** (`origamiPaneRect`) sizing the image to
the pane it will occupy — full width × its height share of the vertical stack (panes
nest right-leaning 50/50, so item _i_ gets `1/2^(i+1)`, the last the same as its
predecessor). Without this the canvas-element has no dimensions and the image renders
as a tiny box in any static preview/thumbnail (so even a tightly-trimmed illustration
— see §5.8 — still looked small); with it, `object-fit:contain` fills the pane. Bloom
recomputes this geometry on first view, so the rect only affects the preview, never the
edited page.

- **Vertical alignment** → `bloom-vertical-align-{top|center|bottom}` class on the
  translationGroup. **Horizontal** → inline `text-align` on the editable.
- **Bilingual ordering**: a sole-L2 page’s text gets `data-default-languages="N1"`; a
  bilingual Text-Image-Text page gets `V` on the first text block and `N1` on the
  third (controls which language shows first).

### 9.6 The dataDiv, styles, page size, meta.json

- **`#bloomDataDiv`** (`generateBloomDataDiv`): `contentLanguage1` (= `l1`),
  `contentLanguage2` only if **>50%** of pages are bilingual, the cover entries
  (8.3), and one `data-book` div per metadata field — grouped, markdown→HTML inlined,
  multiple values joined with `<br>`. Field fix-ups: **ISBN** stripped to digits and
  set `lang="*"`; **copyright** stripped of a leading “Published by”; **license ↔
  licenseUrl** filled in from each other via `licenses.ts`, and — when neither is
  present — recovered from a Creative Commons URL embedded in the prose
  `licenseDescription`/`licenseNotes` (`resolveCcLicenseUrl`), since OCR/LLM output
  often leaves the whole CC statement there without a structured token.
- **`userModifiedStyles`** (`generateUserModifiedStyles`): emits the detected body
  font as `.normal-style { font-size: Npt }` + `.normal-style[lang="L1"] { …
font-family }`, and the **same rules for `.Bubble-style`** so canvas captions match
  the body. Editables carry the `normal-style` class. A text block may also request a
  **named style** via `TextBlockElement.style` (round-tripped as `style="…"` on the
  `<!-- text -->` comment); `generateCanvasPage` then puts `<name>-style` on the editable
  instead of `Bubble-style`, and this method emits a matching `.<name>-style` rule. The
  one in use today is **`tableRows`** (discussion-question rows, §5A), which adds
  `text-align: left` — a table cell's HTML default — so the questions aren't centered by
  Bloom's `Bubble-style` default; emitting it as a style (not inline) lets an editor
  restyle all the questions together in Bloom.
- **Page size**: every `bloom-page` (content + covers) gets the detected size class
  (e.g. `A4Portrait`), replacing the old hard-coded `A5Portrait`. `pagePx` converts a
  size class to px at 96 dpi minus a 12 mm margin (Bloom’s `--page-margin`).
- **`meta.json`** (`metaJson.ts`): `bookInstanceId` (new UUID, or **preserved** when
  updating so Bloom refreshes rather than duplicates), `formatVersion`,
  `nameLocked: true` (so Bloom keeps our folder name instead of renaming to the
  title), `pageCount` = **content pages only**, plus title/author/license/etc. The
  license is resolved (token, `licenseUrl`, or a CC URL in the prose description via
  `resolveCcLicenseUrl`) and normalized to a Bloom token (`cc-by-nc-nd`, else `custom`).

- **`appearance.json`** (`metaJson.writeAppearanceJson`): for full-bleed-style books
  (a full-page cover or any canvas page) we write `{ fullBleed: true }` so Bloom
  renders with no page margins, plus `cover-background-color: "white"` when there's a
  full-page front cover. Merged over any `appearance.json` Bloom already wrote; a
  no-op for ordinary bordered books.

The book HTML is written as `<bookFolder>/<bookFolder>.htm` (the name Bloom reads),
and a stray `index.html` from older runs is removed.

- **Image XMP metadata** (`imageMetadata.writeImageMetadata`): after the HTML and
  `meta.json` are written, we stamp **every image in the book folder** (`image-*.png`,
  `cover.jpg`, `back-cover.jpg`; placeholder/license/thumbnail are skipped) with the
  book's intellectual-property metadata, using the **same XMP tags SIL libpalaso
  reads back** so a running Bloom recognizes them (attributes the artist, builds image
  credits). The mapping — verified against Bloom's `ImageUpdater.cs` and libpalaso's
  `ClearShare.MetadataCore`:

  | Book field (`collectFields`)                    | XMP tag                     | Notes                                                                                                                                                                                            |
  | ----------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `illustrator`                                   | `XMP-dc:Creator`            | the image's "Creator" = the artist                                                                                                                                                               |
  | `copyright`                                     | `XMP-dc:Rights` (x-default) |                                                                                                                                                                                                  |
  | `licenseNotes`                                  | `XMP-dc:Rights` (lang `en`) | only written alongside a copyright, matching libpalaso                                                                                                                                           |
  | `licenseUrl` / `license` / `licenseDescription` | `XMP-cc:License`            | Creative-Commons only, via `resolveCcLicenseUrl`: a ready `licenseUrl`, a `license` token, or a CC URL recovered from the prose `licenseDescription`/`licenseNotes`. Custom licenses are skipped |

  Written via the `exiftool-vendored` package (externalized in the lib build like
  `sharp`, since it ships a platform exiftool binary). Uses `-overwrite_original` so no
  `*_original` backups are left behind. **Best-effort:** a per-image failure is logged
  and skipped, and a missing/unusable exiftool never aborts the conversion. One
  book-level illustrator is applied to all images (no per-image artist support yet).

### 9.7 Master-page substitution — `master/masterPages.ts`

**The problem.** A publisher's books often share the same hand-built, complex pages
(license/credits, "You're reading Level 4", "Did you enjoy this book?") that OCR
can't reconstruct faithfully. Rather than fight them on every book, we build **one
"master" book**, perfect those pages in Bloom, and **drop them into every other
import** when we recognize them.

**Recognition is by a perceptual page-render hash.** Each source page's raster is
hashed in Stage 1 (§5.1, a 64-bit dHash) and carried as `import-source-hash`. A book
folder ending in `master` holds the canonical pages, each tagged with the
`data-import-source-hash` of the source page it replaces. On a normal import we build
a `hash → {page HTML, images}` map from the master (`loadMasterPages`) and, after
Stage 4 generates the HTML, `applyMasterPages` post-processes it. Matching is by
**Hamming distance ≤ `PERCEPTUAL_MATCH_MAX_DISTANCE` (10/64)`** (`hashesMatch`), and
when several master pages are within range the closest one wins:

- **matched page** (its `data-import-source-hash` is in the map) → the generated
  placeholder div is replaced with the **master's exact page HTML**; the master's
  referenced images are copied into the book folder under collision-proof names
  (`m<hash8>-<original>`), the spliced `src`s are rewritten to match, and the page
  gets a fresh `id`.
- **unmatched page** → kept as-is, but its internal `data-import-source-hash` marker
  is **stripped** (so normal books stay clean). In `--emit-source-hashes` mode the
  whole post-process is skipped and every hash is kept.

For matched pages the OCR call is also skipped in Stage 1 (cost saving), and
`master-page="true"` forces the page to render as a splice placeholder even if it
was classified back-matter (which `shouldRenderPage` would otherwise drop).

**Hybrid "template" master pages (fill text from source).** Wholesale substitution
fits pages that are identical across books, but some shared pages have a **constant
layout/images yet per-book text** — the LFA "You can use these questions…" page, whose
four reader-figure icons and positions are fixed but whose questions change per book. A
master page is treated as a **fill-template** (`isTemplateMasterPage`) when it has at
least one **fill-slot**: a text box whose visible text is empty or begins with `(` (e.g.
a `(first question)` hint the author types so the slot is self-documenting in Bloom). This
works for both layout kinds — a canvas page (`bloom-canvas-element`) and a regular origami
page (text in a `bloom-translationGroup` inside a split-pane, e.g. an "About the author"
page) — because slot detection iterates `bloom-translationGroup`, which wraps the editable
in either case. For a template match, `applyMasterPages` runs `fillTemplatePage` first: it takes
the master's text boxes and the source page's text boxes each in **reading order**
(positioned canvas boxes by `top`; flow/origami boxes by document order, which is their
visual order) and zips them 1:1 — a verbatim box (the heading) keeps its
own words and ignores its partner; a slot box takes its partner's text. So the author
mirrors the source's block structure (type the fixed boxes, leave the variable ones
blank/parenthetical) and the questions land in order, including the icon-less row. The
layout, images, and positions all come from the master — the source's (often
badly-laid-out) geometry is discarded, which is the whole point. A count mismatch is
logged and a surplus slot is **blanked** (a `(hint)` must never reach a real book).
Mechanics: such a page must NOT collapse to a placeholder in Stage 1/the EPUB front-end
(its text has to survive to Stage 4), so a template match keeps the page's real content;
the EPUB front-end is told the template hashes for this (`epubToBloomMarkdown`'s
`templateHashes`). Because an EPUB page is hashed by its main image — and a grid page's
icons are all "decorative" (`i-N.jpg`) — such a page would otherwise get _no_ hash; the
front-end falls back to hashing the first image so the page is still mappable, and since
that icon is identical across a publisher's books the page hashes the same everywhere
(**one mapping serves every book**). The fresh-`id` rewrite matches a whitespace-preceded
` id=` (not a `\b`-boundary one) so it can't clobber `data-tool-id="canvas"` on a canvas
master page, and `placeHolder.png` (Bloom's empty-canvas-background built-in) is left for
Bloom to supply rather than copied.

**Building a master.** Run a representative book with `--emit-source-hashes` so every
page carries `data-import-source-hash`; open it in Bloom, perfect the complex pages,
delete the rest, and **rename the folder to end in `master`**. Subsequent imports
into that collection substitute automatically. For a template page, additionally clear
its variable text boxes to blank or a `(hint)` so they act as fill-slots (the heading
and any other fixed text stay as typed), and map the source page to it in the GUI.

**Robustness, measured this session:**

- The perceptual hash tolerates re-compression: across a full-res PDF and a heavily
  compressed copy (37 MB → 1.25 MB), every shared page hashed to within **0–2 bits**,
  while distinct pages differed by **≥ 18** — so the threshold of 10 separates them
  with wide margin. Build the master from your full-resolution PDFs; it still matches
  the compressed copies used in repo tests.
- Bloom **preserves `data-import-source-hash`** on the page divs across a save
  (verified on Bloom 6.5.0), so the master's hashes survive hand-editing in Bloom.
- Residual risk: two genuinely look-alike pages (e.g. blank pages) can fall within
  10 bits of each other. Masters only tag the specific boilerplate pages, and the
  closest match wins, so this hasn't caused a wrong substitution — but don't tag a
  blank/near-empty page in a master.

---

## 10. Stage 5 — notify a running Bloom — `notifyBloom.ts`

Best-effort, never fails the conversion. Scans candidate ports (8089 + 3·n), asks
each `/bloom/api/common/instanceInfo` whether its open collection is this book’s
parent, and if so POSTs `/bloom/api/external/update-book` `{id, folderPath}` so Bloom
adds/refreshes the book live.

> **Known issue (observed in this session):** the current BloomBeta build’s
> `instanceInfo` no longer returns `editableCollectionFolder`, and `update-book`
> returns 404 — so auto-import silently no-ops on that build. Workaround: reload the
> collection in Bloom so it rescans the folder. This contract likely needs updating.

---

## 11. The variety of inputs we handle, and how

| Variety                                                         | How we detect/handle it                                                                                                                                                    |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EPUB input**                                                  | EPUB front-end (§5A): digital text + separate images + OPF metadata → `.llm.md` directly, no OCR/LLM. Best-effort beyond the LFA template.                                 |
| **Scanned vs text PDFs**                                        | `gpt`/`mistral` OCR read rendered text (works on scans); `unpdf` reads the text layer (text PDFs only, and may surface hidden text).                                       |
| **Page size** (A4/A5/Letter/…)                                  | `detectNormalStyle` maps PDF points → Bloom size class; emitted on every page so Bloom uses the right paper.                                                               |
| **Body font size/family**                                       | `detectNormalStyle` (char-weighted dominant) → `normal-style`/`Bubble-style` in `userModifiedStyles`. Family is best-effort; Bloom falls back if not installed.            |
| **Full-bleed cover art**                                        | `coverDetection` (≥85% image coverage) → `prepareCovers` renders `cover.jpg`/`back-cover.jpg` → Stage 4 full-bleed custom-layout cover via dataDiv.                        |
| **Interior full-page art + caption (canvas)**                   | `detectCanvasPages` (full-page image + text bbox) → Stage 4 Canvas page with positioned Bubble text.                                                                       |
| **Plain full-page illustration (no text)**                      | image-only page → single image block (empty LLM text blocks are dropped).                                                                                                  |
| **Solid colored page backgrounds**                              | vision-formatting border-sampling → `--page-background-color` on the page. Only genuinely solid pages are tinted (illustrations are not).                                  |
| **Text alignment**                                              | vision-formatting → vertical-align class + horizontal text-align.                                                                                                          |
| **Bilingual pages**                                             | `isBilingualPage` → V/N1 ordering + `contentLanguage2` when majority bilingual.                                                                                            |
| **Title/credits/copyright**                                     | classified as front/back-matter, **not rendered**; their fields go to the dataDiv and Bloom rebuilds xMatter. Title-page **pictures are dropped** (Bloom can’t show them). |
| **Publisher-only copyright**                                    | LLM uses publisher as copyright; Stage 4 strips “Published by”.                                                                                                            |
| **License as name or URL**                                      | `licenses.ts` fills the missing one; `meta.json` normalizes to a Bloom token.                                                                                              |
| **Page numbers**                                                | OCR drops them; cleanup marks stragglers `field="pageNumber"`; never rendered.                                                                                             |
| **Untagged / unknown-language text**                            | wrapped as `lang="unk"`; doesn’t flip a page to “content”.                                                                                                                 |
| **Non-linguistic content**                                      | `lang="zxx"`.                                                                                                                                                              |
| **Marketing back-matter** (e.g. “Did you enjoy this book?”)     | treated as content; if a master book provides a matching page it is **substituted** wholesale (§9.7). Otherwise it falls through as ordinary content.                      |
| **Shared complex/boilerplate pages across a publisher's books** | **master-page substitution** (§9.7): hash-match each source page against a `*master` book and splice in its hand-perfected HTML + images.                                  |

---

## 12. Caching & round-trip principles (why it’s built this way)

- **Markdown is the cache.** OCR, vision alignment, background color, normal-style,
  page size, canvas boxes, and covers all bake into `.ocr.md` (page/book comments +
  image files). Re-running from `.ocr.md`/`.llm.md`/`.bloom.md` costs no API calls.
- **Idempotent vision**: a page already carrying `vertical-align=` is skipped.
- **Round-trip discipline**: if you add a page attribute, you must (1) add it to the
  `Page` type, (2) parse it in `parseMarkdown`, (3) re-emit it in `generateMarkdown`,
  and (4) tell the LLM prompt to preserve it. Miss any and it’s silently dropped.
- **Bloom owns xMatter**: give it data (dataDiv) + content pages; don’t hand it
  title/credits pages.

---

## 13. Testing & validating

- `pnpm test:lib` / `vp test run`. Two `llmMarkdown.test.ts` tests fail without
  `OPENROUTER_KEY` — that’s expected.
- End-to-end: `pnpm cli <pdf> --collection recent --vision-formatting`. Inspect the
  staged `.ocr.md` / `.llm.md` / `.bloom.md` / `.htm` in the book folder.
- **Visual validation in the running Bloom over CDP**: Bloom exposes a CDP endpoint
  (e.g. `http://localhost:8091`). You can `connectOverCDP` with Playwright (the Bloom
  worktree has it), read the book-preview iframe’s `.bloom-page`/canvas-element DOM
  to check page size, background colors, and positioning, and screenshot it. Useful
  because Bloom recomputes canvas geometry on first view, so the live DOM is the
  source of truth. (See session history for the exact scripts.) When Bloom won’t
  auto-import (see §10), render our generated page standalone with the real images to
  confirm positioning.

---

## 14. Vestigial code, gotchas, and open issues

- **Unused OCR paths**: `unused-pdfToMarkdownAndImageFiles-OpenRouter.ts` (the
  `--parser` plugin path), `unused-PdfToImages-pdfjsextractImagesFromPdf.ts`,
  empty `pdfHybrid.ts`.
- **`--parser`** only matters to the unused OpenRouter file-parser path; the live GPT
  path renders page images and ignores it.
- **`--imager`**: only `poppler` is implemented.
- **Mistral OCR model** is hard-coded (`mistral-ocr-latest`); no override.
- **`gemini` OCR alias** value `google/3.1-pro-preview` looks like a typo (missing
  `gemini-`); verify before relying on it.
- **notify-bloom API is stale** for the current Bloom build (§10).
- **Bilingual flag is one-way**: `isBilingualPage` can set `appearsToBeBilingualPage`
  but won’t clear an explicit `false`.
- **`bloom-frontMatter`/`bloom-backMatter` page classes** are emitted but Bloom may
  delete/regenerate them (noted as TODO in code).
- **Marketing back-matter** isn’t auto-distinguished from content, but a master book
  can substitute specific such pages (§9.7).
- **Master substitution uses a perceptual hash** (dHash, Hamming ≤ 10/64), so it
  tolerates re-compression/downsampling between the master's source and the imported
  books. Don't tag near-blank pages in a master (they can collide perceptually).

---

## 15. Code map (where to look)

- CLI: `packages/cli/src/{index,process,processUtils}.ts`
- Stage 1: `packages/lib/src/1-ocr/` — `pdfToMarkdown.ts`,
  `pdfToMarkdownAndImageFiles-Mistral.ts`, `pdfToMarkdownWithUnpdf.ts`,
  `pdfToImages.ts`, `coverDetection.ts`, `prepareCovers.ts`, `renderPdfPage.ts`,
  `visionFormatting.ts`, `detectNormalStyle.ts`, `detectCanvasPages.ts`,
  `trimImageWhitespace.ts` (§5.8), `poppler.ts`
- Stage 2: `packages/lib/src/2-llm/` — `llmMarkdown.ts`, `llmPrompt.txt`,
  `post-llm-cleanup.ts`
- Stage 3: `packages/lib/src/3-add-bloom-plan/` — `addBloomPlan.ts`, `bloomMetadata.ts`
- Markdown contract: `packages/lib/src/bloom-markdown/` — `parseMarkdown.ts`,
  `generateMarkdown.ts`; types in `packages/lib/src/types.ts`
- Stage 4: `packages/lib/src/4-generate-html/` — `html-generator.ts`, `origami.ts`,
  `markdownToHtml.ts`, `metaJson.ts`, `licenses.ts`, `validateBloomHtml.ts`
  (structural well-formedness check on the generated HTML), `imageMetadata.ts` (image XMP)
- Master substitution: `packages/lib/src/master/masterPages.ts`,
  `packages/lib/src/1-ocr/pageImageHash.ts` (perceptual hash + `hashesMatch`)
- Background color (canvas + solid pages): `packages/lib/src/1-ocr/detectBackgroundColor.ts`
- Stage 5: `packages/lib/src/5-notify-bloom/notifyBloom.ts`
