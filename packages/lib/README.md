# @bloombridge/lib

The core Node.js library that converts PDF and ePUB documents into Bloom-compatible
HTML, through OCR, LLM processing, and HTML generation.

> This README describes the conversion pipeline and its features at a conceptual level —
> what each stage does and how the library behaves. For the command-line front end and
> its flags, see [`@bloombridge/cli`](../cli/README.md). For the full architecture
> reference (every stage in depth, the intermediate Markdown format, known issues), see
> [`conversion-process.md`](../../conversion-process.md).

## The conversion pipeline

Conversion from a source document to a Bloom book is a four-stage process. The Markdown
artifact written between stages doubles as a cache, so a later run can start from any
stage rather than redoing earlier work.

1. **OCR** — read the source document into raw Markdown (plus extracted images).
2. **LLM enrichment ("tagging")** — an LLM annotates the Markdown with comments that
   identify text blocks, languages, and metadata fields.
3. **Bloom plan** — the tagged Markdown is turned into a plan of Bloom pages and
   elements.
4. **HTML generation** — the plan is rendered to Bloom-compatible HTML.

The stages correspond to Markdown artifacts:

- `*.ocr.md` (or `*.md`) — raw Markdown from the OCR system (images as `img-*.jpeg`)
- `*.llm.md` — Markdown that has been tagged by an LLM
- `*.bloom.md` — Markdown that is ready for the final stage of conversion to Bloom HTML

### OCR

The default OCR path renders each page and reads it with a capable LLM. Other engines
are available — a different LLM, Mistral OCR, or `unpdf`. The default render-each-page
path is what enables per-page layout analysis (cover detection, vision formatting,
canvas-page detection, perceptual page hashing); the Mistral and `unpdf` paths don't
render pages and so don't support those features.

### LLM enrichment

An LLM reads the OCR Markdown and annotates it: identifying which spans are body text vs
metadata, detecting languages (using any supplied language hints — see below), and
filling metadata fields (title, author, license, etc.). Output is the `*.llm.md`
artifact.

### Language hints from Bloom Collections

The pipeline can detect the expected languages of a document from a Bloom Collection's
settings (the `.bloomCollection` file's L1/L2/L3). Supplying these as hints gives:

- **More accurate language detection** — the LLM knows what languages to expect.
- **Consistent language codes** — the same BCP 47 language tags as the collection.
- **Better metadata extraction** — language-specific content is properly identified and
  tagged.

### Vision formatting

A vision model looks at each rendered page and detects its text alignment (vertical:
top/center/bottom; horizontal: left/center/right) and background color. These are baked
into the `.ocr.md` page comments and carried through to the Bloom HTML (e.g.
`bloom-vertical-align-center`, an inline `text-align`, and a page `background-color`).

It needs a PDF input and an OpenRouter key; if either is missing it is skipped with a
warning and the conversion still completes. Results are cached in the `.ocr.md`, so
re-running later stages does not re-pay for the vision calls — to regenerate, re-run
starting from the PDF. By default the vision pass uses a capable Google Gemini model.

### Image metadata (illustrator, copyright, license)

When generating Bloom HTML, the library copies the book's intellectual-property metadata
into the **XMP of every image** in the book folder, using the same tags Bloom reads. In
particular the **illustrator** becomes each image's _Creator_, so Bloom attributes the
artist and can build image credits. It also writes the copyright, license notes, and —
for Creative Commons licenses — the license URL. The CC license is recognized even when
the book only carries it as prose (e.g. a "This work is licensed under… visit
http://creativecommons.org/licenses/by-nc-nd/4.0/" description), and the same resolution
feeds `meta.json` and the book's license fields.

This is automatic and best-effort: if metadata can't be written to an image, that image
is skipped and the conversion still completes. One book-level illustrator is applied to
all images.

### Master-page substitution (shared boilerplate pages)

When a whole set of books from one publisher share the same complex, hand-built pages
(license/credits, "You're reading Level 4", "Did you enjoy this book?", etc.), you can
build **one "master" book** with those pages perfected in Bloom and have every other
import drop them in automatically.

How it works: every source page is fingerprinted with a perceptual hash. If a page
matches one held by a master book, OCR is skipped for it and the master's exact page
HTML + images are spliced into the result. Matching is perceptual, so a master built
from full-resolution PDFs still matches the same page in a re-compressed copy. Any book
sent to a collection that contains a `*master` folder has its matching pages substituted
automatically — the log shows `matched master, skipping OCR` and `Substituted master
page …`.

Notes:

- Only the default render-each-page OCR path produces the hashes, so this works on the
  LLM-OCR paths, not Mistral/`unpdf`.
- Don't keep blank/near-empty pages in a master — perceptually they look alike and could
  match the wrong page.

### Importing complex pages as images

Some pages are too intricate to rebuild as editable text — e.g. a "discussion questions"
page with a heading, several differently-aligned questions interleaved with little
figures, and a footer. Rather than approximate them, the importer can render such a page
to a **single full-page image** (the same way it handles full-bleed covers), so it looks
exactly like the original. The trade-off: that page's text is then a picture — not
editable, translatable, or searchable in Bloom.

This is the translatability-vs-fidelity tradeoff. Which pages get snapshotted is
configurable along an additive scale (each level snapshots strictly more than the one
above):

| level       | behavior                                                                             |
| ----------- | ------------------------------------------------------------------------------------ |
| `covers`    | only image covers — rebuild every interior page as editable text                     |
| `busy`      | also snapshot canvas pages too busy to convert well (≥ `BUSY_THRESHOLD` text blocks) |
| `anyCanvas` | also snapshot any page with text over a picture (every canvas page)                  |
| `all`       | snapshot **every** page (maximum fidelity; nothing editable/translatable)            |

The common canvas page (a picture with one block of text on it) stays editable at
`covers`/`busy` and only snapshots at `anyCanvas`. Each snapshotted page carries a
`data-conversion-note` recording why and how to change it. This requires a PDF input
(the page is rendered from the PDF), so it runs on the render-each-page OCR paths.

**`all` is a different mode** from the per-page choices. Instead of judging each page, it
imports **every** PDF page as a full-page image, producing a Bloom book that looks
exactly like the source with no per-page reconstruction. To still fill in the book's
metadata (title, author, license) and detect its languages for Bloom, it OCRs just a
handful of pages — the **first 4 and the last 2** — and runs the LLM on those. It
**skips** all per-page layout analysis: cover detection, vision formatting, and
canvas-page detection are all turned off. (On the Mistral and `unpdf` paths the OCR
can't be limited to a few pages, so this saving applies only to the default path; every
page is still imported as an image.)

## Installation

```bash
pnpm add @bloombridge/lib
```

## Usage

```typescript
import {
  pdfToBloomFolder,
  makeMarkdownFromPDF,
  tagMarkdown,
  mdToBloomHtml,
} from "@bloombridge/lib";

// Convert PDF directly to Bloom HTML
const bloomHtmlPath = await pdfToBloomFolder("./document.pdf", "./output", "your-mistral-api-key");

// Or use individual functions
const markdown = await makeMarkdownFromPDF("./document.pdf", "./output", "your-mistral-api-key");
const taggedMarkdown = await tagMarkdown(markdown, "your-openrouter-api-key");
const bloomHtml = await mdToBloomHtml(taggedMarkdown);
```

## API

### `pdfToBloomFolder(pdfPath, outputDir, mistralApiKey, logCallback?)`

Complete pipeline that converts a PDF to Bloom HTML format.

### `makeMarkdownFromPDF(pdfPath, outputDir, mistralApiKey, logCallback?)`

Extract and convert PDF content to markdown using MistralAI.

### `tagMarkdown(markdown, openRouterApiKey, options?)`

Enhance the markdown content using an LLM.

### `mdToBloomHtml(markdown, options?)`

Convert markdown to Bloom-compatible HTML format.
