import { describe, it, expect } from "vite-plus/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  epubToBloomMarkdown,
  getEpubPageCount,
  getEpubPageImage,
  getEpubPageRoles,
  renderEpubPage,
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

  it("renders a faithful single spine page (illustration + prose, images inlined)", async () => {
    const { epubPath } = run();
    // Spine page 3 is the story page: its real HTML, with the image inlined as a
    // data URI (no extra fetch) and the prose intact — not just the illustration.
    const html = renderEpubPage(epubPath, 3) || "";
    expect(html).toMatch(/<img\b[^>]*src="data:image\/jpeg;base64,/i);
    expect(html).toContain("Once upon a time.");
    // Out-of-range spine index yields null.
    expect(renderEpubPage(epubPath, 99)).toBeNull();
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
