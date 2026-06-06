/**
 * EPUB → Bloom tagged Markdown (`.llm.md`) front-end.
 *
 * A reflowable EPUB already carries the story text as DIGITAL TEXT, the
 * illustrations as SEPARATE image files, and the bibliographic data as structured
 * OPF metadata. So — unlike a PDF — we need no OCR and no LLM: we can emit the
 * pipeline's tagged intermediate Markdown deterministically and let the existing
 * Stage 3 (Bloom plan) + Stage 4 (HTML) finish. That yields editable, translatable
 * text objects over clean illustrations ("high translate-ability") at zero API cost.
 *
 * This is tuned to the Library-For-All / Vanuatu template (one image + caption text
 * per spine page, the standard front/back-matter pages) but degrades gracefully to
 * generic `<p>`-based extraction for other reflowable EPUBs.
 *
 * The emitted Markdown is `.llm.md`-grade (YAML front matter + `<!-- text lang -->`
 * field tags), so `planConversion` treats an `.epub` input as starting at the plan
 * stage. See `run/runConversion.ts`. Each emitted page also carries
 * `source-pdf-page="<spine index>"`, so the GUI's paired preview can line each Bloom
 * page up with its source EPUB page (and serve that page's illustration via
 * `getEpubPageImage`), exactly as the PDF flow aligns by rendered page.
 */
import * as fs from "fs";
import * as path from "path";
import { logger } from "../logger";
import { readZip } from "./zipReader";
import { FRONT_COVER_IMAGE_FILENAME, BACK_COVER_IMAGE_FILENAME } from "../types";

// ---------- tiny XHTML/XML helpers (the markup is regular; regex is enough) ----------

/** Named HTML entities common in EPUB prose (numeric refs are decoded generically). */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  copy: "©",
};

function decodeEntities(s: string): string {
  return (
    s
      // Numeric character references — &#x01D2; and &#462; — must be decoded so
      // non-Latin orthographies (e.g. ɔ ɛ Ƒ in many African/Pacific languages) survive.
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeFromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
      .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m)
  );
}

function safeFromCodePoint(cp: number): string {
  try {
    return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
  } catch {
    return "";
  }
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

const tagText = (xml: string, tag: string): string | undefined => {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? stripTags(m[1]) : undefined;
};
const allTagText = (xml: string, tag: string): string[] =>
  [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map((m) =>
    stripTags(m[1]),
  );

/** All <img src> values (raw, doc-relative) in document order. */
const imageSrcs = (xhtml: string): string[] =>
  [...xhtml.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]);

/** The page's primary illustration src, skipping decorative icons / logos. */
const pickMainImage = (imgs: string[]): string | undefined =>
  imgs.find((i) => !/(^|\/)(i-\d|logo|sc\.)/i.test(i));

/** Text of every `<div class="p">` (the LFA story-body convention), in order. */
const storyParagraphs = (xhtml: string): string[] =>
  [...xhtml.matchAll(/<div\s+class="p"[^>]*>([\s\S]*?)<\/div>/gi)]
    .map((m) => stripTags(m[1]))
    .filter(Boolean);

/** Text of `<p|div class="…matching…">` blocks (front/back-matter prose), in order. */
const classedParagraphs = (xhtml: string, classRe: RegExp): string[] => {
  const re = new RegExp(
    `<(?:p|div)\\s+class="(?:${classRe.source})"[^>]*>([\\s\\S]*?)<\\/(?:p|div)>`,
    "gi",
  );
  return [...xhtml.matchAll(re)].map((m) => stripTags(m[1])).filter(Boolean);
};

/** Non-empty table cells (the discussion-questions page), skipping icon-only cells. */
const tableCells = (xhtml: string): string[] =>
  [...xhtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1])).filter(Boolean);

/** Generic fallback: every non-empty <p>, used when no template class is recognized. */
const genericParagraphs = (xhtml: string): string[] => allTagText(xhtml, "p").filter(Boolean);

// ---------- posix path resolution inside the zip ----------

function resolveZipPath(baseDir: string, rel: string): string {
  const parts = (baseDir ? baseDir.split("/") : []).concat(rel.split("/"));
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/**
 * The role a spine page plays. Used both to emit the right kind of Markdown page and
 * — crucially — to line the EPUB up against Bloom's *regenerated* xMatter in the GUI's
 * paired preview. Bloom rebuilds cover/title/credits/back pages as its own xMatter and
 * strips our `source-pdf-page` link from them, so the preview can't align matter pages
 * by source-page number; it matches them by this role instead. See `getEpubPageRoles`.
 */
export type EpubPageRole = "front-cover" | "title" | "credits" | "back-cover" | "content";

/** Classify a spine page by its document basename (the LFA/Vanuatu naming convention). */
export function classifyEpubSpinePage(href: string): EpubPageRole {
  const name = path.basename(href, path.extname(href)).toLowerCase();
  if (name === "cover") return "front-cover";
  if (name === "title") return "title";
  if (name === "copy" || name === "copyright" || name === "credits") return "credits";
  if (name === "back" || name === "backcover" || name === "back-cover") return "back-cover";
  return "content";
}

// ---------- EPUB structure ----------

interface LoadedEpub {
  zip: Map<string, Buffer>;
  read: (zpath: string) => string | undefined;
  /** Directory of the OPF within the zip (hrefs resolve against it). */
  opfDir: string;
  /** Raw OPF XML. */
  opf: string;
  /** Spine hrefs (relative to the OPF dir), in reading order. */
  spineHrefs: string[];
}

/** Parse the EPUB container + OPF and resolve the spine (no image/text extraction). */
function loadEpub(epubPath: string): LoadedEpub {
  const zip = readZip(epubPath);
  const read = (zpath: string): string | undefined => {
    const b = zip.get(zpath);
    return b ? b.toString("utf8") : undefined;
  };

  const container = read("META-INF/container.xml");
  if (!container) throw new Error("Invalid EPUB: missing META-INF/container.xml");
  const opfHref = (container.match(/<rootfile\b[^>]*\bfull-path=["']([^"']+)["']/i) || [])[1];
  if (!opfHref) throw new Error("Invalid EPUB: no rootfile in container.xml");
  const opf = read(opfHref);
  if (!opf) throw new Error(`Invalid EPUB: OPF not found at ${opfHref}`);
  const opfDir = opfHref.includes("/") ? opfHref.slice(0, opfHref.lastIndexOf("/")) : "";

  const manifest: Record<string, string> = {};
  for (const m of opf.matchAll(/<item\b([^>]*)\/?>/gi)) {
    const id = (m[1].match(/\bid=["']([^"']+)["']/i) || [])[1];
    const href = (m[1].match(/\bhref=["']([^"']+)["']/i) || [])[1];
    if (id && href) manifest[id] = href;
  }
  const spineHrefs = [...opf.matchAll(/<itemref\b[^>]*\bidref=["']([^"']+)["']/gi)]
    .map((m) => manifest[m[1]])
    .filter(Boolean);
  if (spineHrefs.length === 0) throw new Error("Invalid EPUB: empty spine");

  return { zip, read, opfDir, opf, spineHrefs };
}

// ---------- main ----------

export interface EpubExtractResult {
  /** The `.llm.md`-grade tagged markdown. */
  markdown: string;
  /** Primary language tag found in the OPF (or "en"). */
  language: string;
  /** Number of pages emitted. */
  pageCount: number;
}

/**
 * Extract an EPUB into `bookFolder` (copying its images there) and return the
 * tagged Bloom Markdown. Deterministic; no network, no API keys.
 */
export async function epubToBloomMarkdown(
  epubPath: string,
  bookFolder: string,
): Promise<EpubExtractResult> {
  const { zip, read, opfDir, opf, spineHrefs } = loadEpub(epubPath);

  // OPF metadata.
  const title = tagText(opf, "dc:title") || path.parse(epubPath).name;
  const author = tagText(opf, "dc:creator");
  const publisher = tagText(opf, "dc:publisher");
  const date = tagText(opf, "dc:date");
  const language = (tagText(opf, "dc:language") || "en").trim();
  const isbn = allTagText(opf, "dc:identifier").find((s) => /\d{6,}/.test(s));
  const subjects = allTagText(opf, "dc:subject").filter((s) => /^[a-z ]+$/i.test(s));

  // Mine a few extra fields from the copyright page if present.
  const copyHref = spineHrefs.find((h) => /copy/i.test(path.basename(h)));
  const copyXhtml = copyHref ? read(resolveZipPath(opfDir, copyHref)) : undefined;
  const illustrator =
    copyXhtml && (copyXhtml.match(/illustrations?\s+by\s+([^<.]+)/i) || [])[1]?.trim();
  const ccUrl =
    copyXhtml &&
    (copyXhtml.match(/https?:\/\/creativecommons\.org\/licenses\/[^\s"'<]+/i) || [])[0];
  const fundingLine =
    copyXhtml &&
    classedParagraphs(copyXhtml, /p1/).find((t) => /made possible|support of|funded/i.test(t));

  // Emit images + tagged markdown.
  fs.mkdirSync(bookFolder, { recursive: true });
  const copied = new Set<string>();
  const useImage = (docDir: string, src: string, destName?: string): string | null => {
    const zpath = resolveZipPath(docDir, src);
    const bytes = zip.get(zpath);
    if (!bytes) {
      logger.warn(`EPUB image not found in archive: ${zpath}`);
      return null;
    }
    const dest = destName || path.basename(zpath);
    fs.writeFileSync(path.join(bookFolder, dest), bytes);
    copied.add(dest);
    return dest;
  };

  const L1 = language;
  const out: string[] = [];
  out.push(
    "---",
    `l1: "${L1}"`,
    "languages:",
    `  ${L1}: ${JSON.stringify(langName(L1))}`,
    "---",
    "",
  );

  let emitted = 0;
  let sourcePage = 0; // 1-based spine index of the page being processed
  const emitPage = (attrs: string, lines: string[]) => {
    if (lines.length === 0) return;
    emitted += 1;
    out.push(
      `<!-- page index=${emitted} ${attrs} source-pdf-page="${sourcePage}" -->`,
      ...lines,
      "",
    );
  };
  const textTag = (field?: string) =>
    `<!-- text lang="${L1}"${field ? ` field="${field}"` : ""} -->`;

  for (let s = 0; s < spineHrefs.length; s++) {
    sourcePage = s + 1;
    const href = spineHrefs[s];
    const name = path.basename(href, path.extname(href)).toLowerCase();
    const zpath = resolveZipPath(opfDir, href);
    const xhtml = read(zpath);
    if (!xhtml) continue;
    const docDir = zpath.includes("/") ? zpath.slice(0, zpath.lastIndexOf("/")) : "";
    const imgs = imageSrcs(xhtml);
    const role = classifyEpubSpinePage(href);

    if (role === "front-cover") {
      if (imgs[0]) useImage(docDir, imgs[0], FRONT_COVER_IMAGE_FILENAME);
      emitPage('type="front-matter"', [`![cover](${FRONT_COVER_IMAGE_FILENAME})`]);
      continue;
    }
    if (role === "title") {
      // The rendered title picture can't be shown by Bloom; carry the metadata as
      // fields so Bloom regenerates the title/credits xMatter from the dataDiv.
      const lines: string[] = [textTag("bookTitle"), title];
      if (author) lines.push(textTag("author"), author);
      if (illustrator) lines.push(textTag("illustrator"), illustrator);
      if (subjects[0]) lines.push(textTag("topic"), subjects[0]);
      emitPage('type="front-matter"', lines);
      continue;
    }
    if (role === "credits") {
      const lines: string[] = [];
      if (publisher)
        lines.push(textTag("copyright"), `© ${(date || "").trim()} ${publisher}`.trim());
      if (isbn) lines.push(textTag("isbn"), isbn);
      if (ccUrl) lines.push(textTag("licenseUrl"), ccUrl);
      if (publisher) lines.push(textTag("originalPublisher"), publisher);
      if (fundingLine) lines.push(textTag("funding"), fundingLine);
      emitPage('type="back-matter"', lines);
      continue;
    }
    if (role === "back-cover") {
      if (imgs[0]) useImage(docDir, imgs[0], BACK_COVER_IMAGE_FILENAME);
      emitPage('type="back-matter"', [`![back](${BACK_COVER_IMAGE_FILENAME})`]);
      continue;
    }

    // ---- content pages (story + discussion/about/marketing) ----
    let paras = storyParagraphs(xhtml);
    if (name === "question" || name === "questions") {
      paras = [...classedParagraphs(xhtml, /quest-h/), ...tableCells(xhtml)];
    } else if (name === "author") {
      paras = classedParagraphs(xhtml, /auth-h|auth-t/);
    } else if (/lfa|enjoy|about/.test(name)) {
      paras = classedParagraphs(xhtml, /lfa-h|lfa-t/);
    }
    if (paras.length === 0) paras = genericParagraphs(xhtml); // template-agnostic fallback

    const lines: string[] = [];
    const mainImg = pickMainImage(imgs);
    if (mainImg) {
      const dest = useImage(docDir, mainImg);
      if (dest) lines.push(`![${path.basename(dest, path.extname(dest))}](${dest})`);
    }
    if (paras.length) lines.push(textTag(), paras.join("\n\n"));
    emitPage('type="content"', lines);
  }

  logger.info(
    `EPUB extracted: ${emitted} page(s), language "${L1}", ${copied.size} image(s) — no OCR/LLM needed.`,
  );

  return { markdown: out.join("\n"), language: L1, pageCount: emitted };
}

/** Number of EPUB source (spine) pages — the source-page count for the paired preview. */
export function getEpubPageCount(epubPath: string): number {
  return loadEpub(epubPath).spineHrefs.length;
}

/**
 * The role of every spine page (1-based), in reading order. The GUI's paired preview
 * uses this to align the EPUB against Bloom's regenerated xMatter: a Bloom cover/title/
 * credits/back page (which has lost its `source-pdf-page` link) is matched to the spine
 * page of the same role, while content pages still align by `source-pdf-page`.
 */
export function getEpubPageRoles(epubPath: string): { index: number; role: EpubPageRole }[] {
  return loadEpub(epubPath).spineHrefs.map((href, i) => ({
    index: i + 1,
    role: classifyEpubSpinePage(href),
  }));
}

/**
 * The primary illustration of source (spine) page `pageIndex` (1-based), as raw
 * bytes + content type — used by the GUI to render the EPUB side of the paired
 * preview, mirroring the PDF flow's rendered page. Returns null if that page has no
 * usable image (e.g. a text-only credits page).
 */
export function getEpubPageImage(
  epubPath: string,
  pageIndex: number,
): { buffer: Buffer; contentType: string } | null {
  const { read, zip, opfDir, spineHrefs } = loadEpub(epubPath);
  const href = spineHrefs[pageIndex - 1];
  if (!href) return null;
  const zpath = resolveZipPath(opfDir, href);
  const xhtml = read(zpath);
  if (!xhtml) return null;
  const docDir = zpath.includes("/") ? zpath.slice(0, zpath.lastIndexOf("/")) : "";
  const src = pickMainImage(imageSrcs(xhtml));
  if (!src) return null;
  const imgZpath = resolveZipPath(docDir, src);
  const buffer = zip.get(imgZpath);
  if (!buffer) return null;
  const contentType = IMAGE_CONTENT_TYPES[path.extname(imgZpath).toLowerCase()] || "image/jpeg";
  return { buffer, contentType };
}

// ---------- raw EPUB preview (GUI source pane) ----------

const escapeAttr = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Inline every `<img src>` in a spine document as a data URI from the archive. */
function inlineImages(xhtml: string, docDir: string, zip: Map<string, Buffer>): string {
  return xhtml.replace(
    /(<img\b[^>]*\bsrc=)["']([^"']+)["']/gi,
    (whole, pre: string, src: string) => {
      if (/^(data:|https?:)/i.test(src)) return whole;
      const bytes = zip.get(resolveZipPath(docDir, src));
      if (!bytes) return whole;
      const ct = IMAGE_CONTENT_TYPES[path.extname(src).toLowerCase()] || "image/jpeg";
      return `${pre}"data:${ct};base64,${bytes.toString("base64")}"`;
    },
  );
}

/** Replace `<link rel="stylesheet" href>` with the archive's CSS inlined as `<style>`. */
function inlineStylesheets(xhtml: string, docDir: string, zip: Map<string, Buffer>): string {
  return xhtml.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/stylesheet/i.test(tag)) return tag;
    const href = (tag.match(/\bhref=["']([^"']+)["']/i) || [])[1];
    if (!href) return tag;
    const css = zip.get(resolveZipPath(docDir, href));
    return css ? `<style>${css.toString("utf8")}</style>` : tag;
  });
}

/**
 * Render ONE spine page (1-based) as a self-contained HTML document — its own XHTML
 * with every image and stylesheet inlined from the archive, so it renders faithfully
 * (illustration *and* prose, in the EPUB's own layout) with nothing else to fetch.
 *
 * This is the per-page analogue of `renderEpubPreviewHtml`, used by the GUI's paired
 * preview to show the real EPUB page beside its Bloom equivalent — not just the
 * extracted illustration. Returns null if that spine page is missing/unreadable.
 */
export function renderEpubPage(epubPath: string, pageIndex: number): string | null {
  const { read, zip, opfDir, spineHrefs } = loadEpub(epubPath);
  const href = spineHrefs[pageIndex - 1];
  if (!href) return null;
  const zpath = resolveZipPath(opfDir, href);
  const xhtml = read(zpath);
  if (!xhtml) return null;
  const docDir = zpath.includes("/") ? zpath.slice(0, zpath.lastIndexOf("/")) : "";
  return inlineStylesheets(inlineImages(xhtml, docDir, zip), docDir, zip);
}

/**
 * Render a reflowable EPUB into ONE self-contained, scrollable HTML document for the
 * GUI's raw-source preview pane — the EPUB analogue of embedding a PDF in an iframe.
 *
 * Each spine page becomes its own `<iframe srcdoc>` (so each page keeps its own CSS
 * and absolute-positioned layout, with no bleed between pages), with all images and
 * stylesheets inlined from the archive so nothing else has to be fetched. A tiny
 * height-sync script lets each page iframe report its rendered height to the parent
 * so the column scrolls naturally. No network, no API keys.
 */
export function renderEpubPreviewHtml(epubPath: string): string {
  const { read, zip, opfDir, spineHrefs } = loadEpub(epubPath);

  const pages: string[] = [];
  for (let s = 0; s < spineHrefs.length; s++) {
    const zpath = resolveZipPath(opfDir, spineHrefs[s]);
    let xhtml = read(zpath);
    if (!xhtml) continue;
    const docDir = zpath.includes("/") ? zpath.slice(0, zpath.lastIndexOf("/")) : "";
    xhtml = inlineStylesheets(inlineImages(xhtml, docDir, zip), docDir, zip);

    // Each page reports its height to the parent so the iframe can be sized to fit.
    const sync =
      `<script>(function(){var I=${s};function s(){parent.postMessage(` +
      `{__epubPageHeight:1,i:I,h:document.documentElement.scrollHeight},"*");}` +
      `addEventListener("load",s);addEventListener("resize",s);` +
      `var n=0,t=setInterval(function(){s();if(++n>12)clearInterval(t);},150);})();</script>`;
    xhtml = /<\/body>/i.test(xhtml) ? xhtml.replace(/<\/body>/i, `${sync}</body>`) : xhtml + sync;

    pages.push(`<iframe class="pg" data-i="${s}" srcdoc="${escapeAttr(xhtml)}"></iframe>`);
  }

  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    "<style>",
    "html,body{margin:0;background:#f1f3f4;}",
    ".pg{display:block;margin:12px auto;width:min(700px,94%);background:#fff;",
    "border:1px solid #dadce0;box-shadow:0 1px 3px rgba(0,0,0,.18);border-radius:2px;}",
    "iframe.pg{border:none;width:min(700px,94%);height:520px;}",
    "</style></head><body>",
    pages.join(""),
    '<script>window.addEventListener("message",function(e){var d=e.data;',
    "if(!d||!d.__epubPageHeight)return;",
    "var f=document.querySelector('iframe[data-i=\"'+d.i+'\"]');",
    'if(f&&d.h)f.style.height=d.h+"px";});</script>',
    "</body></html>",
  ].join("");
}

/** Best-effort human name for a BCP-47 tag (only the common ones; falls back to the tag). */
function langName(tag: string): string {
  const names: Record<string, string> = {
    en: "English",
    bi: "Bislama",
    fr: "French",
    es: "Spanish",
    pt: "Portuguese",
    tpi: "Tok Pisin",
    ho: "Hiri Motu",
  };
  return names[tag.toLowerCase()] || tag;
}
