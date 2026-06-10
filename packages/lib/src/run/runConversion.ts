/**
 * In-process conversion orchestration — the stage-sequencing core, extracted
 * from the CLI so both the CLI and the GUI server drive the pipeline the same
 * way (no child process, no CLI dependency).
 *
 * `planConversion(args)` resolves input type, output paths, and the collection
 * used for language hints + master substitution. `runConversion(plan, hooks)`
 * runs the stages and returns a `RunResult` (it never calls `process.exit`).
 * Events flow through the singleton `logger`; wrap a call in `withRunContext`
 * (see logger.ts) to route a run's events to its own sink.
 */
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../logger";

import { pdfToMarkdownAndImageFiles as makeMarkdownFromPDF } from "../1-ocr/pdfToMarkdownAndImageFiles-Mistral";
import { pdfToMarkdown } from "../1-ocr/pdfToMarkdown";
import { epubToBloomMarkdown } from "../epub/epubToBloomMarkdown";
import { pdfToMarkdownWithUnpdf } from "../1-ocr/pdfToMarkdownWithUnpdf";
import {
  extractImagesWithPdfImages,
  extractAndSaveImagesWithPdfImages,
} from "../1-ocr/pdfToImages";
import { prepareCovers, type CoverMode } from "../1-ocr/prepareCovers";
import { addVisionFormatting } from "../1-ocr/visionFormatting";
import { detectNormalStyle } from "../1-ocr/detectNormalStyle";
import { detectCanvasPages, type CanvasPageInfo } from "../1-ocr/detectCanvasPages";
import { renderPdfPageToImage } from "../1-ocr/renderPdfPage";
import { getPdfPageInfo } from "../1-ocr/coverDetection";
import { trimWhitespaceInBookFolder } from "../1-ocr/trimImageWhitespace";
import { llmMarkdown } from "../2-llm/llmMarkdown";
import { attemptCleanup } from "../2-llm/post-llm-cleanup";
import { addBloomPlanToMarkdown } from "../3-add-bloom-plan/addBloomPlan";
import { BloomMarkdown as Parser } from "../bloom-markdown/parseMarkdown";
import { HtmlGenerator } from "../4-generate-html/html-generator";
import { writeMetaJson, writeAppearanceJson } from "../4-generate-html/metaJson";
import { writeImageMetadata } from "../4-generate-html/imageMetadata";
import { notifyBloomOfBook } from "../5-notify-bloom/notifyBloom";
import {
  findMasterBookFolder,
  loadMasterPages,
  readMasterHashes,
  isTemplateMasterPage,
  applyMasterPages,
  readMasterAppearance,
  applyMasterHeadStyles,
  applyMasterAcknowledgments,
  type MasterAppearance,
} from "../master/masterPages";
import {
  validateAndResolveCollectionPath,
  readBloomCollectionSettingsIfFound,
} from "../collections/collections";
import {
  loadStageFingerprints,
  optionKeysAffectingStage,
  type PipelineStage,
} from "./stageManifest";
import { writeStageProvenance, hashFileContents, hashOptionsSubset } from "./provenance";

export enum Artifact {
  // EPUB is an input type (like PDF) but its front-end produces the tagged
  // `.llm.md` directly (no OCR/LLM needed), so for ordering it sits before PDF.
  EPUB,
  PDF,
  Images,
  MarkdownFromOCR,
  MarkdownFromLLMRaw,
  MarkdownFromLLMCleaned,
  MarkdownReadyForBloom,
  HTML,
}

export const artifactNames: Record<Artifact, string> = {
  [Artifact.EPUB]: "EPUB",
  [Artifact.PDF]: "PDF",
  [Artifact.Images]: "Images",
  [Artifact.MarkdownFromOCR]: "Markdown from OCR",
  [Artifact.MarkdownFromLLMRaw]: "Raw Markdown from LLM",
  [Artifact.MarkdownFromLLMCleaned]: "Tagged Markdown from LLM",
  [Artifact.MarkdownReadyForBloom]: "Bloom-ready Markdown",
  [Artifact.HTML]: "Bloom HTML",
};

/** Resolved, key-bearing arguments for a single conversion. */
export interface RunArgs {
  input: string;
  output?: string;
  collection?: string;
  target: Artifact;
  verbose?: boolean;
  mistralKey?: string;
  openrouterKey?: string;
  promptPath?: string;
  modelName?: string;
  ocrMethod: string;
  parserEngine?: string;
  imager?: string;
  cover?: string;
  visionFormatting?: boolean;
  visionModelName?: string;
  emitSourceHashes?: boolean;
  complexBecomesImage?: string;
  trimWhitespace?: boolean;
  fitImagePanes?: boolean;
}

/** A fully-resolved plan: every path, key, and mode the stage loop needs. */
export interface RunPlan {
  epubPath?: string;
  pdfPath?: string;
  markdownFromOCRPath?: string;
  markdownFromLLMPath?: string;
  markdownCleanedAfterLLMPath?: string;
  markdownForBloomPath?: string;
  bookFolderPath?: string;
  collectionFolderPath?: string;
  inputArtifact: Artifact;
  targetArtifact: Artifact;
  verbose: boolean;
  mistralKey?: string;
  openrouterKey?: string;
  promptPath?: string;
  modelName?: string;
  ocrMethod: string;
  parserEngine: string;
  imager: string;
  coverMode: CoverMode;
  visionFormatting: boolean;
  visionModelName?: string;
  emitSourceHashes: boolean;
  masterFolderPath?: string;
  complexBecomesImage: string;
  trimWhitespace: boolean;
  fitImagePanes: boolean;
  /** Settings keyed by `optionsSchema` key, recorded in the provenance sidecar. */
  optionsRecord: Record<string, unknown>;
}

/**
 * The settings subset (keyed by `optionsSchema` key) that influences conversion
 * output, derived from the raw run arguments. Used both to record stage provenance
 * and, by `resolveStartStage`, to detect a settings change. `target`/`verbose` are
 * intentionally excluded — they don't affect any stage's output.
 *
 * The resolver and the provenance writer MUST derive this the same way, so callers
 * that want to resolve a start stage before running should use this helper too.
 */
export function runOptionsRecord(a: RunArgs): Record<string, unknown> {
  return {
    ocrMethod: a.ocrMethod ?? "gpt",
    model: a.modelName ?? "",
    visionFormatting: a.visionFormatting !== false,
    visionModel: a.visionModelName ?? "",
    coverMode: a.cover ?? "auto",
    complexBecomesImage: a.complexBecomesImage ?? "busy",
    prompt: a.promptPath ?? "",
    imager: a.imager ?? "poppler",
    parserEngine: a.parserEngine ?? "native",
    emitSourceHashes: a.emitSourceHashes ?? false,
    trimWhitespace: a.trimWhitespace ?? true,
    fitImagePanes: a.fitImagePanes !== false,
  };
}

/** Map the input artifact to the earliest pipeline stage runnable from it. */
export function inputArtifactToFloorStage(input: Artifact): PipelineStage {
  switch (input) {
    case Artifact.PDF:
    case Artifact.Images:
      return "ocr";
    case Artifact.MarkdownFromOCR:
    case Artifact.MarkdownFromLLMRaw:
      return "llm";
    // EPUB extraction produces the tagged `.llm.md`, so the first real pipeline
    // stage it feeds is the Bloom plan.
    case Artifact.EPUB:
    case Artifact.MarkdownFromLLMCleaned:
      return "plan";
    case Artifact.MarkdownReadyForBloom:
    case Artifact.HTML:
      return "html";
  }
}

/** Map a pipeline stage back to the input artifact that feeds it (its run floor). */
export function stageToInputArtifact(stage: PipelineStage): Artifact {
  switch (stage) {
    case "ocr":
      return Artifact.PDF;
    case "llm":
      return Artifact.MarkdownFromOCR;
    case "plan":
      return Artifact.MarkdownFromLLMCleaned;
    case "html":
      return Artifact.MarkdownReadyForBloom;
  }
}

export interface RunHooks {
  /** Informational id for the run (events are auto-tagged via withRunContext). */
  runId?: string;
  /** Checked at stage boundaries; if it returns true the run stops as "cancelled". */
  isCancelled?: () => boolean;
}

export interface RunResult {
  status: "completed" | "failed" | "cancelled";
  error?: string;
  finalArtifact: Artifact;
  bookFolderPath?: string;
}

function normalizeCoverMode(value?: string): CoverMode {
  switch ((value ?? "auto").toLowerCase()) {
    case "render":
      return "render";
    case "none":
      return "none";
    case "auto":
      return "auto";
    default:
      logger.warn(`Unknown --cover value '${value}', defaulting to 'auto'.`);
      return "auto";
  }
}

async function extractImages(pdfPath: string, outputDir: string, method: string): Promise<void> {
  if (method === "poppler") {
    logger.info("Using Poppler pdfimages for image extraction");
    await extractImagesWithPdfImages(pdfPath, outputDir);
  } else {
    if (method !== "pdfjs") {
      logger.warn(`Unknown imager method '${method}', defaulting to 'poppler'`);
    }
    logger.info("Using Poppler pdfimages for image extraction (PDF.js method removed)");
    await extractAndSaveImagesWithPdfImages(pdfPath, outputDir);
  }
}

/**
 * "Too busy to convert well" cutoff for `--complex-becomes-image busy`: a canvas
 * page is snapshotted when it has this many or more separate text blocks. This
 * single constant replaces the old `2/3/4/5` numeric granularity; tune after
 * testing on real books.
 */
const BUSY_THRESHOLD = 4;

/** True when every page should be snapshotted (the whole-book image path). */
function isFlattenAll(level: string): boolean {
  return level === "all" || level === "always";
}

/**
 * Map the `--complex-becomes-image` level to a per-canvas-page complexity-score
 * threshold (the score is the page's text-block count). `null` means "don't
 * flatten any canvas page here" — either we never flatten (`covers`) or every
 * page is handled by the flatten-all path (`all`). Legacy values (`off`, `0..5`,
 * `always`) are still accepted.
 */
function complexThreshold(level: string): number | null {
  switch (level) {
    case "covers":
    case "off":
    case "all":
    case "always":
      return null;
    case "busy":
      return BUSY_THRESHOLD;
    case "anyCanvas":
      return 1;
  }
  // Legacy numeric scale: "0" → 1, "1" → 2, … "5" → 6.
  const n = Number(level);
  if (!Number.isInteger(n) || n < 0 || n > 5) {
    logger.warn(`Unknown --complex-becomes-image value '${level}', treating as 'covers'.`);
    return null;
  }
  return n + 1;
}

async function flattenComplexPages(
  markdown: string,
  canvasPages: Map<number, CanvasPageInfo>,
  pdfPath: string,
  bookFolder: string,
  level: string,
): Promise<string> {
  const threshold = complexThreshold(level);
  if (threshold === null) return markdown;

  let out = markdown;
  for (const [pageNum, info] of canvasPages) {
    const score = info.textBoxes.length;
    if (score < threshold) continue;

    const existing = out.match(new RegExp(`<!--\\s*page\\s+index=${pageNum}\\b[^>]*-->`));
    if (existing && /master-page=/.test(existing[0])) continue;

    const file = `page-${pageNum}.jpg`;
    try {
      await renderPdfPageToImage(pdfPath, pageNum, path.join(bookFolder, file), { dpi: 200 });
    } catch (error) {
      logger.warn(`Could not render complex page ${pageNum} to an image: ${String(error)}`);
      continue;
    }
    const re = new RegExp(`(<!--\\s*page\\s+index=${pageNum}\\b)([^>]*?)(\\s*-->)`);
    out = out.replace(
      re,
      `$1$2 flatten-as-image="${file}" flatten-score="${score}" flatten-level="${level}"$3`,
    );
    logger.info(
      `Page ${pageNum}: too complex (score ${score} ≥ ${threshold}); importing as full-page image ${file}.`,
    );
  }
  return out;
}

/**
 * Pages to OCR in `--complex-becomes-image always` mode: the first 4 and last 2
 * (deduped and clamped to the page count). Every page becomes an image; we only
 * read these few for the book's metadata + language detection.
 */
function pagesForMetadata(pageCount: number): Set<number> {
  const pages = new Set<number>();
  for (let p = 1; p <= Math.min(4, pageCount); p++) pages.add(p);
  for (let p = Math.max(1, pageCount - 1); p <= pageCount; p++) pages.add(p);
  return pages;
}

/**
 * `--complex-becomes-image always`: render EVERY page to a full-page image and
 * mark every page comment `flatten-as-image`, so the whole book imports as page
 * pictures (no per-page text/layout reconstruction). Metadata + languages still
 * come from the handful of pages OCR'd via `pagesForMetadata`.
 */
async function flattenAllPages(
  markdown: string,
  pdfPath: string,
  bookFolder: string,
): Promise<string> {
  const { pageCount } = await getPdfPageInfo(pdfPath);
  let out = markdown;
  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const file = `page-${pageNum}.jpg`;
    try {
      await renderPdfPageToImage(pdfPath, pageNum, path.join(bookFolder, file), { dpi: 200 });
    } catch (error) {
      logger.warn(`Could not render page ${pageNum} to an image: ${String(error)}`);
      continue;
    }
    const re = new RegExp(`(<!--\\s*page\\s+index=${pageNum}\\b)([^>]*?)(\\s*-->)`);
    if (re.test(out)) {
      out = out.replace(re, `$1$2 flatten-as-image="${file}" flatten-level="always"$3`);
    } else {
      // No page marker from this OCR path — append one so the page still imports.
      out += `\n\n<!-- page index=${pageNum} flatten-as-image="${file}" flatten-level="always" -->\n_(page imported as image)_\n`;
    }
  }
  logger.info(`Flatten 'always': imported all ${pageCount} page(s) as full-page images.`);
  return out;
}

/**
 * Resolve input type, output paths, and the collection used for hints/master.
 * `--output` is the write location; `--collection` (if given) supplies language
 * hints + master search and may be combined with `--output`.
 */
export async function planConversion(args: RunArgs): Promise<RunPlan> {
  const fullInputPath = path.resolve(args.input);

  const regex = /^(.*?)(\.[^.]+)?(\.[^.]+)?$/;
  const match = fullInputPath.match(regex);
  if (!match) throw new Error(`Failed to parse input file path: ${fullInputPath}`);
  const [, , firstExt, secondExt] = match;
  const ext = [firstExt, secondExt].filter(Boolean).join("");

  let inputType: Artifact;
  switch (ext) {
    case ".epub":
      inputType = Artifact.EPUB;
      break;
    case ".pdf":
      inputType = Artifact.PDF;
      break;
    case ".md":
    case ".ocr.md":
      inputType = Artifact.MarkdownFromOCR;
      break;
    case ".raw-llm.md":
      inputType = Artifact.MarkdownFromLLMRaw;
      break;
    case ".llm.md":
      inputType = Artifact.MarkdownFromLLMCleaned;
      break;
    case ".bloom.md":
      inputType = Artifact.MarkdownReadyForBloom;
      break;
    default:
      throw new Error(
        `Unsupported input file type: ${ext}. Supported types: .epub, .pdf, .md, .ocr.md, .raw-llm.md, .llm.md, .bloom.md`,
      );
  }

  logger.info(`Input file: "${fullInputPath}" (Type: ${inputType})`);
  const targetType = args.target ?? Artifact.HTML;
  logger.info(`Target format: ${artifactNames[targetType]}`);

  const mistralKey = args.mistralKey;
  const openrouterKey = args.openrouterKey;

  if (inputType === Artifact.PDF && args.ocrMethod === "mistral" && !mistralKey) {
    throw new Error(
      "Mistral API key is required for --ocr mistral. Provide it, or use --ocr unpdf for local processing.",
    );
  }
  if (
    inputType === Artifact.PDF &&
    args.ocrMethod !== "mistral" &&
    args.ocrMethod !== "unpdf" &&
    !openrouterKey
  ) {
    throw new Error("OpenRouter API key is required for OpenRouter OCR models.");
  }

  let visionFormatting = args.visionFormatting !== false;
  if (visionFormatting && inputType !== Artifact.PDF) {
    logger.info(
      "Skipping vision-formatting: it only runs when the input is a PDF (results are cached in the .ocr.md).",
    );
    visionFormatting = false;
  }
  if (visionFormatting && !openrouterKey) {
    logger.warn(
      "Skipping vision-formatting: it needs an OpenRouter key (or pass --no-vision-formatting to silence this).",
    );
    visionFormatting = false;
  }
  if (visionFormatting && isFlattenAll(args.complexBecomesImage ?? "busy")) {
    logger.info(
      "Skipping vision-formatting: --complex-becomes-image all imports every page as an image, so per-page layout isn't needed.",
    );
    visionFormatting = false;
  }

  if (
    inputType !== Artifact.EPUB && // EPUB extraction produces tagged markdown directly — no LLM stage
    inputType < Artifact.MarkdownFromLLMCleaned &&
    targetType >= Artifact.MarkdownFromLLMCleaned &&
    !openrouterKey
  ) {
    throw new Error("OpenRouter API key is required for the LLM enrichment stage.");
  }

  // Resolve a collection (if given) for language hints + master search — this is
  // independent of where the book is written.
  let collectionFolderPath: string | undefined;
  let baseOutputDir: string;

  if (args.collection) {
    const { collectionFolderPath: resolved } = await validateAndResolveCollectionPath(
      args.collection,
    );
    collectionFolderPath = resolved;
    logger.info(`Using Bloom collection (language hints + master): ${collectionFolderPath}`);
  }

  if (args.output) {
    baseOutputDir = path.resolve(args.output);
  } else if (collectionFolderPath) {
    baseOutputDir = collectionFolderPath;
  } else {
    try {
      logger.info("No collection or output specified, using most recent Bloom collection");
      const { collectionFolderPath: resolved } = await validateAndResolveCollectionPath("recent");
      collectionFolderPath = resolved;
      baseOutputDir = collectionFolderPath;
    } catch (error) {
      logger.warn(
        `Could not find recent collection (${String(error)}), falling back to current directory`,
      );
      baseOutputDir =
        inputType === Artifact.PDF || inputType === Artifact.EPUB
          ? process.cwd()
          : path.dirname(fullInputPath);
    }
  }

  const baseName = path.parse(path.parse(fullInputPath).name).name;

  let bookDir: string;
  if (
    collectionFolderPath &&
    !args.output &&
    inputType !== Artifact.PDF &&
    inputType !== Artifact.EPUB &&
    fullInputPath.startsWith(collectionFolderPath)
  ) {
    bookDir = path.dirname(fullInputPath);
    logger.info(`Using existing book directory: ${bookDir}`);
  } else {
    bookDir = path.join(baseOutputDir, baseName);
    logger.info(`Creating book directory: ${bookDir}`);
    await fs.mkdir(bookDir, { recursive: true });
  }
  baseOutputDir = bookDir;

  const emitSourceHashes = args.emitSourceHashes ?? false;
  let masterFolderPath: string | undefined;
  const masterSearchDir =
    collectionFolderPath ?? (args.output ? path.resolve(args.output) : undefined);
  if (masterSearchDir && !emitSourceHashes) {
    masterFolderPath = await findMasterBookFolder(masterSearchDir, bookDir);
    if (masterFolderPath)
      logger.info(`Using master book for page substitution: ${masterFolderPath}`);
  }

  return {
    epubPath: inputType === Artifact.EPUB ? fullInputPath : undefined,
    pdfPath: inputType === Artifact.PDF ? fullInputPath : undefined,
    markdownFromOCRPath:
      inputType === Artifact.MarkdownFromOCR
        ? fullInputPath
        : path.join(baseOutputDir, baseName + ".ocr.md"),
    markdownFromLLMPath:
      inputType === Artifact.MarkdownFromLLMRaw
        ? fullInputPath
        : path.join(baseOutputDir, baseName + ".raw-llm.md"),
    markdownCleanedAfterLLMPath:
      inputType === Artifact.MarkdownFromLLMCleaned
        ? fullInputPath
        : path.join(baseOutputDir, baseName + ".llm.md"),
    markdownForBloomPath:
      inputType === Artifact.MarkdownReadyForBloom
        ? fullInputPath
        : path.join(baseOutputDir, baseName + ".bloom.md"),
    bookFolderPath: bookDir,
    collectionFolderPath,
    inputArtifact: inputType,
    targetArtifact: targetType,
    verbose: args.verbose ?? false,
    mistralKey,
    openrouterKey,
    promptPath: args.promptPath,
    modelName: args.modelName,
    ocrMethod: args.ocrMethod,
    parserEngine: args.parserEngine ?? "native",
    imager: args.imager ?? "poppler",
    coverMode: normalizeCoverMode(args.cover),
    visionFormatting,
    visionModelName: args.visionModelName,
    emitSourceHashes,
    masterFolderPath,
    complexBecomesImage: args.complexBecomesImage ?? "busy",
    trimWhitespace: args.trimWhitespace ?? true,
    fitImagePanes: args.fitImagePanes ?? true,
    optionsRecord: runOptionsRecord(args),
  };
}

/** Run the pipeline for a resolved plan. Never throws for conversion failures;
 *  returns a RunResult instead. Cancellation is honored between stages. */
export async function runConversion(plan: RunPlan, hooks?: RunHooks): Promise<RunResult> {
  const cancelled = () => !!hooks?.isCancelled?.();
  const fail = (error: unknown, finalArtifact: Artifact): RunResult => {
    const message = error instanceof Error ? error.message : String(error);
    logger.event({ kind: "error", message });
    logger.error("❌ Error during conversion:");
    logger.error(message);
    return { status: "failed", error: message, finalArtifact, bookFolderPath: plan.bookFolderPath };
  };

  const stageStarts: Record<string, number> = {};
  const startStage = (stage: any) => {
    stageStarts[stage] = Date.now();
    logger.event({ kind: "stage-start", stage });
  };
  const endStage = (stage: any) => {
    const ms = stageStarts[stage] ? Date.now() - stageStarts[stage] : undefined;
    logger.event({ kind: "stage-end", stage, durationMs: ms });
  };

  // Provenance: after a stage writes its artifact, stamp the sidecar with the code +
  // settings + consumed-input fingerprints that produced it, so a later run can skip
  // stages whose code and settings are unchanged. Best-effort, never fails the run.
  const fingerprints = await loadStageFingerprints();
  const provBaseName = plan.bookFolderPath ? path.basename(plan.bookFolderPath) : undefined;
  const recordStage = async (stage: PipelineStage, consumedPath?: string) => {
    if (!plan.bookFolderPath || !provBaseName) return;
    const keys = optionKeysAffectingStage(stage);
    const subset: Record<string, unknown> = {};
    for (const k of keys) subset[k] = plan.optionsRecord[k];
    await writeStageProvenance(plan.bookFolderPath, provBaseName, stage, {
      codeHash: fingerprints[stage] ?? "",
      optionsHash: hashOptionsSubset(subset),
      inputHash: await hashFileContents(consumedPath),
      options: subset,
      producedAt: new Date().toISOString(),
    });
  };

  let latestArtifact = plan.inputArtifact;

  try {
    logger.info(
      `Starting conversion from "${artifactNames[plan.inputArtifact]}" to "${artifactNames[plan.targetArtifact]}"`,
    );

    // EPUB front-end — extract directly to the tagged `.llm.md` (no OCR, no LLM).
    if (latestArtifact === Artifact.EPUB) {
      if (cancelled())
        return {
          status: "cancelled",
          finalArtifact: latestArtifact,
          bookFolderPath: plan.bookFolderPath,
        };
      logger.info(`-> Extracting EPUB...`);
      // Master-page reuse for EPUB: a page whose main image matches a master page is
      // substituted in Stage 4 (the EPUB flow has no OCR to skip, but the same hashes
      // drive the GUI picker and the substitution).
      let epubMasterHashes: Set<string> | undefined;
      let epubTemplateHashes: Set<string> | undefined;
      if (plan.masterFolderPath && !plan.emitSourceHashes) {
        // Hashes of all master pages, plus the subset that are fill-templates: a page
        // matching a template keeps its real content (so Stage 4 can pour it into the
        // template's slots), whereas a wholesale match collapses to a placeholder.
        const masterPages = await loadMasterPages(plan.masterFolderPath);
        epubMasterHashes = new Set(masterPages.keys());
        epubTemplateHashes = new Set(
          [...masterPages].filter(([, p]) => isTemplateMasterPage(p.html)).map(([h]) => h),
        );
      }
      const { markdown } = await epubToBloomMarkdown(plan.epubPath!, plan.bookFolderPath!, {
        masterHashes: epubMasterHashes,
        templateHashes: epubTemplateHashes,
      });
      if (plan.trimWhitespace) {
        logger.info(`-> Trimming whitespace from illustration edges...`);
        await trimWhitespaceInBookFolder(plan.bookFolderPath!);
      }
      logger.info(`Writing tagged markdown to: ${plan.markdownCleanedAfterLLMPath}`);
      await fs.writeFile(plan.markdownCleanedAfterLLMPath!, markdown);

      latestArtifact = Artifact.MarkdownFromLLMCleaned;
      // EPUB skips OCR/LLM; any target at or below tagged markdown is satisfied here.
      if (plan.targetArtifact <= Artifact.MarkdownFromLLMCleaned) {
        return {
          status: "completed",
          finalArtifact: latestArtifact,
          bookFolderPath: plan.bookFolderPath,
        };
      }
    }

    // Images-only target
    if (latestArtifact === Artifact.PDF && plan.targetArtifact === Artifact.Images) {
      logger.info(`-> Extracting images from PDF...`);
      await extractImages(plan.pdfPath!, plan.bookFolderPath!, plan.imager);
      return {
        status: "completed",
        finalArtifact: Artifact.Images,
        bookFolderPath: plan.bookFolderPath,
      };
    }

    // Stage 1 — PDF → .ocr.md
    if (latestArtifact === Artifact.PDF) {
      if (cancelled())
        return {
          status: "cancelled",
          finalArtifact: latestArtifact,
          bookFolderPath: plan.bookFolderPath,
        };
      logger.info(`-> Converting PDF to Markdown...`);
      startStage("ocr");

      // "all"-flatten: import every PDF page as a full-page image, doing only
      // enough OCR (a few pages) + LLM to recover the book's metadata/languages,
      // and skipping all per-page layout analysis (covers, vision, canvas).
      const flattenAll = isFlattenAll(plan.complexBecomesImage);

      let markdownContent: string;

      if (plan.ocrMethod === "unpdf") {
        logger.info(`Using unpdf for PDF processing (experimental)`);
        markdownContent = await pdfToMarkdownWithUnpdf(plan.pdfPath!, plan.bookFolderPath!);
      } else if (plan.ocrMethod === "mistral") {
        logger.info(`Using Mistral AI for PDF processing`);
        markdownContent = await makeMarkdownFromPDF(
          plan.pdfPath!,
          plan.bookFolderPath!,
          plan.mistralKey!,
        );
      } else {
        let customPrompt: string | undefined;
        if (plan.promptPath) {
          customPrompt = await fs.readFile(plan.promptPath, "utf-8");
          logger.info(`Using custom prompt from: ${plan.promptPath} for OCR`);
        }
        let masterHashes: Set<string> | undefined;
        if (plan.masterFolderPath && !plan.emitSourceHashes) {
          masterHashes = await readMasterHashes(plan.masterFolderPath);
        }
        let ocrOnlyPages: Set<number> | undefined;
        if (flattenAll) {
          const { pageCount } = await getPdfPageInfo(plan.pdfPath!);
          ocrOnlyPages = pagesForMetadata(pageCount);
          logger.info(
            `Flatten 'always': OCR-ing only page(s) ${[...ocrOnlyPages].join(", ")} of ${pageCount} for metadata; every page will be imported as an image.`,
          );
        }
        markdownContent = await pdfToMarkdown(
          plan.pdfPath!,
          plan.openrouterKey!,
          plan.ocrMethod,
          undefined,
          customPrompt,
          { masterHashes, ocrOnlyPages },
        );
        // In "always" mode the extracted images aren't referenced (each page
        // renders as its own full-page picture), so skip the extra extraction.
        if (!flattenAll) await extractImages(plan.pdfPath!, plan.bookFolderPath!, plan.imager);
      }

      // Per-page analysis (covers, vision, canvas) is meaningless in "always"
      // mode — every page becomes an image — so skip straight to flattening.
      if (!flattenAll) {
        markdownContent = await prepareCovers(
          plan.pdfPath!,
          markdownContent,
          plan.bookFolderPath!,
          plan.coverMode,
        );
      }

      if (plan.visionFormatting && !flattenAll) {
        logger.info(`-> Detecting page layout with vision model...`);
        markdownContent = await addVisionFormatting(
          plan.pdfPath!,
          markdownContent,
          plan.openrouterKey!,
          {
            overrideModel: plan.visionModelName,
          },
        );
      }

      const normalStyle = await detectNormalStyle(plan.pdfPath!);
      if (normalStyle.fontSizePt || normalStyle.fontFamily || normalStyle.pageSize) {
        let attrs = "";
        if (normalStyle.fontSizePt) attrs += ` normal-font-size="${normalStyle.fontSizePt}"`;
        if (normalStyle.fontFamily) attrs += ` normal-font-family="${normalStyle.fontFamily}"`;
        if (normalStyle.pageSize) attrs += ` page-size="${normalStyle.pageSize}"`;
        markdownContent = `<!-- book${attrs} -->\n\n${markdownContent}`;
      }

      if (flattenAll) {
        markdownContent = await flattenAllPages(
          markdownContent,
          plan.pdfPath!,
          plan.bookFolderPath!,
        );
      } else {
        const canvasPages = await detectCanvasPages(plan.pdfPath!);
        for (const [pageNum, info] of canvasPages) {
          const re = new RegExp(`(<!--\\s*page\\s+index=${pageNum}\\b)([^>]*?)(\\s*-->)`);
          const boxes = (info.textBoxes.length ? info.textBoxes : [info])
            .map((b) => `${b.x},${b.y},${b.w},${b.h}`)
            .join(";");
          markdownContent = markdownContent.replace(re, (_m, open, attrs, close) => {
            let addition = ` canvas-text-boxes="${boxes}"`;
            if (info.backgroundColor && !/background-color=/.test(attrs)) {
              addition += ` background-color="${info.backgroundColor}"`;
            }
            // Record the detected full-page background image so Stage 4 renders it
            // even when the OCR/LLM omitted the `![image]` ref (e.g. the LFA
            // "comprehension questions" page, whose art is scattered clip-art).
            if (info.backgroundImageIndex && !/canvas-background-image=/.test(attrs)) {
              addition += ` canvas-background-image="image-${pageNum}-${info.backgroundImageIndex}.png"`;
            }
            return `${open}${attrs}${addition}${close}`;
          });
        }

        markdownContent = await flattenComplexPages(
          markdownContent,
          canvasPages,
          plan.pdfPath!,
          plan.bookFolderPath!,
          plan.complexBecomesImage,
        );
      }

      // Crop the white margins off the extracted illustrations (opt-in). Done after
      // all per-page analysis (which reads the PDF / rendered pages, not these PNGs),
      // and skipped in flatten-all mode where every page is a full-bleed snapshot.
      if (plan.trimWhitespace && !flattenAll) {
        logger.info(`-> Trimming whitespace from illustration edges...`);
        await trimWhitespaceInBookFolder(plan.bookFolderPath!);
      }

      logger.info(`Writing OCR'd markdown to: ${plan.markdownFromOCRPath}`);
      await fs.writeFile(plan.markdownFromOCRPath!, markdownContent);
      await recordStage("ocr", plan.pdfPath);
      endStage("ocr");

      latestArtifact = Artifact.MarkdownFromOCR;
      if (plan.targetArtifact === Artifact.MarkdownFromOCR) {
        return {
          status: "completed",
          finalArtifact: latestArtifact,
          bookFolderPath: plan.bookFolderPath,
        };
      }
    }

    // Stage 2 — .ocr.md → .llm.md
    if (latestArtifact === Artifact.MarkdownFromOCR) {
      if (cancelled())
        return {
          status: "cancelled",
          finalArtifact: latestArtifact,
          bookFolderPath: plan.bookFolderPath,
        };
      logger.info(`-> Giving Markdown to LLM...`);
      startStage("llm");
      const markdownContentToEnrich = await fs.readFile(plan.markdownFromOCRPath!, "utf-8");
      const inputFolder = plan.collectionFolderPath || path.dirname(plan.bookFolderPath!);
      const langs = await readBloomCollectionSettingsIfFound(inputFolder);

      let customPrompt: string | undefined;
      if (plan.promptPath) {
        customPrompt = await fs.readFile(plan.promptPath, "utf-8");
        logger.info(`Using custom prompt from: ${plan.promptPath}`);
      }

      const llmResult = await llmMarkdown(markdownContentToEnrich, plan.openrouterKey!, {
        l1: langs?.l1,
        l2: langs?.l2,
        l3: langs?.l3,
        overridePrompt: customPrompt,
        overrideModel: plan.modelName,
      });
      logger.info(`Writing llm-tagged markdown to: ${plan.markdownFromLLMPath}`);

      if (llmResult.error) {
        await fs.writeFile(plan.markdownFromLLMPath!, llmResult.markdownResultFromLLM);
        return fail(
          `LLM processing failed: ${llmResult.error}. See "${plan.markdownCleanedAfterLLMPath}".`,
          latestArtifact,
        );
      }

      await fs.writeFile(plan.markdownFromLLMPath!, llmResult.markdownResultFromLLM);
      logger.info(`Writing cleaned up markdown to: ${plan.markdownCleanedAfterLLMPath}`);
      await fs.writeFile(plan.markdownCleanedAfterLLMPath!, llmResult.cleanedUpMarkdown);
      endStage("llm");

      if (!llmResult.valid) {
        return fail(
          `Enrichment returned invalid content. See "${plan.markdownCleanedAfterLLMPath}".`,
          latestArtifact,
        );
      }

      latestArtifact = Artifact.MarkdownFromLLMCleaned;
      if (plan.targetArtifact === Artifact.MarkdownFromLLMCleaned) {
        return {
          status: "completed",
          finalArtifact: latestArtifact,
          bookFolderPath: plan.bookFolderPath,
        };
      }
    }

    // Stage 2.5 — start from .raw-llm.md (re-run cleanup only)
    if (latestArtifact === Artifact.MarkdownFromLLMRaw) {
      logger.info(`-> Processing raw LLM markdown...`);
      const rawLLMContent = await fs.readFile(plan.markdownFromLLMPath!, "utf-8");
      const cleanupResult = attemptCleanup(rawLLMContent);
      if (!cleanupResult.valid) {
        return fail(
          `Cleanup of raw LLM markdown produced invalid content. See "${plan.markdownCleanedAfterLLMPath}".`,
          latestArtifact,
        );
      }
      logger.info(`Writing cleaned-up markdown to: ${plan.markdownCleanedAfterLLMPath}`);
      await fs.writeFile(plan.markdownCleanedAfterLLMPath!, cleanupResult.cleaned);

      latestArtifact = Artifact.MarkdownFromLLMCleaned;
      if (plan.targetArtifact === Artifact.MarkdownFromLLMCleaned) {
        return {
          status: "completed",
          finalArtifact: latestArtifact,
          bookFolderPath: plan.bookFolderPath,
        };
      }
    }

    // Stage 3 — .llm.md → .bloom.md
    if (latestArtifact === Artifact.MarkdownFromLLMCleaned) {
      if (cancelled())
        return {
          status: "cancelled",
          finalArtifact: latestArtifact,
          bookFolderPath: plan.bookFolderPath,
        };
      logger.info(`-> Adding Bloom plan to Markdown...`);
      startStage("plan");
      const input = await fs.readFile(plan.markdownCleanedAfterLLMPath!, "utf-8");
      const finalMarkdown = addBloomPlanToMarkdown(input);
      logger.info(`Writing ready-for-bloom markdown to: ${plan.markdownForBloomPath!}`);
      await fs.writeFile(plan.markdownForBloomPath!, finalMarkdown);
      endStage("plan");

      latestArtifact = Artifact.MarkdownReadyForBloom;
      if (plan.targetArtifact === Artifact.MarkdownReadyForBloom) {
        return {
          status: "completed",
          finalArtifact: latestArtifact,
          bookFolderPath: plan.bookFolderPath,
        };
      }
    }

    // Stage 4 — .bloom.md → .htm
    if (latestArtifact === Artifact.MarkdownReadyForBloom) {
      if (cancelled())
        return {
          status: "cancelled",
          finalArtifact: latestArtifact,
          bookFolderPath: plan.bookFolderPath,
        };
      logger.info(`-> Converting Markdown to Bloom HTML...`);
      startStage("html");
      const taggedMarkdownContent = await fs.readFile(plan.markdownForBloomPath!, "utf-8");
      const book = new Parser().parseMarkdown(taggedMarkdownContent);

      // When a master book exists, make the import match it: its page size/orientation
      // drives layout (must be set BEFORE generation — canvas geometry depends on it),
      // and its head styles + appearance (fonts, cover colour, theme) are copied in below.
      let masterAppearance: MasterAppearance | undefined;
      if (plan.masterFolderPath && !plan.emitSourceHashes) {
        masterAppearance = await readMasterAppearance(plan.masterFolderPath);
        if (masterAppearance.pageSize) {
          logger.info(`Using master book page size: ${masterAppearance.pageSize}`);
          book.frontMatterMetadata.pageSize = masterAppearance.pageSize;
        }
      }

      let bloomHtmlContent = HtmlGenerator.generateHtmlDocument(book, undefined, {
        bookFolder: plan.bookFolderPath!,
        fitImagePanes: plan.fitImagePanes,
      });

      await fs.mkdir(plan.bookFolderPath!, { recursive: true });

      if (!plan.emitSourceHashes) {
        const masterPages = plan.masterFolderPath
          ? await loadMasterPages(plan.masterFolderPath)
          : new Map();
        bloomHtmlContent = await applyMasterPages(bloomHtmlContent, {
          masterPages,
          bookFolder: plan.bookFolderPath!,
          masterFolder: plan.masterFolderPath,
          emitSourceHashes: false,
        });
      }
      // Copy the master's font + cover-colour <style> blocks over the generated ones.
      if (masterAppearance?.headStyles) {
        bloomHtmlContent = applyMasterHeadStyles(bloomHtmlContent, masterAppearance.headStyles);
      }
      // Prepend the master's originalAcknowledgments (publisher boilerplate) to the import's.
      if (masterAppearance?.acknowledgments) {
        bloomHtmlContent = applyMasterAcknowledgments(
          bloomHtmlContent,
          masterAppearance.acknowledgments,
        );
      }
      const bookHtmlPath = path.join(
        plan.bookFolderPath!,
        path.basename(plan.bookFolderPath!) + ".htm",
      );
      await fs.writeFile(bookHtmlPath, bloomHtmlContent);
      await fs.rm(path.join(plan.bookFolderPath!, "index.html"), { force: true });

      await writeMetaJson(plan.bookFolderPath!, book);
      await writeAppearanceJson(plan.bookFolderPath!, book);
      // Adopt the master book's appearance.json wholesale, so the import matches its
      // theme, cover colour, margins, and cover field visibility exactly.
      if (masterAppearance?.appearance) {
        await fs.writeFile(
          path.join(plan.bookFolderPath!, "appearance.json"),
          JSON.stringify(masterAppearance.appearance, null, 2),
        );
      }
      // Book-level hand CSS the collection won't supply and Bloom won't regenerate.
      if (masterAppearance?.customBookStyles !== undefined) {
        await fs.writeFile(
          path.join(plan.bookFolderPath!, "customBookStyles.css"),
          masterAppearance.customBookStyles,
        );
      }
      await writeImageMetadata(plan.bookFolderPath!, book);

      logger.info(`Bloom book should be at: ${plan.bookFolderPath}`);
      logger.info("✅ Conversion to Bloom HTML completed successfully!");

      await notifyBloomOfBook(plan.bookFolderPath!);
      endStage("html");
      logger.event({ kind: "done" });
      return {
        status: "completed",
        finalArtifact: Artifact.HTML,
        bookFolderPath: plan.bookFolderPath,
      };
    }

    // Nothing ran (input already at/after target)
    return {
      status: "completed",
      finalArtifact: latestArtifact,
      bookFolderPath: plan.bookFolderPath,
    };
  } catch (error) {
    return fail(error, latestArtifact);
  }
}
