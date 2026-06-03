import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../logger";

/** A page lifted from a master book, keyed elsewhere by its source-image hash. */
export interface MasterPage {
  /** Outer HTML of the `div.bloom-page`. */
  html: string;
  /** Image filenames the page references (from `<img src>`). */
  images: string[];
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

/**
 * Load the master book's substitutable pages, keyed by their
 * `data-import-source-hash`. Pages without that attribute are ignored.
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
  for (const page of extractBloomPageDivs(html)) {
    const hash = readSourceHash(page.html);
    if (!hash) continue;
    map.set(hash, { html: page.html, images: imageFilenames(page.html) });
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

    const master = masterPages.get(hash);
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
