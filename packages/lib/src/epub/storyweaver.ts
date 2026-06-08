/**
 * Pratham Books' **StoryWeaver** is one of the largest sources of openly-licensed
 * children's books, and its EPUBs share one very consistent structure. This module
 * recognises that structure and pulls the book's metadata out of it, so the generic
 * EPUB extractor can let Bloom's own xMatter convey the credits instead of importing
 * StoryWeaver's end-matter pages as duplicate content.
 *
 * A StoryWeaver EPUB's spine is `1.xhtml … N.xhtml`, where:
 *   • page 1 is the **cover** — a `front-cover-page` whose `contributor_attribution`
 *     spans name the Author / Illustrator / Translator (each behind an English label);
 *   • the middle pages are the story;
 *   • the last 1-3 pages are **end matter** — `attribution-text` pages (story/illustration
 *     attribution, copyright, CC license, publisher, donor) and a `back-cover` page whose
 *     `synopsis` is the blurb.
 *
 * We mine the contributors from the cover and the rest from the end matter, and report
 * which spine indices are end matter so the extractor skips them as content. Detection
 * and parsing key off StoryWeaver's own class names / boilerplate, not any one book.
 */

/**
 * The `<body>` content of a spine document. StoryWeaver embeds its ENTIRE stylesheet in
 * every page's `<head>`, so probing for a class name (`cover_title`, `attribution-text`,
 * …) over the whole document matches every page — we must look only at the body markup.
 */
function bodyOf(html: string): string {
  return html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
}

/** Strip tags + collapse whitespace (self-contained so this module has no import cycle). */
function text(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export interface StoryWeaverMeta {
  /** Original story author (the cover's "Author:"). */
  author?: string;
  illustrator?: string;
  translator?: string;
  /** Ready-to-show copyright line, e.g. "© 2022 Pratham Books". */
  copyright?: string;
  /** Creative Commons license URL mined from the attribution page. */
  licenseUrl?: string;
  /** The publisher named by the attribution page ("…published on StoryWeaver by X"). */
  publisher?: string;
  /** Funder/donor ("The development of this book has been supported by X"). */
  funding?: string;
  /** The back-cover blurb. */
  summary?: string;
}

export interface StoryWeaverInfo {
  /**
   * 1-based spine indices that are StoryWeaver END MATTER (attribution + back cover).
   * The extractor skips these as content — their information is mined into `meta` and
   * conveyed by Bloom's regenerated xMatter instead.
   */
  matterPages: Set<number>;
  meta: StoryWeaverMeta;
}

/** True if this EPUB was produced by Pratham Books' StoryWeaver. */
export function isStoryWeaverEpub(opf: string, spineBodies: (string | undefined)[]): boolean {
  // The OPF identifier is a StoryWeaver story URL (`/stories/<id>-<slug>`).
  if (/\bstories\/\d+/i.test(opf)) return true;
  // Otherwise the spine documents carry StoryWeaver's reader chrome / boilerplate.
  return spineBodies.some(
    (b) =>
      !!b &&
      (/\bstoryweaver\.org/i.test(b) ||
        /id=["']story_?(?:epub|Reader)["']/i.test(b) ||
        /Pratham Books['’]? StoryWeaver/i.test(b)),
  );
}

/** Which kind of StoryWeaver page is this (given its `<body>` markup)? */
function pageKind(html: string): "cover" | "attribution" | "back-cover" | "content" {
  if (/\bfront-cover-page\b/.test(html) || /\bcover_title\b/.test(html)) return "cover";
  if (/\battribution-text\b/.test(html) || /\battrb-full\b/.test(html)) return "attribution";
  if (
    /\bback-cover-top\b/.test(html) ||
    /\bback_cover_title\b/.test(html) ||
    /\bspp_about_us_footer\b/.test(html)
  )
    return "back-cover";
  return "content";
}

/** First capture group of `re` against `s`, trimmed, or undefined. */
function cap(s: string, re: RegExp): string | undefined {
  const m = s.match(re);
  return m?.[1]?.trim() || undefined;
}

/**
 * Pull contributors from the cover's `cover_attribution` paragraphs. Each is an English
 * label ("Author:", "Illustrator:", "Translator:") followed by the name, so we read the
 * label rather than the (class-name) markup — robust across StoryWeaver's role variants
 * (e.g. a translator's span also carries the `authors` class).
 */
function parseCoverContributors(coverHtml: string, meta: StoryWeaverMeta): void {
  for (const m of coverHtml.matchAll(
    /<p[^>]*class=["'][^"']*\bcover_attribution\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi,
  )) {
    const line = text(m[1]);
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const label = line.slice(0, sep).toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (!value) continue;
    if (/illustrat/.test(label) && !meta.illustrator) meta.illustrator = value;
    else if (/translat/.test(label) && !meta.translator) meta.translator = value;
    else if (/author/.test(label) && !meta.author) meta.author = value;
  }
}

/** Mine copyright / license / publisher / funder from the attribution page(s). */
function parseAttribution(attrHtml: string, meta: StoryWeaverMeta): void {
  const t = text(attrHtml);

  // Copyright. A translation's "© for this translation lies with <holder>, <year>" comes
  // first (it's the edition we're shipping); an original-only book just has "© <holder>,
  // <year>". One pattern handles both — the optional "for this … lies with" prefix lets
  // the first match land on the translation copyright when present.
  const copy = t.match(
    /©\s*(?:for this [^,]*?\blies with\s+)?([A-Za-z][A-Za-z .&'’-]+?)\s*,\s*(\d{4})/i,
  );
  if (copy) meta.copyright = `© ${copy[2]} ${copy[1].trim()}`;

  meta.licenseUrl = cap(t, /(https?:\/\/creativecommons\.org\/licenses\/[a-z0-9./-]+)/i);

  meta.publisher = cap(t, /published on StoryWeaver by\s+([^.]+?)\s*\./i);

  // The funder is StoryWeaver's canonical donor sentence — NOT the "This book was made
  // possible by Pratham Books' StoryWeaver platform" boilerplate that appears on every
  // book. Key on "the development of this book … by <funder>".
  meta.funding = cap(t, /development of this book\b[^.]*?\bby\s+(?:the\s+)?([^.]+?)\s*\./i);
}

/** The back cover's synopsis is the book blurb. */
function parseBackCover(backHtml: string, meta: StoryWeaverMeta): void {
  const m = backHtml.match(/<p[^>]*class=["'][^"']*\bsynopsis\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
  if (m) {
    const s = text(m[1]);
    if (s) meta.summary = s;
  }
}

/**
 * Analyse a StoryWeaver EPUB's spine documents (1-based order, undefined for unreadable
 * pages) → the end-matter page set + mined metadata. Call only when `isStoryWeaverEpub`.
 */
export function analyzeStoryWeaver(spineBodies: (string | undefined)[]): StoryWeaverInfo {
  const matterPages = new Set<number>();
  const meta: StoryWeaverMeta = {};
  const attribution: string[] = [];

  spineBodies.forEach((html, i) => {
    if (!html) return;
    const body = bodyOf(html);
    switch (pageKind(body)) {
      case "cover":
        parseCoverContributors(body, meta);
        break;
      case "attribution":
        matterPages.add(i + 1);
        attribution.push(body);
        break;
      case "back-cover":
        matterPages.add(i + 1);
        parseBackCover(body, meta);
        break;
    }
  });

  if (attribution.length) parseAttribution(attribution.join("\n"), meta);
  return { matterPages, meta };
}
