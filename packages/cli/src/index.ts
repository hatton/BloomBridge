import { Command } from "commander";
import chalk from "chalk";
import { fileURLToPath } from "url";
import { Arguments, Artifact, processConversion } from "./process";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);

const program = new Command();

// --- Commander.js Setup ---
program
  .name("bloombridge")
  .description("Convert PDF documents to Bloom-compatible HTML format")
  .version("1.0.0");

// Main command: Handles both web app start and file conversions
program
  .argument("<input>", "Path to input file ending in .pdf,  .ocr.md, .llm.md, or .bloom.md.")
  .option(
    "-t, --target <target>",
    "Target format: images (extract images only), markdown (just ocr of the PDF), tagged (run through LLM and other processing), or bloom. Default is bloom.",
  )
  .option(
    "-c, --collection <path>",
    "Path to Bloom collection folder or .bloomCollection file. Can be a full path, just a collection name (e.g., 'My Books' will expand to ~/Documents/Bloom/My Books), or 'recent' to use the most recently opened collection. This is the recommended way to specify where to create the book, as it provides language settings for better processing.",
  )
  .option(
    "-o, --output <path>",
    "Directory in which a new directory will be created based on the input file name. If neither --collection nor --output is specified, defaults to the most recently opened Bloom collection for better language detection.",
  )
  .option(
    "--mistral-api-key <key>",
    "Mistral AI API key (for PDF processing and general LLM interactions)",
  )
  .option(
    "--openrouter-key <key>",
    "OpenRouter API key (for enrichment and potentially advanced Bloom HTML generation)",
  )
  .option("--prompt <path>", "Path to custom prompt file to override the built-in LLM prompt")
  .option(
    "--model <model>",
    "OpenRouter model name to use for LLM enrichment (e.g., 'google/gemini-2.5-flash')",
  )
  .option(
    "--ocr <method>",
    "OCR processing method: 'gpt' (default, OpenRouter GPT-4o), 'mistral', 'unpdf' (experimental structural extraction), or any OpenRouter model (e.g. 'gemini', 'google/gemini-2.0-flash-exp'). Note: unpdf extracts all text from PDF structure, including hidden layers that may not be visually rendered.",
    "gpt",
  )
  .option(
    "--parser <engine>",
    "PDF parsing engine for OpenRouter models: 'native' (default, use model's built-in capabilities), 'mistral-ocr' (best for scanned documents, $2 per 1,000 pages), or 'pdf-text' (free, best for text-based PDFs).",
    "native",
  )
  .option(
    "--imager <method>",
    "Image extraction method: 'poppler' (default, uses pdfimages from Poppler for higher fidelity). Note: 'pdfjs' method has been removed.",
    "poppler",
  )
  .option(
    "--cover <mode>",
    "Full-page cover handling: 'auto' (default, render front/back cover to an image only when the page is detected as full-bleed art), 'render' (always render the first and last pages as cover images), or 'none' (leave covers to OCR/Bloom's default xMatter).",
    "auto",
  )
  .option(
    "--vision-formatting",
    "Use a vision model to detect per-page text alignment (vertical/horizontal) and background color, cached into the .ocr.md so it isn't re-run on later passes. On by default; requires a PDF input and an OpenRouter key. Use --no-vision-formatting to disable.",
  )
  .option("--no-vision-formatting", "Disable the vision-formatting pass (see --vision-formatting).")
  .option(
    "--vision-model <model>",
    "OpenRouter model for the --vision-formatting pass (defaults to a cheap vision model). e.g. 'google/gemini-3.1-pro-preview'. Independent of --model.",
  )
  .option(
    "--emit-source-hashes",
    "Emit a data-import-source-hash on every page (the hash of its source PDF page render) and skip master-page substitution. Use this once to build a 'master' book: run it on the publisher's sample, hand-perfect the complex pages in Bloom, then rename the folder to end in 'master'. Normal imports then substitute those pages automatically.",
  )
  .option(
    "--complex-becomes-image <which>",
    "For which pages should the converter snapshot the original PDF page instead of rebuilding it as editable text (the translatability-vs-fidelity tradeoff)? 'covers' rebuilds every interior page as editable text; 'busy' (default) additionally snapshots pages too busy to convert well; 'anyCanvas' snapshots any page with text over a picture; 'all' snapshots EVERY page (OCR-ing only a few pages for metadata/languages, skipping all per-page layout analysis). Legacy values (off, 0-5, always) are still accepted. Flattened pages carry a data-conversion-note. Requires PDF input.",
    "busy",
  )
  .option(
    "--trim-whitespace",
    "Crop uniform white margins off the edges of each extracted illustration so the artwork fills its frame. Off by default. Skips full-bleed covers, per-page snapshots, and decorative icons.",
  )
  .option("--verbose", "Enable verbose logging to see detailed process steps")
  .option(
    "--json-events",
    "Emit machine-readable NDJSON events on stdout (stage timing, page progress, token usage) for tooling like the GUI server; human logs go to stderr.",
  )
  .action(async (input, options) => {
    if (input) {
      const args: Arguments = {
        input,
        target: getTarget(options.target),
        output: options.output,
        collection: options.collection,
        mistralApiKey: options.mistralApiKey || process.env.MISTRAL_API_KEY,
        openrouterKey: options.openrouterKey || process.env.OPENROUTER_KEY,
        promptPath: options.prompt,
        modelName: options.model,
        verbose: options.verbose || false,
        ocrMethod: options.ocr || "gpt",
        parserEngine: options.parser || "native",
        imager: options.imager || "poppler",
        cover: options.cover || "auto",
        // Commander defaults this to true (because --no-vision-formatting is defined);
        // --no-vision-formatting sets it false. Vision-formatting is on by default.
        visionFormatting: options.visionFormatting,
        visionModelName: options.visionModel,
        emitSourceHashes: options.emitSourceHashes || false,
        complexBecomesImage: options.complexBecomesImage || "busy",
        trimWhitespace: options.trimWhitespace || false,
        jsonEvents: options.jsonEvents || false,
      };

      await processConversion(input, args);
    } else {
      // This should never happen now since input is required, but kept for robustness
      console.error(chalk.red("❌ Error: Input path is required for file conversion operations."));
      console.log(chalk.blue("💡 Tip: Use 'bloombridge --help' for usage instructions."));
      process.exit(1);
    }
  });

// Removed the 'convert' command as its functionality is now absorbed by the main command's `action` handler.

// Version command (kept as is)
program
  .command("version")
  .description("Show version information for the BloomBridge CLI")
  .action(() => {
    console.log(chalk.blue("BloomBridge CLI v1.0.0"));
    console.log(chalk.gray("A tool for converting PDF documents to Bloom format"));
  });

// Handle unknown commands gracefully
program.on("command:*", () => {
  console.error(chalk.red("❌ Invalid command: %s"), program.args.join(" "));
  console.log(chalk.blue("See '--help' for a list of available commands."));
  process.exit(1);
});

// Parse command line arguments and execute the appropriate action
program.parse(process.argv);
function getTarget(target: any): Artifact {
  switch (target) {
    case "images":
      return Artifact.Images;
    case "ocr":
    case "markdown":
      return Artifact.MarkdownFromOCR;
    case "tagged":
      return Artifact.MarkdownReadyForBloom;
    case "bloom":
      return Artifact.HTML;
    default:
      return Artifact.HTML;
  }
}
