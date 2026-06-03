import { BloomMetadataParser, FrontMatterMetadata } from "../3-add-bloom-plan/bloomMetadata";
import type { Book, Page, PageElement, TextBlockElement, ValidationError } from "../types";

export class BloomMarkdown {
  private errors: ValidationError[] = [];
  private metadataParser = new BloomMetadataParser();

  public parseMarkdown(markdown: string): Book {
    this.errors = [];
    this.metadataParser.clearErrors();

    const { frontmatter, body } = this.metadataParser.extractFrontmatter(markdown);
    const metadata = this.metadataParser.parseMetadata(frontmatter);
    if (!metadata) {
      throw new Error("Failed to parse metadata from frontmatter");
    }

    // Merge metadata parser errors with our errors
    this.errors.push(...this.metadataParser.getErrors());

    const pages = this.createPageObjects(body, metadata);

    if (this.errors.some((e) => e.type === "error")) {
      throw new Error(
        `Validation failed:\n${this.errors.map((e) => `${e.type.toUpperCase()}: ${e.message}`).join("\n")}`,
      );
    }

    // Go through each page, find every text block that has a field attribute, and add it to the metadata.
    // Overwrite existing metadata fields if they already exist.
    // for (const page of pages) {
    //   for (const element of page.elements) {
    //     if (element.type === "text" && element.field) {
    //       // If the field already exists, we overwrite it.
    //       metadata[element.field] = element.content;
    //     }
    //   }
    // }

    return { frontMatterMetadata: metadata, pages };
  }
  getErrors(): ValidationError[] {
    return [...this.errors, ...this.metadataParser.getErrors()];
  }
  private createPageObjects(body: string, metadata: FrontMatterMetadata): Page[] {
    // Use regex to split on page comments with or without attributes
    const pageRegex = /<!--\s*page\s*(?:[^>]*)-->/g;
    const parts = body.split(pageRegex);
    const pages: Page[] = [];

    // Find all page comments to extract their attributes
    const pageComments = [...body.matchAll(pageRegex)];

    // Skip the first part if it's empty (before the first page comment)
    let startIndex = 0;
    if (parts[0].trim() === "") {
      startIndex = 1;
    }

    for (let i = startIndex; i < parts.length; i++) {
      const pageContent = parts[i].trim();
      if (!pageContent) continue;

      // Get the corresponding page comment (adjust index for empty first part)
      const pageCommentIndex = startIndex === 1 ? i - 1 : i;
      const pageComment = pageComments[pageCommentIndex]?.[0] || "";

      const page = this.parsePage(pageContent, metadata, i, pageComment);
      if (page) {
        pages.push(page);
      }
    }

    return pages;
  }
  private parsePage(
    content: string,
    metadata: FrontMatterMetadata,
    pageNumber: number,
    pageComment?: string,
  ): Page | null {
    const lines = content.split("\n");
    const elements: PageElement[] = [];
    let currentTextBlock: TextBlockElement | null = null;
    let currentLang = "";
    let currentText = "";

    // Parse page attributes from the comment
    const pageAttributes = this.parsePageAttributes(pageComment || "");

    // Sometimes the llm sees something that it can't identify and doesn't tag it.
    // Collect up everything that comes before the first comment or image (![...) and
    // add a text block for it with lang="unk". If it's just whitespace, skip it.
    const indexOfFirstCommentOrImage = content.search(/<!--|!\[([^\]]*)\]\(([^)]+)\)/);
    const materialBeforeFirstComment =
      indexOfFirstCommentOrImage >= 0
        ? content.substring(0, indexOfFirstCommentOrImage).trim()
        : content.trim();
    if (materialBeforeFirstComment) {
      const unknownTextBlock: TextBlockElement = {
        type: "text",
        content: {
          unk: materialBeforeFirstComment,
        },
      };
      elements.push(unknownTextBlock);
      this.addWarning(`page ${pageNumber}: Found untagged text in unknown language`);
    }

    for (const line of lines) {
      const trimmedLine = line.trim();

      // Handle inline comments by splitting the line
      const commentMatches = [
        ...line.matchAll(/<!-- text lang=(?:"?([a-zA-Z0-9-]+)"?)(?:\s+[^>]*)? -->/g),
      ];

      if (commentMatches.length > 0) {
        // Split line by comments and process each part
        let lastIndex = 0;

        for (const match of commentMatches) {
          const matchStart = match.index!;
          const matchEnd = matchStart + match[0].length;

          // REVIEW what's this about?
          // Process text before the comment
          const textBefore = line.substring(lastIndex, matchStart).trim();
          if (textBefore && currentTextBlock && currentLang) {
            currentText += textBefore + "\n";
          }

          // Finalize current text block if we have accumulated text
          if (currentTextBlock && currentLang && currentText.trim()) {
            currentTextBlock.content[currentLang] = currentText.trim();
          }

          // Extract the optional field attribute from the comment
          const fieldMatch = match[0].match(/field=["']?([^"'\s>]+)["']?/);
          const field = fieldMatch ? fieldMatch[1] : undefined;

          // Set new language
          currentLang = match[1];
          // If our currentTextBlock is a different field or
          // if it already has text in this language,
          // create new text block or finalize existing one.
          if (
            currentTextBlock &&
            (currentTextBlock.field !== field || currentTextBlock.content[currentLang])
          ) {
            elements.push(currentTextBlock);
            currentTextBlock = null;
          }

          if (!currentTextBlock) {
            currentTextBlock = {
              type: "text",
              content: {},
              field: field as TextBlockElement["field"],
            };
          }

          // Initialize the content for this language if it doesn't exist
          if (!currentTextBlock.content[currentLang]) {
            currentTextBlock.content[currentLang] = "";
          }

          currentText = "";

          // Process text after the comment
          lastIndex = matchEnd;
        }

        // Process any remaining text after the last comment
        const textAfter = line.substring(lastIndex).trim();
        if (textAfter && currentTextBlock && currentLang) {
          currentText += textAfter + "\n";
        }

        continue; // Skip the normal processing for this line
      }

      /* The algorithm:
       Go through each line:
            If the line is an image:
               1) if we have a currentTextBlock, push it to elements and set it to null.
               2) push an image element to elements.
            If the line is a lang comment:
            1) if currentTextBlock not null and already has a currentLang for this lang comment, push it to elements and set it to null.
            2) if currentTextBlock is null, create a new one.
           
      When we are done with lines, if we have a currentTextBlock, push it to elements.
      */ // Check for images - preserve full markdown format
      const imageMatch = trimmedLine.match(/!\[([^\]]*)\]\(([^)]+)\)(\{[^}]*\})?/);
      if (imageMatch) {
        // Finalize current text block before adding image
        if (currentTextBlock) {
          // Transfer any accumulated text before finalizing
          if (currentLang && currentText.trim()) {
            currentTextBlock.content[currentLang] = currentText.trim();
          }
          elements.push(currentTextBlock);
          currentTextBlock = null;
          currentText = "";
        }

        const alt = imageMatch[1];
        const src = imageMatch[2];
        const attributes = imageMatch[3];

        elements.push({
          type: "image",
          src,
          alt: alt || undefined,
          attributes: attributes || undefined,
        });

        continue; // go to the next line in the markdown
      }

      // Check for language blocks
      const langMatch = trimmedLine.match(
        /<!-- text lang=(?:"?([a-zA-Z0-9-]+)"?)(?:\s+[^>]*)?(?:\s*)-->/,
      );
      if (langMatch) {
        // Extract field attribute if present
        const fieldMatch = trimmedLine.match(/field=["']?([^"'\s>]+)["']?/);
        const field = fieldMatch ? fieldMatch[1] : undefined;

        // Finalize current text before switching languages
        if (currentTextBlock && currentLang && currentText.trim()) {
          currentTextBlock.content[currentLang] = currentText.trim();
        }
        currentLang = langMatch[1];

        // Check if we need to create a new text block due to field mismatch
        const shouldCreateNewBlock =
          !currentTextBlock ||
          currentTextBlock.content[currentLang] ||
          currentTextBlock.field !== field;

        // Finalize current text block if needed
        if (currentTextBlock && shouldCreateNewBlock) {
          elements.push(currentTextBlock);
          currentTextBlock = null;
        }

        // Create new text block if needed
        if (!currentTextBlock) {
          currentTextBlock = {
            type: "text",
            content: {},
            field: field as TextBlockElement["field"],
          };
        }

        currentTextBlock.content[currentLang] = "";
        currentText = "";

        if (!metadata.languages || !metadata.languages[currentLang]) {
          this.addWarning(
            `Encountered lang="${currentLang}" but this language is not defined in the metadata languages (page ${pageNumber}).`,
          );
        }

        continue; // go to the next line in the markdown
      }

      // If the line is some text, accumulate it for the current language
      // Accumulate text for the current language
      if (currentTextBlock && currentLang) {
        currentText += trimmedLine + "\n"; // Accumulate text
      } else {
        // if the trimmed line is not empty
        if (trimmedLine.length > 0) {
          this.addWarning(
            `Found text outside of a language block (page ${pageNumber}): "${trimmedLine}"`,
          );
        }
      }
    }
    // Transfer any remaining accumulated text before finalizing
    if (currentTextBlock && currentLang && currentText.trim()) {
      currentTextBlock.content[currentLang] = currentText.trim();
    }
    if (currentTextBlock) {
      elements.push(currentTextBlock);
    }

    if (elements.length === 0) {
      return null; // No content for this page
    }

    return {
      elements,
      type: (pageAttributes.type as any) || "content", // Default to content type
      appearsToBeBilingualPage: pageAttributes.bilingual,
    };
  }

  private addWarning(message: string): void {
    this.errors.push({ type: "warning", message });
  }
  private parsePageAttributes(pageComment: string): {
    type?: string;
    bilingual?: boolean;
  } {
    const attributes: { type?: string; bilingual?: boolean } = {};

    // Extract type attribute
    const typeMatch = pageComment.match(/type=["']?([^"'\s>]+)["']?/);
    if (typeMatch) {
      attributes.type = typeMatch[1];
    }

    // Extract bilingual attribute
    const bilingualMatch = pageComment.match(/bilingual=["']?(true|false)["']?/);
    if (bilingualMatch) {
      attributes.bilingual = bilingualMatch[1] === "true";
    }

    return attributes;
  }
}
