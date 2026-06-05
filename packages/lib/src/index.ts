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
export { validateBloomHtml } from "./4-generate-html/validateBloomHtml";
export {
  buildBookMetaData,
  writeMetaJson,
  writeAppearanceJson,
  hasFullPageFrontCover,
} from "./4-generate-html/metaJson";
export type { BookMetaData } from "./4-generate-html/metaJson";
export {
  writeImageMetadata,
  collectImageIntellectualProperty,
} from "./4-generate-html/imageMetadata";

export {
  notifyBloomOfBook,
  getRunningBloomCollection,
  bringBloomToFront,
  reloadBloomCollection,
  selectBookInBloom,
  processBookInBloom,
} from "./5-notify-bloom/notifyBloom";
export type { NotifyBloomResult } from "./5-notify-bloom/notifyBloom";

export {
  findMasterBookFolder,
  loadMasterPages,
  readMasterHashes,
  applyMasterPages,
} from "./master/masterPages";
export type { MasterPage } from "./master/masterPages";
export {
  hashPageImage,
  hashesMatch,
  hashDistance,
  PERCEPTUAL_MATCH_MAX_DISTANCE,
  DEFAULT_HASH_MODE,
} from "./1-ocr/pageImageHash";
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
export { logger, withRunContext } from "./logger";
export type { LogEntry, LogLevel, ConversionEvent, StageName } from "./logger";

// In-process conversion orchestration (shared by the CLI and the GUI server)
export { planConversion, runConversion, Artifact, artifactNames } from "./run/runConversion";
export type { RunArgs, RunPlan, RunResult, RunHooks } from "./run/runConversion";

// Options manifest — single source of truth for parameters + defaults (CLI, server, GUI)
export { optionsSchema, defaultParams } from "./options/optionsSchema";
export type { OptionSpec, OptionType } from "./options/optionsSchema";

// Artifact detection — which pipeline outputs exist in a folder, and where a run can start
export { detectArtifacts, startableStages } from "./artifacts";
export type { ArtifactSet } from "./artifacts";

// Collection + folder discovery (shared by CLI and server)
export {
  getMostRecentBloomCollection,
  validateAndResolveCollectionPath,
  readBloomCollectionSettingsIfFound,
  scanPdfFolder,
} from "./collections/collections";
export type { ScannedPdf } from "./collections/collections";

//export Language type
export type { Language } from "./types";
