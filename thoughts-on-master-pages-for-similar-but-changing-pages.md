# Master pages for "similar but changing" pages

Status: **design notes / not yet implemented.** Captures the problem and the
options we discussed so we can decide and come back to it.

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

## Recommendation

These aren't mutually exclusive, and they serve different needs:

- **Option A** is a small, safe, immediate win for canvas alignment _in general_
  (not just this page) — any canvas page with a left-aligned caption benefits, and
  it's strictly an improvement over today.
- **Option B** is the durable, correct solution for _this recurring templated page_
  and any like it, and it's the only one that also restores figures and pristine
  boilerplate.

Suggested sequencing: ship **A** now (cheap, low-risk, uses `canvas-left-style`), and
design/prototype **B** as the real answer for the publisher's repeating pages. If we
expect many templated pages across the 100 books, **B** is where the leverage is.

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
