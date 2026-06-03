import escapeHtml from "escape-html";
import { randomUUID } from "crypto";
import { getUrlFromLicense } from "./licenses.js";
import {
  type Book,
  type Page,
  type PageElement,
  type TextBlockElement,
  type ImageElement,
  FRONT_COVER_IMAGE_FILENAME,
  BACK_COVER_IMAGE_FILENAME,
} from "../types.js";
import { FrontMatterMetadata } from "../3-add-bloom-plan/bloomMetadata.js";
import {
  generateOrigamiHtml,
  Orientation,
  type OrigamiItem,
  type TextOrigamiItem,
} from "./origami.js";
import { inlineMarkdownToHtml } from "./markdownToHtml.js";
import { LogEntry, logger } from "../logger";

// A note about bloom-monolingual, bloom-bilingual, and bloom-trilingual
// Although they show up on page divs, they are put there at runtime, so
// this converter doesn't need to add them, and if it does, they will
// just be overwritten.

export class HtmlGenerator {
  public static generateHtmlDocument(book: Book, logCallback?: (log: LogEntry) => void): string {
    if (logCallback) logger.subscribe(logCallback);

    // use console.log to give me a bunch of info to see why this line is failing:
    // this.getField("bookTitle", book)?.content[book.frontMatterMetadata.l1]

    let titleRecord = this.getFieldContent("bookTitle", book);

    if (!titleRecord) {
      logger.warn("Book title not found in book metadata.");
      // set the l1 of the titleRecord to "untitlled"
      titleRecord = {
        [book.frontMatterMetadata.l1]: "untitled",
      };
      logger.warn("Setting book title to 'untitled'.");
    }
    // verify that we have an l1
    if (!Object.entries(book.frontMatterMetadata).find(([key]) => key === "l1")) {
      logger.error("Book metadata does not contain a primary language (l1).");
      throw new Error("Book metadata does not contain a primary language (l1).");
    }
    // verify that the titleRecord has an entry for l1
    if (!titleRecord[book.frontMatterMetadata.l1]) {
      logger.error(
        `Um, Book title does not contain an entry for the primary language (${book.frontMatterMetadata.l1}).`,
      );
      logger.error(
        `book.frontMatterMetadata: ${JSON.stringify(book.frontMatterMetadata, null, 2)}`,
      );
      logger.error(`titleRecord: ${JSON.stringify(titleRecord, null, 2)}`);
      // throw new Error(
      //   `Book title does not contain an entry for the primary language (${book.frontMatterMetadata.l1}).`
      // );
    }
    const l1Lang = book.frontMatterMetadata.l1;
    return `<!doctype html>
  <html>
    <head>
    <meta charset="UTF-8" />
    <meta name="Generator" content="PDF-to-Bloom Converter" />
    <meta name="BloomFormatVersion" content="2.1" />
    <title>${escapeHtml(titleRecord![l1Lang])}</title>
    </head>
    <body>
    ${this.generateBloomDataDiv(book)}
    ${book.pages.map((page) => this.generatePage(page, book.frontMatterMetadata)).join("\n")}
    </body>
  </html>`;
  }

  private static generateBloomDataDiv(book: Book): string {
    const elements: string[] = [];

    elements.push(`<div id="bloomDataDiv">
      <div data-book="contentLanguage1" lang="*">${book.frontMatterMetadata.l1}</div>`);

    if (book.frontMatterMetadata.l2) {
      const bilingualContentPages = book.pages.filter(
        (page) => page.appearsToBeBilingualPage,
      ).length;
      if (bilingualContentPages > book.pages.length / 2) {
        elements.push(
          `      <div data-book="contentLanguage2" lang="*">${book.frontMatterMetadata.l2}</div>`,
        );
      }
    }

    // Determine the cover image. Bloom regenerates the front cover xMatter page
    // and fills its <img data-book="coverImage"> from this data-book value.
    //
    // Ideally the cover art is an image element on the first page. But some OCR
    // engines (notably Mistral) don't extract the full-bleed background art on a
    // cover page and only capture its overlaid text. In that common case the same
    // cover art is reproduced on the title page (e.g. Library For All readers), so
    // fall back to the first image found anywhere in the book.
    const coverImagesOnFirstPage = book.pages[0].elements.filter(
      (element) => element.type === "image",
    );
    if (coverImagesOnFirstPage.length > 1) {
      logger.warn("Multiple cover images found on the first page. Using the first one.");
    }
    let coverImage = coverImagesOnFirstPage[0] as ImageElement | undefined;
    if (!coverImage) {
      logger.warn(
        "No cover image found on the first page; falling back to the first image in the book.",
      );
      for (const page of book.pages) {
        const image = page.elements.find((element) => element.type === "image");
        if (image) {
          coverImage = image as ImageElement;
          break;
        }
      }
    }
    if (coverImage?.src) {
      logger.info(`Using "${coverImage.src}" as the cover image.`);
      elements.push(
        `      <div data-book="coverImage" lang="*">${escapeHtml(coverImage.src)}</div>`,
      );
    } else {
      logger.warn("No cover image found anywhere in the book.");
    }

    // hack for now
    const inputFieldNameToOutputName = {
      originalAcknowledgements: "originalAcknowledgments", // in case the version with the "e" gets in there
      credits: "originalAcknowledgments", // note, no extra "e"
      isbn: "ISBN",
      publisher: "originalAcknowledgments", // TODO
      author: "originalAcknowledgments", // TODO
      illustrator: "originalAcknowledgments", // TODO
    };

    // Group fields by their output field name and concatenate values
    const fields = this.fields(book);
    fixIsbn(fields);
    const groupedFields: Record<string, Record<string, string[]>> = {};

    for (const element of fields) {
      // Ensure we have a valid field name
      if (!element.field) {
        continue;
      }

      // Use the mapping to rename the field if it exists, otherwise use the original field name
      const outputFieldName =
        inputFieldNameToOutputName[element.field as keyof typeof inputFieldNameToOutputName] ||
        element.field;

      // only log if the outputFieldName is different from the input field name
      if (outputFieldName !== element.field) logger.info(`${element.field} -> ${outputFieldName}`);

      // Initialize the output field if it doesn't exist
      if (!groupedFields[outputFieldName]) {
        groupedFields[outputFieldName] = {};
      }

      // For each language in this field, add the value to the array
      for (const [lang, value] of Object.entries(element.content)) {
        if (!groupedFields[outputFieldName][lang]) {
          groupedFields[outputFieldName][lang] = [];
        }
        const htmlValue = inlineMarkdownToHtml(value);
        if (htmlValue.trim()) {
          // Only add non-empty values
          groupedFields[outputFieldName][lang].push(htmlValue);
        }
      }
    }

    // Generate div elements for each grouped field
    for (const [outputFieldName, langValues] of Object.entries(groupedFields)) {
      for (const [lang, valueArray] of Object.entries(langValues)) {
        if (valueArray.length > 0) {
          const concatenatedValue = valueArray.join("<br>");
          elements.push(
            `      <div data-book="${outputFieldName}" lang="${lang}">${concatenatedValue}</div>`,
          );
        }
      }
    }

    elements.push("    </div>");
    return elements.join("\n");
  }

  private static getFieldContent(key: string, book: Book): Record<string, string> | undefined {
    const fields: TextBlockElement[] = this.fields(book);
    const field = fields.find((field) => field.field === key);
    if (!field) {
      logger.warn(`Field "${key}" not found in book metadata.`);
      return undefined;
    }
    return field.content;
  }
  private static stripMarkdownHeading(markdown: string): string {
    // Remove markdown headings (e.g., # Heading, ## Subheading)
    return markdown.replace(/^\s*#+\s+/, "").trim();
  }
  private static fields(book: Book): TextBlockElement[] {
    const fields: Record<string, Record<string, string>>[] = [];
    for (const page of book.pages) {
      for (const element of page.elements) {
        if (element.type === "text" && element.field && element.field !== "pageNumber") {
          const textElement = element as TextBlockElement;
          const fieldName = textElement.field;
          // If the field already exists, merge the content
          const existingField = fields.find((f) => Object.keys(f)[0] === fieldName);

          // Process content to strip markdown headings
          const processedContent: Record<string, string> = {};
          for (const [lang, content] of Object.entries(textElement.content)) {
            processedContent[lang] = this.stripMarkdownHeading(content);
          }

          if (existingField) {
            // Merge the content for each language
            for (const [lang, content] of Object.entries(processedContent)) {
              const fieldKey = fieldName as keyof typeof existingField;
              if (!existingField[fieldKey]) {
                existingField[fieldKey] = {};
              }
              existingField[fieldKey][lang] = content;
            }
          } else {
            // Create a new field entry
            fields.push({
              [fieldName as string]: processedContent,
            });
          }
        }
      }
    }

    // use getUrlFromLicense and getLicenseFromUrl to fill in license or licenseUrl if we have one and not the other
    // use the first language found in the existing fields for the lookup
    const licenseField = fields.find((f) => Object.keys(f)[0] === "license");
    const licenseUrlField = fields.find((f) => Object.keys(f)[0] === "licenseUrl");
    if (licenseField && !licenseUrlField) {
      // We have a license but no licenseUrl, so we need to generate the licenseUrl
      const firstLang = Object.keys(licenseField["license"])[0];
      const licenseValue = licenseField["license"][firstLang];
      const licenseUrl = getUrlFromLicense(licenseValue);
      fields.push({
        licenseUrl: { [firstLang]: licenseUrl },
      });
      logger.info(`Generated licenseUrl from license: ${licenseValue} -> ${licenseUrl}`);
    } else if (!licenseField && licenseUrlField) {
      // We have a licenseUrl but no license, so we need to generate the license
      const firstLang = Object.keys(licenseUrlField["licenseUrl"])[0];
      const licenseUrlValue = licenseUrlField["licenseUrl"][firstLang];
      const licenseValue = getUrlFromLicense(licenseUrlValue);
      fields.push({
        license: { [firstLang]: licenseValue },
      });
      logger.info(`Generated license from licenseUrl: ${licenseUrlValue} -> ${licenseValue}`);
    }
    //console.log("Fields generated:", JSON.stringify(fields, null, 2));

    // now we want to actually output a single object with an element for each field
    // where the key is the field name and the value is an object with language keys
    const result: TextBlockElement[] = [];
    for (const field of fields) {
      const fieldName = Object.keys(field)[0];
      const content = field[fieldName];
      result.push({
        type: "text",
        field: fieldName,
        content: content,
      });
    }
    return result;
  }

  /**
   * Emit a full-bleed custom-layout cover page (front or back).
   *
   * Bloom regenerates xMatter, so a plain `data-book="coverImage"` produces its
   * default cover (small positioned image + title + credits). To get a true
   * edge-to-edge cover we instead emit a `bloom-customLayout` xMatter page whose
   * `.marginBox` holds the image as a `bloom-backgroundImage` canvas element.
   *
   * On import Bloom saves this marginBox into the dataDiv under the page's
   * `data-custom-layout-id` (`customOutsideFrontCover`/`customOutsideBackCover`),
   * then restores it over the regenerated xMatter cover and re-applies
   * `bloom-customLayout` — preserving our full-page art. (See Bloom's
   * BookData.cs / XMatterHelper.cs custom-layout round-trip.)
   */
  private static generateFullPageCoverPage(kind: "front" | "back", imageSrc: string): string {
    const pageId = randomUUID();
    const isFront = kind === "front";
    const pageClasses = isFront
      ? "bloom-page cover coverColor bloom-frontMatter frontCover outsideFrontCover A5Portrait bloom-customLayout"
      : "bloom-page cover coverColor bloom-backMatter outsideBackCover A5Portrait bloom-customLayout";
    const dataExport = isFront ? "front-matter-cover" : "back-matter-back-cover";
    const xmatterPage = isFront ? "frontCover" : "outsideBackCover";
    const customLayoutId = isFront ? "customOutsideFrontCover" : "customOutsideBackCover";
    // The front cover's image is also the book's coverImage; the back cover image
    // is not a standard data-book field, so it is only the background here.
    const dataBookAttr = isFront ? ' data-book="coverImage"' : "";

    // `bloom-imageObjectFit-cover` makes the art fill the page (cropping bleed)
    // rather than letterboxing. The data-bubble marks this as a canvas element so
    // Bloom's canvas tooling recognizes it.
    const dataBubble =
      "{`version`:`1.0`,`style`:`none`,`tails`:[],`level`:1,`backgroundColors`:[`transparent`],`shadowOffset`:0}";

    return `    <div class="${pageClasses}" data-page="required singleton" data-export="${dataExport}" data-xmatter-page="${xmatterPage}" data-custom-layout-id="${customLayoutId}" id="${pageId}">
      <div class="marginBox">
        <div class="bloom-canvas bloom-has-canvas-element bloom-imageObjectFit-cover">
          <div class="bloom-canvas-element bloom-backgroundImage" style="width:100%;height:100%;left:0;top:0;" data-bubble="${dataBubble}">
            <div class="bloom-imageContainer">
              <img src="${escapeHtml(imageSrc)}" class="bloom-imageObjectFit-cover" alt=""${dataBookAttr} />
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }

  private static generatePage(page: Page, metadata: FrontMatterMetadata): string {
    // A page whose art is a whole-page render (see 1-ocr/prepareCovers.ts) becomes
    // a full-bleed custom-layout cover: the image fills the page as a background
    // and all other elements (title, credits, etc.) are dropped, since the
    // rendered image already contains them.
    const coverImage = page.elements.find(
      (element): element is ImageElement =>
        element.type === "image" &&
        (element.src === FRONT_COVER_IMAGE_FILENAME || element.src === BACK_COVER_IMAGE_FILENAME),
    );
    if (coverImage) {
      return this.generateFullPageCoverPage(
        coverImage.src === FRONT_COVER_IMAGE_FILENAME ? "front" : "back",
        coverImage.src,
      );
    }

    const origamiItems: OrigamiItem[] = [];

    // Determine if the page structure matches a [Text, Image, Text] sequence
    // This is relevant for assigning "V" and "N1" for bilingual T-I-T pages.
    const isTITSequence =
      page.elements.length === 3 &&
      page.elements[0].type === "text" &&
      page.elements[1].type === "image" &&
      page.elements[2].type === "text";

    page.elements.forEach((element: PageElement, index: number) => {
      // Skip page number elements
      if (element.type === "text" && (element as TextBlockElement).field === "pageNumber") {
        return;
      }

      if (element.type === "text") {
        const textElement = element as TextBlockElement;
        const textItem: TextOrigamiItem = {
          type: "text",
          content: textElement.content,
        };

        // Condition for a page that is solely L2 text
        if (
          page.elements.length === 1 && // Only one element on the page
          metadata.l2 &&
          Object.keys(textElement.content).length === 1 && // Text element has content for only one language
          textElement.content[metadata.l2] // And that language is L2
        ) {
          textItem.translationGroupDefaultLangVariables = ["N1"];
        }
        // Condition for bilingual Text-Image-Text pages
        else if (page.appearsToBeBilingualPage && isTITSequence) {
          if (index === 0) {
            // First text element in T-I-T
            textItem.translationGroupDefaultLangVariables = ["V"];
          } else if (index === 2) {
            // Second text element in T-I-T (at element index 2)
            textItem.translationGroupDefaultLangVariables = ["N1"];
          }
        }
        origamiItems.push(textItem);
      } else if (element.type === "image") {
        const imageElement = element as ImageElement;
        origamiItems.push({ type: "image", src: imageElement.src });
      }
    });

    // If, after processing, no origami items were created (e.g., page.elements was empty),
    // default to a single empty text block.
    if (origamiItems.length === 0) {
      origamiItems.push({ type: "text", content: {} });
    }

    // All current Bloom top-level page layouts are vertical stacks,
    // which means the splits are horizontal.
    // In origami.ts, Orientation.Portrait leads to horizontal splits.
    const orientation = Orientation.Portrait;
    const origamiContent = generateOrigamiHtml(origamiItems, orientation);

    // to 'bloom-page' div based on page properties (e.g., page.type) if available/needed.
    // For now, 'customPage' is used as a general class.
    // The `page.type` property could be used here.
    let pageClasses = "bloom-page customPage";

    // TODO: think about this... it appears that Bloom is deleting these. Ultimately
    // we do want to get rid of them because Bloom regenerates them based on its
    // metadata, but at the moment we also might be losing some information.
    if (page.type === "front-matter") {
      pageClasses += " bloom-frontMatter";
    } else if (page.type === "back-matter") {
      pageClasses += " bloom-backMatter";
    }
    // Consider adding 'numberedPage' if it's a content page, etc.

    // Every .bloom-page must have a unique, non-empty id (required by Bloom and
    // its validator). Bloom uses GUIDs; generate one per page.
    const pageId = randomUUID();

    return `    <div class="${pageClasses.trim()}" id="${pageId}">
      <div class="marginBox">
        ${origamiContent}
      </div>
    </div>`;
  }
}
function fixIsbn(fields: TextBlockElement[]) {
  // if there is a field with "isbn" or "ISBn", do two things:
  // 1. make the language "*"
  // 2. Strip off any content before the first digit. e.g. "ISBN (Shell Book): 9980-0-0905-5" --> "9980-0-0905-5"

  fields.forEach((field) => {
    if (field.field && field.field.toLowerCase() === "isbn") {
      // Get all the content values from different languages
      const contentValues = Object.values(field.content);

      if (contentValues.length > 0) {
        // Take the first available content value
        let isbnValue = contentValues[0];

        // Strip off any content before the first digit
        const match = isbnValue.match(/(\d.*)/);
        if (match) {
          isbnValue = match[1];
        }

        // Replace the content with language "*"
        field.content = { "*": isbnValue };

        logger.info(
          `Fixed ISBN field: changed language to "*" and cleaned value to "${isbnValue}"`,
        );
      }
    }
  });
}
