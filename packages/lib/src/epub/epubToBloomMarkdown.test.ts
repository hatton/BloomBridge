/// <reference types="node" />
import { describe, it, expect } from "vite-plus/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  epubToBloomMarkdown,
  getEpubPageCount,
  getEpubPageImage,
  getEpubPageRoles,
  getEpubSpineHrefs,
  readEpubEntry,
} from "./epubToBloomMarkdown";

// ---- a minimal STORE-method ZIP builder (no compression), so the test needs no
// committed binary fixture and exercises the real zipReader + extractor together. ----

function zip(files: { name: string; data: Buffer }[]): Uint8Array {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0, 8); // method: store
    lfh.writeUInt32LE(0, 14); // crc (reader ignores)
    lfh.writeUInt32LE(f.data.length, 18); // comp size
    lfh.writeUInt32LE(f.data.length, 22); // uncomp size
    lfh.writeUInt16LE(name.length, 26);
    lfh.writeUInt16LE(0, 28); // extra len
    chunks.push(lfh, name, f.data);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 6); // version needed
    cdh.writeUInt16LE(0, 10); // method: store
    cdh.writeUInt32LE(0, 16); // crc
    cdh.writeUInt32LE(f.data.length, 20);
    cdh.writeUInt32LE(f.data.length, 24);
    cdh.writeUInt16LE(name.length, 28);
    cdh.writeUInt32LE(offset, 42); // local header offset
    central.push(cdh, name);

    offset += lfh.length + name.length + f.data.length;
  }
  const cd = Buffer.concat(central as Uint8Array[]);
  const cdOffset = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([...chunks, cd, eocd] as Uint8Array[]) as Uint8Array;
}

const file = (name: string, text: string) => ({ name, data: Buffer.from(text, "utf8") });

function sampleEpub(language = "en"): Uint8Array {
  const container = `<?xml version="1.0"?>
<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  const opf = `<?xml version="1.0"?>
<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier>9781234567890</dc:identifier>
<dc:title>The Test Book</dc:title>
<dc:creator>Ada Author</dc:creator>
<dc:publisher>Test Press</dc:publisher>
<dc:date>2025</dc:date>
<dc:language>${language}</dc:language>
<dc:subject>animals</dc:subject>
</metadata>
<manifest>
<item id="cover" href="Text/cover.xhtml" media-type="application/xhtml+xml"/>
<item id="title" href="Text/title.xhtml" media-type="application/xhtml+xml"/>
<item id="p1" href="Text/p1.xhtml" media-type="application/xhtml+xml"/>
<item id="copy" href="Text/copy.xhtml" media-type="application/xhtml+xml"/>
<item id="coverimg" href="Images/cover.jpg" media-type="image/jpeg"/>
<item id="p1img" href="Images/p1.jpg" media-type="image/jpeg"/>
</manifest>
<spine>
<itemref idref="cover"/>
<itemref idref="title"/>
<itemref idref="p1"/>
<itemref idref="copy"/>
</spine></package>`;
  const cover = `<html><body><section><img alt="cover" src="../Images/cover.jpg"/></section></body></html>`;
  const title = `<html><body><section></section></body></html>`;
  const p1 = `<html><body><section>
<div class="container"><img alt="p1" src="../Images/p1.jpg"/></div>
<div class="p">Once upon a time.</div>
<div class="p">The end came soon.</div>
</section></body></html>`;
  const copy = `<html><body><section>
<p class="p1">This work is licensed under the Creative Commons Attribution-NonCommercial 4.0 International License, http://creativecommons.org/licenses/by-nc/4.0/.</p>
<p class="p1">Original illustrations by Bob Artist</p>
</section></body></html>`;
  return zip([
    file("mimetype", "application/epub+zip"),
    file("META-INF/container.xml", container),
    file("OEBPS/content.opf", opf),
    file("OEBPS/Text/cover.xhtml", cover),
    file("OEBPS/Text/title.xhtml", title),
    file("OEBPS/Text/p1.xhtml", p1),
    file("OEBPS/Text/copy.xhtml", copy),
    { name: "OEBPS/Images/cover.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
    { name: "OEBPS/Images/p1.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
  ]);
}

function run(language?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "epub-test-"));
  const epubPath = path.join(dir, "in.epub");
  fs.writeFileSync(epubPath, sampleEpub(language));
  const bookDir = path.join(dir, "book");
  return { dir, bookDir, epubPath };
}

describe("epubToBloomMarkdown", () => {
  it("emits tagged markdown with cover, story text, fields, and copies images", async () => {
    const { bookDir, epubPath } = run();
    const { markdown, language, pageCount } = await epubToBloomMarkdown(epubPath, bookDir);

    expect(language).toBe("en");
    expect(pageCount).toBe(4); // cover, title(fields), p1, copy(fields)

    // YAML front matter makes this a .llm.md-grade artifact.
    expect(markdown).toMatch(/^---\nl1: "en"\nlanguages:\n {2}en: "English"\n---/);

    // Full-bleed cover uses the reserved filename.
    expect(markdown).toContain("![cover](cover.jpg)");

    // Story text preserved verbatim as an editable text block.
    expect(markdown).toContain('<!-- text lang="en" -->');
    expect(markdown).toContain("Once upon a time.");
    expect(markdown).toContain("The end came soon.");

    // OPF metadata → fields.
    expect(markdown).toContain('field="bookTitle"');
    expect(markdown).toContain("The Test Book");
    expect(markdown).toContain('field="author"');
    expect(markdown).toContain("Ada Author");
    // illustrator mined from the copyright page prose.
    expect(markdown).toContain("Bob Artist");
    // CC license URL mined from the copyright page prose — and ONLY the URL: the prose
    // ends the sentence right after it ("…/4.0/."), so the trailing period must not be
    // swallowed into the URL (or Bloom can't map it to a token and shows "Custom").
    expect(markdown).toContain("http://creativecommons.org/licenses/by-nc/4.0/");
    expect(markdown).not.toContain("by-nc/4.0/.");

    // Images actually copied into the book folder.
    expect(fs.existsSync(path.join(bookDir, "cover.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(bookDir, "p1.jpg"))).toBe(true);

    // Each page carries its source (spine) page index for paired-preview alignment.
    expect(markdown).toContain('source-pdf-page="1"'); // cover
    expect(markdown).toContain('source-pdf-page="3"'); // the story page (spine index 3)
  });

  it("exposes source page count and per-page illustrations for the paired preview", async () => {
    const { epubPath } = run();
    expect(getEpubPageCount(epubPath)).toBe(4);
    // Spine page 3 is the story page with p1.jpg.
    const img = getEpubPageImage(epubPath, 3);
    expect(img).not.toBeNull();
    expect(img!.contentType).toBe("image/jpeg");
    expect(img!.buffer.length).toBeGreaterThan(0);
    // Spine page 4 is the text-only copyright page — no illustration.
    expect(getEpubPageImage(epubPath, 4)).toBeNull();
  });

  it("classifies spine pages by role for xMatter alignment", async () => {
    const { epubPath } = run();
    // cover, title, story, copyright → the four roles the paired preview aligns
    // against Bloom's regenerated xMatter (Bloom strips source-pdf-page from those).
    expect(getEpubPageRoles(epubPath)).toEqual([
      { index: 1, role: "front-cover" },
      { index: 2, role: "title" },
      { index: 3, role: "content" },
      { index: 4, role: "credits" },
    ]);
  });

  it("exposes spine hrefs (internal zip paths) in reading order for the resource proxy", async () => {
    const { epubPath } = run();
    expect(getEpubSpineHrefs(epubPath)).toEqual([
      "OEBPS/Text/cover.xhtml",
      "OEBPS/Text/title.xhtml",
      "OEBPS/Text/p1.xhtml",
      "OEBPS/Text/copy.xhtml",
    ]);
  });

  it("reads archive entries by internal path with the right content type", async () => {
    const { epubPath } = run();
    // The story document — served so its relative ../Images/../Fonts resolve through the proxy.
    const doc = readEpubEntry(epubPath, "OEBPS/Text/p1.xhtml");
    expect(doc).not.toBeNull();
    expect(doc!.contentType).toBe("text/html; charset=utf-8");
    expect(doc!.buffer.toString("utf8")).toContain("Once upon a time.");
    // The real illustration (a relative src that resolves in the zip) is preserved.
    expect(doc!.buffer.toString("utf8")).toContain("p1.jpg");
    // An image entry keeps its image content type.
    expect(readEpubEntry(epubPath, "OEBPS/Images/p1.jpg")!.contentType).toBe("image/jpeg");
    // A missing entry yields null.
    expect(readEpubEntry(epubPath, "OEBPS/nope.css")).toBeNull();
  });

  it("strips unresolvable <img>s from served spine docs (no broken-image boxes)", async () => {
    // A StoryWeaver-style page: a real relative illustration, a hidden dictionary loader
    // with an absolute /assets path, and a remote CDN logo. Only the first can render
    // through the local proxy; the other two would otherwise show as broken-image boxes.
    // The illustration is a multi-line <img> whose `data-size1-src` (a remote CDN URL,
    // used only by the publisher's lazy-load JS) precedes the real relative `src` — we
    // must key off the real src, not the `data-*-src`, or we'd drop the illustration.
    const page = `<html><body><section>
<div class="container"><img class="responsive_illustration"
  data-size1-src="https://static.example.org/crops/size1/abc.jpg"
  src="../Images/p1.jpg"
/></div>
<div class="loader"><img src="/assets/loader-deadbeef.svg"/></div>
<div class="logo"><img alt="donor" data-src="https://static.example.org/donors/logo.png" src="https://static.example.org/donors/logo.png"/></div>
</section></body></html>`;
    const opf = `<?xml version="1.0"?>
<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:language>en</dc:language></metadata>
<manifest>
<item id="p1" href="Text/p1.xhtml" media-type="application/xhtml+xml"/>
<item id="i1" href="Images/p1.jpg" media-type="image/jpeg"/>
</manifest>
<spine><itemref idref="p1"/></spine></package>`;
    const bytes = zip([
      file("mimetype", "application/epub+zip"),
      file(
        "META-INF/container.xml",
        `<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
      ),
      file("OEBPS/content.opf", opf),
      file("OEBPS/Text/p1.xhtml", page),
      { name: "OEBPS/Images/p1.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
    ]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "epub-imgstrip-"));
    const epubPath = path.join(dir, "in.epub");
    fs.writeFileSync(epubPath, bytes);

    const html = readEpubEntry(epubPath, "OEBPS/Text/p1.xhtml")!.buffer.toString("utf8");
    // Real illustration kept — keyed off its working relative src, not the data-*-src.
    expect(html).toContain('src="../Images/p1.jpg"');
    expect(html).toContain("responsive_illustration");
    // The dictionary loader (absolute /assets path) and the donor logo (remote CDN src)
    // are dropped, leaving their wrapper divs empty so no broken-image box can render.
    expect(html).not.toContain("/assets/loader-deadbeef.svg");
    expect(html).not.toContain('<img alt="donor"');
    expect(html).toMatch(/<div class="loader"><\/div>/);
    expect(html).toMatch(/<div class="logo"><\/div>/);
  });

  // A minimal but real JPEG header (SOF0) declaring w×h, so intrinsicSize can read it.
  function jpeg(w: number, h: number): Buffer {
    return Buffer.from([
      0xff,
      0xd8,
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      (h >> 8) & 0xff,
      h & 0xff,
      (w >> 8) & 0xff,
      w & 0xff,
      0x03,
      0x01,
      0x22,
      0x00,
      0x02,
      0x11,
      0x01,
      0x03,
      0x11,
      0x01,
      0xff,
      0xd9,
    ]);
  }

  // Build a 2-content-page EPUB whose illustrations have the given pixel size.
  function epubWithImageSize(w: number, h: number): Uint8Array {
    const opf = `<?xml version="1.0"?>
<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:language>en</dc:language></metadata>
<manifest>
<item id="p1" href="Text/p1.xhtml" media-type="application/xhtml+xml"/>
<item id="p2" href="Text/p2.xhtml" media-type="application/xhtml+xml"/>
<item id="i1" href="Images/p1.jpg" media-type="image/jpeg"/>
<item id="i2" href="Images/p2.jpg" media-type="image/jpeg"/>
</manifest>
<spine><itemref idref="p1"/><itemref idref="p2"/></spine></package>`;
    const pg = (n: number) =>
      `<html><body><section><div class="container"><img src="../Images/p${n}.jpg"/></div><div class="p">Page ${n}.</div></section></body></html>`;
    return zip([
      file("mimetype", "application/epub+zip"),
      file(
        "META-INF/container.xml",
        `<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
      ),
      file("OEBPS/content.opf", opf),
      file("OEBPS/Text/p1.xhtml", pg(1)),
      file("OEBPS/Text/p2.xhtml", pg(2)),
      { name: "OEBPS/Images/p1.jpg", data: jpeg(w, h) },
      { name: "OEBPS/Images/p2.jpg", data: jpeg(w, h) },
    ]);
  }

  async function convert(bytes: Uint8Array): Promise<string> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "epub-orient-"));
    const epubPath = path.join(dir, "in.epub");
    fs.writeFileSync(epubPath, bytes);
    return (await epubToBloomMarkdown(epubPath, path.join(dir, "book"))).markdown;
  }

  it("emits a Device16x9 landscape page-size hint when illustrations are landscape", async () => {
    const md = await convert(epubWithImageSize(1024, 600));
    expect(md).toMatch(/<!-- book page-size="Device16x9Landscape"[^>]*-->/);
  });

  it("emits a Device16x9 portrait page-size hint for portrait illustrations", async () => {
    const md = await convert(epubWithImageSize(600, 900));
    expect(md).toMatch(/<!-- book page-size="Device16x9Portrait"[^>]*-->/);
  });

  // A reflowable book (named cover + story pages) whose COVER is portrait but whose
  // interior scene illustrations are landscape — the LFA/Vanuatu shape. The wide interior
  // art sits at the top of a portrait page, so it must NOT drive orientation; the cover
  // (sized to the target device) does. `pre-paginated` flips this: a fixed-layout book's
  // pages ARE the art, so the landscape illustrations win.
  function reflowableEpub(
    cover: { w: number; h: number },
    content: { w: number; h: number },
    opts: { prePaginated?: boolean } = {},
  ): Uint8Array {
    const rendition = opts.prePaginated
      ? `<meta property="rendition:layout">pre-paginated</meta>`
      : "";
    const opf = `<?xml version="1.0"?>
<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:language>en</dc:language>${rendition}</metadata>
<manifest>
<item id="cover" href="Text/cover.xhtml" media-type="application/xhtml+xml"/>
<item id="p1" href="Text/p1.xhtml" media-type="application/xhtml+xml"/>
<item id="p2" href="Text/p2.xhtml" media-type="application/xhtml+xml"/>
<item id="cimg" href="Images/cover.jpg" media-type="image/jpeg"/>
<item id="i1" href="Images/p1.jpg" media-type="image/jpeg"/>
<item id="i2" href="Images/p2.jpg" media-type="image/jpeg"/>
</manifest>
<spine><itemref idref="cover"/><itemref idref="p1"/><itemref idref="p2"/></spine></package>`;
    const cov = `<html><body><section><img src="../Images/cover.jpg"/></section></body></html>`;
    const pg = (n: number) =>
      `<html><body><section><div class="container"><img src="../Images/p${n}.jpg"/></div><div class="p">Page ${n}.</div></section></body></html>`;
    return zip([
      file("mimetype", "application/epub+zip"),
      file(
        "META-INF/container.xml",
        `<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
      ),
      file("OEBPS/content.opf", opf),
      file("OEBPS/Text/cover.xhtml", cov),
      file("OEBPS/Text/p1.xhtml", pg(1)),
      file("OEBPS/Text/p2.xhtml", pg(2)),
      { name: "OEBPS/Images/cover.jpg", data: jpeg(cover.w, cover.h) },
      { name: "OEBPS/Images/p1.jpg", data: jpeg(content.w, content.h) },
      { name: "OEBPS/Images/p2.jpg", data: jpeg(content.w, content.h) },
    ]);
  }

  it("orients a reflowable book by its cover, not its (wide) interior illustrations", async () => {
    const md = await convert(reflowableEpub({ w: 600, h: 900 }, { w: 1024, h: 600 }));
    expect(md).toMatch(/<!-- book page-size="Device16x9Portrait"[^>]*-->/);
  });

  it("orients a pre-paginated (fixed-layout) book by its full-page illustrations", async () => {
    const md = await convert(
      reflowableEpub({ w: 600, h: 900 }, { w: 1024, h: 600 }, { prePaginated: true }),
    );
    expect(md).toMatch(/<!-- book page-size="Device16x9Landscape"[^>]*-->/);
  });

  // A discussion-questions page: a bold heading then a <table> of (icon | question) rows.
  // It must become a TEXT-ONLY canvas — a positioned box per question — not a single merged
  // origami block; a contents/index table (cells that are links) must NOT (it's navigation).
  function epubWithTablePage(tableHtml: string): Uint8Array {
    const opf = `<?xml version="1.0"?>
<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:language>en</dc:language></metadata>
<manifest>
<item id="q" href="Text/q.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="q"/></spine></package>`;
    const q = `<html><head><title>The Book</title></head><body><section>${tableHtml}</section></body></html>`;
    // Include a stub file for every image the table references (resolved relative to
    // OEBPS/Text/), so useImage finds them in the archive and the row icons are copied.
    const imageEntries = [...tableHtml.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(
      (m) => ({
        name: `OEBPS/${m[1].replace(/^\.\.\//, "")}`,
        data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      }),
    );
    return zip([
      file("mimetype", "application/epub+zip"),
      file(
        "META-INF/container.xml",
        `<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
      ),
      file("OEBPS/content.opf", opf),
      file("OEBPS/Text/q.xhtml", q),
      ...imageEntries,
    ]);
  }

  it("lays a discussion-questions table page out as a canvas, keeping each row's icon", async () => {
    const md = await convert(
      epubWithTablePage(`<h2>Talk about this book.</h2>
<table>
<tr><td><img src="../Images/i-1.jpg"/></td><td>Where were they going?</td></tr>
<tr><td><img src="../Images/i-2.jpg"/></td><td>Why was it hard?</td></tr>
<tr><td></td><td>What happened next?</td></tr>
</table>`),
    );
    // A heading box + one box per question (4 text boxes).
    const m = md.match(/canvas-text-boxes="([^"]+)"/);
    expect(m).not.toBeNull();
    expect(m![1].split(";")).toHaveLength(4);
    expect(md).toContain("**Talk about this book.**");
    expect(md).toContain("Where were they going?");
    expect(md).toContain("What happened next?");
    // The two rows that HAVE an icon keep it: an image line + a canvas-image-boxes entry
    // each. The icon-less third row contributes neither. (Icons are content, not noise —
    // dropping them as "decorative" was the bug.)
    const imgBoxes = md.match(/canvas-image-boxes="([^"]+)"/);
    expect(imgBoxes).not.toBeNull();
    expect(imgBoxes![1].split(";")).toHaveLength(2);
    // The icons carry their intrinsic pixel size so Stage 4 can size them all to one
    // common width with proportional heights (the source's equal-width intent). The stub
    // fixture images are 4-byte JPEGs with no real dimensions, so the `{width= height=}`
    // suffix may be absent here; the real-EPUB sizing is covered by the html-generator test.
    expect(md).toMatch(/!\[i-1\]\(i-1\.jpg\)/);
    expect(md).toMatch(/!\[i-2\]\(i-2\.jpg\)/);

    // The questions are a table column: each row's text carries the `tableRows` style
    // (left-aligned in Stage 4) and shares ONE left edge — including the icon-less row,
    // which lines up with the others (it just has an empty icon slot). The heading is a
    // separate centered paragraph, NOT a tableRows row.
    expect(md).toContain('<!-- text lang="en" style="tableRows" -->');
    const rowXs = m![1]
      .split(";")
      .slice(1) // drop the heading box
      .map((b) => b.split(",")[0]);
    expect(new Set(rowXs).size).toBe(1); // all questions share one left X
    // The heading row is NOT styled tableRows (it stays centered).
    const headingIdx = md.indexOf("**Talk about this book.**");
    expect(md.slice(0, headingIdx)).not.toContain('style="tableRows"');
  });

  it("sizes table-canvas row icons to one width with aspect-proportional, non-overlapping rows", async () => {
    // The source table sets every icon to ONE width and lets each row's HEIGHT follow the
    // figure's aspect. Regression guard for the bug where a tall figure was squeezed into a
    // short even-height band (and dragged every icon's common width down): a tall standing
    // figure (220x550) and a short seated one (304x325) must get the SAME box width but a
    // PROPORTIONAL height (tall > short), and the stacked rows must not overlap.
    const opf = `<?xml version="1.0"?>
<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:language>en</dc:language></metadata>
<manifest><item id="q" href="Text/q.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="q"/></spine></package>`;
    const q = `<html><head><title>Qs</title></head><body><section>
<p class="quest-h"><b>You can use these questions.</b></p>
<table>
<tr><td><img src="../Images/i-tall.jpg" width="140"/></td><td>Tall figure question?</td></tr>
<tr><td><img src="../Images/i-short.jpg" width="140"/></td><td>Short figure question?</td></tr>
<tr><td></td><td>An icon-less question?</td></tr>
</table></section></body></html>`;
    const md = await convert(
      zip([
        file("mimetype", "application/epub+zip"),
        file(
          "META-INF/container.xml",
          `<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
        ),
        file("OEBPS/content.opf", opf),
        file("OEBPS/Text/q.xhtml", q),
        { name: "OEBPS/Images/i-tall.jpg", data: jpeg(220, 550) },
        { name: "OEBPS/Images/i-short.jpg", data: jpeg(304, 325) },
      ]),
    );
    const boxes = md
      .match(/canvas-image-boxes="([^"]+)"/)![1]
      .split(";")
      .map((b) => b.split(",").map(Number))
      .map(([x, y, w, h]) => ({ x, y, w, h }));
    expect(boxes).toHaveLength(2); // the icon-less row contributes no image box
    const [tall, short] = boxes;
    expect(tall.w).toBeCloseTo(short.w, 6); // one common width
    expect(tall.h).toBeGreaterThan(short.h); // height follows each figure's aspect
    expect(tall.y + tall.h).toBeLessThanOrEqual(short.y + 1e-6); // rows stack, no overlap
  });

  it("leaves a links-only contents/index table to origami (not a canvas)", async () => {
    const md = await convert(
      epubWithTablePage(`<table>
<tr><td><a href="c1.xhtml">CHAPTER I.</a></td><td><a href="c1.xhtml">Down the Hole</a></td></tr>
<tr><td><a href="c2.xhtml">CHAPTER II.</a></td><td><a href="c2.xhtml">The Pool</a></td></tr>
<tr><td><a href="c3.xhtml">CHAPTER III.</a></td><td><a href="c3.xhtml">The Race</a></td></tr>
</table>`),
    );
    expect(md).not.toContain("canvas-text-boxes");
  });

  // A picture-book whose spine isn't named (cov/p1/p2/p3, like StoryWeaver's 1..N): the
  // first spine page is the cover, the rest absolutely-position prose over full-bleed art.
  function epubWithPositionedText(): Uint8Array {
    const opf = `<?xml version="1.0"?>
<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:language>or</dc:language>
<dc:title>My Story Title</dc:title>
<dc:creator>An Author</dc:creator>
<dc:date>2023-01-01</dc:date>
<meta name="cover" content="icov"/>
</metadata>
<manifest>
<item id="cov" href="Text/cov.xhtml" media-type="application/xhtml+xml"/>
<item id="p1" href="Text/p1.xhtml" media-type="application/xhtml+xml"/>
<item id="p2" href="Text/p2.xhtml" media-type="application/xhtml+xml"/>
<item id="p3" href="Text/p3.xhtml" media-type="application/xhtml+xml"/>
<item id="icov" href="Images/cov.jpg" media-type="image/jpeg"/>
<item id="i1" href="Images/p1.jpg" media-type="image/jpeg"/>
<item id="i2" href="Images/p2.jpg" media-type="image/jpeg"/>
<item id="i3" href="Images/p3.jpg" media-type="image/jpeg"/>
</manifest>
<spine><itemref idref="cov"/><itemref idref="p1"/><itemref idref="p2"/><itemref idref="p3"/></spine></package>`;
    // cov: the cover — illustration + the title/author/illustrator contributor prose.
    const cov = `<html><body><div class="front-cover-page">
<div class="illustration"><img src="../Images/cov.jpg"/></div>
<div class="cover_title">My Story Title</div>
<div class="contributor_attribution illustrators">Illustrator: An Illustrator</div>
<div class="contributor_attribution translators">Translator: A Translator</div>
</div></body></html>`;
    // p1: one positioned caption over a full-bleed illustration (a wrapper layer at
    // 0/0/100%/100% must be ignored). p2: two positioned blocks (multi-box canvas).
    const p1 = `<html><body><div class="page">
<div class="illustration"><img class="responsive_illustration"
  data-size1-src="https://cdn.example.org/big.jpg" src="../Images/p1.jpg"/></div>
<svg style="width:100%; height:100%; position:absolute; top:0; left:0;"></svg>
<div class="content" style="position: absolute; width: 53.3%; height: 52.43%; top: 25.83%; left: 38.83%;">
<p>Hello there.</p><p>Second line.</p></div>
</div></body></html>`;
    const p2 = `<html><body><div class="page">
<div class="illustration"><img src="../Images/p2.jpg"/></div>
<div class="content" style="position:absolute; width:30%; height:20%; top:10%; left:5%;"><p>Top box.</p></div>
<div class="content" style="position:absolute; width:25%; height:15%; top:80%; left:60%;"><p>Bottom box.</p></div>
</div></body></html>`;
    // p3: a WORDLESS page — full-bleed illustration, no positioned prose, only a
    // (non-story) page-number div like StoryWeaver's "3/3".
    const p3 = `<html><body><div class="page">
<div class="illustration"><img src="../Images/p3.jpg"/></div>
<div class="page_number">3/3</div>
</div></body></html>`;
    return zip([
      file("mimetype", "application/epub+zip"),
      file(
        "META-INF/container.xml",
        `<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
      ),
      file("OEBPS/content.opf", opf),
      file("OEBPS/Text/cov.xhtml", cov),
      file("OEBPS/Text/p1.xhtml", p1),
      file("OEBPS/Text/p2.xhtml", p2),
      file("OEBPS/Text/p3.xhtml", p3),
      { name: "OEBPS/Images/cov.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
      { name: "OEBPS/Images/p1.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
      { name: "OEBPS/Images/p2.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
      { name: "OEBPS/Images/p3.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
    ]);
  }

  it("emits canvas-text-boxes for full-bleed art with absolutely-positioned prose", async () => {
    const md = await convert(epubWithPositionedText());

    // Page 1: a single box at the source fractions (left,top,width,height ÷ 100),
    // the illustration, and the caption's two paragraphs kept as one block.
    expect(md).toContain('canvas-text-boxes="0.3883,0.2583,0.533,0.5243"');
    expect(md).toContain("![p1](p1.jpg)");
    expect(md).toContain("Hello there.\n\nSecond line.");
    // The full-bleed wrapper layer (0,0,100%,100%) is NOT treated as a text box.
    expect(md).not.toContain("0,0,1,1");

    // Page 2: two boxes (multi-text canvas), in document order, each its own block.
    expect(md).toContain('canvas-text-boxes="0.05,0.1,0.3,0.2;0.6,0.8,0.25,0.15"');
    expect(md).toContain("Top box.");
    expect(md).toContain("Bottom box.");

    // Page 3: wordless → a full-bleed image page (no canvas boxes), and the page
    // number is dropped, not emitted as a stray text block.
    expect(md).toContain('full-page-image="true"');
    expect(md).toContain("![p3](p3.jpg)");
    expect(md).not.toContain("3/3");
  });

  it("recognizes the cover and emits OPF + mined metadata when the spine isn't named", async () => {
    const md = await convert(epubWithPositionedText());

    // The first (unnamed) spine page is the cover: the OPF cover image becomes Bloom's
    // `coverImage` under its own name (a STANDARD cover with title, not the full-bleed
    // reserved `cover.jpg`), and the page is NOT re-rendered as content.
    expect(md).toContain("![cover](cov.jpg)");
    expect(md).not.toContain("cover.jpg");

    // OPF metadata → title fields; illustrator + translator mined from the pages.
    expect(md).toContain('field="bookTitle"');
    expect(md).toContain("My Story Title");
    expect(md).toContain('field="author"');
    expect(md).toContain("An Author");
    expect(md).toContain('field="illustrator"');
    expect(md).toContain("An Illustrator");
    expect(md).toContain("© 2023");

    // The cover credit carries the ROLES (not bare names), and EPUBs default to a white
    // cover (a plain image + title), so Bloom keeps the regenerated cover white.
    expect(md).toContain('field="smallCoverCredits"');
    expect(md).toContain("Author: An Author");
    expect(md).toContain("Illustrator: An Illustrator");
    expect(md).toContain("Translator: A Translator");
    expect(md).toContain('cover-color="white"');
  });

  it("preserves full-page-image through the parse → generate round-trip Stage 3 performs", async () => {
    const { getMarkdownFromBook } = await import("../bloom-markdown/generateMarkdown");
    const { BloomMarkdown } = await import("../bloom-markdown/parseMarkdown");
    const md = await convert(epubWithPositionedText());
    const book = new BloomMarkdown().parseMarkdown(md);
    expect(book.pages.some((p) => p.fullPageImage)).toBe(true);
    expect(getMarkdownFromBook(book)).toContain('full-page-image="true"');
  });

  it("uses the OPF language for l1", async () => {
    const { bookDir, epubPath } = run("bi");
    const { markdown, language } = await epubToBloomMarkdown(epubPath, bookDir);
    expect(language).toBe("bi");
    expect(markdown).toContain('l1: "bi"');
    expect(markdown).toContain('bi: "Bislama"');
    expect(markdown).toContain('<!-- text lang="bi" -->');
  });

  // A Pratham Books / StoryWeaver EPUB: spine 1..N, the cover names contributors via
  // `cover_attribution` paragraphs, and the last pages are end matter (`attribution-text`
  // + a `back-cover` with the blurb). Crucially, EVERY page embeds the SAME full
  // stylesheet in <head>, so the class names appear on every page — the importer must
  // classify pages by their <body> only.
  function storyWeaverEpub(): Uint8Array {
    // The shared stylesheet StoryWeaver injects into every page's <head>. It MENTIONS the
    // structural class names, so a naive whole-document probe would tag every page.
    const sharedStyle = `<style type="text/css">.front-cover-page{}.cover_title{}.cover_attribution{}.attribution-text{}.attrb-full{}.back-cover-top{}.synopsis{}</style>`;
    const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head>${sharedStyle}</head><body><div id="story_epub"><div id="storyReader">${body}</div></div></body></html>`;
    const opf = `<?xml version="1.0"?>
<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier>/stories/12345-a-storyweaver-tale</dc:identifier>
<dc:title>A StoryWeaver Tale</dc:title>
<dc:creator>Orig Author</dc:creator>
<dc:date>2019-01-01</dc:date>
<meta name="cover" content="icov"/>
</metadata>
<manifest>
<item id="c1" href="1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="2.xhtml" media-type="application/xhtml+xml"/>
<item id="c3" href="3.xhtml" media-type="application/xhtml+xml"/>
<item id="c4" href="4.xhtml" media-type="application/xhtml+xml"/>
<item id="icov" href="image_1.jpg" media-type="image/jpeg"/>
<item id="i2" href="image_2.jpg" media-type="image/jpeg"/>
</manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/><itemref idref="c4"/></spine></package>`;
    // 1: cover — illustration + contributor block (Author / Illustrator / Translator).
    const cover = doc(`<div class="illustration"><img src="image_1.jpg"/></div>
<div class="front-cover-page"><p class="cover_title"><b>A StoryWeaver Tale</b></p>
<p class="cover_attribution">Author: <span class="contributor_attribution authors">Orig Author</span></p>
<p class="cover_attribution">Illustrator: <span class="contributor_attribution illustrators">Art Ist</span></p>
<p class="cover_attribution">Translator: <span class="contributor_attribution authors derivation_authors">Trans Lator</span></p></div>`);
    // 2: story page.
    const story = doc(`<div class="illustration"><img src="image_2.jpg"/></div>
<div class="content" style="position:absolute; width:50%; height:40%; top:10%; left:20%;"><p>Once there was a step.</p></div>`);
    // 3: attribution — translation copyright (newest), CC license, publisher, donor.
    const attribution =
      doc(`<div class="attrb-full"><div class="attrib-synopsis"><p>This book was made possible by Pratham Books' StoryWeaver platform.</p></div></div>
<div class="attribution-text"><div class="attribution-center">
<span class="self-attribution">This story: <span>A StoryWeaver Tale</span> is translated by <a href="https://storyweaver.org.in/users/9">Trans Lator</a>. The © for this translation lies with Pratham Books, 2022. Some rights reserved. Released under CC BY 4.0 license.</span>
<span class="original-story-attribution">Based on Original story: '<a href="x">Steps</a>', by <a href="y">Orig Author</a>. © Pratham Books, 2019. Some rights reserved.</span>
<span class="other-credits">'A StoryWeaver Tale' has been published on StoryWeaver by Pratham Books. www.prathambooks.org. The development of this book has been supported by the Test Donor Fund.</span></div></div>
<div class="cc_footer"><p>Some rights reserved. This book is CC-BY-4.0 licensed. <a href="http://creativecommons.org/licenses/by/4.0/">http://creativecommons.org/licenses/by/4.0/</a></p></div>`);
    // 4: back cover — the blurb.
    const back =
      doc(`<div class="back-cover-top"><p class="title"><span class="back_cover_title">A StoryWeaver Tale</span></p>
<p class="synopsis">A short tale about a hungry creature on the steps.</p></div>
<div class="spp_about_us_footer"><span>Pratham Books goes digital…</span></div>`);
    return zip([
      file("mimetype", "application/epub+zip"),
      file(
        "META-INF/container.xml",
        `<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
      ),
      file("OEBPS/content.opf", opf),
      file("OEBPS/1.xhtml", cover),
      file("OEBPS/2.xhtml", story),
      file("OEBPS/3.xhtml", attribution),
      file("OEBPS/4.xhtml", back),
      { name: "OEBPS/image_1.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
      { name: "OEBPS/image_2.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
    ]);
  }

  it("mines StoryWeaver metadata and drops its end-matter pages (no duplication)", async () => {
    const md = await convert(storyWeaverEpub());

    // Contributors come from the COVER's labeled attribution block.
    expect(md).toContain('field="bookTitle"');
    expect(md).toContain("A StoryWeaver Tale");
    expect(md).toContain('field="illustrator"');
    expect(md).toContain("Art Ist");
    // The cover credit carries all three roles, translator included.
    expect(md).toContain("Author: Orig Author");
    expect(md).toContain("Illustrator: Art Ist");
    expect(md).toContain("Translator: Trans Lator");

    // Credits come from the attribution page: the TRANSLATION copyright/year wins, the CC
    // license, the named publisher and donor, and the back-cover blurb as the summary.
    expect(md).toContain("© 2022 Pratham Books");
    expect(md).toContain("creativecommons.org/licenses/by/4.0");
    expect(md).toContain('field="originalPublisher"');
    expect(md).toContain("Pratham Books");
    expect(md).toContain('field="funding"');
    expect(md).toContain("Test Donor Fund");
    expect(md).toContain('field="summary"');
    expect(md).toContain("hungry creature on the steps");

    // The end-matter pages are NOT imported as content — their boilerplate is gone.
    expect(md).not.toContain("made possible by Pratham Books");
    expect(md).not.toContain("Some rights reserved");
    expect(md).not.toContain("goes digital");
    // Only the cover (front matter), the synthesized title/credits, and the ONE story
    // page survive as pages; the story text is kept.
    expect(md).toContain("Once there was a step.");
    expect((md.match(/type="content"/g) || []).length).toBe(1);
  });
});
