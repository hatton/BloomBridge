import { logger } from "../logger";
import type { Book } from "../types";

/**
 * Generate markdown from a Book object
 * @param book The Book object to convert to markdown
 * @returns The generated markdown string
 */
export function getMarkdownFromBook(book: Book): string {
  let frontmatter = "";

  /* example
  allTitles:
    en: "test me"
    unk-x-gondi: "ஹ்வ்லி"
  languages:
    en: "English"
    unk-x-gondi: "Gondi"
  l1: "en"
  l2: "unk-x-gondi"
  coverImage: "img-0.jpeg"
  license: "CC-BY-4.0"
  copyright: "Copyright © [Year], [Author/Publisher]"
  credits:
    author: "A Happy Group of Devs"
  tags:
    topic: []
  publisher: "A Happy Group of Devs"
  country: "India"
  */
  for (const [key, value] of Object.entries(book.frontMatterMetadata)) {
    switch (key) {
      case "languages":
        frontmatter += `languages:\n`;
        for (const lang in value) {
          frontmatter += `  ${lang}: "${value[lang]}"\n`;
        }
        break;
      case "allTitles":
        frontmatter += `allTitles:\n`;
        for (const lang in value) {
          frontmatter += `  ${lang}: "${value[lang]}"\n`;
        }
        break;
      case "tags":
        frontmatter += `tags:\n`;
        for (const tag in value) {
          const tagValue = value[tag];
          if (Array.isArray(tagValue)) {
            frontmatter += `  ${tag}: ${tagValue.join(", ")}\n`;
          } else {
            frontmatter += `  ${tag}: "${tagValue}"\n`;
          }
        }
        break;
      case "credits":
        frontmatter += `credits:\n`;
        for (const field in value) {
          frontmatter += `  ${field}: "${value[field]}"\n`;
        }
        break;
      default:
        frontmatter += `${key}: "${value}"\n`;
    }
  }

  const body = book.pages
    .map((page, index) => {
      // First, emit the <!-- page --> comment with attributes
      let pageComment = `<!-- page index=${index + 1} `;
      // if (page.layout) {
      //   pageComment += `layout="${page.layout}" `;
      // }
      if (page.appearsToBeBilingualPage) {
        pageComment += `bilingual="true" `;
      }
      pageComment += `type="${page.type || "content"}" `;
      // Layout hints from the vision-formatting step must be re-emitted here or
      // they are lost on the round-trip through the Book object (stages 3 and 4).
      if (page.verticalAlign) {
        pageComment += `vertical-align="${page.verticalAlign}" `;
      }
      if (page.horizontalAlign) {
        pageComment += `horizontal-align="${page.horizontalAlign}" `;
      }
      if (page.backgroundColor) {
        pageComment += `background-color="${page.backgroundColor}" `;
      }
      pageComment = pageComment.trimEnd() + " -->"; // Generate page content
      let pageContent = "";
      for (const element of page.elements) {
        if (element.type === "image") {
          pageContent += `\n![${element.alt || ""}](${element.src})${element.attributes || ""}`;
        } else if (element.type === "text") {
          // Skip page number fields
          if (element.field === "pageNumber") {
            continue;
          }

          logger.verbose(`[getMarkdownFromBook] text: ${JSON.stringify(element.content, null, 2)}`);

          // Generate text content for each language
          for (const [lang, content] of Object.entries(element.content)) {
            let textComment = `<!-- text lang="${lang}"`;
            if (element.field) {
              textComment += ` field="${element.field}" -->`;
            } else {
              textComment += ` -->`;
            }
            pageContent += `\n\n${textComment}\n${convertHtmlToMarkdown(content)}`;
          }
        }
      }

      return pageComment + pageContent;
    })
    .join("\n\n");
  //    .join("\n\n<!-- page -->\n");

  // Re-emit the book-level normal-style hint as a comment so it survives the
  // round-trip through the Book object (parsed back in parseMarkdown).
  let bookComment = "";
  if (
    book.frontMatterMetadata.normalFontSizePt ||
    book.frontMatterMetadata.normalFontFamily ||
    book.frontMatterMetadata.pageSize
  ) {
    let attrs = "";
    if (book.frontMatterMetadata.normalFontSizePt) {
      attrs += ` normal-font-size="${book.frontMatterMetadata.normalFontSizePt}"`;
    }
    if (book.frontMatterMetadata.normalFontFamily) {
      attrs += ` normal-font-family="${book.frontMatterMetadata.normalFontFamily}"`;
    }
    if (book.frontMatterMetadata.pageSize) {
      attrs += ` page-size="${book.frontMatterMetadata.pageSize}"`;
    }
    bookComment = `<!-- book${attrs} -->\n\n`;
  }

  return `---\n${frontmatter}---\n\n${bookComment}${body}`;
}

/**
 * Convert HTML content back to markdown format
 * This reverses the HTML conversion done during parsing
 */
export function convertHtmlToMarkdown(html: string): string {
  return (
    html
      // Remove paragraph tags but preserve content
      .replace(/<p>(.*?)<\/p>/g, "$1\n")
      // Convert headings back to markdown
      .replace(/<h1>(.*?)<\/h1>/g, "# $1")
      .replace(/<h2>(.*?)<\/h2>/g, "## $1")
      .replace(/<h3>(.*?)<\/h3>/g, "### $1")
      .replace(/<h4>(.*?)<\/h4>/g, "#### $1")
      .replace(/<h5>(.*?)<\/h5>/g, "##### $1")
      .replace(/<h6>(.*?)<\/h6>/g, "###### $1")
      // Convert bold and italic back to markdown
      .replace(/<strong>(.*?)<\/strong>/g, "**$1**")
      .replace(/<em>(.*?)<\/em>/g, "*$1*")
      // Convert links back to markdown
      .replace(/<a href="([^"]*)">(.*?)<\/a>/g, "[$2]($1)")
      // Clean up extra whitespace
      .trim()
  );
}
