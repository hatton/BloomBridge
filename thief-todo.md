These are remaining problems in converting the thief book.

- [x] The cover image ends up not completely matching our cover, such that we get some blank edges on the left and the right. I think we need to expand it to fill the page.
  - Addressed by `fullBleed: true` (below): the cover sat inside the 12 mm page margin; full-bleed removes the margin so the cover (object-fit:cover) fills the page. Confirm visually in Bloom.

- [x] This book would look better if the cover pages that aren't being used were white. New rule: if we use a full page front cover images, then we should set book's cover color to white.
  - When a full-page front cover is present we emit the head `appearanceCoverBackgroundColor` style (`--cover-background-color: white`) AND set `cover-background-color: "white"` in `appearance.json` so it survives Bloom's regeneration.

- [x] The original book is full-bleed. To turn this on, we need to write appearance.json with `{ "fullBleed": true}`.
  - `metaJson.writeAppearanceJson` writes `appearance.json` with `fullBleed: true` for books with a full-page cover or any canvas page (merged over anything Bloom already wrote).

- [x] "The open quote, you can use these questions" page drops all the actual questions.
  - Two fixes: (1) the parser no longer drops untagged text after an image — each chunk (the questions) now becomes its own text block in the last-seen language; (2) canvas pages now render one positioned `bloom-canvas-element` per text block. `detectCanvasPages` clusters the page text into per-block boxes (`canvas-text-boxes`). Starting from the PDF, the heading + 5 questions + footer are positioned individually; from an older `.ocr.md` with a single box they're merged into one box (still all shown).
