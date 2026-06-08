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
import type { HorizontalAlign } from "../types";

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

/**
 * Decorative images we never treat as page content: the question-page answer icons
 * (`i-1`…), publisher logos, and the small social/credit mark (`sc.`). Everything
 * else is a real illustration.
 */
const isDecorativeImage = (src: string): boolean =>
  /(^|\/)(i-\d|logo|sc\.)/i.test(src) ||
  // Absolute (`/assets/loader-….svg`) or remote (`https://…cdn…`) srcs are website-only
  // chrome that never resolves inside the archive — never a real page illustration.
  /^(https?:)?\/\//i.test(src) ||
  src.startsWith("/");

/** The page's primary illustration src, skipping decorative icons / logos. */
const pickMainImage = (imgs: string[]): string | undefined =>
  imgs.find((i) => !isDecorativeImage(i));

/**
 * Intrinsic pixel size of a JPEG or PNG from its header (no decode, no dependency).
 * Returns null for unrecognised data. Used to read illustration aspect ratios so we can
 * pick the book's page orientation.
 */
function intrinsicSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50)
    // PNG: IHDR width/height
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    // JPEG: scan segments for a Start-Of-Frame marker, which carries height/width.
    let o = 2;
    while (o < buf.length - 8) {
      if (buf[o] !== 0xff) {
        o++;
        continue;
      }
      const m = buf[o + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
      o += 2 + buf.readUInt16BE(o + 2);
    }
  }
  return null;
}

/**
 * Decide a Bloom page-size token from the illustrations' dominant aspect. Reflowable
 * picture books carry no page geometry, but their illustrations do: a landscape book
 * has landscape illustrations. Median aspect > 1.15 → landscape, < 0.87 → portrait,
 * otherwise default portrait. Returns null when there aren't enough images to judge.
 */
function orientationFromAspects(aspects: number[]): "A5Landscape" | "A5Portrait" | null {
  if (aspects.length < 2) return null;
  const sorted = [...aspects].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median > 1.15) return "A5Landscape";
  if (median < 0.87) return "A5Portrait";
  return null; // ambiguous → leave the pipeline default (A5Portrait)
}

/** Text of `<p|div class="…matching…">` blocks (front/back-matter prose), in order. */
const classedParagraphs = (xhtml: string, classRe: RegExp): string[] => {
  const re = new RegExp(
    `<(?:p|div)\\s+class="(?:${classRe.source})"[^>]*>([\\s\\S]*?)<\\/(?:p|div)>`,
    "gi",
  );
  return [...xhtml.matchAll(re)].map((m) => stripTags(m[1])).filter(Boolean);
};

// ---------- document-order content flow (the key to a faithful layout) ----------

/**
 * What the source styles a paragraph as. We recover this generically from the
 * EPUB's own CSS (and inline styles) rather than hard-coding template class names,
 * so any reflowable EPUB benefits: a paragraph set in a bold font becomes bold, and
 * a page whose prose is centered is laid out centered.
 */
interface ClassStyle {
  bold?: boolean;
  align?: HorizontalAlign;
}

/** A font family counts as bold if it's a bold/black/heavy cut — but NOT semi/demi-bold. */
const isBoldFamily = (family: string): boolean =>
  /bold|black|heavy/i.test(family) && !/semi-?bold|demi-?bold/i.test(family);

/**
 * Build a class → {bold, align} map from the EPUB's stylesheet(s). Bold is conveyed
 * either by `font-weight` or — as in the Library-For-All templates — by naming a bold
 * font cut in `font-family` (`OpenSans-Bold`) while leaving `font-weight:normal`.
 */
function parseClassStyles(css: string): Map<string, ClassStyle> {
  const map = new Map<string, ClassStyle>();
  for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const [, selector, decl] = rule;
    const align = (decl.match(/text-align\s*:\s*(left|center|right)/i)?.[1]?.toLowerCase() ??
      undefined) as HorizontalAlign | undefined;
    const family = decl.match(/font-family\s*:\s*([^;]+)/i)?.[1] ?? "";
    const weight = decl.match(/font-weight\s*:\s*([^;]+)/i)?.[1] ?? "";
    const bold = isBoldFamily(family) || /\b(bold|[6-9]00)\b/i.test(weight);
    if (!align && !bold) continue;
    for (const sel of selector.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
      const prev = map.get(sel[1]) ?? {};
      map.set(sel[1], { align: align ?? prev.align, bold: bold || prev.bold });
    }
  }
  return map;
}

/** Resolve a single element's bold/alignment from its class list, inline style, and tag. */
function resolveElementStyle(
  attrs: string,
  isHeadingTag: boolean,
  classStyles: Map<string, ClassStyle>,
): ClassStyle {
  let bold = isHeadingTag;
  let align: HorizontalAlign | undefined;
  const classList = attrs.match(/\bclass=["']([^"']*)["']/i)?.[1] ?? "";
  for (const cls of classList.split(/\s+/).filter(Boolean)) {
    const s = classStyles.get(cls);
    if (s?.bold) bold = true;
    if (s?.align && !align) align = s.align;
  }
  const inline = attrs.match(/\bstyle=["']([^"']*)["']/i)?.[1] ?? "";
  const inlineAlign = inline.match(/text-align\s*:\s*(left|center|right)/i)?.[1]?.toLowerCase();
  if (inlineAlign) align = inlineAlign as HorizontalAlign;
  if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(inline)) bold = true;
  if (isBoldFamily(inline.match(/font-family\s*:\s*([^;]+)/i)?.[1] ?? "")) bold = true;
  return { bold, align };
}

/** A block in document order: an illustration or a run of prose (possibly bold). */
type FlowBlock = { type: "image"; src: string } | { type: "text"; markdown: string };

/**
 * Walk a content page's body in DOCUMENT ORDER, returning the illustrations and
 * prose interleaved exactly as they appear in the source. This is what lets the
 * downstream origami layout reproduce the real top-to-bottom flow (text, picture,
 * text, …) — instead of the old behaviour, which hoisted one picture to the top and
 * dumped all the text into a single block below it, losing both the ordering and the
 * paragraph structure.
 *
 * Decorative icons/logos are skipped; a paragraph the source styles in a bold font
 * (heading classes like `lfa-h`, `auth-h`, …) is wrapped in markdown `**…**`;
 * consecutive prose uninterrupted by a picture is grouped into one text block (so it
 * becomes one editable with several paragraphs). The page's horizontal alignment is
 * reported when every prose block shares it (e.g. the fully-centered marketing page).
 */
function extractContentFlow(
  xhtml: string,
  classStyles: Map<string, ClassStyle>,
): { blocks: FlowBlock[]; align?: HorizontalAlign } {
  const body = xhtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? xhtml;

  // Collect every block-level leaf we care about with its source position, then
  // walk them in order, skipping any nested inside a container we already consumed
  // (the <img> inside a <div class="container">, or a <td>'s icon).
  interface Candidate {
    start: number;
    end: number;
    attrs: string;
    inner: string;
    heading: boolean;
  }
  const candidates: Candidate[] = [];
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    candidates.push({
      start: m.index!,
      end: m.index! + m[0].length,
      attrs: m[0],
      inner: "",
      heading: false,
    });
  }
  for (const m of body.matchAll(/<(p|div|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    candidates.push({
      start: m.index!,
      end: m.index! + m[0].length,
      attrs: m[2],
      inner: m[3],
      heading: false,
    });
  }
  for (const m of body.matchAll(/<(h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    candidates.push({
      start: m.index!,
      end: m.index! + m[0].length,
      attrs: m[2],
      inner: m[3],
      heading: true,
    });
  }
  // Earliest first; on a tie the wider span (a container) wins so it consumes its children.
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);

  // Raw blocks, plus each prose block's resolved alignment (for the page-level decision).
  const raw: FlowBlock[] = [];
  const proseAligns: (HorizontalAlign | undefined)[] = [];
  let consumedTo = -1;
  for (const c of candidates) {
    if (c.start < consumedTo) continue; // nested inside an already-emitted container
    consumedTo = Math.max(consumedTo, c.end);

    const srcs =
      c.inner === "" ? [c.attrs.match(/\bsrc=["']([^"']+)["']/i)?.[1] ?? ""] : imageSrcs(c.inner);
    for (const src of srcs) {
      if (src && !isDecorativeImage(src)) raw.push({ type: "image", src });
    }
    const text = c.inner === "" ? "" : stripTags(c.inner);
    if (text) {
      const { bold, align } = resolveElementStyle(c.attrs, c.heading, classStyles);
      raw.push({ type: "text", markdown: bold ? `**${text}**` : text });
      proseAligns.push(align);
    }
  }

  // Group consecutive prose (no picture between) into one multi-paragraph block.
  const blocks: FlowBlock[] = [];
  for (const b of raw) {
    const last = blocks[blocks.length - 1];
    if (b.type === "text" && last?.type === "text") last.markdown += `\n\n${b.markdown}`;
    else blocks.push({ ...b });
  }

  // Center/right the page only when ALL prose agrees on it (mixed → leave default left).
  const distinct = new Set(proseAligns.map((a) => a ?? "left"));
  const align =
    distinct.size === 1 && ![...distinct][0].includes("left") ? [...distinct][0] : undefined;

  return { blocks, align: align as HorizontalAlign | undefined };
}

// ---------- canvas (full-bleed art + absolutely-positioned prose) ----------

/** A text block placed over the page, with its box as page fractions (x,y,w,h in 0..1). */
interface CanvasText {
  box: { x: number; y: number; w: number; h: number };
  markdown: string;
  align?: HorizontalAlign;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A page-number-only string like "10" or "10/13" — not real story prose. */
const isPageNumberish = (markdown: string): boolean =>
  /^\s*\d+\s*(\/\s*\d+)?\s*$/.test(markdown.replace(/\*\*/g, ""));

/** A CSS-percentage value of one property in an inline `style` string, as a 0..1 fraction. */
function stylePercent(style: string, prop: string): number | null {
  const m = style.match(new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([\\d.]+)%`, "i"));
  return m ? Number(m[1]) / 100 : null;
}

/** Inner HTML of a positioned block → markdown, one paragraph per `<p>`/`<div>` (bold preserved). */
function positionedInnerToMarkdown(inner: string, classStyles: Map<string, ClassStyle>): string {
  const paras = [...inner.matchAll(/<(p|div|h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/gi)]
    .map((m) => {
      const text = stripTags(m[3]);
      if (!text) return "";
      const { bold } = resolveElementStyle(m[2], /^h[1-6]$/i.test(m[1]), classStyles);
      return bold ? `**${text}**` : text;
    })
    .filter(Boolean);
  return paras.length ? paras.join("\n\n") : stripTags(inner);
}

/**
 * A picture-book "canvas" page: a full-bleed illustration with prose the source
 * absolutely-positions over it. We read each block's box straight from its inline
 * `position:absolute; left/top/width/height:%` — the geometry reflowable picture-book
 * exporters (StoryWeaver, Library-For-All, …) write — so Bloom can reproduce the exact
 * size and location of the text instead of stacking it under the picture (origami).
 * This stays generic: any absolutely-positioned prose over a single illustration
 * qualifies; there's no per-template class matching. Returns null when the page has no
 * positioned prose or no illustration, so the caller falls back to the origami flow.
 */
function extractCanvasLayout(
  xhtml: string,
  classStyles: Map<string, ClassStyle>,
): { src: string; texts: CanvasText[] } | null {
  const body = xhtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? xhtml;

  const texts: CanvasText[] = [];
  for (const m of body.matchAll(/<(p|div)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const attrs = m[2];
    const style = attrs.match(/\bstyle=["']([^"']*)["']/i)?.[1] ?? "";
    if (!/position\s*:\s*absolute/i.test(style)) continue;
    const x = stylePercent(style, "left");
    const y = stylePercent(style, "top");
    const w = stylePercent(style, "width");
    const h = stylePercent(style, "height");
    if (x === null || y === null || w === null || h === null) continue;
    // A full-bleed layer (whole-page wrapper/overlay), not a text box — skip it.
    if (x === 0 && y === 0 && w >= 0.99 && h >= 0.99) continue;
    const markdown = positionedInnerToMarkdown(m[3], classStyles);
    if (!markdown) continue;
    const { align } = resolveElementStyle(attrs, false, classStyles);
    texts.push({
      box: { x: round4(x), y: round4(y), w: round4(w), h: round4(h) },
      markdown,
      align,
    });
  }
  if (texts.length === 0) return null;

  const src = pickMainImage(imageSrcs(xhtml));
  if (!src) return null;
  return { src, texts };
}

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

  // The EPUB's own CSS tells us, generically, which paragraphs are bold headings and
  // how prose is aligned — no per-template class names baked in here.
  let combinedCss = "";
  for (const [name, buf] of zip) {
    if (name.toLowerCase().endsWith(".css")) combinedCss += buf.toString("utf8") + "\n";
  }
  const classStyles = parseClassStyles(combinedCss);

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
  // Illustration aspect ratios (w/h), gathered as we copy real illustrations, so we can
  // pick the page orientation from the book's own artwork (see orientationFromAspects).
  const aspects: number[] = [];
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
    const size = intrinsicSize(bytes);
    if (size && size.w > 0 && size.h > 0) aspects.push(size.w / size.h);
    return dest;
  };

  const L1 = language;
  const header = [
    "---",
    `l1: "${L1}"`,
    "languages:",
    `  ${L1}: ${JSON.stringify(langName(L1))}`,
    "---",
    "",
  ];
  const out: string[] = [];

  // Is this a fixed-layout picture book (text absolutely-positioned over full-bleed
  // art)? If ANY content page is, then a content page that has only an illustration is
  // a *wordless* page of the same book — emit it as a full-bleed image too, rather than
  // a margin-boxed origami image. (A generic reflowable EPUB has no such pages, so it
  // keeps the document-order origami flow.)
  const fixedLayoutBook = spineHrefs.some((href) => {
    if (classifyEpubSpinePage(href) !== "content") return false;
    const x = read(resolveZipPath(opfDir, href));
    return x ? extractCanvasLayout(x, classStyles) !== null : false;
  });

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
    // A page that absolutely-positions its prose over a full-bleed illustration (the
    // common picture-book layout) becomes a Bloom *canvas* page: the illustration fills
    // the page and each text block keeps its source size & location. We emit the boxes
    // as `canvas-text-boxes`; Stage 4's generateCanvasPage turns them into positioned
    // canvas elements. Pages without positioned prose fall through to origami below.
    const canvas = extractCanvasLayout(xhtml, classStyles);
    if (canvas) {
      const dest = useImage(docDir, canvas.src);
      if (dest) {
        const lines: string[] = [`![${path.basename(dest, path.extname(dest))}](${dest})`];
        for (const t of canvas.texts) lines.push(textTag(), t.markdown);
        const boxesAttr = canvas.texts
          .map((t) => `${t.box.x},${t.box.y},${t.box.w},${t.box.h}`)
          .join(";");
        // The page is centered when every box's prose is centered (the picture-book norm).
        const aligns = new Set(canvas.texts.map((t) => t.align ?? "left"));
        const pageAlign =
          aligns.size === 1 && ![...aligns][0].includes("left") ? [...aligns][0] : undefined;
        const alignAttr = pageAlign ? ` horizontal-align="${pageAlign}"` : "";
        emitPage(`type="content"${alignAttr} canvas-text-boxes="${boxesAttr}"`, lines);
        continue;
      }
    }

    // Otherwise walk the page in document order so pictures and prose stay interleaved
    // exactly as authored; origami then lays them out as a faithful top-to-bottom stack
    // (e.g. text, picture, text) instead of one picture on top of all the text.
    const { blocks, align } = extractContentFlow(xhtml, classStyles);

    // A WORDLESS page of a fixed-layout picture book — a full-bleed illustration with no
    // real prose (only the source page number, e.g. "10/13") — is rendered full-bleed
    // like its lettered siblings, not as a margin-boxed origami image. We require "no
    // prose" (not just "no positioned prose") so attribution/credits pages, which carry
    // flow text + logos, still go to origami below and keep their text.
    const hasProse = blocks.some((b) => b.type === "text" && !isPageNumberish(b.markdown));
    if (fixedLayoutBook && !hasProse) {
      const src = pickMainImage(imgs);
      const dest = src ? useImage(docDir, src) : null;
      if (dest) {
        emitPage('type="content" full-page-image="true"', [
          `![${path.basename(dest, path.extname(dest))}](${dest})`,
        ]);
        continue;
      }
    }

    const lines: string[] = [];
    for (const block of blocks) {
      if (block.type === "image") {
        const dest = useImage(docDir, block.src);
        if (dest) lines.push(`![${path.basename(dest, path.extname(dest))}](${dest})`);
      } else {
        lines.push(textTag(), block.markdown);
      }
    }
    const contentAttrs =
      align && align !== "left" ? `type="content" horizontal-align="${align}"` : 'type="content"';
    emitPage(contentAttrs, lines);
  }

  // A landscape book (landscape illustrations) is told to Bloom — and shown in the GUI
  // preview — as landscape, via a `<!-- book page-size=… -->` hint that parseMarkdown reads
  // into the book's pageSize (the same channel the PDF stage uses). Portrait is the default,
  // so we only emit the hint for landscape.
  const pageSize = orientationFromAspects(aspects);
  const bookHint = pageSize === "A5Landscape" ? [`<!-- book page-size="${pageSize}" -->`, ""] : [];

  logger.info(
    `EPUB extracted: ${emitted} page(s), language "${L1}", ${copied.size} image(s)` +
      `${pageSize ? `, ${pageSize}` : ""} — no OCR/LLM needed.`,
  );

  return {
    markdown: [...header, ...bookHint, ...out].join("\n"),
    language: L1,
    pageCount: emitted,
  };
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

// ---------- resource proxy (GUI paired preview) ----------

/**
 * The internal zip path of every spine page (1-based reading order). The GUI's resource
 * proxy resolves a spine index to one of these, then serves it (and its relative images/
 * CSS/fonts) so the page renders faithfully in an iframe — see `readEpubEntry`.
 */
export function getEpubSpineHrefs(epubPath: string): string[] {
  const { opfDir, spineHrefs } = loadEpub(epubPath);
  return spineHrefs.map((href) => resolveZipPath(opfDir, href));
}

/** Content types for the resource kinds an EPUB document references (images + the doc/CSS/fonts). */
const RESOURCE_CONTENT_TYPES: Record<string, string> = {
  ...IMAGE_CONTENT_TYPES,
  // Serve spine documents as text/html (the forgiving HTML parser) rather than strict
  // application/xhtml+xml, so a malformed real-world XHTML doc renders instead of blanking.
  ".xhtml": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * Drop every `<img>` whose `src` can't be resolved to a real entry in this EPUB's
 * archive — the faithful-preview iframe would otherwise render them as broken-image
 * placeholder boxes laid over the page. Real-world EPUBs (e.g. StoryWeaver exports)
 * carry website-only UI cruft that 404s through our local resource proxy: a hidden
 * dictionary "loader" `<img src="/assets/loader-….svg">` on every content page, and
 * remote CDN `<img src="https://…">` donor logos on the attribution pages. The page's
 * real illustrations use ordinary relative srcs (resolved against the document) and
 * survive untouched. Purely cosmetic: it removes only images that could not have
 * displayed anyway.
 */
function stripUnresolvableImages(html: string, zip: Map<string, Buffer>, docDir: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    // Match the real `src` attribute only — require whitespace before it so we don't
    // pick up a `data-*-src` (e.g. StoryWeaver's `data-size1-src="https://…cdn…"`,
    // which sits before the working relative `src` on the same multi-line <img>).
    const src = tag.match(/\ssrc\s*=\s*["']([^"']*)["']/i)?.[1];
    if (!src) return ""; // no usable src → nothing the browser can show
    if (/^data:/i.test(src)) return tag; // inline image → always renders, keep
    if (/^(https?:)?\/\//i.test(src)) return ""; // remote / protocol-relative → never proxied
    // Relative to the document, or root-absolute (e.g. "/assets/…") tried as a zip path.
    const zpath = src.startsWith("/") ? src.replace(/^\/+/, "") : resolveZipPath(docDir, src);
    return zip.has(zpath) ? tag : "";
  });
}

/**
 * Read one entry out of the EPUB archive by its internal (zip-relative) path, as raw
 * bytes + content type. This backs the GUI's resource proxy: the iframe loads a spine
 * document by URL and the browser fetches its relative `../Images`/`../Styles`/`../Fonts`
 * through the same proxy, so the page renders with its own fonts and layout intact.
 * Spine documents (HTML) are first passed through `stripUnresolvableImages` so the
 * preview never shows broken-image boxes for resources that live only on the publisher's
 * website. Returns null if the entry is absent.
 */
export function readEpubEntry(
  epubPath: string,
  internalZipPath: string,
): { buffer: Buffer; contentType: string } | null {
  const zip = readZip(epubPath);
  const buffer = zip.get(internalZipPath);
  if (!buffer) return null;
  const contentType =
    RESOURCE_CONTENT_TYPES[path.extname(internalZipPath).toLowerCase()] ||
    "application/octet-stream";
  if (contentType.startsWith("text/html")) {
    const docDir = internalZipPath.includes("/")
      ? internalZipPath.slice(0, internalZipPath.lastIndexOf("/"))
      : "";
    const cleaned = stripUnresolvableImages(buffer.toString("utf8"), zip, docDir);
    return { buffer: Buffer.from(cleaned, "utf8"), contentType };
  }
  return { buffer, contentType };
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
