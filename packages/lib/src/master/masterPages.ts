import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../logger";
import { hashesMatch, hashDistance } from "../1-ocr/pageImageHash";

/** A page lifted from a master book, keyed elsewhere by its source-image hash. */
export interface MasterPage {
  /** The master page's stable `id` (GUID) — how the mapping file references it. */
  id: string;
  /** Outer HTML of the `div.bloom-page`. */
  html: string;
  /** Image filenames the page references (from `<img src>`). */
  images: string[];
}

/** One recorded correspondence: a source page's hash → the master page to use. */
export interface MasterPageMapEntry {
  sourceHash: string;
  masterPageId: string;
  addedAt?: string;
}

/**
 * Collection-shared mapping of source-image hashes to master pages, stored in the
 * master book folder as `master-page-map.json`. Lets a user designate "this source
 * page is served by master page X" from the GUI without hand-editing the master
 * HTML. Many `sourceHash`es may map to one `masterPageId`.
 */
export interface MasterPageMap {
  version: 1;
  /** The master book's HTML filename at write time (debugging aid only). */
  masterBookHtml?: string;
  entries: MasterPageMapEntry[];
}

/**
 * Find a sibling book folder in the collection whose name ends in "master"
 * (case-insensitive). This is the hand-perfected book whose complex pages we
 * substitute into other imports. `excludeFolder` skips the book being written.
 */
export async function findMasterBookFolder(
  collectionFolder: string,
  excludeFolder?: string,
): Promise<string | undefined> {
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(collectionFolder, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const normalizedExclude = excludeFolder ? path.resolve(excludeFolder) : undefined;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/master$/i.test(entry.name)) continue;
    const full = path.join(collectionFolder, entry.name);
    if (normalizedExclude && path.resolve(full) === normalizedExclude) continue;
    return full;
  }
  return undefined;
}

/** Path to a Bloom book's main HTML file (named after its folder). */
function bookHtmlPath(bookFolder: string): string {
  return path.join(bookFolder, path.basename(bookFolder) + ".htm");
}

/**
 * Slice out the top-level `div.bloom-page` elements from a Bloom HTML string by
 * counting `<div>`/`</div>` depth. Bloom HTML is well-formed and bloom-page divs
 * are direct, non-nested siblings, so depth counting is reliable without a full
 * HTML parser.
 */
function extractBloomPageDivs(html: string): Array<{ start: number; end: number; html: string }> {
  const results: Array<{ start: number; end: number; html: string }> = [];
  const tagRe = /<div\b[^>]*>|<\/div>/gi;
  let match: RegExpExecArray | null;
  let pageStart = -1;
  let depth = 0;

  while ((match = tagRe.exec(html)) !== null) {
    const isOpen = match[0][1] !== "/";
    if (pageStart === -1) {
      // Looking for the start of a bloom-page div.
      if (isOpen && /class="[^"]*\bbloom-page\b[^"]*"/i.test(match[0])) {
        pageStart = match.index;
        depth = 1;
      }
    } else {
      depth += isOpen ? 1 : -1;
      if (depth === 0) {
        const end = match.index + match[0].length;
        results.push({ start: pageStart, end, html: html.slice(pageStart, end) });
        pageStart = -1;
      }
    }
  }
  return results;
}

/** Read the `data-import-source-hash` from a page div's opening tag, if any. */
function readSourceHash(pageHtml: string): string | undefined {
  const m = pageHtml.match(/data-import-source-hash=["']([^"']+)["']/i);
  return m ? m[1] : undefined;
}

/** Read the `id` from a bloom-page div's opening tag (the master page's stable key). */
function readMasterPageId(pageHtml: string): string | undefined {
  const open = pageHtml.match(/<div\b[^>]*>/i);
  const m = open?.[0].match(/\bid=["']([^"']+)["']/i);
  return m ? m[1] : undefined;
}

/** Collect the image filenames referenced by `<img src>` in a page's HTML. */
function imageFilenames(pageHtml: string): string[] {
  const out = new Set<string>();
  const re = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pageHtml)) !== null) {
    out.add(m[1]);
  }
  return [...out];
}

/** Build a MasterPage record from a page div's outer HTML. */
function toMasterPage(pageHtml: string): MasterPage {
  return {
    id: readMasterPageId(pageHtml) ?? "",
    html: pageHtml,
    images: imageFilenames(pageHtml),
  };
}

/**
 * Load *every* page of the master book, keyed by its `id`. Backs both the GUI page
 * picker and the `masterPageId → MasterPage` resolution used by the mapping file.
 * Pages without an `id` can't be referenced, so they're skipped with a warning.
 */
export async function loadMasterPagesById(masterFolder: string): Promise<Map<string, MasterPage>> {
  const map = new Map<string, MasterPage>();
  let html: string;
  try {
    html = await fs.readFile(bookHtmlPath(masterFolder), "utf-8");
  } catch (error) {
    logger.warn(`Could not read master book HTML in ${masterFolder}: ${error}`);
    return map;
  }
  for (const page of extractBloomPageDivs(html)) {
    const mp = toMasterPage(page.html);
    if (!mp.id) {
      logger.warn(`Master page without an id skipped in ${path.basename(masterFolder)}`);
      continue;
    }
    map.set(mp.id, mp);
  }
  return map;
}

/** Path to a master book's mapping file. */
export function masterMapPath(masterFolder: string): string {
  return path.join(masterFolder, "master-page-map.json");
}

/** Read the master book's mapping file, or an empty map if absent/corrupt. */
export async function readMasterPageMap(masterFolder: string): Promise<MasterPageMap> {
  const empty: MasterPageMap = { version: 1, entries: [] };
  let raw: string;
  try {
    raw = await fs.readFile(masterMapPath(masterFolder), "utf-8");
  } catch {
    return empty;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MasterPageMap>;
    return { version: 1, masterBookHtml: parsed.masterBookHtml, entries: parsed.entries ?? [] };
  } catch (error) {
    logger.warn(`Corrupt master-page map in ${path.basename(masterFolder)}: ${error}`);
    return empty;
  }
}

/** Write the master book's mapping file. */
export async function writeMasterPageMap(masterFolder: string, map: MasterPageMap): Promise<void> {
  await fs.writeFile(masterMapPath(masterFolder), JSON.stringify(map, null, 2) + "\n", "utf-8");
}

/**
 * Record `sourceHash → masterPageId` in the master book's mapping file. A hash maps
 * to exactly one master page, so an existing entry for the same hash is replaced.
 */
export async function appendMasterMapping(
  masterFolder: string,
  sourceHash: string,
  masterPageId: string,
): Promise<MasterPageMap> {
  const map = await readMasterPageMap(masterFolder);
  map.masterBookHtml = path.basename(bookHtmlPath(masterFolder));
  map.entries = map.entries.filter((e) => e.sourceHash !== sourceHash);
  map.entries.push({ sourceHash, masterPageId, addedAt: new Date().toISOString() });
  await writeMasterPageMap(masterFolder, map);
  return map;
}

/** Remove any mapping for `sourceHash` (the GUI's "use none / clear"). */
export async function clearMasterMapping(
  masterFolder: string,
  sourceHash: string,
): Promise<MasterPageMap> {
  const map = await readMasterPageMap(masterFolder);
  map.entries = map.entries.filter((e) => e.sourceHash !== sourceHash);
  await writeMasterPageMap(masterFolder, map);
  return map;
}

/**
 * Load the master book's substitutable pages, keyed by source-image hash. The
 * effective map merges two sources:
 *  - embedded `data-import-source-hash` attributes on master pages (legacy), and
 *  - the `master-page-map.json` mapping file (which takes precedence on conflict).
 */
export async function loadMasterPages(masterFolder: string): Promise<Map<string, MasterPage>> {
  const map = new Map<string, MasterPage>();
  let html: string;
  try {
    html = await fs.readFile(bookHtmlPath(masterFolder), "utf-8");
  } catch (error) {
    logger.warn(`Could not read master book HTML in ${masterFolder}: ${error}`);
    return map;
  }

  const byId = new Map<string, MasterPage>();
  for (const page of extractBloomPageDivs(html)) {
    const mp = toMasterPage(page.html);
    if (mp.id) byId.set(mp.id, mp);
    // Legacy: pages carrying an embedded source hash are keyed by it directly.
    const hash = readSourceHash(page.html);
    if (hash) map.set(hash, mp);
  }

  // Mapping file: resolve each entry's master page by id and key it by source hash.
  // File entries win over an embedded hash for the same source hash.
  const { entries } = await readMasterPageMap(masterFolder);
  for (const { sourceHash, masterPageId } of entries) {
    const page = byId.get(masterPageId);
    if (page) map.set(sourceHash, page);
  }

  logger.info(`Loaded ${map.size} master page(s) from ${path.basename(masterFolder)}`);
  return map;
}

/** The set of source-image hashes the master book provides (for the OCR-skip step). */
export async function readMasterHashes(masterFolder: string): Promise<Set<string>> {
  return new Set((await loadMasterPages(masterFolder)).keys());
}

/** The master book's whole-book look, copied onto imports so they match it. */
export interface MasterAppearance {
  /** Page-size/orientation token (e.g. "A5Portrait") read from the master's pages. */
  pageSize?: string;
  /** The master's head `<style>` blocks worth copying (fonts + cover colour). */
  headStyles?: string;
  /** The master's entire `appearance.json`, copied onto the import verbatim. */
  appearance?: Record<string, unknown>;
  /** The master's `customBookStyles.css` (book-level hand CSS Bloom never regenerates). */
  customBookStyles?: string;
  /**
   * The master's `originalAcknowledgments` dataDiv field, one entry per language
   * (publisher boilerplate the source pages don't carry as parseable metadata, e.g. an
   * "About <publisher>" blurb). Each is prepended to the import's own acknowledgments
   * for that language — see `applyMasterAcknowledgments`. Empty when the field is blank.
   */
  acknowledgments?: { lang: string; html: string }[];
}

/** Bloom page-size class tokens we recognise on a master page div. */
const PAGE_SIZE_RE =
  /class="[^"]*\b(A3|A4|A5|A6|B5|Letter|HalfLetter|QuarterLetter|Legal|Device16x9)(Portrait|Landscape)\b/;

/**
 * The `<style>` blocks from the master's `<head>` we copy onto imports: Bloom's
 * `userModifiedStyles` (the body/Bubble font sizes & family) and the two
 * cover-background-colour blocks (legacy + appearance). Other generated/runtime
 * styles are left to the generator.
 */
function extractHeadStyleBlocks(html: string): string {
  const headEnd = html.search(/<\/head>/i);
  const scope = headEnd >= 0 ? html.slice(0, headEnd) : html;
  const blocks: string[] = [];
  const re = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope)) !== null) {
    const tag = m[0];
    if (
      /title=["']userModifiedStyles["']/i.test(tag) ||
      /name=["'](?:legacyCoverBackgroundColor|appearanceCoverBackgroundColor)["']/i.test(tag)
    ) {
      blocks.push(tag);
    }
  }
  return blocks.join("\n    ");
}

/**
 * Every non-empty `data-book="originalAcknowledgments"` field (one per language) in the
 * master's dataDiv, as `{ lang, inner-html }`. Scoped to the dataDiv — which precedes
 * the first `bloom-page` — so the editable copies Bloom renders onto the actual credits
 * page aren't picked up. Acknowledgments are prose (no nested `<div>`), so a non-greedy
 * slice to the next `</div>` is reliable.
 */
function extractMasterAcknowledgments(html: string): { lang: string; html: string }[] {
  const start = html.search(/<div\b[^>]*\bid="bloomDataDiv"/i);
  if (start < 0) return [];
  const after = html.slice(start);
  const pageIdx = after.search(/<div\b[^>]*\bclass="[^"]*\bbloom-page\b/i);
  const scope = pageIdx >= 0 ? after.slice(0, pageIdx) : after;

  const out: { lang: string; html: string }[] = [];
  const re = /<div\b[^>]*\bdata-book="originalAcknowledgments"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope)) !== null) {
    const lang = m[0].match(/\blang="([^"]*)"/i)?.[1] ?? "*";
    const rest = scope.slice(re.lastIndex);
    const closeIdx = rest.search(/<\/div>/i);
    if (closeIdx < 0) continue;
    const inner = rest.slice(0, closeIdx).trim();
    if (inner.replace(/<[^>]*>/g, "").trim()) out.push({ lang, html: inner });
  }
  return out;
}

/**
 * Read the master book's page size, head styles, and appearance fields so an import
 * can be made to match it (see `applyMasterHeadStyles` + the Stage-4 wiring).
 */
export async function readMasterAppearance(masterFolder: string): Promise<MasterAppearance> {
  const result: MasterAppearance = {};
  try {
    const html = await fs.readFile(bookHtmlPath(masterFolder), "utf-8");
    const size = html.match(PAGE_SIZE_RE);
    if (size) result.pageSize = size[1] + size[2];
    const styles = extractHeadStyleBlocks(html);
    if (styles) result.headStyles = styles;
    const acks = extractMasterAcknowledgments(html);
    if (acks.length) result.acknowledgments = acks;
  } catch (error) {
    logger.warn(`Could not read master book HTML for appearance: ${error}`);
  }
  try {
    result.appearance = JSON.parse(
      await fs.readFile(path.join(masterFolder, "appearance.json"), "utf-8"),
    ) as Record<string, unknown>;
  } catch {
    /* no master appearance.json */
  }
  try {
    result.customBookStyles = await fs.readFile(
      path.join(masterFolder, "customBookStyles.css"),
      "utf-8",
    );
  } catch {
    /* no master customBookStyles.css */
  }
  return result;
}

/**
 * Replace the generator's own `userModifiedStyles` + cover-colour `<style>` blocks in
 * a freshly generated book with the master book's, so imports adopt its fonts and
 * cover colour. The `preserveCoverColor` meta the generator emits is left in place so
 * Bloom honours the (now master) cover colour instead of randomising it.
 */
export function applyMasterHeadStyles(html: string, headStyles: string): string {
  if (!headStyles) return html;
  let out = html
    .replace(/\s*<style\b[^>]*title=["']userModifiedStyles["'][^>]*>[\s\S]*?<\/style>/i, "")
    .replace(
      /\s*<style\b[^>]*name=["'](?:legacyCoverBackgroundColor|appearanceCoverBackgroundColor)["'][^>]*>[\s\S]*?<\/style>/gi,
      "",
    );
  out = /<\/head>/i.test(out)
    ? out.replace(/<\/head>/i, `    ${headStyles}\n    </head>`)
    : headStyles + out;
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Prepend the master's `originalAcknowledgments` (publisher boilerplate) to the
 * generated book's own, per language. The master's text comes first; the import's mined
 * acknowledgments (author/illustrator/credits) follow. A language the import has no
 * field for is added as a new dataDiv entry — copied as-is, leaving Bloom to decide
 * which languages to show.
 */
export function applyMasterAcknowledgments(
  html: string,
  acks: { lang: string; html: string }[],
): string {
  let out = html;
  for (const ack of acks) {
    const re = new RegExp(
      `(<div\\b[^>]*\\bdata-book="originalAcknowledgments"[^>]*\\blang="${escapeRegExp(ack.lang)}"[^>]*>)([\\s\\S]*?)(</div>)`,
      "i",
    );
    if (re.test(out)) {
      out = out.replace(re, (_full, open: string, content: string, close: string) => {
        const existing = content.trim();
        return `${open}${existing ? `${ack.html}<br>${existing}` : ack.html}${close}`;
      });
    } else {
      const div = `\n      <div data-book="originalAcknowledgments" lang="${ack.lang}">${ack.html}</div>`;
      out = out.replace(/<div id="bloomDataDiv">/i, (open) => `${open}${div}`);
    }
  }
  return out;
}

/** Remove the internal `data-import-source-hash` marker from a page's opening tag. */
function stripSourceHashAttr(pageHtml: string): string {
  return pageHtml.replace(/\s*data-import-source-hash=["'][^"']*["']/i, "");
}

/** Mark a spliced page as master-sourced (drives the Bloom-side preview badge). */
function setFromMasterAttr(pageHtml: string, masterId: string): string {
  return pageHtml.replace(/(<div\b)([^>]*>)/i, `$1 data-from-master="${masterId}"$2`);
}

// ---------- hybrid "template" master pages (keep layout + images, fill text from source) ----------

/**
 * A master page may be a **template**: it keeps its own layout and images, but designated
 * text boxes are *filled* from the source page instead of copied verbatim. A canvas text
 * box is a **fill-slot** when its visible text is empty or begins with "(" — e.g. a
 * "(first question)" hint the author types so the slot is self-documenting while editing in
 * Bloom. Any non-slot box (the "You can use these questions…" heading) is kept exactly as
 * authored. A page is a template iff it has at least one slot.
 *
 * Filling is positional by **structural parity**: the master's text boxes and the source
 * page's text boxes are each taken in reading order (top-to-bottom, then left) and zipped
 * 1:1, so box *i* pairs with source box *i*. A verbatim box ignores its partner; a slot box
 * takes its partner's text. (So the author mirrors the source's block structure — type the
 * fixed boxes, leave the variable ones blank/parenthetical.) The images and every box's
 * position come entirely from the master, which is the whole point: the source's geometry
 * (often a faithful copy of a badly-laid-out original) is discarded.
 */

/** Strip tags so an empty/parenthetical fill-slot can be told apart from real prose. */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

interface TextBox {
  /** vertical px when positioned (a canvas box); undefined for flow (origami) boxes */
  top?: number;
  left: number;
  /** the box's position in the page string — the reading-order key for flow layouts */
  docIndex: number;
  /** absolute [innerStart, innerEnd) of the chosen editable's inner HTML in the page string */
  innerStart: number;
  innerEnd: number;
  inner: string;
  isSlot: boolean;
}

/**
 * The top-level divs of a given class in a page, by depth-counting (Bloom HTML is
 * well-formed — the same assumption `extractBloomPageDivs` relies on).
 */
function extractDivsByClass(
  html: string,
  className: string,
): Array<{ start: number; end: number; html: string }> {
  const out: Array<{ start: number; end: number; html: string }> = [];
  const tagRe = /<div\b[^>]*>|<\/div>/gi;
  const classRe = new RegExp(`class="[^"]*\\b${className}\\b[^"]*"`, "i");
  let m: RegExpExecArray | null;
  let elStart = -1;
  let depth = 0;
  while ((m = tagRe.exec(html)) !== null) {
    const isOpen = m[0][1] !== "/";
    if (elStart === -1) {
      if (isOpen && classRe.test(m[0])) {
        elStart = m.index;
        depth = 1;
      }
    } else {
      depth += isOpen ? 1 : -1;
      if (depth === 0) {
        out.push({
          start: elStart,
          end: m.index + m[0].length,
          html: html.slice(elStart, m.index + m[0].length),
        });
        elStart = -1;
      }
    }
  }
  return out;
}

/**
 * The text boxes of a page, in reading order, for both layout kinds: a canvas page's text
 * lives in `bloom-canvas-element > bloom-translationGroup`, an origami page's in
 * `split-pane-component > bloom-translationGroup` — so iterating `bloom-translationGroup`
 * catches both (and image-only canvas elements, which have no group, are naturally skipped).
 * For each box: where its primary editable's inner HTML sits (so it can be replaced) and
 * whether it's a fill-slot. The "primary" editable is the visible one
 * (`bloom-visibility-code-on`) if present, else the first — so a multilingual box is judged
 * and filled by the language Bloom actually shows. Positioned (canvas) boxes carry a `top`
 * (from the editable's `data-bubble-alternate` geometry) and sort by it; flow (origami)
 * boxes have none and sort by document order — which is their visual order anyway.
 */
function textBoxes(pageHtml: string): TextBox[] {
  const boxes: TextBox[] = [];
  for (const grp of extractDivsByClass(pageHtml, "bloom-translationGroup")) {
    const edRe = /<div\b[^>]*\bclass="([^"]*\bbloom-editable\b[^"]*)"[^>]*>([\s\S]*?)<\/div>/gi;
    let chosen: { idx: number; inner: string } | undefined;
    let first: { idx: number; inner: string } | undefined;
    let em: RegExpExecArray | null;
    while ((em = edRe.exec(grp.html)) !== null) {
      const rec = { idx: em.index, inner: em[2] };
      first ??= rec;
      if (/\bbloom-visibility-code-on\b/i.test(em[1])) {
        chosen = rec;
        break;
      }
    }
    const ed = chosen ?? first;
    if (!ed) continue;
    const openTagEnd = grp.html.indexOf(">", ed.idx); // end of the editable's opening tag
    if (openTagEnd < 0) continue;
    const innerRelStart = openTagEnd + 1;
    const text = visibleText(ed.inner);
    const topM = grp.html.match(/(?:^|[;\s`"])top:\s*([\d.]+)px/i);
    boxes.push({
      top: topM ? Number(topM[1]) : undefined,
      left: Number(grp.html.match(/(?:^|[;\s`"])left:\s*([\d.]+)px/i)?.[1] ?? 0),
      docIndex: grp.start,
      innerStart: grp.start + innerRelStart,
      innerEnd: grp.start + innerRelStart + ed.inner.length,
      inner: ed.inner,
      isSlot: text === "" || text.startsWith("("),
    });
  }
  const positioned = boxes.some((b) => b.top !== undefined);
  return boxes.sort((a, b) =>
    positioned ? (a.top ?? 0) - (b.top ?? 0) || a.left - b.left : a.docIndex - b.docIndex,
  );
}

/** Whether a master page is a fill-template (has at least one empty/parenthetical slot). */
export function isTemplateMasterPage(pageHtml: string): boolean {
  return textBoxes(pageHtml).some((b) => b.isSlot);
}

/**
 * Fill a template master page's slots from the source page's text, keeping the master's
 * layout, images, and verbatim boxes. See the block comment above for the parity model. A
 * slot that has no source counterpart (count mismatch) is *blanked*, never left showing its
 * "(hint)". Returns the master HTML with slots filled.
 */
export function fillTemplatePage(masterHtml: string, sourceHtml: string): string {
  const boxes = textBoxes(masterHtml);
  const sources = textBoxes(sourceHtml).map((b) => b.inner);
  if (boxes.length !== sources.length) {
    logger.warn(
      `Master template has ${boxes.length} text box(es) but the source page has ${sources.length}; ` +
        `filling in reading order and ${boxes.length > sources.length ? "blanking the surplus slots" : "ignoring the surplus source text"}.`,
    );
  }
  // Build inner-HTML replacements, then apply back-to-front to keep indices valid.
  const replacements = boxes
    .map((box, i) => ({ box, fill: i < sources.length ? sources[i] : "<p></p>" }))
    .filter(({ box }) => box.isSlot)
    .map(({ box, fill }) => ({ start: box.innerStart, end: box.innerEnd, html: fill }))
    .sort((a, b) => b.start - a.start);
  let out = masterHtml;
  for (const r of replacements) out = out.slice(0, r.start) + r.html + out.slice(r.end);
  return out;
}

/**
 * Substitute master pages into a freshly generated book's HTML.
 *
 * For each `div.bloom-page` carrying a `data-import-source-hash`:
 *  - if the hash matches a master page, replace the div with the master's HTML, copy its
 *    images into `bookFolder` under collision-proof names, and rewrite the spliced `src`s
 *    + give the page a fresh id. When the master is a **template** (`isTemplateMasterPage`),
 *    its slot boxes are first filled from this source page's text (`fillTemplatePage`) so
 *    the layout+images come from the master but the words come from the book being imported.
 *  - otherwise leave the page, but strip the marker attribute unless
 *    `emitSourceHashes` is set (master-creation runs keep it).
 */
export async function applyMasterPages(
  html: string,
  opts: {
    masterPages: Map<string, MasterPage>;
    bookFolder: string;
    masterFolder?: string;
    emitSourceHashes?: boolean;
  },
): Promise<string> {
  const { masterPages, bookFolder, masterFolder, emitSourceHashes } = opts;
  const pages = extractBloomPageDivs(html);
  if (pages.length === 0) return html;

  // Build replacements, then rebuild the string back-to-front to keep indices valid.
  const replacements: Array<{ start: number; end: number; html: string }> = [];

  for (const page of pages) {
    const hash = readSourceHash(page.html);
    if (!hash) continue;

    // Perceptual match: pick the closest master page within the match threshold.
    let master: MasterPage | undefined;
    let bestDistance = Infinity;
    for (const [masterHash, candidate] of masterPages) {
      if (!hashesMatch(hash, masterHash)) continue;
      const d = hashDistance(hash, masterHash);
      if (d < bestDistance) {
        bestDistance = d;
        master = candidate;
      }
    }

    if (master && masterFolder) {
      // A template master keeps its layout + images but draws its words from THIS page.
      const template = isTemplateMasterPage(master.html);
      let pageHtml = template ? fillTemplatePage(master.html, page.html) : master.html;
      for (const src of master.images) {
        const base = path.basename(src);
        // `placeHolder.png` is a Bloom built-in (the empty-canvas-background image), not a
        // real file in the book folder — leave the src alone so Bloom supplies it, rather
        // than rewriting it to a missing namespaced copy (a broken image on canvas pages).
        if (base === "placeHolder.png") continue;
        const newName = `m${hash.slice(0, 8)}-${base}`;
        try {
          await fs.copyFile(path.join(masterFolder, base), path.join(bookFolder, newName));
        } catch (error) {
          logger.warn(`Failed to copy master image ${base}: ${error}`);
        }
        pageHtml = pageHtml.split(`src="${src}"`).join(`src="${newName}"`);
        pageHtml = pageHtml.split(`src='${src}'`).join(`src='${newName}'`);
      }
      // Fresh id so two books in a collection can't share a page id. Match a *whitespace*-
      // preceded ` id=` (the real attribute), not a `\b`-boundary one — else `data-tool-id=`
      // on a canvas master page is matched first and clobbered, stripping `data-tool-id="canvas"`.
      pageHtml = pageHtml.replace(/(<div\b[^>]*?\sid=)["'][^"']*["']/i, `$1"${randomUUID()}"`);
      // Mark it master-sourced (with the master page's own id) for the preview badge.
      pageHtml = setFromMasterAttr(pageHtml, master.id);
      // Carry over the source-page link from the page we're replacing. Master-book
      // HTML has no `data-source-pdf-page`, so without this the substituted page loses
      // its alignment and the paired preview both un-pairs it and re-lists the orphaned
      // source page at the very end.
      const srcPageAttr = page.html.match(/\bdata-source-pdf-page=["']\d+["']/i)?.[0];
      if (srcPageAttr && !/\bdata-source-pdf-page=/i.test(pageHtml)) {
        pageHtml = pageHtml.replace(/(<div\b)([^>]*>)/i, `$1 ${srcPageAttr}$2`);
      }
      logger.info(
        `${template ? "Filled master template" : "Substituted master page"} for source hash ${hash.slice(0, 8)}`,
      );
      replacements.push({ start: page.start, end: page.end, html: pageHtml });
    } else if (!emitSourceHashes) {
      replacements.push({ start: page.start, end: page.end, html: stripSourceHashAttr(page.html) });
    }
  }

  let result = html;
  for (const r of replacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, r.start) + r.html + result.slice(r.end);
  }
  return result;
}
