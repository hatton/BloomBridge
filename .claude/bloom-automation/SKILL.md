---
name: bloom-automation
description: Use when you need to SEE the result of a BloomBridge conversion in the real Bloom app — start Bloom from the Remote-Reload worktree, attach to its embedded WebView2 over CDP, select a converted book in the Collection-tab preview, screenshot individual pages, trigger a live reload of a re-converted book, and compare Bloom's rendering to the source PDF page images. This closes the loop: convert → view → compare → adjust the BloomBridge code → re-convert.
argument-hint: "what to view, e.g. 'screenshot the thief cover and compare to source', 'reload after re-running the conversion'"
user-invocable: true
---

# View BloomBridge Results in the Real Bloom App

## Outcome

Run a `BloomBridge` conversion, see the resulting book in a running Bloom, grab a
screenshot of any page, and compare it to the source image extracted/rendered from
the PDF. Then change the conversion code, re-run, trigger a live reload, and look
again — without restarting Bloom.

This is for **inspecting conversion output**, not for developing Bloom itself.

## The loop

1. **Convert** a PDF into the Bloom collection (`pnpm cli <input> --collection recent`
   or `--collection <path>`). The pipeline writes the book folder + `meta.json` and
   then auto-calls `notifyBloomOfBook`, which POSTs `external/update-book` so a running
   Bloom adds or refreshes the book and shows a toast. (Source:
   [notifyBloom.ts](../../packages/lib/src/5-notify-bloom/notifyBloom.ts).)
2. **View** — attach to Bloom over CDP with `dev-browser` and screenshot pages from
   the Collection-tab preview pane (see `captureBookPages.mjs` below).
3. **Compare** the screenshot to the source page image in the book folder
   (`cover.jpg`, `back-cover.jpg`, `image-N-1.png`) or to a fresh full-page render.
4. **Adjust** the BloomBridge code, rebuild (`pnpm build`), re-run the conversion,
   and reload (`--reload`, or just let the pipeline's notify do it).

## Key facts (confirmed in this environment)

- **Bloom lives in a separate worktree:** `D:\bloom.worktrees\Remote-Reload`. It is NOT
  in this repo. Launch it with `D:\bloom.worktrees\Remote-Reload\go.sh` (a long-lived
  launcher; first build takes a few minutes, an already-built run is fast).
- Bloom uses HTTP port **8089** by default (then 8089+3n if taken), CDP on the next
  reserved port (e.g. **8091**). It reports its real ports, PID, open collection, and
  CDP origin at `http://localhost:8089/bloom/api/common/instanceInfo`.
- The currently-open collection folder is the `editableCollectionFolder` field of
  `instanceInfo`. In this environment it has been
  `C:\Users\hatto\OneDrive\Documents\Bloom\PDF-Import-Tests-English`.
- **`external/update-book`** (POST `{"id":"<bookInstanceId>"}` to
  `/bloom/api/external/update-book`) makes Bloom re-read that book from disk. A new book
  is added to the collection; an existing one is refreshed (and if it's open in the
  Edit tab, reloaded discarding edits). Bloom hydrates CSS/xMatter, including the
  custom-cover round-trip, and shows a toast like `Updated book "<title>" (h:mm:ss)`.
  The `id` must equal the book's `meta.json` `bookInstanceId` — which is also the
  `data-book-id` on its Collection-tab book button.
- **The Collection tab has a preview pane** — an iframe at `/book-preview/index.htm`
  showing the _selected_ book as a vertical stack of `.bloom-page` elements. This is
  the easiest place to see and screenshot rendered pages. (Reloading in place from the
  Edit tab was dropped as too hard; the reload path lands you on the Collection tab.)
- **Driver:** use the globally-installed `dev-browser` CLI
  (https://github.com/SawyerHood/dev-browser). It attaches to an existing CDP endpoint
  with `--connect`, gives full Playwright `Page` objects, and `saveScreenshot()`s into
  `~/.dev-browser/tmp`. It is self-contained — prefer it over the Playwright path the
  old Bloom-dev scripts used (that path needs Bloom's `component-tester` node_modules,
  which aren't installed for this repo).

## Start / check Bloom

Is a Bloom already running, and which ports?

```bash
node .claude/bloom-automation/bloomProcessStatus.mjs --running-bloom --json
# or, more simply:
curl -s http://localhost:8089/bloom/api/common/instanceInfo
```

If none is running, launch it in a background terminal and wait for the
`Bloom ready. HTTP <p>, CDP <c>, Bloom PID <pid>.` line (do not wait for the command
to exit — `go.sh` stays running):

```bash
cd /d/bloom.worktrees/Remote-Reload && ./go.sh   # run in background; poll output
```

Note: `bloomProcessStatus.mjs`/`webview2Targets.mjs` still work here via
`--running-bloom` or `--http-port <port>`. Ignore their `expectedRepoRoot` (it
resolves under this repo, not Bloom's worktree — irrelevant for viewing results).

## Capture pages (the main tool)

`captureBookPages.mjs` attaches over CDP, selects the book, screenshots the requested
pages, and copies the PNGs to a folder you can Read.

```bash
# Screenshot every page of a book (by name == book-button caption, or by bookInstanceId):
node .claude/bloom-automation/captureBookPages.mjs --book thief-vision --out test-outputs/bloom-shots

# Just the cover and first content page:
node .claude/bloom-automation/captureBookPages.mjs --book thief-vision --pages 0,1 --out test-outputs/bloom-shots

# A range:
node .claude/bloom-automation/captureBookPages.mjs --book thief-vision --pages 0-5 --out test-outputs/bloom-shots

# Reload the book from disk first (after re-running a conversion), by bookInstanceId:
node .claude/bloom-automation/captureBookPages.mjs --book <bookInstanceId> --reload --out test-outputs/bloom-shots
```

`--pages` is 0-based into the preview's `.bloom-page` list. Page 0 is the front cover.
Output files are `bloompage-NN.png`. Read them to inspect.

The `bookInstanceId` you need for `--reload` is in the book folder's `meta.json`
(`bookInstanceId`) and is also the `data-book-id` on the book button.

## Compare to the source

The conversion leaves the source page images in the book folder inside the collection:

- `cover.jpg` / `back-cover.jpg` — full PDF-page renders of the covers (via Poppler
  `pdftocairo`).
- `image-N-1.png` — the illustration extracted from PDF page N.

Read the Bloom screenshot and the matching source image and compare them visually
(faithful art? right crop? full-bleed vs. framed? text placed correctly? spine-bleed
strip cropped?). To get a fresh full-page render of any PDF page for ground truth, the
lib exposes `renderPdfPageToImage` (Poppler) — see
[renderPdfPage.ts](../../packages/lib/src/1-ocr/renderPdfPage.ts).

## Ad-hoc inspection with dev-browser

For anything beyond screenshots, drive Bloom directly. Find the target id, then attach:

```bash
dev-browser --connect http://localhost:8091 <<'EOF'
const pages = await browser.listPages();
const t = pages.find(p => p.url.includes('/bloom/') && !p.url.startsWith('devtools://'));
const page = await browser.getPage(t.id);
// e.g. list preview pages:
const frame = page.frames().find(f => f.url().includes('book-preview'));
const labels = await frame.evaluate(() =>
  [...document.querySelectorAll('.bloom-page')].map((p,i) => ({i, id:p.id.slice(0,8),
    cls:p.className, label:p.querySelector('.pageLabel')?.textContent || ''})));
console.log(JSON.stringify(labels, null, 2));
EOF
```

Useful selectors (confirmed):

- Book buttons (main page DOM): `.book-button[data-book-id="<id>"] button`; the caption
  text is the book name; the selected one has `.bookButton.selected`.
- Preview pane: the iframe whose URL contains `book-preview`; its pages are `.bloom-page`.
- Switch top-bar tabs if needed: `page.getByRole('tab', {name: 'Collections'|'Edit'|'Publish'})`.

## Gotchas

- Screenshots from `dev-browser` can only be saved into `~/.dev-browser/tmp`; the
  helper copies them out for you. If you script `saveScreenshot` directly, Read from
  that tmp dir or copy first.
- After `external/update-book`, give Bloom a moment (the helper waits ~3s after
  selecting a book) before screenshotting, so the preview iframe reloads.
- `data-book-id` / `bookInstanceId` is preserved across re-conversions when a
  `meta.json` already exists, so reloads target the same book instead of duplicating it.
- Don't expect the Edit tab to refresh in place; the reload returns you to the
  Collection tab — screenshot from the preview pane there.

## Completion checks

- `instanceInfo` returns and reports the HTTP/CDP ports and open collection.
- The intended book is selected (its button has `.selected`) and the preview shows the
  expected page count.
- The requested page PNGs exist in `--out` and visually match (or reveal a real
  discrepancy vs.) the source PDF page images.
