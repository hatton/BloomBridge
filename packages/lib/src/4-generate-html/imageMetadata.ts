import * as fs from "fs/promises";
import * as path from "path";
import { ExifTool } from "exiftool-vendored";
import type { Book } from "../types.js";
import { collectFields, preferL1 } from "./metaJson.js";
import { resolveCcLicenseUrl } from "./licenses.js";
import { logger } from "../logger";

/**
 * Intellectual-property values we copy from the book's metadata onto every image
 * file. These mirror the fields SIL libpalaso's `ClearShare.MetadataCore` reads
 * back (see Bloom's `ImageUpdater.cs` / `Metadata.cs`): Creator is the artist
 * (our illustrator), CopyrightNotice the copyright, License a Creative Commons
 * URL, and RightsStatement the license notes.
 */
interface ImageIntellectualProperty {
  /** The illustrator — written as the image's Creator (XMP-dc:Creator). */
  creator?: string;
  /** Copyright notice — written as the default-language XMP-dc:Rights. */
  copyright?: string;
  /** Creative Commons license URL — written as XMP-cc:License. */
  licenseUrl?: string;
  /** License notes / rights statement — written as the en XMP-dc:Rights. */
  rightsStatement?: string;
}

/** Files Bloom never treats as book art (see ImageUpdater.cs ExcludedFiles). */
const EXCLUDED_IMAGE_NAMES = new Set([
  "placeholder.png",
  "license.png",
  "thumbnail.png",
  "nonpaddedthumbnail.png",
]);

/** Pull the IP fields out of the book, preferring the primary language. */
export function collectImageIntellectualProperty(book: Book): ImageIntellectualProperty {
  const fields = collectFields(book);
  const l1 = book.frontMatterMetadata.l1;

  const creator = preferL1(fields["illustrator"], l1);
  const copyright = preferL1(fields["copyright"], l1);
  const rightsStatement = preferL1(fields["licenseNotes"], l1);

  // Only Creative Commons licenses have a stable URL Bloom understands as a
  // license. The CC info may be a ready `licenseUrl`, a `license` token, or only
  // embedded in the prose `licenseDescription`/`licenseNotes` — resolveCcLicenseUrl
  // checks all of them. A non-CC (custom) license yields no URL.
  const licenseUrl = resolveCcLicenseUrl({
    license: preferL1(fields["license"], l1),
    licenseUrl: preferL1(fields["licenseUrl"], l1),
    licenseDescription: preferL1(fields["licenseDescription"], l1),
    licenseNotes: preferL1(fields["licenseNotes"], l1),
  });

  return { creator, copyright, licenseUrl, rightsStatement };
}

/**
 * Build the exiftool tag map. Keys are literal exiftool tag names matching what
 * libpalaso writes/reads, so Bloom recognizes the values on import:
 *   - XMP-dc:Creator         ← illustrator
 *   - XMP-dc:Rights          ← copyright          (x-default language alternative)
 *   - XMP-dc:Rights-en       ← license notes      (en language alternative)
 *   - XMP-cc:License         ← Creative Commons URL
 */
function buildTags(ip: ImageIntellectualProperty): Record<string, string> {
  const tags: Record<string, string> = {};
  if (ip.creator) tags["XMP-dc:Creator"] = ip.creator;
  if (ip.copyright) tags["XMP-dc:Rights"] = ip.copyright;
  // The en alternative of dc:rights holds the rights statement. libpalaso only
  // populates it alongside a copyright (the x-default), so we do the same to
  // keep the language-alternation valid.
  if (ip.copyright && ip.rightsStatement) tags["XMP-dc:Rights-en"] = ip.rightsStatement;
  if (ip.licenseUrl) tags["XMP-cc:License"] = ip.licenseUrl;
  return tags;
}

/** List the book-folder image files we should stamp (png/jpg, minus Bloom's exclusions). */
async function listImageFiles(bookFolderPath: string): Promise<string[]> {
  const entries = await fs.readdir(bookFolderPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => /\.(png|jpg|jpeg)$/i.test(name))
    .filter((name) => !EXCLUDED_IMAGE_NAMES.has(name.toLowerCase()))
    .map((name) => path.join(bookFolderPath, name));
}

/**
 * Copy the book's intellectual-property metadata (illustrator, copyright,
 * license) into the XMP of every image in the book folder, using the same tags
 * SIL libpalaso reads — so a running Bloom attributes the artist and builds
 * image credits. Best-effort: a failure on any one image is logged and skipped;
 * a missing/unusable exiftool never aborts the conversion.
 */
export async function writeImageMetadata(bookFolderPath: string, book: Book): Promise<void> {
  const ip = collectImageIntellectualProperty(book);
  const tags = buildTags(ip);
  if (Object.keys(tags).length === 0) {
    logger.info("No illustrator/copyright/license metadata to write to images.");
    return;
  }

  let files: string[];
  try {
    files = await listImageFiles(bookFolderPath);
  } catch (error) {
    logger.warn(`Could not list images to tag in ${bookFolderPath}: ${error}`);
    return;
  }
  if (files.length === 0) return;

  // `-overwrite_original` keeps exiftool from leaving "<name>_original" backups
  // in the book folder. `-codedcharacterset=utf8` keeps non-ASCII names/notices
  // intact in the IPTC-derived fields.
  const writeArgs = ["-overwrite_original", "-codedcharacterset=utf8"];
  const exiftool = new ExifTool();
  let written = 0;
  try {
    for (const file of files) {
      try {
        await exiftool.write(file, tags, { writeArgs });
        written++;
      } catch (error) {
        logger.warn(`Failed to write image metadata to ${path.basename(file)}: ${error}`);
      }
    }
  } finally {
    await exiftool.end();
  }

  const summary = [
    ip.creator ? `illustrator="${ip.creator}"` : null,
    ip.copyright ? "copyright" : null,
    ip.licenseUrl ? "license" : null,
  ]
    .filter(Boolean)
    .join(", ");
  logger.info(`Wrote image metadata (${summary}) to ${written}/${files.length} image(s).`);
}
