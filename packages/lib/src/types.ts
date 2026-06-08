import { FrontMatterMetadata } from "./3-add-bloom-plan/bloomMetadata";

/**
 * Reserved filenames for whole-page renders of full-bleed covers (see
 * `1-ocr/prepareCovers.ts`). These names are the signal that links the OCR stage
 * (which renders + injects the image) to the HTML stage (which emits a custom
 * full-page cover when it sees an image with one of these srcs on a cover page).
 */
export const FRONT_COVER_IMAGE_FILENAME = "cover.jpg";
export const BACK_COVER_IMAGE_FILENAME = "back-cover.jpg";

export interface ImageElement {
  type: "image";
  src: string;
  alt?: string; // Alt text from ![alt](src)
  attributes?: string; // Attributes like {width=993}
}

/*     l1: "bo" # the primary language
    l2: "en" # often a major language used for metadata, but may also be used in bilingual pages
    isbn: "968-31-0276-X"
    license: "CC-BY-NC"
    licenseNotes: "Ask us before you translate this"
    copyright: "Copyright © 1993, Instituto Lingüístico de Verano, A.C."
    credits: "the authors, the illustrator"
    acknowledgements-original-version: "may thank funders, editors, etc."
    acknowledgements-localized-version: "often the translator"
    other-credits-on-cover: ""
    funding-info: "funded by a grant from the Foo dept of literacy"
    tags:
      topic: "Folktale"
    country: "Mexico"
    province: "Oaxaca"
    district: "Santa María Zacatepec"
    author: "Virginia López Lucas"
    illustrator: "Jose Foo"
    publisher: "Instituto de Grillo"
    originalPublisher:
*/

export interface TextBlockElement {
  type: "text";
  field?: string; // e.g., "title", "author", "credits", etc.
  // field?:
  //   | "l1"
  //   | "l2"
  //   | "isbn"
  //   | "license"
  //   | "licenseNotes"
  //   | "copyright"
  //   | "credits"
  //   | "acknowledgements-original-version"
  //   | "acknowledgements-localized-version"
  //   | "smallCoverCredits"
  //   | "funding"
  //   | "tags"
  //   | "country"
  //   | "province"
  //   | "district"
  //   | "author"
  //   | "illustrator"
  //   | "publisher"
  //   | "originalPublisher"
  //   | "title"
  //   | "coverImage";
  content: Record<string, string>; // lang -> text
}

export type PageElement = ImageElement | TextBlockElement;

/** Vertical position of the text block within the page, as seen in the source PDF. */
export type VerticalAlign = "top" | "center" | "bottom";
/** Horizontal alignment of the text within the text block. */
export type HorizontalAlign = "left" | "center" | "right";

/**
 * Position of a text block over a full-page background image, as a fraction of the
 * page (0..1, origin top-left). Set by canvas-page detection (1-ocr/detectCanvasPages.ts)
 * to drive a Bloom "Canvas" page where text floats on top of the image.
 */
export interface TextBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Page {
  appearsToBeBilingualPage?: boolean;
  elements: PageElement[];
  type: "front-matter" | "back-matter" | "content" | "empty";
  // Layout hints, optionally detected by the "vision-formatting" step (see
  // 1-ocr/visionFormatting.ts) and carried through the markdown page comment.
  verticalAlign?: VerticalAlign;
  horizontalAlign?: HorizontalAlign;
  backgroundColor?: string; // CSS color, e.g. "#fff3e0"
  // When set, this page is a full-page background image with one or more text
  // blocks floating on top (a Bloom "Canvas" page); each box is where one text
  // block sits over the image, in reading order (top to bottom).
  canvasTextBoxes?: TextBox[];
  // 1-based page number of the source PDF this page came from. Captured at OCR time
  // and preserved verbatim through the markdown round-trips (unlike the page-comment
  // `index`, which generateMarkdown re-numbers by array position). Emitted to the
  // generated HTML as `data-source-pdf-page` so the paired preview can align each
  // Bloom page with its source page even when blank/dropped pages create gaps.
  sourcePdfPage?: number;
  // Hash of the source PDF page's render (see 1-ocr/pageImageHash.ts). Carried in
  // the page comment so master-page substitution can recognize a page that
  // matches one in a "master" book.
  importSourceHash?: string;
  // True when this page matched a master book page and was skipped during OCR.
  // It renders as a minimal placeholder div that master-page substitution then
  // replaces with the master's exact HTML.
  isMasterPage?: boolean;
  // When set, the page was judged "too complex" to reconstruct faithfully and is
  // imported as a single full-page image instead (see Stage 1's complexity check
  // and the `--complex-becomes-image` option). The value is the rendered image's
  // filename; score/level record why, for the page's data-conversion-note.
  flattenAsImage?: string;
  flattenScore?: number;
  flattenLevel?: string;
  // When set, this content page is a single full-bleed illustration with no text — a
  // wordless picture-book page. Rendered as a background-only canvas page (no margins,
  // no page number), the same full-bleed treatment as a flattened page but without the
  // "too-complex" conversion note. Set by the EPUB front-end for fixed-layout books.
  fullPageImage?: boolean;
}

export interface Book {
  // most metadata is actually in the context of the markdown, but things that
  // the llm needs to figure out for us are in the front matter
  frontMatterMetadata: FrontMatterMetadata;

  pages: Page[];
}

export interface ConversionStats {
  pages: number;
  languages: string[];
  images: number;
  layouts: Record<string, number>;
}

export interface ValidationError {
  type: "error" | "warning";
  message: string;
  line?: number;
}
export type Language = {
  tag: string; // BCP-47 language tag, e.g., "en", "uz-CYRL"
  name: string;
};
