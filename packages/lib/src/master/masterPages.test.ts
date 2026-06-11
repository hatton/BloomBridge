import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  appendMasterMapping,
  applyMasterPages,
  clearMasterMapping,
  findMasterBookFolder,
  loadMasterPages,
  loadMasterPagesById,
  readMasterPageMap,
  readMasterAppearance,
  applyMasterHeadStyles,
  applyMasterAcknowledgments,
  isTemplateMasterPage,
  fillTemplatePage,
} from "./masterPages";

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "master-test-"));
}

describe("master pages", () => {
  let root: string;

  beforeEach(async () => {
    root = await makeTempDir();
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("finds a sibling folder ending in 'master', excluding the current book", async () => {
    await fs.mkdir(path.join(root, "Book One"));
    await fs.mkdir(path.join(root, "Publisher master"));
    await fs.mkdir(path.join(root, "current master")); // would match but is excluded

    const found = await findMasterBookFolder(root, path.join(root, "current master"));
    expect(found).toBe(path.join(root, "Publisher master"));
  });

  it("loads master pages keyed by source hash with their images", async () => {
    const masterFolder = path.join(root, "Pub master");
    await fs.mkdir(masterFolder);
    await fs.writeFile(path.join(masterFolder, "Pub master.htm"), MASTER_HTML);

    const pages = await loadMasterPages(masterFolder);
    expect([...pages.keys()]).toEqual(["abc123"]);
    expect(pages.get("abc123")!.images).toEqual(["image-9-1.png"]);
  });

  it("substitutes a matched page (copying + renaming its images) and strips the marker from others", async () => {
    const masterFolder = path.join(root, "Pub master");
    const bookFolder = path.join(root, "Book One");
    await fs.mkdir(masterFolder);
    await fs.mkdir(bookFolder);
    await fs.writeFile(path.join(masterFolder, "Pub master.htm"), MASTER_HTML);
    await fs.writeFile(path.join(masterFolder, "image-9-1.png"), "PNGDATA");

    const masterPages = await loadMasterPages(masterFolder);
    const result = await applyMasterPages(GENERATED_HTML, {
      masterPages,
      bookFolder,
      masterFolder,
      emitSourceHashes: false,
    });

    // Matched page: master HTML spliced in, image rewritten to a namespaced copy.
    expect(result).toContain("THE MASTER LICENSE PAGE");
    expect(result).toContain('src="mabc123-image-9-1.png"');
    expect(result).not.toContain('src="image-9-1.png"');
    const copied = await fs.readFile(path.join(bookFolder, "mabc123-image-9-1.png"), "utf-8");
    expect(copied).toBe("PNGDATA");

    // Non-matched page: kept, but the internal marker attribute is stripped.
    expect(result).toContain("ordinary content");
    expect(result).not.toContain('data-import-source-hash="zzz999"');

    // The matched page is tagged for the Bloom-side reuse badge.
    expect(result).toContain('data-from-master="master-guid-1"');

    // The source-page link is carried onto the spliced master div, so the paired
    // preview keeps the page aligned (rather than orphaning the source page to the end).
    expect(result).toContain('data-source-pdf-page="7"');
  });

  it("overwrites a master page's stale source-page number with the page it replaces", async () => {
    const masterFolder = path.join(root, "Pub master");
    const bookFolder = path.join(root, "Book One");
    await fs.mkdir(masterFolder);
    await fs.mkdir(bookFolder);
    await fs.writeFile(path.join(masterFolder, "Pub master.htm"), MASTER_HTML_STALE_PDF_PAGE);
    await fs.writeFile(path.join(masterFolder, "image-9-1.png"), "PNGDATA");

    const masterPages = await loadMasterPages(masterFolder);
    const result = await applyMasterPages(GENERATED_HTML, {
      masterPages,
      bookFolder,
      masterFolder,
      emitSourceHashes: false,
    });

    // The master's baked-in "99" (from the book it was authored in) is meaningless here:
    // it must be replaced by the source page (7) we substituted onto, not kept. Keeping it
    // would duplicate page numbers and mis-pair the preview.
    expect(result).toContain('data-source-pdf-page="7"');
    expect(result).not.toContain('data-source-pdf-page="99"');
  });

  it("loads every master page keyed by id, including pages with no embedded hash", async () => {
    const masterFolder = path.join(root, "Pub master");
    await fs.mkdir(masterFolder);
    await fs.writeFile(path.join(masterFolder, "Pub master.htm"), MASTER_HTML_MULTI);

    const byId = await loadMasterPagesById(masterFolder);
    expect([...byId.keys()].sort()).toEqual(["page-credits", "page-license"]);
    expect(byId.get("page-license")!.images).toEqual(["image-9-1.png"]);
  });

  it("round-trips the mapping file and clears entries", async () => {
    const masterFolder = path.join(root, "Pub master");
    await fs.mkdir(masterFolder);
    await fs.writeFile(path.join(masterFolder, "Pub master.htm"), MASTER_HTML_MULTI);

    await appendMasterMapping(masterFolder, "src-hash-1", "page-license");
    await appendMasterMapping(masterFolder, "src-hash-2", "page-license"); // many → one
    let map = await readMasterPageMap(masterFolder);
    expect(map.entries.map((e) => e.sourceHash).sort()).toEqual(["src-hash-1", "src-hash-2"]);

    // Re-recording the same source hash replaces, not duplicates.
    await appendMasterMapping(masterFolder, "src-hash-1", "page-credits");
    map = await readMasterPageMap(masterFolder);
    expect(map.entries.filter((e) => e.sourceHash === "src-hash-1")).toHaveLength(1);
    expect(map.entries.find((e) => e.sourceHash === "src-hash-1")!.masterPageId).toBe(
      "page-credits",
    );

    await clearMasterMapping(masterFolder, "src-hash-1");
    map = await readMasterPageMap(masterFolder);
    expect(map.entries.map((e) => e.sourceHash)).toEqual(["src-hash-2"]);
  });

  it("reads the master's page size + head styles + appearance, and copies head styles in", async () => {
    const masterFolder = path.join(root, "Pub master");
    await fs.mkdir(masterFolder);
    await fs.writeFile(path.join(masterFolder, "Pub master.htm"), MASTER_HTML_APPEARANCE);
    await fs.writeFile(
      path.join(masterFolder, "appearance.json"),
      JSON.stringify({
        cssThemeName: "zero-margin-ebook",
        "cover-background-color": "#C2A6BF",
        fullBleed: false,
      }),
    );
    await fs.writeFile(path.join(masterFolder, "customBookStyles.css"), ".foo { color: red; }");

    const app = await readMasterAppearance(masterFolder);
    expect(app.pageSize).toBe("A5Portrait");
    expect(app.customBookStyles).toBe(".foo { color: red; }");
    expect(app.headStyles).toContain("userModifiedStyles");
    expect(app.headStyles).toContain("28pt");
    expect(app.headStyles).toContain("appearanceCoverBackgroundColor");
    // The master's appearance.json is read in its entirety (copied onto imports verbatim).
    expect(app.appearance).toEqual({
      cssThemeName: "zero-margin-ebook",
      "cover-background-color": "#C2A6BF",
      fullBleed: false,
    });

    const generated = `<!doctype html><html><head>
      <style type="text/css" title="userModifiedStyles">/*<![CDATA[*/ .normal-style { font-size: 12pt !important; } /*]]>*/</style>
      <style type="text/css" name="appearanceCoverBackgroundColor">.bloom-page { --cover-background-color: white; }</style>
      </head><body></body></html>`;
    const out = applyMasterHeadStyles(generated, app.headStyles!);
    expect(out).toContain("28pt"); // master font size copied in
    expect(out).not.toContain("12pt"); // generator's userModifiedStyles replaced
    expect(out).toContain("#C2A6BF"); // master cover colour present
    expect(out).not.toContain("--cover-background-color: white"); // generator white removed

    // Every non-empty originalAcknowledgments axis is picked up (the empty "z" skipped),
    // scoped to the dataDiv (page-instance copies ignored).
    expect(app.acknowledgments).toEqual([
      { lang: "en", html: "<p>About Pub: a non-profit.</p>" },
      { lang: "fr", html: "<p>À propos de Pub.</p>" },
    ]);
  });

  it("prepends each master acknowledgments axis, adding the field when a language is absent", () => {
    const acks = [
      { lang: "en", html: "<p>About Pub.</p>" },
      { lang: "fr", html: "<p>À propos.</p>" },
    ];

    // The import has an "en" field (master text goes first) but no "fr" (one is added).
    const html = `<body><div id="bloomDataDiv">
      <div data-book="originalAcknowledgments" lang="en">Author: Jane<br>Illustrator: Sam</div>
    </div></body>`;
    const out = applyMasterAcknowledgments(html, acks);
    expect(out).toContain(
      '<div data-book="originalAcknowledgments" lang="en"><p>About Pub.</p><br>Author: Jane<br>Illustrator: Sam</div>',
    );
    expect(out).toContain(
      '<div data-book="originalAcknowledgments" lang="fr"><p>À propos.</p></div>',
    );
  });

  it("detects a fill-template page (empty or parenthetical text box) vs a verbatim one", () => {
    expect(isTemplateMasterPage(TEMPLATE_MASTER_PAGE)).toBe(true);
    // A page whose boxes all hold real prose is a wholesale page, not a template.
    expect(isTemplateMasterPage(MASTER_HTML)).toBe(false);
  });

  it("fills template slots from the source page's text, in reading order, keeping verbatim boxes", () => {
    const out = fillTemplatePage(TEMPLATE_MASTER_PAGE, SOURCE_QUESTIONS_PAGE);
    // The heading box is verbatim (its text doesn't start with "(") — the master's wording
    // is kept and the source heading is ignored.
    expect(out).toContain("Talk about this book.");
    expect(out).not.toContain("You can use these questions");
    // The three slots take the three source questions, in top-to-bottom order.
    expect(out).toContain("<p>What game?</p>");
    expect(out).toContain("<p>Why not?</p>");
    expect(out).toContain("<p>What next?</p>");
    // The "(hint)" placeholders are gone — a hint must never reach a published book.
    expect(out).not.toContain("(question");
    // Images and positions are untouched (still the master's).
    expect(out).toContain('src="i-1.jpg"');
    expect(out).toContain("top: 100px");
  });

  it("blanks a surplus slot when the source has fewer texts than the template has slots", () => {
    // Source page with only the heading + two questions (template has three slots).
    const shortSource = SOURCE_QUESTIONS_PAGE.replace(
      /<div class="bloom-canvas-element"[^>]*top: 300px[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/,
      "",
    );
    const out = fillTemplatePage(TEMPLATE_MASTER_PAGE, shortSource);
    expect(out).toContain("<p>What game?</p>");
    expect(out).toContain("<p>Why not?</p>");
    expect(out).not.toContain("(question"); // the unmatched third slot is blanked, not left as a hint
  });

  it("applyMasterPages fills a matched template (layout+images from master, words from source)", async () => {
    const masterFolder = path.join(root, "Pub master");
    const bookFolder = path.join(root, "Book One");
    await fs.mkdir(masterFolder);
    await fs.mkdir(bookFolder);
    await fs.writeFile(
      path.join(masterFolder, "Pub master.htm"),
      `<!doctype html><html><body>${TEMPLATE_MASTER_PAGE}</body></html>`,
    );
    await fs.writeFile(path.join(masterFolder, "i-1.jpg"), "JPEGDATA");

    const masterPages = await loadMasterPages(masterFolder);
    const generated = `<!doctype html><html><body>${SOURCE_QUESTIONS_PAGE}</body></html>`;
    const result = await applyMasterPages(generated, {
      masterPages,
      bookFolder,
      masterFolder,
      emitSourceHashes: false,
    });

    expect(result).toContain("Talk about this book."); // master heading kept
    expect(result).toContain("<p>What game?</p>"); // source question poured into a slot
    expect(result).not.toContain("(question"); // no hint leaks
    expect(result).toContain('src="mdeadbeef-i-1.jpg"'); // master image copied + namespaced
    expect(result).toContain('data-from-master="tmpl-page-1"');
    expect(result).toContain('data-source-pdf-page="14"'); // alignment carried over
    // The fresh-id rewrite must not clobber data-tool-id="canvas" (else Bloom stops
    // treating the spliced page as a canvas).
    expect(result).toContain('data-tool-id="canvas"');
    const copied = await fs.readFile(path.join(bookFolder, "mdeadbeef-i-1.jpg"), "utf-8");
    expect(copied).toBe("JPEGDATA");
  });

  it("fills slots on an ORIGAMI template (translationGroups, no canvas elements), by document order", () => {
    // An "About the author" page is a regular origami layout — its text lives in a
    // bloom-translationGroup inside a split-pane, NOT a positioned canvas element. Slot
    // detection and fill must work there too, ordering by document position (the page has
    // no `top` geometry). Heading verbatim, bio slot filled, image untouched.
    expect(isTemplateMasterPage(ORIGAMI_TEMPLATE)).toBe(true);
    const out = fillTemplatePage(ORIGAMI_TEMPLATE, ORIGAMI_SOURCE);
    expect(out).toContain("<p><b>About the Author</b></p>"); // verbatim heading kept
    expect(out).toContain("Vivane was born in Vila"); // bio poured into the slot
    expect(out).not.toContain("(bio)"); // hint replaced
    expect(out).toContain('src="author.jpg"'); // master image untouched
  });

  it("loadMasterPages resolves mapping-file entries by master page id", async () => {
    const masterFolder = path.join(root, "Pub master");
    await fs.mkdir(masterFolder);
    await fs.writeFile(path.join(masterFolder, "Pub master.htm"), MASTER_HTML_MULTI);
    await appendMasterMapping(masterFolder, "src-hash-1", "page-license");

    const pages = await loadMasterPages(masterFolder);
    expect(pages.has("src-hash-1")).toBe(true);
    expect(pages.get("src-hash-1")!.id).toBe("page-license");
  });
});

const MASTER_HTML = `<!doctype html>
<html><body>
  <div class="bloom-page customPage A5Portrait" id="master-guid-1" data-import-source-hash="abc123">
    <div class="marginBox">
      <p>THE MASTER LICENSE PAGE</p>
      <img src="image-9-1.png" />
    </div>
  </div>
</body></html>`;

// Same matched page, but the master div carries a STALE data-source-pdf-page (the page
// number it had in whatever book the master was built from). Substitution must NOT keep
// it — it should be replaced with the source page we're standing in for.
const MASTER_HTML_STALE_PDF_PAGE = `<!doctype html>
<html><body>
  <div class="bloom-page customPage A5Portrait" id="master-guid-1" data-import-source-hash="abc123" data-source-pdf-page="99">
    <div class="marginBox">
      <p>THE MASTER LICENSE PAGE</p>
      <img src="image-9-1.png" />
    </div>
  </div>
</body></html>`;

// Two pages with stable ids but NO embedded source hash — designated purely via the
// mapping file (the new GUI-driven workflow).
const MASTER_HTML_MULTI = `<!doctype html>
<html><body>
  <div class="bloom-page customPage A5Portrait" id="page-license">
    <div class="marginBox"><p>LICENSE</p><img src="image-9-1.png" /></div>
  </div>
  <div class="bloom-page customPage A5Portrait" id="page-credits">
    <div class="marginBox"><p>CREDITS</p></div>
  </div>
</body></html>`;

const MASTER_HTML_APPEARANCE = `<!doctype html>
<html><head>
<style type="text/css" title="userModifiedStyles">/*<![CDATA[*/ .normal-style { font-size: 28pt !important; } /*]]>*/</style>
<style type="text/css" name="legacyCoverBackgroundColor">DIV.bloom-page.coverColor { background-color: #C2A6BF !important;}</style>
<style type="text/css" name="appearanceCoverBackgroundColor">.bloom-page { --cover-background-color: #C2A6BF; }</style>
</head><body>
  <div id="bloomDataDiv">
    <div data-book="originalAcknowledgments" lang="en" class="bloom-editable" contenteditable="true"><p>About Pub: a non-profit.</p></div>
    <div data-book="originalAcknowledgments" lang="fr" class="bloom-editable" contenteditable="true"><p>À propos de Pub.</p></div>
    <div data-book="originalAcknowledgments" lang="z" class="bloom-editable" contenteditable="true"></div>
  </div>
  <div class="bloom-page customPage A5Portrait" id="m1"><div class="marginBox">x</div></div>
</body></html>`;

const GENERATED_HTML = `<!doctype html>
<html><body>
  <div class="bloom-page customPage A5Portrait" id="g1" data-import-source-hash="zzz999">
    <div class="marginBox"><p>ordinary content</p></div>
  </div>
  <div class="bloom-page customPage A5Portrait" id="g2" data-import-source-hash="abc123" data-source-pdf-page="7">
    <div class="marginBox"></div>
  </div>
</body></html>`;

// A canvas "discussion questions" template: a verbatim heading + three fill-slots (two
// parenthetical hints + one blank) + a fixed row icon. Filling keeps the heading and image
// and pours the source's questions into the slots, top-to-bottom.
const canvasTextBox = (top: number, style: string, inner: string) =>
  `<div class="bloom-canvas-element" style="left: 40px; top: ${top}px; width: 300px; height: 40px;" data-bubble="{}">
     <div class="bloom-translationGroup bloom-leadingElement" data-default-languages="V" style="font-size: 16px;">
       <div class="bloom-editable ${style} bloom-visibility-code-on bloom-content1" lang="en" contenteditable="true">${inner}</div>
     </div>
   </div>`;

const TEMPLATE_MASTER_PAGE = `<div class="bloom-page numberedPage customPage bloom-combinedPage A5Portrait bloom-monolingual" id="tmpl-page-1" data-tool-id="canvas" data-import-source-hash="deadbeefcafe0011">
  <div class="marginBox"><div class="bloom-canvas bloom-has-canvas-element" data-tool-id="canvas">
    ${canvasTextBox(20, "normal-style", "<p><strong>Talk about this book.</strong></p>")}
    ${canvasTextBox(100, "tableRows-style", "<p>(question 1)</p>")}
    ${canvasTextBox(200, "tableRows-style", "<p>(question 2)</p>")}
    ${canvasTextBox(300, "tableRows-style", "<p></p>")}
    <div class="bloom-canvas-element" style="left: 10px; top: 100px; width: 25px; height: 60px;" data-bubble="{}">
      <div class="bloom-imageContainer" data-tool-id="canvas"><img src="i-1.jpg" class="" alt="" /></div>
    </div>
  </div></div>
</div>`;

const SOURCE_QUESTIONS_PAGE = `<div class="bloom-page numberedPage customPage bloom-combinedPage A5Portrait bloom-monolingual" id="g-q" data-tool-id="canvas" data-import-source-hash="deadbeefcafe0011" data-source-pdf-page="14">
  <div class="marginBox"><div class="bloom-canvas bloom-has-canvas-element" data-tool-id="canvas">
    ${canvasTextBox(20, "normal-style", "<p>You can use these questions</p>")}
    ${canvasTextBox(100, "tableRows-style", "<p>What game?</p>")}
    ${canvasTextBox(200, "tableRows-style", "<p>Why not?</p>")}
    ${canvasTextBox(300, "tableRows-style", "<p>What next?</p>")}
  </div></div>
</div>`;

// An origami page: text in bloom-translationGroups inside split-panes (no canvas elements,
// no positions). A heading box then a body box, in document order, plus an image pane.
const origamiTextPane = (inner: string) =>
  `<div class="split-pane-component position-top"><div class="split-pane-component-inner">
     <div class="bloom-translationGroup" style="font-size: 16px;">
       <div class="bloom-editable normal-style bloom-visibility-code-on bloom-content1" lang="en" contenteditable="true">${inner}</div>
     </div>
   </div></div>`;

const ORIGAMI_TEMPLATE = `<div class="bloom-page numberedPage customPage A5Portrait" id="o-master" data-import-source-hash="cafe000000000011">
  <div class="marginBox"><div class="split-pane horizontal-percent">
    ${origamiTextPane("<p><b>About the Author</b></p>")}
    ${origamiTextPane("<p>(bio)</p>")}
    <div class="split-pane-component position-bottom"><div class="split-pane-component-inner">
      <div class="bloom-canvas"><div class="bloom-canvas-element bloom-backgroundImage">
        <div class="bloom-imageContainer"><img src="author.jpg" alt="" /></div>
      </div></div>
    </div></div>
  </div></div>
</div>`;

const ORIGAMI_SOURCE = `<div class="bloom-page numberedPage customPage A5Portrait" id="o-src" data-import-source-hash="cafe000000000011" data-source-pdf-page="15">
  <div class="marginBox"><div class="split-pane horizontal-percent">
    ${origamiTextPane("<p><strong>About the Author</strong></p>")}
    ${origamiTextPane("<p>Vivane was born in Vila but now lives at Agathis.</p>")}
    <div class="split-pane-component position-bottom"><div class="split-pane-component-inner">
      <div class="bloom-canvas"><div class="bloom-canvas-element bloom-backgroundImage">
        <div class="bloom-imageContainer"><img src="img2.jpg" alt="" /></div>
      </div></div>
    </div></div>
  </div></div>
</div>`;
