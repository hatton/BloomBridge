import { BloomMarkdown } from "../bloom-markdown/parseMarkdown";
import { getMarkdownFromBook } from "../bloom-markdown/generateMarkdown";
import { Page } from "../types";

// Here we want to do the final bit of any logic work and add that to the markdown.
// We do this still in the format so that it is easier for a human to inspect the plan.
// Later we're go to HTML and by then it's really hard to wade through what was done.

// The plan includes:
// - for each page
// -- we need to look at the pattern of texts and images and choose a Bloom page layout
// -- decide if it is a bilingual page or not
// -- decide if it is front matter or back matter page which we want to strip out
// of the book we'll produce because the way Bloom works, all metadata is put in the book as such,
// and it's a runtime thing to generate pages to show that metadata in whatever way the current settings want.
// We then add that information to the <!-- page --> comment in the markdown.

export function addBloomPlanToMarkdown(markdown: string): string {
  const book = new BloomMarkdown().parseMarkdown(markdown);
  AddPageTypes(book.pages);
  // foreach page
  for (const page of book.pages) {
    if (isBilingualPage(page)) {
      page.appearsToBeBilingualPage = true;
    }
    //page.layout = choosePageLayout(page);
  }

  // TODO: go through each page looking for any metadata that we didn't pick up to the front-matter somewhere so that it isn't lost
  return getMarkdownFromBook(book);
}

// function choosePageLayout(page: Page): Layout {
//   // TODO: look at the patterns of text and images in the page and choose a layout
//   return "text"; // Placeholder for actual logic to determine layout
// }

function isBilingualPage(page: Page): boolean {
  // When a page has two or more consecutive text blocks in two different languages, without any intervening images,
  // we consider it bilingual. Also if something has combined multiple languages in a single text block,
  // we consider it bilingual.

  let previousLang = "";
  for (let i = 0; i < page.elements.length; i++) {
    const element = page.elements[i];
    if (element.type !== "text") {
      previousLang = ""; // Reset search for consecutive languages if we hit a non-text element
    } else {
      const currentLang = element.content.lang || ""; // Assuming content has a lang property

      if (Object.keys(element.content).length > 1) {
        return true; // Found multiple languages in the same text block, so it's bilingual
      }
      if (currentLang && currentLang !== previousLang) {
        if (previousLang) {
          return true; // Found a different language after a previous one, so it's bilingual
        }
        previousLang = currentLang; // Update previous language to current
      }
    }
  }
  return false; // No bilingual pattern found
}

function AddPageTypes(pages: Page[]): void {
  // We consider front-matter to be a cover, title page, and credits page. (We do not consider TOC, dedication, etc. to be front matter).
  // Some books then include back matter.
  // Here we want to identify front-matter, back-matter, and content pages using some heuristics.
  // E.g. non-content pages should have <!-- text --> blocks that have a "field" attribute, e.g. <!-- text lang="en" field="title" -->
  // and <!-- text lang="en" field="copyright" -->.
  // Once we identify our first content page, all pages are content pages until we hit a back-matter page.

  let haveSeenContentPage = false;

  for (const page of pages) {
    if (page.elements.length === 0) {
      page.type = "empty"; // No elements, treat as empty
      continue;
    }

    page.type = "content" as const; // Default to content

    for (const element of page.elements) {
      if (element.type === "text") {
        // This comes from a run (from a Bloom book!) that gave us a page with a single "." as the page content (an OCR error maybe?).
        // For now we're just leaving it there but making sure it doesn't switch us into "content" mode.
        const hasOnlyUnknownLang =
          element.content["unk"] && Object.keys(element.content).length === 1;
        if ((element.field && element.field !== "pageNumber") || hasOnlyUnknownLang) {
          page.type = haveSeenContentPage ? ("back-matter" as const) : ("front-matter" as const);
          break; // Found a field element, so this determines the page type
        }
      }
    }

    if (page.type === "content") {
      haveSeenContentPage = true;
    }
  }
}
