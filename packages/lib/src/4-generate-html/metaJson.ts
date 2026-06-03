import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import {
  type Book,
  type TextBlockElement,
  type ImageElement,
  FRONT_COVER_IMAGE_FILENAME,
  BACK_COVER_IMAGE_FILENAME,
} from "../types.js";
import { logger } from "../logger";

/**
 * Bloom's meta.json (a subset of `BookMetaData` in Bloom's `BookInfo.cs`).
 * camelCase keys. We only populate the fields we can derive; Bloom fills in and
 * recomputes the rest (e.g. pageCount, thumbnails) when it loads the book.
 */
export interface BookMetaData {
  bookInstanceId: string;
  title?: string;
  allTitles?: string; // JSON string: {"en":"...","fr":"..."}
  originalTitle?: string;
  isbn?: string;
  author?: string;
  publisher?: string;
  license?: string; // Bloom token, e.g. "cc-by-nc-nd"
  licenseNotes?: string;
  copyright?: string;
  credits?: string;
  summary?: string;
  formatVersion: string;
  suitableForMakingShells: boolean;
  /** When true, Bloom keeps the book's folder name instead of deriving it from the title. */
  nameLocked?: boolean;
  pageCount: number;
  // Preserve any fields Bloom wrote that we don't model.
  [key: string]: unknown;
}

/** Collect text-field content from the book, keyed by field name then language. */
function collectFields(book: Book): Record<string, Record<string, string>> {
  const fields: Record<string, Record<string, string>> = {};
  for (const page of book.pages) {
    for (const element of page.elements) {
      if (element.type !== "text") continue;
      const text = element as TextBlockElement;
      if (!text.field || text.field === "pageNumber") continue;
      const bucket = (fields[text.field] ??= {});
      for (const [lang, value] of Object.entries(text.content)) {
        // First non-empty value per language wins.
        if (value?.trim() && !bucket[lang]) bucket[lang] = value.trim();
      }
    }
  }
  return fields;
}

/** Pick the value for the primary language, falling back to the first available. */
function preferL1(content: Record<string, string> | undefined, l1: string): string | undefined {
  if (!content) return undefined;
  return content[l1] ?? Object.values(content)[0];
}

/** Map a license string (e.g. "CC-BY-NC-ND") to Bloom's token (e.g. "cc-by-nc-nd"). */
function toBloomLicenseToken(license: string | undefined): string | undefined {
  if (!license) return undefined;
  const trimmed = license.trim();
  // Creative Commons licenses become lowercase tokens; anything else is "custom".
  if (/^cc[-\s]/i.test(trimmed) || /^cc0$/i.test(trimmed)) {
    return trimmed.toLowerCase().replace(/\s+/g, "-");
  }
  return "custom";
}

/**
 * Build a `BookMetaData` object from the parsed book.
 *
 * If `existing` is provided (a previously written/Bloom-authored meta.json), its
 * `bookInstanceId` is preserved so Bloom treats this as an *update* of the same
 * book rather than a brand-new one, and any fields we don't model are kept.
 */
export function buildBookMetaData(book: Book, existing?: Partial<BookMetaData>): BookMetaData {
  const fields = collectFields(book);
  const l1 = book.frontMatterMetadata.l1;

  const titleContent = fields["bookTitle"];
  const title = preferL1(titleContent, l1);

  const license = toBloomLicenseToken(preferL1(fields["license"], l1));

  // Fields we derive from the book content. Undefined entries are dropped below
  // so they never clobber a value an existing meta.json already had.
  const derived: Record<string, unknown> = {
    title,
    allTitles: titleContent ? JSON.stringify(titleContent) : undefined,
    originalTitle: title,
    isbn: preferL1(fields["isbn"], l1),
    author: preferL1(fields["author"], l1),
    publisher: preferL1(fields["publisher"], l1),
    license,
    licenseNotes: preferL1(fields["licenseNotes"], l1),
    copyright: preferL1(fields["copyright"], l1),
    credits: preferL1(fields["credits"], l1),
    summary: preferL1(fields["summary"], l1),
  };
  for (const key of Object.keys(derived)) {
    if (derived[key] === undefined) delete derived[key];
  }

  return {
    // Carry through anything Bloom wrote that we don't model...
    ...existing,
    // ...then our freshly derived content...
    ...derived,
    // ...and the fields we always own.
    bookInstanceId: existing?.bookInstanceId || randomUUID(),
    formatVersion: "2.1",
    suitableForMakingShells: false,
    // Keep the folder name we ship: Bloom otherwise renames the book folder (and
    // its .htm) to the sanitized <title> on import/save, appending " - <id>" when
    // a book of that title already exists. nameLocked suppresses that rename.
    nameLocked: true,
    pageCount: book.pages.filter((p) => p.type === "content").length,
  };
}

/** Whether the book has a full-page front cover (a rendered `cover.jpg`). */
export function hasFullPageFrontCover(book: Book): boolean {
  return book.pages.some((page) =>
    page.elements.some(
      (el): el is ImageElement => el.type === "image" && el.src === FRONT_COVER_IMAGE_FILENAME,
    ),
  );
}

/**
 * A book "looks full-bleed" when its art runs to the page edge: a full-page cover
 * (front or back) or any Canvas page (full-page background image with floating
 * text). For these, we tell Bloom to render full-bleed (no page margins).
 */
function looksFullBleed(book: Book): boolean {
  const hasFullCover = book.pages.some((page) =>
    page.elements.some(
      (el): el is ImageElement =>
        el.type === "image" &&
        (el.src === FRONT_COVER_IMAGE_FILENAME || el.src === BACK_COVER_IMAGE_FILENAME),
    ),
  );
  const hasCanvasPage = book.pages.some((page) => !!page.canvasTextBox);
  return hasFullCover || hasCanvasPage;
}

/**
 * Write Bloom's `appearance.json` when the book calls for full-bleed presentation.
 * Bloom reads this on import: `fullBleed` removes page margins so cover/canvas art
 * reaches the edge, and `cover-background-color: white` keeps the regenerated (and
 * otherwise branding-colored) xMatter covers white behind a full-page cover image.
 * Merges over any appearance.json Bloom already wrote, and is a no-op for ordinary
 * bordered books.
 */
export async function writeAppearanceJson(bookFolderPath: string, book: Book): Promise<void> {
  const fullBleed = looksFullBleed(book);
  const whiteCover = hasFullPageFrontCover(book);
  if (!fullBleed && !whiteCover) return; // nothing to assert; let Bloom manage it

  const appearancePath = path.join(bookFolderPath, "appearance.json");
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await fs.readFile(appearancePath, "utf-8")) as Record<string, unknown>;
  } catch {
    existing = {};
  }

  const merged: Record<string, unknown> = { cssThemeName: "default", ...existing };
  if (fullBleed) merged.fullBleed = true;
  if (whiteCover) merged["cover-background-color"] = "white";

  await fs.writeFile(appearancePath, JSON.stringify(merged, null, 2));
  logger.info(
    `Wrote appearance.json (fullBleed=${fullBleed ? "true" : "unchanged"}${whiteCover ? ", cover-background-color=white" : ""}).`,
  );
}

/**
 * Write `meta.json` into the book folder, creating a new `bookInstanceId` for a
 * new book or preserving the existing one when updating a book already in a
 * Bloom collection. Returns the resulting metadata (including the id).
 */
export async function writeMetaJson(bookFolderPath: string, book: Book): Promise<BookMetaData> {
  const metaPath = path.join(bookFolderPath, "meta.json");

  let existing: Partial<BookMetaData> | undefined;
  try {
    existing = JSON.parse(await fs.readFile(metaPath, "utf-8")) as Partial<BookMetaData>;
  } catch {
    existing = undefined; // No existing meta.json (new book) or unreadable.
  }

  const meta = buildBookMetaData(book, existing);
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

  if (existing?.bookInstanceId) {
    logger.info(`Updated meta.json (preserved bookInstanceId ${meta.bookInstanceId}).`);
  } else {
    logger.info(`Wrote meta.json with new bookInstanceId ${meta.bookInstanceId}.`);
  }

  return meta;
}
