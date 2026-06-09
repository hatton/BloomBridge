import { BloomMetadataParser, FrontMatterMetadata } from "../3-add-bloom-plan/bloomMetadata";
import type {
  Book,
  HorizontalAlign,
  Page,
  PageElement,
  TextBlockElement,
  ValidationError,
  VerticalAlign,
} from "../types";

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

    // Book-level layout hints carried in a `<!-- book ... -->` comment (injected
    // during the PDF stage by detectNormalStyle). Survives the LLM as a comment.
    const bookComment = markdown.match(/<!--\s*book\b([^>]*)-->/);
    if (bookComment) {
      const sizeMatch = bookComment[1].match(/normal-font-size=["']?([\d.]+)["']?/);
      if (sizeMatch) metadata.normalFontSizePt = Number(sizeMatch[1]);
      const familyMatch = bookComment[1].match(/normal-font-family=["']([^"']+)["']/);
      if (familyMatch) metadata.normalFontFamily = familyMatch[1];
      const pageSizeMatch = bookComment[1].match(/page-size=["']?([A-Za-z0-9]+)["']?/);
      if (pageSizeMatch) metadata.pageSize = pageSizeMatch[1];
      if (/cover-color=["']?white["']?/i.test(bookComment[1])) metadata.whiteCover = true;
    }

    // Strip the book comment out of the body before splitting into pages. If left
    // in, it makes the pre-first-page segment non-empty, which throws off the
    // page-comment↔content alignment in createPageObjects (shifting every page's
    // attributes — type, background-color, alignment — onto the wrong page).
    const bodyWithoutBookComment = body.replace(/<!--\s*book\b[^>]*-->/g, "");

    const pages = this.createPageObjects(bodyWithoutBookComment, metadata);

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

          // Extract the optional field and style attributes from the comment
          const fieldMatch = match[0].match(/field=["']?([^"'\s>]+)["']?/);
          const field = fieldMatch ? fieldMatch[1] : undefined;
          const styleMatch = match[0].match(/style=["']?([^"'\s>]+)["']?/);
          const style = styleMatch ? styleMatch[1] : undefined;

          // Set new language
          currentLang = match[1];
          // If our currentTextBlock is a different field/style or
          // if it already has text in this language,
          // create new text block or finalize existing one.
          if (
            currentTextBlock &&
            (currentTextBlock.field !== field ||
              currentTextBlock.style !== style ||
              currentTextBlock.content[currentLang])
          ) {
            elements.push(currentTextBlock);
            currentTextBlock = null;
          }

          if (!currentTextBlock) {
            currentTextBlock = {
              type: "text",
              content: {},
              field: field as TextBlockElement["field"],
              style,
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
        // Extract field and style attributes if present
        const fieldMatch = trimmedLine.match(/field=["']?([^"'\s>]+)["']?/);
        const field = fieldMatch ? fieldMatch[1] : undefined;
        const styleMatch = trimmedLine.match(/style=["']?([^"'\s>]+)["']?/);
        const style = styleMatch ? styleMatch[1] : undefined;

        // Finalize current text before switching languages
        if (currentTextBlock && currentLang && currentText.trim()) {
          currentTextBlock.content[currentLang] = currentText.trim();
        }
        currentLang = langMatch[1];

        // Check if we need to create a new text block due to a field/style mismatch
        const shouldCreateNewBlock =
          !currentTextBlock ||
          currentTextBlock.content[currentLang] ||
          currentTextBlock.field !== field ||
          currentTextBlock.style !== style;

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
            style,
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
      } else if (trimmedLine.length > 0) {
        if (currentLang) {
          // Untagged text after an image (the LLM tags one block per page but a
          // canvas page can have several text chunks separated by images). Rather
          // than drop it, start a fresh text block in the language we last saw so
          // the chunk survives — e.g. the discussion questions on a "you can use
          // these questions" page.
          currentTextBlock = { type: "text", content: { [currentLang]: "" } };
          currentText = trimmedLine + "\n";
        } else {
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
      verticalAlign: pageAttributes.verticalAlign,
      horizontalAlign: pageAttributes.horizontalAlign,
      backgroundColor: pageAttributes.backgroundColor,
      canvasTextBoxes: pageAttributes.canvasTextBoxes,
      canvasBackgroundImage: pageAttributes.canvasBackgroundImage,
      canvasImageBoxes: pageAttributes.canvasImageBoxes,
      sourcePdfPage: pageAttributes.sourcePdfPage,
      importSourceHash: pageAttributes.importSourceHash,
      isMasterPage: pageAttributes.isMasterPage,
      flattenAsImage: pageAttributes.flattenAsImage,
      flattenScore: pageAttributes.flattenScore,
      flattenLevel: pageAttributes.flattenLevel,
      fullPageImage: pageAttributes.fullPageImage,
    };
  }

  private addWarning(message: string): void {
    this.errors.push({ type: "warning", message });
  }
  private parsePageAttributes(pageComment: string): {
    type?: string;
    bilingual?: boolean;
    verticalAlign?: VerticalAlign;
    horizontalAlign?: HorizontalAlign;
    backgroundColor?: string;
    canvasTextBoxes?: { x: number; y: number; w: number; h: number }[];
    canvasBackgroundImage?: string;
    canvasImageBoxes?: { x: number; y: number; w: number; h: number }[];
    sourcePdfPage?: number;
    importSourceHash?: string;
    isMasterPage?: boolean;
    flattenAsImage?: string;
    flattenScore?: number;
    flattenLevel?: string;
    fullPageImage?: boolean;
  } {
    const attributes: {
      type?: string;
      bilingual?: boolean;
      verticalAlign?: VerticalAlign;
      horizontalAlign?: HorizontalAlign;
      backgroundColor?: string;
      canvasTextBoxes?: { x: number; y: number; w: number; h: number }[];
      canvasBackgroundImage?: string;
      canvasImageBoxes?: { x: number; y: number; w: number; h: number }[];
      sourcePdfPage?: number;
      importSourceHash?: string;
      isMasterPage?: boolean;
      flattenAsImage?: string;
      flattenScore?: number;
      flattenLevel?: string;
      fullPageImage?: boolean;
    } = {};

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

    // Layout hints (added by the vision-formatting step). Validate against the
    // known enum values and warn + drop anything unexpected.
    const verticalMatch = pageComment.match(/vertical-align=["']?([^"'\s>]+)["']?/);
    if (verticalMatch) {
      const value = verticalMatch[1];
      if (value === "top" || value === "center" || value === "bottom") {
        attributes.verticalAlign = value;
      } else {
        this.addWarning(`Ignoring unknown vertical-align value "${value}"`);
      }
    }

    const horizontalMatch = pageComment.match(/horizontal-align=["']?([^"'\s>]+)["']?/);
    if (horizontalMatch) {
      const value = horizontalMatch[1];
      if (value === "left" || value === "center" || value === "right") {
        attributes.horizontalAlign = value;
      } else {
        this.addWarning(`Ignoring unknown horizontal-align value "${value}"`);
      }
    }

    const backgroundMatch = pageComment.match(/background-color=["']?([^"'\s>]+)["']?/);
    if (backgroundMatch) {
      attributes.backgroundColor = backgroundMatch[1];
    }

    // True source-PDF page number (preserved verbatim across round-trips, unlike
    // the renumbered `index`). Drives paired-preview alignment.
    const sourcePageMatch = pageComment.match(/source-pdf-page=["']?(\d+)["']?/);
    if (sourcePageMatch) {
      attributes.sourcePdfPage = Number(sourcePageMatch[1]);
    }

    // Hash of the source PDF page render, used for master-page substitution.
    const hashMatch = pageComment.match(/import-source-hash=["']?([^"'\s>]+)["']?/);
    if (hashMatch) {
      attributes.importSourceHash = hashMatch[1];
    }

    // Marks a page that matched a master book page and should render as a
    // substitution placeholder regardless of its detected type.
    const masterPageMatch = pageComment.match(/master-page=["']?(true|false)["']?/);
    if (masterPageMatch) {
      attributes.isMasterPage = masterPageMatch[1] === "true";
    }

    // Marks a page the complexity check chose to import as a full-page image
    // (see Stage 1 + `--complex-becomes-image`). The value is the rendered file.
    const flattenMatch = pageComment.match(/flatten-as-image=["']?([^"'\s>]+)["']?/);
    if (flattenMatch) {
      attributes.flattenAsImage = flattenMatch[1];
      const scoreMatch = pageComment.match(/flatten-score=["']?(\d+)["']?/);
      if (scoreMatch) attributes.flattenScore = Number(scoreMatch[1]);
      const levelMatch = pageComment.match(/flatten-level=["']?([^"'\s>]+)["']?/);
      if (levelMatch) attributes.flattenLevel = levelMatch[1];
    }

    // Marks a wordless full-bleed illustration page (a picture-book page with art but
    // no text), rendered as a background-only canvas page (see generatePage).
    const fullPageImageMatch = pageComment.match(/full-page-image=["']?(true|false)["']?/);
    if (fullPageImageMatch) {
      attributes.fullPageImage = fullPageImageMatch[1] === "true";
    }

    // Canvas text boxes: one or more "x,y,w,h" groups (separated by ";") marking
    // where each text block floats over a full-page background image (a Bloom
    // Canvas page), in reading order. Also accept the older singular
    // `canvas-text-box="x,y,w,h"` for backward compatibility.
    const parseBox = (s: string): { x: number; y: number; w: number; h: number } | undefined => {
      const n = s.split(",").map(Number);
      return n.length === 4 && n.every((v) => Number.isFinite(v))
        ? { x: n[0], y: n[1], w: n[2], h: n[3] }
        : undefined;
    };
    const boxesMatch = pageComment.match(/canvas-text-boxes=["']([^"']+)["']/);
    const singleMatch = pageComment.match(/canvas-text-box=["']([^"']+)["']/);
    if (boxesMatch) {
      const boxes = boxesMatch[1].split(";").map(parseBox).filter(Boolean) as {
        x: number;
        y: number;
        w: number;
        h: number;
      }[];
      if (boxes.length) attributes.canvasTextBoxes = boxes;
    } else if (singleMatch) {
      const box = parseBox(singleMatch[1]);
      if (box) attributes.canvasTextBoxes = [box];
    }

    // Boxes for foreground images positioned on a canvas page (the row icons of a
    // discussion-questions grid); the page's image elements pair to these in order.
    const imageBoxesMatch = pageComment.match(/canvas-image-boxes=["']([^"']+)["']/);
    if (imageBoxesMatch) {
      const boxes = imageBoxesMatch[1].split(";").map(parseBox).filter(Boolean) as {
        x: number;
        y: number;
        w: number;
        h: number;
      }[];
      if (boxes.length) attributes.canvasImageBoxes = boxes;
    }

    // Filename of the Canvas page's full-page background image, detected
    // geometrically in Stage 1 so the picture survives even when the OCR/LLM didn't
    // emit an `![image]` ref for it (see Page.canvasBackgroundImage).
    const bgImageMatch = pageComment.match(/canvas-background-image=["']?([^"'\s>]+)["']?/);
    if (bgImageMatch) {
      attributes.canvasBackgroundImage = bgImageMatch[1];
    }

    return attributes;
  }
}
