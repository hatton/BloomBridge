// Proof-of-concept EPUB -> Bloom intermediate-Markdown (.llm.md) converter.
//
// The whole point of this experiment: a (reflowable) EPUB already carries the
// story text as DIGITAL TEXT and the illustrations as SEPARATE image files, plus
// structured metadata in the OPF. So we can produce the pipeline's tagged
// intermediate Markdown deterministically — no OCR, no LLM, no API calls — and let
// the existing Stage 3 (Bloom plan) + Stage 4 (HTML) finish the job. That gives the
// "high translate-ability" result (clean images + editable text objects) for free.
//
// This is intentionally tuned to the Library-For-All / Vanuatu EPUB template used by
// "Why Rat and Cat Became Enemies", but the shape generalises to any reflowable EPUB
// with one image + caption text per spine page.
//
// Usage: node epub-to-bloom-md.mjs <extracted-OEBPS-dir> <book-output-dir>

import * as fs from "fs";
import * as path from "path";

const [, , oebpsDir, bookDir] = process.argv;
if (!oebpsDir || !bookDir) {
  console.error("Usage: node epub-to-bloom-md.mjs <extracted-OEBPS-dir> <book-output-dir>");
  process.exit(1);
}

fs.mkdirSync(bookDir, { recursive: true });

// ---------- helpers ----------

const readText = (p) => fs.readFileSync(p, "utf-8");

/** Strip inline tags (<a>, <br/>, <span>…) from an XHTML fragment, collapse ws. */
function stripTags(html) {
  return html
    .replace(/<br\s*\/?>(?=)/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2019;|&rsquo;/g, "’")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** All <img src> basenames in an XHTML body, in document order. */
function imagesIn(xhtml) {
  return [...xhtml.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => path.basename(m[1]));
}

/** Text of every <div class="p"> (the story body), in order. */
function storyParagraphs(xhtml) {
  return [...xhtml.matchAll(/<div\s+class="p">([\s\S]*?)<\/div>/gi)]
    .map((m) => stripTags(m[1]))
    .filter(Boolean);
}

/** Text of every <p|div class="X"> whose class matches a regex (front/back prose). */
function classedParagraphs(xhtml, classRe) {
  const re = new RegExp(
    `<(?:p|div)\\s+class="(${classRe.source})"[^>]*>([\\s\\S]*?)<\\/(?:p|div)>`,
    "gi",
  );
  return [...xhtml.matchAll(re)].map((m) => stripTags(m[2])).filter(Boolean);
}

/** Cells in the questions table (skip the icon <img> cells). */
function tableQuestions(xhtml) {
  return [...xhtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map((m) => stripTags(m[1]))
    .filter((t) => t.length > 0);
}

// ---------- parse the OPF (metadata + spine) ----------

const opf = readText(path.join(oebpsDir, "content.opf"));

// Simple regex extraction — the OPF is regular, well-formed XML.
const tagText = (tag) => {
  const m = opf.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? stripTags(m[1]) : undefined;
};
const allTagText = (tag) =>
  [...opf.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map((m) =>
    stripTags(m[1]),
  );

const title = tagText("dc:title");
const author = tagText("dc:creator");
const publisher = tagText("dc:publisher");
const date = tagText("dc:date");
const isbn = allTagText("dc:identifier").find((s) => /\d{6,}/.test(String(s)));
const subjects = allTagText("dc:subject").filter((s) => /^[a-z ]+$/i.test(String(s)));

// manifest id -> href, and the ordered spine
const manifest = {};
for (const m of opf.matchAll(/<item\b([^>]*)\/?>/gi)) {
  const attrs = m[1];
  const id = (attrs.match(/\bid=["']([^"']+)["']/i) || [])[1];
  const href = (attrs.match(/\bhref=["']([^"']+)["']/i) || [])[1];
  if (id && href) manifest[id] = href;
}
const spine = [...opf.matchAll(/<itemref\b[^>]*\bidref=["']([^"']+)["']/gi)]
  .map((m) => manifest[m[1]])
  .filter(Boolean);

// ---------- mine a few fields from the copyright page ----------

const copyXhtml = readText(path.join(oebpsDir, "Text", "copy.xhtml"));
const illustrator =
  (copyXhtml.match(/illustrations?\s+by\s+([^<.]+)/i) || [])[1]?.trim() || undefined;
const ccUrl = (copyXhtml.match(/https?:\/\/creativecommons\.org\/licenses\/[^\s"'<]+/i) || [])[0];
const fundingLine = classedParagraphs(copyXhtml, /p1/).find((t) =>
  /made possible|support of/i.test(t),
);

// ---------- emit the tagged Markdown ----------

const L1 = "en";
const copiedImages = new Set();
function useImage(srcBasename, destBasename = srcBasename) {
  const src = path.join(oebpsDir, "Images", srcBasename);
  if (!fs.existsSync(src)) return null;
  fs.copyFileSync(src, path.join(bookDir, destBasename));
  copiedImages.add(destBasename);
  return destBasename;
}

const out = [];
out.push("---");
out.push(`l1: "${L1}"`);
out.push("languages:");
out.push(`  ${L1}: "English"`);
out.push("---");
out.push("");

let idx = 0;
const page = (attrs, lines) => {
  idx += 1;
  out.push(`<!-- page index=${idx}${attrs ? " " + attrs : ""} -->`);
  out.push(...lines);
  out.push("");
};
const textBlock = (field) => `<!-- text lang="${L1}"${field ? ` field="${field}"` : ""} -->`;

let contentSeen = false;
for (const href of spine) {
  const name = path.basename(href, ".xhtml");
  const xhtml = readText(
    path.join(oebpsDir, path.dirname(href) === "." ? "" : path.dirname(href), path.basename(href)),
  );
  const imgs = imagesIn(xhtml);

  if (name === "cover") {
    // Full-bleed front cover. The reserved filename `cover.jpg` is the Stage-4 signal.
    useImage(imgs[0] || "cover.jpg", "cover.jpg");
    page('type="front-matter"', ["![cover](cover.jpg)"]);
    continue;
  }

  if (name === "title") {
    // Title-page picture can't be shown by Bloom; carry the metadata as fields so
    // Bloom regenerates the title/credits xMatter from the dataDiv.
    const lines = [];
    lines.push(textBlock("bookTitle"), title);
    if (author) lines.push(textBlock("author"), author);
    if (illustrator) lines.push(textBlock("illustrator"), illustrator);
    if (subjects[0]) lines.push(textBlock("topic"), subjects[0]);
    page('type="front-matter"', lines);
    continue;
  }

  if (name === "copy") {
    // Copyright/credits → back-matter fields → dataDiv (Bloom rebuilds the credits page).
    const lines = [];
    if (publisher)
      lines.push(textBlock("copyright"), `© ${(date || "").trim()} ${publisher}`.trim());
    if (isbn) lines.push(textBlock("isbn"), String(isbn));
    if (ccUrl) lines.push(textBlock("licenseUrl"), ccUrl);
    if (publisher) lines.push(textBlock("originalPublisher"), publisher);
    if (fundingLine) lines.push(textBlock("funding"), fundingLine);
    page('type="back-matter"', lines);
    continue;
  }

  if (name === "back") {
    // Full-bleed back cover. Reserved filename `back-cover.jpg`.
    useImage(imgs[0] || "back.jpg", "back-cover.jpg");
    page('type="back-matter"', ["![back](back-cover.jpg)"]);
    continue;
  }

  // ---- content-ish pages ----
  let paras = storyParagraphs(xhtml);
  if (name === "question") {
    paras = [...classedParagraphs(xhtml, /quest-h/), ...tableQuestions(xhtml)];
  } else if (name === "author") {
    paras = classedParagraphs(xhtml, /auth-h|auth-t/);
  } else if (name === "lfa") {
    paras = classedParagraphs(xhtml, /lfa-h|lfa-t/);
  }

  const lines = [];
  // Main illustration for the page (skip decorative icons / logos).
  const mainImg = imgs.find((i) => !/^(i-\d|logo|sc\.)/i.test(i));
  if (mainImg) {
    const dest = useImage(mainImg);
    if (dest) lines.push(`![${path.basename(dest, path.extname(dest))}](${dest})`);
  }
  if (paras.length) {
    lines.push(textBlock());
    lines.push(paras.join("\n\n"));
  }
  if (!lines.length) continue;

  const hasRealText = paras.length > 0;
  if (hasRealText) contentSeen = true;
  page('type="content"', lines);
}

const mdPath = path.join(path.dirname(bookDir), path.basename(bookDir) + ".llm.md");
fs.writeFileSync(mdPath, out.join("\n"));

console.log("Wrote:", mdPath);
console.log("Book folder:", bookDir);
console.log("Copied images:", [...copiedImages].join(", "));
console.log("Pages emitted:", idx);
