# Plan: Faithfully importing "A Thief in the Night" into Bloom

_Last updated: 2026-06-02. Branch: `migrate-to-vite-plus`._

## Goal

Make `@pdf-to-bloom` able to faithfully import
`large-local-test-inputs/4788 A Thief In The Night_2xpage A4.pdf` into a **valid**
Bloom book that includes:

- All metadata (title, author, illustrator, publisher, ISBN, license, copyright, reading level, description/subjects).
- **Full-bleed pages** — i.e. select the correct Bloom appearance theme so illustrations run edge-to-edge.
- **Custom covers** — the front and back covers are full-page art and must be preserved as such, not regenerated as plain Bloom xMatter covers.
- Where possible, capabilities are confirmed by tests run against this document.

"Done" = this plan reflects where the code is and the concrete steps to get there, with test evidence for the current state.

---

## Ground truth — what this book actually contains

Source of truth is the companion EPUB (`4788 A Thief In The Night.epub`), which we unpacked and read. The book is a **Library For All** Vanuatu LDS reader.

### Metadata (from `OEBPS/content.opf`)

| Field            | Value                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Title            | A Thief in the Night                                                                                                                    |
| Author / creator | Vanessa David Nimbwen                                                                                                                   |
| Illustrator      | Viktoria Khmelnickaya (from copyright page)                                                                                             |
| ISBN             | 978-1-923429-63-5                                                                                                                       |
| SKU              | 04788                                                                                                                                   |
| Publisher        | Library For All Ltd                                                                                                                     |
| First published  | 2025                                                                                                                                    |
| License          | CC BY-NC-ND 4.0 (`http://creativecommons.org/licenses/by-nc-nd/4.0/`)                                                                   |
| Language         | en                                                                                                                                      |
| Reading level    | Reading Level 4                                                                                                                         |
| Collection       | Vanuatu LDS Collection                                                                                                                  |
| Description      | "Jade and his mother hear a strange noise in the night! A thief has come to steal their bananas, but their dogs know just how to help." |
| Subjects         | family, security, crime, pets (+ BISAC JUV043000, JUV030080)                                                                            |
| Funding credit   | The Church of Jesus Christ of Latter-day Saints + Global Partnership for Education (GPE)                                                |

### Page inventory (EPUB spine order)

1. **cover** — full-page art `cover.jpg` (492×700, ~A5 portrait ratio). Custom cover.
2. **title** — `title.jpg`
3. **copy** (copyright/credits) — logos, publisher, license, illustrator, ISBN, funding.
4. **p-1 … p-9** — illustration (`p-N.jpg`, 424×600) + 1–2 paragraphs of story text. 9 content pages.
5. **question** — comprehension questions with icon images (i-1…i-4).
6. **author** — "About the author" text + photo (`about.jpg`).
7. **lfa** — Library For All info page.
8. **level** — reading-level badge image (`level.jpg`).
9. **back** — full-page art `back.jpg` (492×700). Custom back cover.

Implications:

- Page size is **A5Portrait** (492×700 ≈ 0.70 ratio; A5 = 0.705).
- Covers are **full-bleed images** → custom covers + full-bleed appearance.
- Content pages are image + text → in Bloom these become full-bleed illustration pages with an overlaid/positioned text block (the "faithful" interpretation of the print `2xpage A4` PDF).
- There is real front-matter (title, credits) and real back-matter (questions, author, LFA, level, back cover) that must map to Bloom xMatter + content pages correctly.

---

## Current state of the code (with test evidence)

### Pipeline (per `CLAUDE.md` and `packages/lib/src`)

1. `1-ocr/` PDF → markdown + extracted images (Mistral / OpenRouter / unpdf).
2. `2-llm/` enrich markdown, detect languages, tag fields.
3. `3-add-bloom-plan/` add Bloom metadata / page-type plan.
4. `4-generate-html/` emit HTML (`html-generator.ts`, `origami.ts`).

### What works

- PDF interpretation / OCR / LLM tagging (the user's recollection that this part is solid appears correct).
- Bilingual text handling via `bloom-translationGroup` / `bloom-editable` with `lang`.
- Split-pane (Origami) layout generation for stacked text/image content.
- Image extraction (poppler) into the book folder.

### What is missing or broken — confirmed by tests

**Test 1 — current output fails Bloom's own validator.**
Ran the skill validator on an existing generated book:

```
node D:/bloom/.github/skills/edit-bloom-book/validateBloomBook.mjs \
     test-outputs/children-come/index.html
→ FAIL
  - Each .bloom-page must have a non-empty id.   (×9 — every page)
```

So **no generated book is currently a structurally valid Bloom book.**

**Test 2 — structural inspection of generated HTML** (`test-outputs/children-come/index.html`):

- `.bloom-page` divs have **no `id`**, no page-size class (`A5Portrait`), no `numberedPage`/`data-page`, no `.pageLabel`, no `.pageDescription`. Only `bloom-page customPage [bloom-frontMatter]`.
- Front matter (language name, title, cover image) is **hand-built as deeply nested split-panes** inside a `customPage`. This is the wrong model: Bloom **regenerates xMatter** (cover/title/credits) from `#bloomDataDiv` + the collection's xMatter pack. Hand-built front-matter pages will be discarded or duplicated.
- No `meta.json` is produced (confirmed in code — the converter writes only `index.html` + images + intermediate `.md` files).
- No `appearance.json`, no `fullBleed`, no `bloom-mediaBox` wrappers, no `body class="bloom-fullBleed"`.
- No custom-cover markup (`data-xmatter-page="frontCover"`, `data-custom-layout-id`, cover background image).

**Test 3 — validation in this repo is minimal.** `3-add-bloom-plan/bloomMetadata.ts::validateMetadata` only checks YAML front-matter (`languages`, `l1`, `l2`). There is **no validation of the generated Bloom HTML** at all.

**Test 4 — OCR on the actual target PDF.** PASS (with caveat). Default `--ocr 4o` (OpenRouter) hit a transient 502. Retrying with `--ocr mistral` succeeded: 264 lines of markdown with correct title/author ("By Vanessa David Nimbwen") / illustrator ("Illustrated by Viktoria Khmelnickaya"), all story text, page markers (`<!-- page index=N -->`), and 22 images extracted. **OCR/interpretation of this book is solid** — confirming the recollection that PDF interpretation is the strong part. Note: OCR'd 21 images vs the EPUB's curated set; cover/back-cover identification and image-to-page mapping is work for the Bloom-generation side, not OCR.

### Gap analysis

| Capability                              | Needed for this book | Current state                                                                                                | Gap        |
| --------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ | ---------- |
| Structurally valid Bloom HTML           | Yes                  | Fails validator (no page ids, no shells)                                                                     | **Large**  |
| `meta.json`                             | Yes (all metadata)   | Not generated                                                                                                | **Large**  |
| Bloom validation in pipeline            | Yes                  | None                                                                                                         | **Large**  |
| Metadata → `#bloomDataDiv` data-book    | Yes                  | Partial (title/credits/isbn/etc.) but author/illustrator/publisher all dumped into `originalAcknowledgments` | **Medium** |
| xMatter (don't hand-build front matter) | Yes                  | Hand-builds front matter as customPage                                                                       | **Medium** |
| Page size class (A5Portrait)            | Yes                  | None                                                                                                         | **Small**  |
| Appearance theme + full-bleed           | Yes                  | None                                                                                                         | **Medium** |
| Custom front/back covers                | Yes                  | None                                                                                                         | **Medium** |
| Reading level / subjects / description  | Nice-to-have         | None                                                                                                         | **Small**  |

---

## Bloom format reference (the target output)

Distilled from the `edit-bloom-book` skill (`D:/bloom/.github/skills/edit-bloom-book/SKILL.md` + `validateBloomBook.mjs`) and Bloom source (`D:/bloom/src`).

### A valid book folder

```
<Book Name>/
  <Book Name>.htm        # the book (Bloom uses .htm; we currently emit index.html)
  meta.json              # book metadata (camelCase)
  appearance.json        # theme + fullBleed
  *.jpg / *.png          # images
```

### HTML invariants enforced by the validator

- Parseable DOM; `<meta name="BloomFormatVersion">` present.
- One `#bloomDataDiv` in `<body>`.
- One or more `.bloom-page` as **direct children of `<body>`**, each with a **unique non-empty `id`** (GUID).
- Page shell: `.bloom-page` → `.pageLabel`, `.pageDescription`, `.marginBox`.
- Every `.bloom-editable` has a non-empty `lang`; never strip `bloom-translationGroup`.
- Split-pane: exactly one orientation, 2 components + 1 divider + inner wrappers.
- Canvas images: `.bloom-canvas` (inside a page) → `.bloom-canvas-element` → `.bloom-imageContainer` → one `img` (with `bloom-has-canvas-element` when canvas-elements are used).

### Full-bleed (Bloom source: `AppearanceSettings.cs`, `HtmlDom.cs`, `appearance-theme-zero-margin-ebook.css`)

- `appearance.json`: `{ "cssThemeName": "zero-margin-ebook", "fullBleed": true }`
- `#bloomDataDiv`: `<div data-book="fullBleed" lang="*">true</div>`
- `<body class="bloom-fullBleed">`
- Each page wrapped: `<div class="bloom-mediaBox A5Portrait"><div class="bloom-page A5Portrait">…</div></div>`

### Custom covers / xMatter (Bloom source: `bloom-xmatter-mixins.pug`, `Factory-XMatter.pug`)

- Front cover page: `class="bloom-page cover coverColor frontCover outsideFrontCover bloom-frontMatter"`, `data-page="required singleton"`, `data-xmatter-page="frontCover"`, and for custom layout `data-custom-layout-id="customOutsideFrontCover"`.
- Back cover: `…outsideBackCover bloom-backMatter`, `data-xmatter-page="outsideBackCover"`, `data-custom-layout-id="customOutsideBackCover"`.
- Cover image lives in a full-size canvas: `.bloom-canvas.bloom-has-canvas-element > .bloom-canvas-element.bloom-backgroundImage (style="width:100%;height:100%") > .bloom-imageContainer > img[data-book="coverImage"]`.
- Appearance toggles to hide default cover text when the art is self-contained: `cover-title-L1-show`, `cover-languageName-show`, etc. (in `appearance.json`).
- **xMatter is regenerated by Bloom.** Strategy: put metadata in `#bloomDataDiv` (data-book) and let Bloom build standard xMatter; only emit explicit cover pages when we need the custom full-bleed art that Bloom's default cover won't reproduce.

### meta.json (Bloom source: `BookInfo.cs` → `BookMetaData`)

camelCase keys. Minimum useful set for this book:

```json
{
  "bookInstanceId": "<new GUID>",
  "title": "A Thief in the Night",
  "allTitles": "{\"en\":\"A Thief in the Night\"}",
  "originalTitle": "A Thief in the Night",
  "isbn": "978-1-923429-63-5",
  "author": "Vanessa David Nimbwen",
  "publisher": "Library For All",
  "license": "cc-by-nc-nd",
  "licenseNotes": "...",
  "copyright": "Copyright © 2025 Library For All",
  "credits": "Illustrations by Viktoria Khmelnickaya",
  "summary": "Jade and his mother hear a strange noise in the night! ...",
  "tags": ["family", "security", "crime", "pets"],
  "formatVersion": "2.1",
  "suitableForMakingShells": false,
  "pageCount": 0
}
```

### Validation command (to wire into our tests)

```
node D:/bloom/.github/skills/edit-bloom-book/validateBloomBook.mjs <book>.htm
```

Exit 0 = OK, 1 = validation failures, 2 = missing jsdom.

---

## The plan

Phased so each phase ends with a measurable test. Earlier phases unblock the rest.

### Phase 0 — Vendor + wire in Bloom validation _(enables everything; do first)_

- Vendor `validateBloomBook.mjs` (or its rules) into the repo so it has no dependency on `D:/bloom`. Options: (a) copy the script + a bundled `jsdom`, or (b) port the rule set into a TS module in `4-generate-html/`.
- Add `validateBloomHtml(html): ValidationError[]` to the lib and call it at the end of HTML generation; fail/warn loudly.
- Add a vitest that runs the validator over a generated fixture. **Target: this test exists and currently fails, then turns green as phases land.**

### Phase 1 — Make generated HTML structurally valid

In `html-generator.ts` / `origami.ts`:

- Give every `.bloom-page` a unique GUID `id`.
- Emit the page shell: `.pageLabel`, `.pageDescription`, `.marginBox` wrapper (content currently starts at `.marginBox` but lacks label/description).
- Add page-size class `A5Portrait` (derive from image aspect / page dimensions; default A5Portrait).
- Add `numberedPage`/`data-page` for content pages.
- **Test:** generated `children-come` and a `thief` fixture pass `validateBloomHtml` for page-structure rules.

### Phase 2 — Generate `meta.json`

- New module `4-generate-html/metaJson.ts` building `BookMetaData` from the parsed metadata + page count.
- Generate a `bookInstanceId` GUID. Map license string → Bloom token (CC BY-NC-ND → `cc-by-nc-nd`).
- Write `meta.json` alongside the `.htm` in `process.ts`.
- **Test:** `meta.json` parses, has required fields, round-trips title/isbn/author/license.

### Phase 3 — Correct metadata model (stop hand-building xMatter)

- Move title/language/credits/cover into `#bloomDataDiv` data-book fields and **let Bloom regenerate standard xMatter** rather than emitting front-matter `customPage`s.
- Fix the field collapsing in `html-generator.ts` (`author`, `publisher`, `illustrator` currently all map to `originalAcknowledgments`) — give them their proper `data-book` keys and meta.json fields.
- **Test:** `#bloomDataDiv` contains distinct author/illustrator/publisher/copyright/license; no hand-built `bloom-frontMatter customPage` for cover/title.

### Phase 4 — Appearance theme + full-bleed

- Emit `appearance.json` with `{ cssThemeName: "zero-margin-ebook", fullBleed: true }` (theme name TBD — verify which shipped theme this book should use; see Open Questions).
- Add `<div data-book="fullBleed" lang="*">true</div>` to `#bloomDataDiv`, `bloom-fullBleed` to `<body>`, and `bloom-mediaBox` wrappers around each page.
- **Test:** `appearance.json` present and valid; body/mediaBox markup present; validator still passes.

### Phase 5 — Custom covers

- Detect first/last pages as cover/back-cover (cover = full-page single image, matches `coverImage`).
- Emit explicit `frontCover` / `outsideBackCover` xMatter pages with the full-bleed background-image canvas pattern and `data-custom-layout-id`.
- Set appearance toggles to hide default cover title/language text where the art already contains it.
- **Test:** front & back cover pages have correct classes/`data-xmatter-page`, cover image is a full-size canvas background, validator passes.

#### Phase 5 progress (2026-06-02)

**Approach decided:** full-page-art covers are captured by **rendering the whole PDF page to a flat image** (Poppler `pdftocairo`), not by extracting embedded images — so the composited cover (background art + overlaid badges/logos/title) is preserved faithfully. Whether a page is full-page art is **auto-detected**: `pdfinfo` page size vs. `pdfimages -list` displayed image size; if one image covers ≥ 85% of the page it's treated as full-bleed art. A `--cover auto|render|none` flag overrides (default `auto`).

**Done:**

- New lib modules: `1-ocr/poppler.ts` (shared binary resolver/runner), `1-ocr/coverDetection.ts` (`getPdfPageInfo`, `getLargestImageCoverage`, `isFullPageArtPage`), `1-ocr/renderPdfPage.ts` (`renderPdfPageToImage` via `pdftocairo`), `1-ocr/prepareCovers.ts` (orchestrates detect → render → inject).
- Bundled `pdftocairo.exe` + `pdfinfo.exe` (Poppler 24.08.0, matching the existing `pdfimages.exe`/DLLs) into `packages/lib/bin/win32/`.
- Pipeline: `process.ts` calls `prepareCovers` in the PDF stage. It renders `cover.jpg` (front) and `back-cover.jpg` (back) into the book folder and injects `![cover.jpg](cover.jpg)` at the top of the cover page in the OCR markdown. Image tags survive the LLM verbatim, and stage 4's existing "first image on cover page → `data-book=coverImage`" picks it up. This bakes the cover into the `.ocr.md`, so re-runs from markdown need no PDF and no re-OCR.
- Verified on `thief.pdf`: detection = page 1/4/28 → full art (100%), text pages → 0%. `cover.jpg`/`back-cover.jpg` render faithfully (full composite). After `prepareCovers` + stage 4, `#bloomDataDiv` has `data-book="coverImage">cover.jpg`.

**Custom full-page covers (2026-06-02, second pass):**

Decided **not** to use a plain `data-book="coverImage"` (Bloom renders that as its default cover: small positioned image + title + credits overlaid). Instead we emit the cover/back-cover pages as **`bloom-customLayout` xMatter pages** whose `.marginBox` is just the rendered image as a `bloom-backgroundImage` canvas element — no title/credits/topic. This is the current canonical Bloom approach (the legacy `cover-is-image` class is migrated away in `BookStorageTests.cs`).

How Bloom keeps it (verified against Bloom source `BookData.cs` / `XMatterHelper.cs`): a page with `bloom-customLayout` + `data-custom-layout-id="customOutsideFrontCover"` (or `customOutsideBackCover`) + `data-xmatter-page` has its marginBox saved into the dataDiv under that id, and on xMatter regeneration the content is restored over the template cover and `bloom-customLayout` is re-applied by id.

- `html-generator.ts`: `generateFullPageCoverPage("front"|"back", src)` emits the custom-layout page. `generatePage` dispatches to it when a page contains an image whose src is the reserved `cover.jpg` / `back-cover.jpg` (constants `FRONT_COVER_IMAGE_FILENAME` / `BACK_COVER_IMAGE_FILENAME` in `types.ts`, shared with `prepareCovers`). All other elements on that page are dropped (the rendered image already shows them).
- `prepareCovers.ts` now injects **both** covers (`cover.jpg` page 1, `back-cover.jpg` last page).
- Verified: stage 4 emits both custom-layout cover pages (front `frontCover`, back `outsideBackCover`), `data-book="coverImage">cover.jpg` in the dataDiv, and the output passes Bloom's `validateBloomBook.mjs` (exit 0). The structure matches a known-good hand-edited Bloom cover.

**Still to do for Phase 5:**

- **Confirm in Bloom via a clean re-import** — Bloom's port-8089 "refresh" doesn't re-import an already-imported book; need a fresh import to see the full-page cover render and confirm the custom-layout round-trip survives.
- **Full PDF→Bloom re-run** to confirm the injected cover refs survive OCR→LLM→plan in practice (verified `prepareCovers` + stage 4 in isolation so far).
- Decide whether the print **spine bleed strip** visible on the rendered covers should be cropped.

### Phase 6 — Full-bleed content pages with positioned text

- For content pages (illustration + story text), emit the illustration as a full-bleed background canvas and the text as an overlaid `bloom-translationGroup` (a positioned canvas-element text box), instead of stacked split-panes.
- Handle the special back-matter pages (questions, author, level, LFA) — decide which become normal content pages vs. dropped/regenerated.
- **Test:** import the real `thief` book end-to-end; validate; visually open in Bloom (manual) to confirm full-bleed + covers + text placement.

### Phase 7 — Polish metadata coverage

- Reading level → Bloom level/tools; subjects/description → meta.json `tags`/`summary`; funding credit → credits.
- **Test:** end-to-end on thief; spot-check every ground-truth metadata field appears in `meta.json` or `#bloomDataDiv`.

---

## Open questions / decisions needed

1. **Which appearance theme?** `zero-margin-ebook` gives full-bleed; confirm against Bloom's current shipped themes (`D:/bloom/src/content/appearanceThemes/`) and whether a newer default supports full-bleed per-page. _Recommend verifying before Phase 4._
2. **Custom cover approach:** explicit cover pages emitted by us vs. relying on Bloom's "Use first page as cover" with a full-bleed cover image. Faithful complex covers argue for explicit pages.
3. **Content page text placement:** the print PDF is `2xpage A4` (likely full-page art with text). The EPUB separates image and text. Do we want text overlaid on the illustration (true full-bleed picture book) or image-top/text-bottom? This determines Phase 6 layout. _Recommend: full-bleed art + overlaid text box to honor "full-bleed pages."_
4. **`.htm` vs `index.html`:** ✅ RESOLVED — write `<FolderName>.htm`. Bloom's `BookStorage.FindBookHtmlInFolder` (Remote-Reload worktree) tries `<FolderName>.htm` first and only falls back to a stray `.html` if that's absent. We were writing `index.html`, so once a book had been imported (and a `<FolderName>.htm` existed) every re-run was silently ignored — Bloom always read the stale `.htm`. `process.ts` now writes `<bookFolder>/<bookFolderBaseName>.htm` and removes any leftover `index.html`. The `external/updateBook` notify then reloads it from disk and Bloom hydrates (CSS/xMatter, incl. the custom-cover round-trip).
5. **Back-matter special pages** (questions/author/level/LFA): keep as content pages, or map to Bloom conventions?

---

## Test log

- **Validator on existing output:** `children-come/index.html` → FAIL, 9× "Each .bloom-page must have a non-empty id." (baseline: no current output is valid).
- **EPUB metadata extraction:** complete — all ground-truth fields captured above.
- **OCR on target PDF (`--target markdown`):** `--ocr gpt` → transient OpenRouter 502 (no code fault). `--ocr mistral` → PASS: 264-line markdown with correct title/author/illustrator and story text, 22 images, page markers. Output → `test-outputs/thief-test/4788 A Thief In The Night_2xpage A4/`. Conclusion: OCR/interpretation is solid; all remaining work is on the Bloom-generation side (Phases 0–7).
