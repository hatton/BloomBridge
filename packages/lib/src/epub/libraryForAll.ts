/**
 * **Library For All** (libraryforall.org) is a major source of openly-licensed early-reader
 * books, shipped as EPUBs built from a consistent "Vanuatu" template. Like StoryWeaver
 * (see storyweaver.ts) we recognise the publisher and mine the one piece of metadata its
 * pages don't expose as text: the book's **summary** (blurb).
 *
 * An LFA book's last spine page is its back cover, and the blurb there is baked INTO the
 * back-cover IMAGE (back.jpg) — so it cannot be read as page text without OCR or an LLM.
 * Fortunately the same blurb is carried losslessly in the OPF's `<dc:description>`, so we
 * take it from there. That summary then rides through the pipeline as a `field="summary"`
 * block and lands in Bloom's meta.json `summary` (shown on the book's outside back cover).
 *
 * Detection keys off LFA's `<dc:publisher>`, not any one book — kept general within the
 * publisher, no per-title branches.
 */

export interface LibraryForAllInfo {
  /** The book blurb, mined from the OPF `<dc:description>`. */
  summary?: string;
}

/** Strip tags + decode the entities that appear in OPF prose; collapse whitespace. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True if this EPUB was published by Library For All (its OPF `<dc:publisher>`). */
export function isLibraryForAllEpub(opf: string): boolean {
  return /<dc:publisher\b[^>]*>\s*Library\s+For\s+All\s*<\/dc:publisher>/i.test(opf);
}

/**
 * Mine the Library For All summary from the OPF. Call only when `isLibraryForAllEpub`.
 * Returns an empty object if the OPF carries no usable description.
 */
export function analyzeLibraryForAll(opf: string): LibraryForAllInfo {
  const m = opf.match(/<dc:description\b[^>]*>([\s\S]*?)<\/dc:description>/i);
  const summary = m ? text(m[1]) : undefined;
  return summary ? { summary } : {};
}
