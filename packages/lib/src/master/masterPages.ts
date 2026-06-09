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

/** Remove the internal `data-import-source-hash` marker from a page's opening tag. */
function stripSourceHashAttr(pageHtml: string): string {
  return pageHtml.replace(/\s*data-import-source-hash=["'][^"']*["']/i, "");
}

/** Mark a spliced page as master-sourced (drives the Bloom-side preview badge). */
function setFromMasterAttr(pageHtml: string, masterId: string): string {
  return pageHtml.replace(/(<div\b)([^>]*>)/i, `$1 data-from-master="${masterId}"$2`);
}

/**
 * Substitute master pages into a freshly generated book's HTML.
 *
 * For each `div.bloom-page` carrying a `data-import-source-hash`:
 *  - if the hash matches a master page, replace the div with the master's exact
 *    HTML, copy its images into `bookFolder` under collision-proof names, and
 *    rewrite the spliced `src`s + give the page a fresh id.
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
      let pageHtml = master.html;
      for (const src of master.images) {
        const base = path.basename(src);
        const newName = `m${hash.slice(0, 8)}-${base}`;
        try {
          await fs.copyFile(path.join(masterFolder, base), path.join(bookFolder, newName));
        } catch (error) {
          logger.warn(`Failed to copy master image ${base}: ${error}`);
        }
        pageHtml = pageHtml.split(`src="${src}"`).join(`src="${newName}"`);
        pageHtml = pageHtml.split(`src='${src}'`).join(`src='${newName}'`);
      }
      // Fresh id so two books in a collection can't share a page id.
      pageHtml = pageHtml.replace(/(<div\b[^>]*\bid=)["'][^"']*["']/i, `$1"${randomUUID()}"`);
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
      logger.info(`Substituted master page for source hash ${hash.slice(0, 8)}`);
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
