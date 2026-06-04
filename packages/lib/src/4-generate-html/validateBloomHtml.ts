import type { ValidationError } from "../types.js";

/**
 * Validate the structural well-formedness of generated Bloom HTML.
 *
 * The one structural rule that actually matters for layout: a content page MUST
 * carry the `numberedPage` class. Bloom only assigns the `side-left`/`side-right`
 * classes to numbered pages, and in basePage.css those side classes are what apply
 * the horizontal page margin; a content page without `numberedPage` renders with
 * its text hard against the page edge (the bug this guards against). We also
 * require every page to have a non-empty id (Bloom needs it). We deliberately do
 * NOT check for the other things Bloom's "repair" adds (data-pagelineage,
 * pageLabel, etc.) — they don't affect layout and we don't emit them.
 *
 * Returns a list of problems (does not throw); the generator logs them so a
 * borderline book is still written for inspection.
 */
export function validateBloomHtml(html: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const pages = extractBloomPageDivs(html);

  pages.forEach((page, index) => {
    const openTag = page.match(/^<div\b[^>]*>/i)?.[0] ?? "";
    const classes = openTag.match(/class="([^"]*)"/i)?.[1] ?? "";

    // xMatter / cover pages have their own structure (Bloom regenerates them) and
    // aren't subject to the content-page rules.
    if (/\b(cover|bloom-frontMatter|bloom-backMatter|bloom-customLayout)\b/.test(classes)) {
      return;
    }
    // Master-page substitution placeholders are intentionally minimal (an empty
    // marginBox); they get replaced wholesale later. Skip them.
    if (/<div class="marginBox">\s*<\/div>/.test(page)) {
      return;
    }

    const id = openTag.match(/\bid="([^"]*)"/i)?.[1];
    const where = id ? `page id=${id}` : `page #${index + 1}`;

    if (!id) {
      errors.push({ type: "error", message: `${where}: missing a non-empty id` });
    }
    if (!/\bnumberedPage\b/.test(classes)) {
      errors.push({
        type: "error",
        message: `${where}: content page is missing the "numberedPage" class (its text will render hard against the page edge)`,
      });
    }
  });

  return errors;
}

/**
 * Slice out the top-level `div.bloom-page` elements by counting `<div>`/`</div>`
 * depth. Bloom HTML is well-formed and bloom-page divs are direct, non-nested
 * siblings, so depth counting is reliable without a full HTML parser. (Mirrors the
 * same approach in master/masterPages.ts.)
 */
function extractBloomPageDivs(html: string): string[] {
  const results: string[] = [];
  const tagRe = /<div\b[^>]*>|<\/div>/gi;
  let match: RegExpExecArray | null;
  let pageStart = -1;
  let depth = 0;

  while ((match = tagRe.exec(html)) !== null) {
    const isOpen = match[0][1] !== "/";
    if (pageStart === -1) {
      if (isOpen && /class="[^"]*\bbloom-page\b[^"]*"/i.test(match[0])) {
        pageStart = match.index;
        depth = 1;
      }
    } else {
      depth += isOpen ? 1 : -1;
      if (depth === 0) {
        results.push(html.slice(pageStart, match.index + match[0].length));
        pageStart = -1;
      }
    }
  }
  return results;
}
