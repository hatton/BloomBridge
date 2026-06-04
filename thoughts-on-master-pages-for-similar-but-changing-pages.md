# Master pages for "similar but changing" pages

Status: **Option C implemented** (`--complex-becomes-image`); Options A and B not
built. Captures the problem and the options we discussed so we can decide and come
back to it.

## The concrete case

Library For All readers (≈100 books from this publisher) end with a recurring
**"You can use these questions" page**. Across all the books it is structurally
identical:

- solid blue full-page background (a Canvas page);
- a **centered heading**: "You can use these questions to talk about this book with
  your family, friends and teachers.";
- **5–6 discussion questions**, each **left-aligned**, each next to a small reader
  figure;
- a **centered footer**: "Download the Library For All Reader app from
  libraryforall.org".

The **boilerplate** (background, heading, footer, figures, and the _styles_ —
alignment, position, font) is the same in every book. Only the **question text**
changes from book to book (they're about that book's story: "What were the dogs'
names?", "Where was Jade's father?", …).

So it is neither a fully-static page (which the existing master substitution
handles — see §9.7 of `conversion-process.md`) nor a normal content page (which OCR

- canvas layout handles). It's a **template**: fixed frame, variable slots.

## Why our current pipeline doesn't get it right

Two separate problems showed up, in order:

1. **Dropped questions** — fixed. The LLM tagged only the first chunk; the parser
   dropped untagged text after an image; and `generateCanvasPage` rendered only one
   text block. We now: keep untagged-after-image text, cluster the page's text into
   per-block boxes (`canvas-text-boxes`), and render one positioned canvas-element
   per block (splitting on blank lines to reconcile block↔box counts). The questions
   now appear as 7 separate positioned elements.

2. **Alignment** — open. The questions render with Bloom's default `Bubble-style`,
   which is **center-justified**, but they should be **left**. The heading and footer
   _should_ stay centered. So the page has genuinely mixed alignment and no blanket
   rule works.

## What "getting alignment right automatically" would take

We have two ways to decide alignment; both have a cost.

### Option A — detect alignment from the PDF geometry (deterministic, no model)

We already read each text item's box from the PDF text layer. For a text block:

- group its items into lines;
- if **≥2 lines**, the aligned edge has near-zero spread → left / center / right is
  unambiguous. (Verified on the real page: heading → CENTER with center-spread 0,
  footer → CENTER, the wrapping questions → LEFT with left-spread 0.)
- if **1 line** (e.g. the short questions), alignment can't be proven from the line
  alone. The workable heuristic is the same inference a human makes: _a single-line
  block that shares the left edge of the multi-line LEFT blocks belongs to the same
  left-aligned column._ On this page the one-line questions sit at the same x as the
  wrapping ones, so they resolve to LEFT.

Apply it with a named style (the chosen name is **`canvas-left-style`**): emit a
`.canvas-left-style { text-align: left }` user style and put that class on
non-centered canvas editables, leaving centered ones on the default `Bubble-style`.
(A named style is more robust across Bloom edits than an inline `text-align`, and
matches the pattern in the hand-made master, which uses a custom `DidYouPage-style`.)

**Pros:** free, no per-book work, no LLM, and it degrades _safely_ — when the
single-line inference can't decide, it falls back to Bloom's center default, i.e.
never worse than today.

**Cons / risk:** the single-line inference is a heuristic. Across 100 varied books
it can misfire (a page whose questions are _all_ one line, with no wrapping sibling
to anchor the left margin; or a genuinely centered single line). It also can't
recover the **figures** (this PDF didn't even extract them — only the background
image came out), and the heading/footer text is whatever OCR produced rather than
pristine boilerplate.

### Option B — a "template" master (the idea worth pursuing)

Generalize the master-page concept. Today a master page means **"copy this page
verbatim."** Add a second kind that means **"keep this page's layout + styles +
boilerplate, but refill the variable slots from the incoming book."**

The human builds the page once in Bloom — correct alignment, positions, fonts,
figures, background, and the real heading/footer text. The importer then, for each
incoming book that matches this template:

- keeps everything (background, figures, heading, footer, and **all the styling**);
- replaces only the **slot** text with that book's questions.

Because the styling lives in the hand-made template, **alignment stops being a
detection problem at all** — it's correct by construction, for every book. It also
solves the figures and keeps the boilerplate pristine.

This is a natural extension of the existing master machinery (`master/masterPages.ts`):
recognition is already by perceptual page hash; `applyMasterPages` already splices a
master page's HTML + images into the output. The new behavior is "splice, but swap
the slot text."

Two sub-decisions drive the complexity:

**(1) How does a human mark which elements are slots vs boilerplate?**

- _Placeholder text_ (recommended): in the template, the heading/footer hold their
  real text; each question element holds a sentinel like `{{question}}`. The importer
  fills `{{…}}` elements and leaves the rest verbatim. Fully authorable in Bloom by
  just typing — no custom attributes (which Bloom's UI can't easily add and might
  strip).
- _No marking, position-match everything_: refill every text element from the source
  page by position; boilerplate elements simply receive the source's (matching)
  boilerplate text. Simplest authoring, but the heading/footer text then comes from
  OCR instead of the pristine template, and you can't keep template-only text.

**(2) How are the incoming questions matched to the slots?**

- _By position_ (recommended): we already compute the source page's per-block boxes
  (`detectCanvasPages`). Match each template slot to the nearest source box. Robust
  because the layout is identical across the publisher's books.
- _By reading order_: simpler, but breaks when a book has a different number of
  questions than the template has slots.

**Pros:** alignment/figures/boilerplate all solved at once, by construction; no
detection heuristics; the human's one-time effort scales to all 100 books.

**Cons / risk:** more moving parts in the master path; the slot↔source matching needs
a sensible fallback when the question count differs from the slot count (e.g. a book
with 6 questions vs a 5-slot template — leave the extra unmatched, or grow the last
slot). Authoring requires teaching the convention (placeholders).

### Option C — flatten an "overly complex" page to a full-page image ✅ implemented

Shipped as `--complex-becomes-image <off|0..5>` (see the CLI README). Stage 1 scores
each Canvas page by its text-block count, renders the page to `page-N.jpg` when the
score meets the level's threshold, and bakes a `flatten-as-image` marker; Stage 4
emits a full-page-image page carrying a `data-conversion-note`. Verified on thief at
level 5: the questions page (score 7) flattened to a pixel-perfect image (heading,
all five left-aligned questions, figures, footer) while "About the author" (score 1)
stayed editable.

If we can detect that a page is too complex to reconstruct faithfully, **render the
whole page to an image and emit it as a single full-page image**, exactly the way we
already handle full-bleed covers. The page becomes a picture; alignment, figures,
fonts, and colors are all perfect because it _is_ the rendered page.

**Feasibility: high, low complexity.** Every piece already exists:

- We already render any page to a raster (`renderPdfPageToImage`), and Stage 1
  already saves full-page renders to the book folder for covers (`prepareCovers` →
  `cover.jpg` / `back-cover.jpg`).
- Stage 4 already emits a full-bleed image page (`generateFullPageCoverPage` /
  `coverCanvasHtml`), and `generatePage` already has a single-full-page-image path
  that sizes the image to the page. With `fullBleed: true` (already wired) it fills
  edge-to-edge.
- So "flatten page N" = save `page-N.jpg` in Stage 1 + emit a full-page-image page in
  Stage 4. A few hours of work, no new dependencies, no LLM.

**Pros:**

- Perfect visual fidelity, for _any_ complex page — solves alignment, the missing
  figures, and boilerplate all at once, with zero layout logic.
- Deterministic; no per-book hand-work; no master needed.
- Naturally per-book: it renders _this_ book's page, so the changing questions come
  out right automatically.

**Cons / the real trade-off — the text stops being text:**

- A flattened page is a picture, so Bloom can't **edit, translate, reflow, search,
  or read-aloud** that text. For a literacy/translation platform that matters a lot
  on _story_ pages, and less on back-matter (questions, "download the app", credits
  with logos). This is a **product decision per page-type**, not a technical limit.
- Raster, so resolution is fixed — render at a high enough DPI for print (the cover
  render is 150 dpi; a text-bearing page probably wants ~200–300).
- Larger files (one full-page image per flattened page). Minor.
- Optional mitigation: also emit the OCR text as hidden/`alt` for search and
  accessibility — extra complexity, can be deferred.

**The crux is detection — "overly complex," which is a scalar, not a black-and-white
line.** We compute a per-page **complexity score** from deterministic signals we
already have (no model), e.g. additively:

- number of text blocks on a Canvas page beyond the first (the questions page has 7;
  a normal caption page has 1; "About the author" has 1);
- canvas box-count vs text-block-count **fails to reconcile**;
- the page references images we **couldn't extract** (broken refs) — art we can't
  reproduce as elements;
- **mixed alignment** within the page;
- many positioned elements overall.

### The `--complex-becomes-image` sensitivity knob

Because "too complex" is fuzzy, expose it as a **scalar** rather than a boolean, so
the user can dial how eagerly the converter "gives up" and flattens:

| value   | meaning                                                             |
| ------- | ------------------------------------------------------------------- |
| `off`   | never flatten — always try to reconstruct (today's behavior)        |
| `0`     | flatten **every** content page (the whole book becomes page images) |
| `1`     | **timid** — bail to an image at the slightest complexity            |
| `2`–`4` | progressively braver — only flatten as pages get clearly complex    |
| `5`     | **bravest** — flatten only the most extreme pages                   |

So lower = flattens more readily; higher = tolerates more complexity before bailing.
Mechanically, the level sets the score threshold (e.g. flatten when
`score >= 6 - level`), with `0`/`off` as the all/never end-stops. Default should be
conservative — likely `off` (opt-in) or a high level like `4` — so we never silently
turn editable text into pictures without the user asking. A per-page escape hatch
(`--flatten-pages 6,9`) can complement the global knob.

### Marking flattened pages: `data-conversion-note`

Every page we flatten gets a machine- and human-readable annotation on its
`div.bloom-page`, so the decision is visible and reversible (and Bloom preserves
unknown `data-*` — we confirmed it keeps `data-import-source-hash`). Make it a
**general conversion-note mechanism**, not specific to this feature, so any stage can
leave notes/warnings on a page. Single-quote the attribute so the JSON value can use
normal double quotes:

```html
data-conversion-note='{"severity":"note","code":"complex-page-flattened","message":"This page
exceeded the too-complex threshold (score 7, level 4), so it was imported as a full-page image
instead of editable text. To keep it as text, re-import with --complex-becomes-image off (or a
higher level).","score":7,"level":4}'
```

Fields: `severity` (`note`|`warning`|`error`), `code` (stable machine key),
`message` (human, includes how to change it), plus context like `score`/`level`.
These could later be surfaced in a conversion report or in Bloom itself.

## Recommendation

These aren't mutually exclusive, and they serve different needs. The deciding axis
between B and C is **does the text on these pages need to stay editable/translatable?**

- **Option A** (geometry alignment) — small, safe, immediate win for canvas alignment
  _in general_; keeps text editable; heuristic, so not bulletproof on the long tail.
- **Option B** (template master) — keeps text **editable**, correct by construction,
  restores figures + pristine boilerplate; the most engineering, and needs authoring
  a template. Right when those pages are real, translatable content.
- **Option C** (flatten to image) — cheapest by far and **pixel-perfect** for any
  complex page, but the text becomes a **non-editable picture**. Right for back-matter
  / boilerplate pages (questions, "download the app", credits-with-logos) that nobody
  needs to translate.

Given these are English LFA readers and the complex pages are end-matter (questions,
app promo), **Option C is very likely the best value**: a few hours of work, perfect
output, no per-book effort. The one thing to confirm is whether those specific pages
are ever translated/edited downstream — if not, flatten them. Keep **A** as a cheap
general improvement for ordinary caption pages; reserve **B** for the case where a
templated page genuinely must remain editable text.

## Open questions to resolve before building B

- Placeholder convention (`{{question}}`?) and whether it survives a Bloom round-trip
  (the master is hand-edited in Bloom; we confirmed Bloom preserves
  `data-import-source-hash`, so it likely preserves editable text too).
- Slot↔source matching policy and the count-mismatch fallback.
- Whether a template master and a verbatim master can coexist in the same `*master`
  folder (probably yes — decide per page, e.g. a page is a template iff it contains a
  placeholder slot).
- The figures: are they part of the template (carried as-is) — yes — and do we ever
  need per-book figures? (For LFA, no; the figures are fixed.)
