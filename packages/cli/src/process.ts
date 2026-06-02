import * as fs from "fs/promises"; // Use promises API for async file operations
import * as path from "path";
import {
  makeMarkdownFromPDF,
  logger,
  llmMarkdown,
  Parser,
  HtmlGenerator,
  addBloomPlanToMarkdown,
  pdfToMarkdownWithUnpdf,
  pdfToMarkdown,
  extractImagesWithPdfImages,
  extractAndSaveImagesWithPdfImages,
  prepareCovers,
  writeMetaJson,
  notifyBloomOfBook,
  type CoverMode,
} from "@pdf-to-bloom/lib"; // Assuming these functions are async and return/handle as described
import {
  createLogCallback,
  getApiKeys,
  getFileNameWithoutExtension,
  readBloomCollectionSettingsIfFound,
  validateAndResolveCollectionPath,
} from "./processUtils";

export enum PdfProcessor {
  Mistral = "mistral",
  Unpdf = "unpdf",
  OpenRouter = "openrouter",
}

export enum Artifact {
  PDF,
  Images,
  MarkdownFromOCR,
  MarkdownFromLLMRaw,
  MarkdownFromLLMCleaned,
  MarkdownReadyForBloom,
  HTML,
}
export type Arguments = {
  input: string; // Input file or directory path
  output?: string; // Optional output path
  collection?: string; // Path to Bloom collection folder or .bloomCollection file
  target: Artifact; // Target format (default is HTML)
  verbose: boolean; // Verbose logging
  mistralApiKey?: string; // Mistral API key for PDF to markdown conversion
  openrouterKey?: string; // OpenRouter API key for LLM tagging of markdown
  promptPath?: string; // Path to custom prompt file to override built-in prompt
  modelName?: string; // OpenRouter model name to override the default model
  ocrMethod: string; // OCR processing method: mistral, unpdf, or any OpenRouter model
  parserEngine: string; // PDF parsing engine for OpenRouter: native, mistral-ocr, or pdf-text
  imager: string; // Image extraction method: pdfjs or poppler
  cover?: string; // Full-page cover handling: auto (default), render, or none
};

type Plan = {
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
};

// Convert numeric enum value to readable string
const artifactNames = {
  [Artifact.PDF]: "PDF",
  [Artifact.Images]: "Images",
  [Artifact.MarkdownFromOCR]: "Markdown from OCR",
  [Artifact.MarkdownFromLLMRaw]: "Raw Markdown from LLM",
  [Artifact.MarkdownFromLLMCleaned]: "Tagged Markdown from LLM",
  [Artifact.MarkdownReadyForBloom]: "Bloom-ready Markdown",
  [Artifact.HTML]: "Bloom HTML",
};

/**
 * Normalize the --cover option to a CoverMode, defaulting to "auto".
 */
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

/**
 * Extracts images from a PDF using the specified method
 */
async function extractImages(pdfPath: string, outputDir: string, method: string): Promise<void> {
  if (method === "poppler") {
    logger.info("Using Poppler pdfimages for image extraction");
    const images = await extractImagesWithPdfImages(pdfPath, outputDir);
  } else {
    if (method !== "pdfjs") {
      logger.warn(`Unknown imager method '${method}', defaulting to 'poppler'`);
    }
    logger.info("Using Poppler pdfimages for image extraction (PDF.js method removed)");
    await extractAndSaveImagesWithPdfImages(pdfPath, outputDir);
  }
}

export async function processConversion(inputPath: string, options: Arguments) {
  const logCallback = createLogCallback(!!options.verbose);
  logger.subscribe(logCallback);

  const plan = await makeThePlan(inputPath, options);

  try {
    logger.info(
      `Starting conversion from "${artifactNames[plan.inputArtifact]}" to "${artifactNames[plan.targetArtifact]}"`,
    );

    let latestArtifact = plan.inputArtifact; // Start with the input type

    // ------------------------------------------------------------------------------
    // Step 0.5: Extract Images from PDF (if target is Images)
    // ------------------------------------------------------------------------------
    if (latestArtifact === Artifact.PDF && plan.targetArtifact === Artifact.Images) {
      logger.info(`-> Extracting images from PDF...`);

      await extractImages(plan.pdfPath!, plan.bookFolderPath!, plan.imager);
      return; // Exit early, we only wanted images
    }

    // ------------------------------------------------------------------------------
    // Step 1: Convert PDF to Markdown
    // ------------------------------------------------------------------------------
    if (latestArtifact === Artifact.PDF) {
      logger.info(`-> Converting PDF to Markdown...`);

      let markdownContent: string;

      if (plan.ocrMethod === "unpdf") {
        logger.info(`Using unpdf for PDF processing (experimental)`);
        // Use the new unpdf approach - extracts ALL text from PDF structure,
        // including potentially hidden layers. Some PDFs (especially those from
        // Adobe Illustrator/Distiller) may contain non-visible text.
        markdownContent = await pdfToMarkdownWithUnpdf(
          plan.pdfPath!,
          plan.bookFolderPath!,
          logCallback,
        );
      } else if (plan.ocrMethod === "mistral") {
        logger.info(`Using Mistral AI for PDF processing`);
        // Use the existing Mistral AI approach - vision-based OCR that only
        // extracts visually rendered text, similar to what a human would see.
        markdownContent = await makeMarkdownFromPDF(
          plan.pdfPath!,
          plan.bookFolderPath!,
          plan.mistralKey!,
          logCallback,
        );
      } else {
        // Read custom prompt if provided
        let customPrompt: string | undefined;
        if (plan.promptPath) {
          try {
            customPrompt = await fs.readFile(plan.promptPath, "utf-8");
            logger.info(`Using custom prompt from: ${plan.promptPath} for OCR`);
          } catch (error) {
            logger.error(`Failed to read custom prompt file: ${plan.promptPath}`);
            throw error;
          }
        }

        markdownContent = await pdfToMarkdown(
          plan.pdfPath!,
          plan.openrouterKey!,
          plan.ocrMethod,
          logCallback,
          customPrompt,
        );
        // After writing markdown, extract images from the PDF to match markdown references
        await extractImages(plan.pdfPath!, plan.bookFolderPath!, plan.imager);
      }

      // Detect and render full-page-art covers (front/back) straight from the PDF.
      // This bakes a `cover.jpg` and a markdown reference into the OCR output, so
      // later runs that start from the markdown don't need the PDF or re-run OCR.
      markdownContent = await prepareCovers(
        plan.pdfPath!,
        markdownContent,
        plan.bookFolderPath!,
        plan.coverMode,
      );

      logger.info(`Writing OCR'd markdown to: ${plan.markdownFromOCRPath}`);
      await fs.writeFile(plan.markdownFromOCRPath!, markdownContent); // Write the markdown content to file

      latestArtifact = Artifact.MarkdownFromOCR;
      // If Markdown was the final target, we're done here
      if (plan.targetArtifact === Artifact.MarkdownFromOCR) {
        return;
      }
    } // ------------------------------------------------------------------------------
    // Stage 2: Run LLM over Markdown
    // ------------------------------------------------------------------------------
    if (latestArtifact === Artifact.MarkdownFromOCR) {
      logger.info(`-> Giving Markdown to LLM...`);
      const markdownContentToEnrich = await fs.readFile(plan.markdownFromOCRPath!, "utf-8");
      // For markdown enrichment, if the input is from a Bloom collection, try to get language info from collection settings
      const inputFolder = plan.collectionFolderPath || path.dirname(plan.bookFolderPath!);
      const langs = await readBloomCollectionSettingsIfFound(inputFolder);
      if (langs) {
        const formatLang = (lang?: { tag: string; name: string }) =>
          lang ? `${lang.name} (${lang.tag})` : "undefined";
        logger.info(
          `Supplying info from Bloom Collection settings: L1: ${formatLang(langs.l1)}, L2: ${formatLang(langs.l2)}, L3: ${formatLang(langs.l3)}`,
        );
      } else {
        logger.warn(
          `No Bloom Collection settings found in ${inputFolder} or parent directories, so LLM may not use the correct language codes.`,
        );
      }

      // Read custom prompt if provided
      let customPrompt: string | undefined;
      if (plan.promptPath) {
        try {
          customPrompt = await fs.readFile(plan.promptPath, "utf-8");
          logger.info(`Using custom prompt from: ${plan.promptPath}`);
        } catch (error) {
          logger.error(`Failed to read custom prompt file: ${error}`);
          throw new Error(`Failed to read custom prompt file: ${plan.promptPath}`);
        }
      }

      const llmResult = await llmMarkdown(markdownContentToEnrich, plan.openrouterKey!, {
        logCallback,
        l1: langs?.l1,
        l2: langs?.l2,
        l3: langs?.l3,
        overridePrompt: customPrompt,
        overrideModel: plan.modelName,
      });
      logger.info(`Writing llm-tagged markdown to: ${plan.markdownFromLLMPath}`);

      // Check if LLM processing failed
      if (llmResult.error) {
        // Save the invalid markdown for inspection
        await fs.writeFile(plan.markdownFromLLMPath!, llmResult.markdownResultFromLLM);
        logger.error(`LLM processing failed: ${llmResult.error}`);
        logger.info(`Invalid markdown saved to: ${plan.markdownFromLLMPath!}`);
        throw new Error(
          `LLM processing failed: ${llmResult.error}. Check the saved markdown at "${plan.markdownFromLLMPath!}" for details.`,
        );
      }

      await fs.writeFile(plan.markdownFromLLMPath!, llmResult.markdownResultFromLLM);
      logger.info(`Writing cleaned up markdown to: ${plan.markdownCleanedAfterLLMPath}`);
      await fs.writeFile(plan.markdownCleanedAfterLLMPath!, llmResult.cleanedUpMarkdown);

      if (!llmResult.valid) {
        throw new Error(
          `Enrichment process returned invalid content. This can be a result of the mode/prompt. You may be able to see errors in the file "${plan.markdownCleanedAfterLLMPath!}" for details.`,
        );
      }

      latestArtifact = Artifact.MarkdownFromLLMCleaned;
      console.log(
        `latestArtifact is now MarkdownFromLLM. target is ${artifactNames[plan.targetArtifact]}`,
      );
      if (plan.targetArtifact === Artifact.MarkdownFromLLMCleaned) {
        return; // If Markdown was the final target, we're done here
      }
    }

    // ------------------------------------------------------------------------------
    // Stage 2.5: Process Raw LLM Markdown (if starting from .raw-llm.md)
    // ------------------------------------------------------------------------------
    if (latestArtifact === Artifact.MarkdownFromLLMRaw) {
      logger.info(`-> Processing raw LLM markdown...`);

      // Read the raw LLM output
      const rawLLMContent = await fs.readFile(plan.markdownFromLLMPath!, "utf-8");

      // For now, just pass through the content as-is
      // Any cleaning should be handled by the existing post-llm-cleanup.ts logic
      logger.info(`Writing raw LLM content to cleaned path: ${plan.markdownCleanedAfterLLMPath}`);
      await fs.writeFile(plan.markdownCleanedAfterLLMPath!, rawLLMContent);

      latestArtifact = Artifact.MarkdownFromLLMCleaned;
      console.log(
        `latestArtifact is now MarkdownFromLLMCleaned. target is ${artifactNames[plan.targetArtifact]}`,
      );
      if (plan.targetArtifact === Artifact.MarkdownFromLLMCleaned) {
        return; // If Markdown was the final target, we're done here
      }
    }

    // ------------------------------------------------------------------------------
    // Stage 3: Make Markdown with all decisions made
    // ------------------------------------------------------------------------------
    if (latestArtifact === Artifact.MarkdownFromLLMCleaned) {
      logger.info(`-> Adding Bloom plan to Markdown...`);
      // Now we want to do the final bit of any logic work, still in markdown format because
      // then it is easier for a human to inspect the plan. Later we're going to HTML and by then
      // it's really hard to wade through what was done.

      const input = await fs.readFile(plan.markdownCleanedAfterLLMPath!, "utf-8");
      const finalMarkdown = addBloomPlanToMarkdown(input);
      logger.info(`Writing ready-for-bloom markdown to: ${plan.markdownForBloomPath!}`);

      await fs.writeFile(plan.markdownForBloomPath!, finalMarkdown);

      latestArtifact = Artifact.MarkdownReadyForBloom;
      // If Tagged Markdown was the final target, we're done here
      if (plan.targetArtifact === Artifact.MarkdownReadyForBloom) {
        return;
      }
    }
    // ------------------------------------------------------------------------------
    // Stage 4: Convert Tagged Markdown to Bloom HTML
    // ------------------------------------------------------------------------------
    if (latestArtifact === Artifact.MarkdownReadyForBloom) {
      logger.info(`-> Converting Markdown to Bloom HTML...`);
      const taggedMarkdownContent = await fs.readFile(plan.markdownForBloomPath!, "utf-8");

      const book = new Parser().parseMarkdown(taggedMarkdownContent);

      const bloomHtmlContent = await HtmlGenerator.generateHtmlDocument(book, logCallback);

      // Ensure the output directory exists
      await fs.mkdir(plan.bookFolderPath!, { recursive: true });
      // A Bloom book's HTML file is named after its folder (e.g.
      // "A Thief in the Night/A Thief in the Night.htm"). Write to that name so we
      // overwrite the file a running Bloom actually reads when it refreshes — not
      // a sibling "index.html" it would ignore.
      const bookHtmlPath = path.join(
        plan.bookFolderPath!,
        path.basename(plan.bookFolderPath!) + ".htm",
      );
      await fs.writeFile(bookHtmlPath, bloomHtmlContent);
      // Remove any leftover index.html from the old output convention; Bloom's
      // FindBookHtmlInFolder prefers "<folder>.htm" but a stray index.html is
      // confusing cruft, so clean it up.
      await fs.rm(path.join(plan.bookFolderPath!, "index.html"), { force: true });

      // Write meta.json (creating a new bookInstanceId, or preserving the
      // existing one when updating a book already in a Bloom collection). The id
      // is what lets a running Bloom add/refresh the right book.
      await writeMetaJson(plan.bookFolderPath!, book);

      logger.info(`Bloom book should be at: ${plan.bookFolderPath}`);
      logger.info("✅ Conversion to Bloom HTML completed successfully!");

      // Final step: tell a running Bloom (if any) to add or refresh this book in
      // its collection. This is best-effort and never fails the conversion.
      await notifyBloomOfBook(plan.bookFolderPath!);
      return;
    }
  } catch (error: any) {
    logger.error("❌ Error during conversion:");

    if (error instanceof Error) {
      logger.error(error.message);
      // Log the stack trace which contains file paths and line numbers
      if (error.stack) {
        logger.error("Stack trace:");
        logger.error(error.stack);
      }
    } else {
      logger.error(String(error));
    }

    process.exit(1); // Exit with an error code
  }
}

async function makeThePlan(inputPath: string, cliArguments: Arguments): Promise<Plan> {
  const fullInputPath = path.resolve(inputPath);

  // Validate that collection and output are not both specified
  if (cliArguments.collection && cliArguments.output) {
    throw new Error(
      "Cannot specify both --collection and --output options. Use --collection for better language detection, or --output for custom directory placement.",
    );
  }

  // use a regex to figure out the input type (as an Artifact) by looking at its last two file extensions, e.g. ".pdf" or ".ocr.md" or ".raw-llm.md"
  const regex = /^(.*?)(\.[^.]+)?(\.[^.]+)?$/; // Matches the last two extensions
  const match = fullInputPath.match(regex);
  if (!match) {
    throw new Error(`Failed to parse input file path: ${fullInputPath}`);
  }

  const [, , firstExt, secondExt] = match;
  // want ".pdf" or ".ocr.md" or ".llm.md" or ".bloom.md" or ".raw-llm.md" by combining the last two extensions

  const ext = [firstExt, secondExt].filter(Boolean).join("");

  let inputType: Artifact;
  switch (ext) {
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
        `Unsupported input file type: ${ext}. Supported types: .pdf, .md, .ocr.md, .raw-llm.md, .llm.md, .bloom.md`,
      );
  }

  logger.info(`Input file: "${fullInputPath}" (Type: ${inputType})`);

  const targetType = cliArguments.target ?? Artifact.HTML;

  logger.info(`Target format: ${artifactNames[targetType]}`);

  const { mistralKey, openrouterKey } = getApiKeys(cliArguments);

  if (inputType === Artifact.PDF && cliArguments.ocrMethod === "mistral" && !mistralKey) {
    // we are going to have to do OCR, need the key
    throw new Error(
      "Mistral API key is required for PDF to Bloom conversion. Provide --mistral-api-key or set MISTRAL_API_KEY environment variable, or use --ocr unpdf for local processing.",
    );
  }

  if (
    inputType === Artifact.PDF &&
    cliArguments.ocrMethod !== "mistral" &&
    cliArguments.ocrMethod !== "unpdf" &&
    !openrouterKey
  ) {
    // we are going to use OpenRouter for OCR, need the key
    throw new Error(
      "OpenRouter API key is required for OpenRouter OCR models. Provide --openrouter-key or set OPENROUTER_KEY environment variable.",
    );
  }
  if (
    inputType < Artifact.MarkdownFromLLMCleaned &&
    targetType >= Artifact.MarkdownFromLLMCleaned &&
    !openrouterKey
  ) {
    // we are going to have to do call the LLM, need the key
    throw new Error(
      "OpenRouter API key is required for PDF to Bloom conversion. Provide --openrouter-key or set OPENROUTER_KEY environment variable.",
    );
  }

  logger.verbose(
    `fullInputPath: ${fullInputPath} cliOutput: ${cliArguments.output} cliCollection: ${cliArguments.collection}`,
  );

  // Handle collection path validation and setup
  let collectionFolderPath: string | undefined;
  let baseOutputDir: string;

  if (cliArguments.collection) {
    // Validate and resolve collection path
    const { collectionFolderPath: resolvedCollectionPath } = await validateAndResolveCollectionPath(
      cliArguments.collection,
    );
    collectionFolderPath = resolvedCollectionPath;
    baseOutputDir = collectionFolderPath;
    logger.info(`Using Bloom collection folder: ${collectionFolderPath}`);
  } else if (cliArguments.output) {
    // Output directory specified explicitly
    baseOutputDir = cliArguments.output;
  } else {
    // No collection or output specified - default to recent collection
    try {
      logger.info("No --collection or --output specified, using most recent Bloom collection");
      const { collectionFolderPath: resolvedCollectionPath } =
        await validateAndResolveCollectionPath("recent");
      collectionFolderPath = resolvedCollectionPath;
      baseOutputDir = collectionFolderPath;
      logger.info(`Using most recent Bloom collection folder: ${collectionFolderPath}`);
    } catch (error) {
      // Fall back to the old logic if recent collection lookup fails
      logger.warn(`Could not find recent collection (${error}), falling back to current directory`);
      baseOutputDir = inputType === Artifact.PDF ? process.cwd() : path.dirname(fullInputPath);
    }
  }

  logger.verbose(`Output directory: ${baseOutputDir}`);
  const baseName = getFileNameWithoutExtension(getFileNameWithoutExtension(fullInputPath));

  // Determine the book directory
  let bookDir: string;

  // Special case: If we're using a collection and the input file is already
  // within that collection, use the existing directory structure
  if (
    collectionFolderPath &&
    inputType !== Artifact.PDF &&
    fullInputPath.startsWith(collectionFolderPath)
  ) {
    // The input file is already in the collection, use its parent directory as the book directory
    bookDir = path.dirname(fullInputPath);
    logger.info(`Using existing book directory: ${bookDir}`);
  } else {
    // Create a new book subdirectory based on the base filename
    bookDir = path.join(baseOutputDir, baseName);
    logger.info(`Creating book directory: ${bookDir}`);
    await fs.mkdir(bookDir, { recursive: true });
  }

  // All outputs will go into the book directory
  baseOutputDir = bookDir;
  const plan = {
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
    verbose: cliArguments.verbose ?? false,
    mistralKey,
    openrouterKey,
    promptPath: cliArguments.promptPath,
    modelName: cliArguments.modelName,
    ocrMethod: cliArguments.ocrMethod,
    parserEngine: cliArguments.parserEngine,
    imager: cliArguments.imager,
    coverMode: normalizeCoverMode(cliArguments.cover),
  };
  //console.log(`Plan created:`, JSON.stringify(plan, null, 2));

  return plan;
}
