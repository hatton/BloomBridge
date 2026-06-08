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
    // CC license URL mined from the copyright page prose.
    expect(markdown).toContain("creativecommons.org/licenses/by-nc/4.0");

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
});
