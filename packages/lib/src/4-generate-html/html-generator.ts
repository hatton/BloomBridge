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
    ${this.generateUserModifiedStyles(book)}
    </head>
    <body>
    ${this.generateBloomDataDiv(book)}
    ${book.pages
      .filter((page) => this.shouldRenderPage(page))
      .map((page) => this.generatePage(page, book.frontMatterMetadata))
      .join("\n")}
    </body>
  </html>`;
  }

  /**
   * Emit Bloom's `userModifiedStyles` block defining the "normal" style (the body
   * text style) from the font size/family detected in the source PDF
   * (see 1-ocr/detectNormalStyle.ts). Bloom stores body styling here and applies
   * it to `.normal-style` editables. The font-family is set per-language on the
   * primary language; size applies to all. Bloom tolerates a family it doesn't
   * have installed (it falls back), so we emit the detected name regardless.
   */
  private static generateUserModifiedStyles(book: Book): string {
    const size = book.frontMatterMetadata.normalFontSizePt;
    const family = book.frontMatterMetadata.normalFontFamily;
    if (!size && !family) return "";

    const rules: string[] = [];
    if (size) {
      rules.push(`.normal-style { font-size: ${size}pt !important; }`);
    }
    if (size || family) {
      const decls = [
        size ? `font-size: ${size}pt !important;` : "",
        family ? `font-family: ${escapeHtml(family)} !important;` : "",
      ]
        .filter(Boolean)
        .join(" ");
      rules.push(`.normal-style[lang="${book.frontMatterMetadata.l1}"] { ${decls} }`);
    }

    return `<style type="text/css" title="userModifiedStyles">
    /*<![CDATA[*/
    ${rules.join("\n    ")}
    /*]]>*/
    </style>`;
  }

  /**
   * Front-matter and back-matter pages (title, credits, copyright, etc.) are NOT
   * rendered as pages: their content has already been collected into the dataDiv
   * metadata, and Bloom regenerates those xMatter pages from it at runtime
   * (rendering them here would insert duplicate title/credits pages). The one
   * exception is a cover page, whose full-bleed custom layout we do emit.
   */
  private static shouldRenderPage(page: Page): boolean {
    const isCover = page.elements.some(
      (element): element is ImageElement =>
        element.type === "image" &&
        (element.src === FRONT_COVER_IMAGE_FILENAME || element.src === BACK_COVER_IMAGE_FILENAME),
    );
    if (isCover) return true;
    return page.type !== "front-matter" && page.type !== "back-matter";
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

    // Full-bleed custom-layout covers: Bloom regenerates the xMatter cover pages
    // from these dataDiv entries (the obsolete data-book="coverImage" no longer
    // drives the cover). Emit them whenever a cover page was captured as full-page
    // art (see 1-ocr/prepareCovers.ts, which injects cover.jpg / back-cover.jpg).
    const findCoverSrc = (filename: string): string | undefined => {
      for (const page of book.pages) {
        const img = page.elements.find(
          (el): el is ImageElement => el.type === "image" && el.src === filename,
        );
        if (img) return img.src;
      }
      return undefined;
    };
    const frontCoverSrc = findCoverSrc(FRONT_COVER_IMAGE_FILENAME);
    const backCoverSrc = findCoverSrc(BACK_COVER_IMAGE_FILENAME);
    const coverPageSize = book.frontMatterMetadata.pageSize || "A5Portrait";
    if (frontCoverSrc) {
      elements.push(
        `      <div data-book="customOutsideFrontCover" lang="*">${this.coverCanvasHtml(frontCoverSrc, true, coverPageSize)}</div>`,
      );
    }
    if (backCoverSrc) {
      elements.push(
        `      <div data-book="customOutsideBackCover" lang="*">${this.coverCanvasHtml(backCoverSrc, false, coverPageSize)}</div>`,
      );
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
    fixCopyright(fields);
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
  // Bloom's data-bubble marker for a background-image canvas element.
  private static readonly COVER_DATA_BUBBLE =
    "{`version`:`1.0`,`style`:`none`,`tails`:[],`level`:1,`backgroundColors`:[`transparent`],`shadowOffset`:0}";

  /**
   * Pixel dimensions (at Bloom's 96dpi) for a page-size class, plus the marginBox
   * (content) area after Bloom's default 12mm page margin. Used to precompute the
   * bloom-canvas-element geometry so images show at the right size before Bloom
   * recomputes it on first view. Falls back to A5 for unknown sizes.
   */
  private static pagePx(pageSize: string): {
    pageW: number;
    pageH: number;
    canvasW: number;
    canvasH: number;
  } {
    const MM_TO_PX = 96 / 25.4;
    const MARGIN_PX = 12 * MM_TO_PX; // --page-margin: 12mm
    const dimsMm: Record<string, [number, number]> = {
      // [short edge, long edge] in mm
      A3: [297, 420],
      A4: [210, 297],
      A5: [148, 210],
      A6: [105, 148],
      Letter: [215.9, 279.4],
      Legal: [215.9, 355.6],
    };
    const base = pageSize.replace(/(Portrait|Landscape)$/, "");
    const landscape = pageSize.endsWith("Landscape");
    const [shortMm, longMm] = dimsMm[base] ?? dimsMm["A5"];
    const wMm = landscape ? longMm : shortMm;
    const hMm = landscape ? shortMm : longMm;
    const pageW = Math.round(wMm * MM_TO_PX);
    const pageH = Math.round(hMm * MM_TO_PX);
    return {
      pageW,
      pageH,
      canvasW: Math.round(pageW - 2 * MARGIN_PX),
      canvasH: Math.round(pageH - 2 * MARGIN_PX),
    };
  }

  /**
   * The inner canvas markup for a full-bleed cover image. This same markup goes
   * both into the visible cover page's `.marginBox` AND the dataDiv
   * `customOutside*Cover` entry that Bloom reads to (re)generate the xMatter cover.
   * It mirrors what Bloom itself writes so the custom layout round-trips on import.
   *
   * The px sizing fills the whole page (full bleed) for the given page size; Bloom
   * recomputes it when the book is edited. `bloom-imageObjectFit-cover` on the img
   * makes the art fill the page (cropping bleed) rather than letterboxing.
   */
  private static coverCanvasHtml(
    imageSrc: string,
    isFront: boolean,
    pageSize: string = "A5Portrait",
  ): string {
    // The front cover image doubles as the book's coverImage, but that data-book
    // binding is INACTIVE — the custom layout drives the cover now (a plain
    // data-book="coverImage" produces Bloom's small positioned default cover).
    const inactiveCoverImage = isFront ? ' data-book-inactive="coverImage"' : "";
    const { pageW, pageH } = this.pagePx(pageSize);
    return `<div class="bloom-canvas bloom-has-canvas-element" data-imgsizebasedon="${pageW},${pageH}" title="">
          <div class="bloom-canvas-element bloom-backgroundImage" style="width: ${pageW}px; top: 0px; left: 0px; height: ${pageH}px;" data-bubble="${this.COVER_DATA_BUBBLE}">
            <div class="bloom-imageContainer" style="direction: ltr;">
              <img src="${escapeHtml(imageSrc)}" class="bloom-imageObjectFit-cover" data-copyright="" data-creator="" data-license="" onerror="this.classList.add('bloom-imageLoadError')" alt=""${inactiveCoverImage} />
            </div>
          </div>
        </div>`;
  }

  private static generateFullPageCoverPage(
    kind: "front" | "back",
    imageSrc: string,
    pageSize: string = "A5Portrait",
  ): string {
    const pageId = randomUUID();
    const isFront = kind === "front";
    const pageClasses = isFront
      ? `bloom-page cover coverColor bloom-frontMatter frontCover outsideFrontCover bloom-customLayout ${pageSize}`
      : `bloom-page cover coverColor outsideBackCover bloom-backMatter bloom-customLayout ${pageSize}`;
    const dataExport = isFront ? "front-matter-cover" : "back-matter-back-cover";
    const xmatterPage = isFront ? "frontCover" : "outsideBackCover";
    const customLayoutId = isFront ? "customOutsideFrontCover" : "customOutsideBackCover";
    const label = isFront ? "Front Cover" : "Outside Back Cover";
    const i18n = isFront
      ? "TemplateBooks.PageLabel.Front Cover"
      : "TemplateBooks.PageLabel.Outside Back Cover";

    return `    <div class="${pageClasses}" data-page="required singleton" data-export="${dataExport}" data-xmatter-page="${xmatterPage}" data-custom-layout-id="${customLayoutId}" id="${pageId}">
      <div class="pageLabel" data-i18n="${i18n}">${label}</div>
      <div class="pageDescription"></div>
      <div class="marginBox">
        ${this.coverCanvasHtml(imageSrc, isFront, pageSize)}
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
        metadata.pageSize || "A5Portrait",
      );
    }

    const origamiItems: OrigamiItem[] = [];

    // Build the list of elements that actually contribute to the layout. We drop:
    //  - page-number text blocks (Bloom renders these in its xMatter, not here), and
    //  - EMPTY text blocks. The LLM enrichment adds a `<!-- text -->` comment under
    //    every page, so an image-only page ends up carrying an empty text element.
    //    If we kept it, the page would render as an origami split — image on top and
    //    a blank translationGroup below. Dropping it lets the image stand alone.
    const isPageNumber = (element: PageElement): boolean =>
      element.type === "text" && (element as TextBlockElement).field === "pageNumber";
    const isEmptyText = (element: PageElement): boolean =>
      element.type === "text" &&
      !Object.values((element as TextBlockElement).content).some((v) => v && v.trim() !== "");

    const layoutElements = page.elements.filter(
      (element) => !isPageNumber(element) && !isEmptyText(element),
    );

    // Determine if the page structure matches a [Text, Image, Text] sequence
    // This is relevant for assigning "V" and "N1" for bilingual T-I-T pages.
    const isTITSequence =
      layoutElements.length === 3 &&
      layoutElements[0].type === "text" &&
      layoutElements[1].type === "image" &&
      layoutElements[2].type === "text";

    layoutElements.forEach((element: PageElement, index: number) => {
      if (element.type === "text") {
        const textElement = element as TextBlockElement;
        const textItem: TextOrigamiItem = {
          type: "text",
          content: textElement.content,
          // Layout hints detected for the whole page apply to its text block(s).
          verticalAlign: page.verticalAlign,
          horizontalAlign: page.horizontalAlign,
        };

        // Condition for a page that is solely L2 text
        if (
          layoutElements.length === 1 && // Only one element on the page
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
        // For a page that is a single full-page image, size its canvas element to
        // the marginBox (page minus margins) so it shows at full size before Bloom
        // recomputes geometry on first view. object-fit:contain (Bloom's default for
        // a non-cover canvas) keeps the whole image visible. We only do this for
        // single-image pages; in multi-pane layouts the pane size isn't the marginBox.
        const isSingleFullPageImage =
          layoutElements.length === 1 && layoutElements[0].type === "image";
        let canvasElementStyle: string | undefined;
        if (isSingleFullPageImage) {
          const { canvasW, canvasH } = HtmlGenerator.pagePx(metadata.pageSize || "A5Portrait");
          canvasElementStyle = `width: ${canvasW}px; height: ${canvasH}px; left: 0px; top: 0px;`;
        }
        origamiItems.push({ type: "image", src: imageElement.src, canvasElementStyle });
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
    // The page-size class (e.g. A4Portrait) matches the source PDF; Bloom keys the
    // book's paper size off this class. Defaults to A5Portrait.
    let pageClasses = `bloom-page customPage ${metadata.pageSize || "A5Portrait"}`;

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

    // A page background color detected by vision formatting is set via Bloom's
    // `--page-background-color` custom property (consumed by basePage.css). A plain
    // `background-color` inline style does NOT survive Bloom's import — it strips it.
    const pageStyleAttr = page.backgroundColor
      ? ` style="--page-background-color: ${page.backgroundColor}"`
      : "";

    return `    <div class="${pageClasses.trim()}" id="${pageId}"${pageStyleAttr}>
      <div class="marginBox">
        ${origamiContent}
      </div>
    </div>`;
  }
}
function fixCopyright(fields: TextBlockElement[]) {
  // When the copyright was derived from a publisher line, it can arrive as
  // "Published by Library For All Ltd". The copyright holder is just the
  // organization, so strip a leading "Published by" (and any trailing punctuation).
  fields.forEach((field) => {
    if (field.field && field.field.toLowerCase() === "copyright") {
      for (const lang of Object.keys(field.content)) {
        field.content[lang] = field.content[lang].replace(/^\s*published\s+by\s*:?\s*/i, "").trim();
      }
    }
  });
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
