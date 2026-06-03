// Re-export all functions from their individual modules
export {
  pdfToMarkdownAndImageFiles,
  pdfToMarkdownAndImageFiles as makeMarkdownFromPDF,
} from "./1-ocr/pdfToMarkdownAndImageFiles-Mistral";
export { pdfToMarkdownAndImageFiles as pdfToMarkdownWithOpenRouter } from "./1-ocr/unused-pdfToMarkdownAndImageFiles-OpenRouter";
export { pdfToMarkdown } from "./1-ocr/pdfToMarkdown";
export { pdfToMarkdownWithUnpdf } from "./1-ocr/pdfToMarkdownWithUnpdf";
export { extractImagesWithPdfImages, extractAndSaveImagesWithPdfImages } from "./1-ocr/pdfToImages";
export type { PdfImage } from "./1-ocr/pdfToImages";
export { prepareCovers } from "./1-ocr/prepareCovers";
export type { CoverMode } from "./1-ocr/prepareCovers";
export { renderPdfPageToImage } from "./1-ocr/renderPdfPage";
export { getPdfPageInfo, isFullPageArtPage, getLargestImageCoverage } from "./1-ocr/coverDetection";
export { llmMarkdown } from "./2-llm/llmMarkdown";
export { attemptCleanup } from "./2-llm/post-llm-cleanup";
export { addBloomPlanToMarkdown } from "./3-add-bloom-plan/addBloomPlan";

// Export additional types and classes for advanced usage
export { BloomMarkdown as Parser } from "./bloom-markdown/parseMarkdown";
export { BloomMetadataParser } from "./3-add-bloom-plan/bloomMetadata";

export { HtmlGenerator } from "./4-generate-html/html-generator";
export { buildBookMetaData, writeMetaJson } from "./4-generate-html/metaJson";
export type { BookMetaData } from "./4-generate-html/metaJson";

export { notifyBloomOfBook } from "./5-notify-bloom/notifyBloom";
export type { NotifyBloomResult } from "./5-notify-bloom/notifyBloom";

export {
  findMasterBookFolder,
  loadMasterPages,
  readMasterHashes,
  applyMasterPages,
} from "./master/masterPages";
export type { MasterPage } from "./master/masterPages";
export { hashPageImage } from "./1-ocr/pageImageHash";
export type { PageHashMode } from "./1-ocr/pageImageHash";
export type {
  Book,
  Page as PageContent,
  PageElement,
  TextBlockElement,
  ImageElement,
  ValidationError,
  ConversionStats,
  VerticalAlign,
  HorizontalAlign,
} from "./types";

export { addVisionFormatting } from "./1-ocr/visionFormatting";
export type { VisionFormattingOptions } from "./1-ocr/visionFormatting";
export { detectNormalStyle } from "./1-ocr/detectNormalStyle";
export type { NormalStyle } from "./1-ocr/detectNormalStyle";
export { detectCanvasPages } from "./1-ocr/detectCanvasPages";
export type { TextBoxFraction, CanvasPageInfo } from "./1-ocr/detectCanvasPages";
export { detectSolidBackgroundColor } from "./1-ocr/detectBackgroundColor";

// Export logger utilities for callers to access log messages
export { logger } from "./logger";

//export Language type
export type { Language } from "./types";
