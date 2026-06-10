import { logger, planConversion, runConversion, Artifact, type RunArgs } from "@bloombridge/lib";
import { createLogCallback, getApiKeys } from "./processUtils";

// The conversion orchestration now lives in the lib (shared with the GUI server).
// This wrapper handles CLI concerns: API-key/env resolution, console logging, the
// --json-events NDJSON stream, and exit codes.

export { Artifact };

export type Arguments = {
  input: string;
  output?: string;
  collection?: string;
  target: Artifact;
  verbose: boolean;
  mistralApiKey?: string;
  openrouterKey?: string;
  promptPath?: string;
  modelName?: string;
  ocrMethod: string;
  parserEngine: string;
  imager: string;
  cover?: string;
  visionFormatting?: boolean;
  visionModelName?: string;
  emitSourceHashes?: boolean;
  complexBecomesImage?: string;
  trimWhitespace?: boolean;
  fitImagePanes?: boolean;
  jsonEvents?: boolean;
};

export async function processConversion(inputPath: string, options: Arguments) {
  const jsonEvents = !!options.jsonEvents;
  // In --json-events mode stdout is reserved for NDJSON; route human logs to stderr.
  const logCallback = jsonEvents
    ? (log: { level: string; message: string }) => {
        if (log.level !== "verbose" || options.verbose) {
          process.stderr.write(`[${log.level}] ${log.message}\n`);
        }
      }
    : createLogCallback(!!options.verbose);
  logger.subscribe(logCallback);
  if (jsonEvents) {
    logger.subscribeEvents((e) => {
      if (e.kind === "log" && e.level === "verbose" && !options.verbose) return;
      process.stdout.write(JSON.stringify(e) + "\n");
    });
  }

  const { mistralKey, openrouterKey } = getApiKeys(options);
  const args: RunArgs = {
    input: inputPath,
    output: options.output,
    collection: options.collection,
    target: options.target,
    verbose: options.verbose,
    mistralKey,
    openrouterKey,
    promptPath: options.promptPath,
    modelName: options.modelName,
    ocrMethod: options.ocrMethod,
    parserEngine: options.parserEngine,
    imager: options.imager,
    cover: options.cover,
    visionFormatting: options.visionFormatting,
    visionModelName: options.visionModelName,
    emitSourceHashes: options.emitSourceHashes,
    complexBecomesImage: options.complexBecomesImage,
    trimWhitespace: options.trimWhitespace,
    fitImagePanes: options.fitImagePanes,
  };

  try {
    const plan = await planConversion(args);
    const result = await runConversion(plan);
    if (result.status === "failed") {
      process.exit(1);
    }
  } catch (error: any) {
    logger.error("❌ Error during conversion:");
    if (error instanceof Error) {
      logger.error(error.message);
      if (error.stack) {
        logger.error("Stack trace:");
        logger.error(error.stack);
      }
    } else {
      logger.error(String(error));
    }
    process.exit(1);
  }
}
