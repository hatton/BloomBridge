import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { generateObject } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { logger, LogEntry } from "../logger";
import { renderPdfPageToImage } from "./renderPdfPage";
import { detectSolidBackgroundColor } from "./detectBackgroundColor";

export interface VisionFormattingOptions {
  logCallback?: (log: LogEntry) => void;
  /** OpenRouter model to use; defaults to a cheap vision-capable model. */
  overrideModel?: string;
  /** DPI for the rendered page image. Layout detection needs little resolution. */
  dpi?: number;
  /** Max pages to inspect concurrently. */
  concurrency?: number;
}

// A vision model only needs a low-resolution image to judge layout; lower DPI
// means fewer image tokens and lower cost.
const DEFAULT_DPI = 100;
// gemini-3.1-pro-preview was benchmarked against gpt-5.4 and gemini-2.5-flash on a
// sample book: it got horizontal/vertical alignment right on every sampled page
// (notably a centered "About the author" page the flash model called left-aligned).
// Override per-run with --vision-model.
const DEFAULT_MODEL = "google/gemini-3.1-pro-preview";
const DEFAULT_CONCURRENCY = 4;

const VisionResultSchema = z.object({
  verticalAlign: z
    .enum(["top", "center", "bottom"])
    .describe("Where the block of text sits vertically within the page margins."),
  horizontalAlign: z
    .enum(["left", "center", "right"])
    .describe("How the lines of text are aligned horizontally."),
});

const VISION_PROMPT = `You are analyzing a single page of a children's picture book to capture how its text is laid out, so it can be reproduced faithfully.

Look at the page image and answer ONLY about the main block of body text (ignore page numbers and any header/footer):

1. verticalAlign: Is the text block positioned at the "top", "center", or "bottom" of the page's content area? Judge by the empty space above vs. below the text. If the gaps are roughly equal, answer "center".
2. horizontalAlign: Are the lines of text aligned to the "left", "center", or "right"?

If the page has no body text at all, answer verticalAlign "center" and horizontalAlign "left".`;

/**
 * Matches each `<!-- page index=N ... -->` comment, capturing the index and the
 * full comment so we can rewrite its attribute list.
 */
const PAGE_COMMENT_REGEX = /<!--\s*page\s+index=(\d+)\b([^>]*)-->/g;

/**
 * Run a list of async tasks with a bounded number running at once.
 */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

/**
 * Use a vision model to detect per-page layout (vertical/horizontal alignment of
 * the text and the page background color), and bake the results into each
 * `<!-- page ... -->` comment in the markdown.
 *
 * This is an OPT-IN step that runs during the PDF stage (the only stage with the
 * PDF in hand). The results persist in the `.ocr.md`, which serves as the cache:
 * any page whose comment already carries `vertical-align` is skipped, so
 * re-running the pipeline does not re-pay for vision calls.
 *
 * @returns the markdown with layout attributes injected into page comments.
 */
export async function addVisionFormatting(
  pdfPath: string,
  markdown: string,
  openRouterApiKey: string,
  options: VisionFormattingOptions = {},
): Promise<string> {
  const {
    logCallback,
    overrideModel,
    dpi = DEFAULT_DPI,
    concurrency = DEFAULT_CONCURRENCY,
  } = options;

  if (logCallback) logger.subscribe(logCallback);

  try {
    if (!openRouterApiKey) {
      throw new Error("OpenRouter API key is required for vision formatting");
    }

    // Collect pages that still need analysis (cache check: skip ones that already
    // have a vertical-align attribute).
    const toProcess: { index: number }[] = [];
    for (const match of markdown.matchAll(PAGE_COMMENT_REGEX)) {
      const [, indexStr, attrs] = match;
      if (/vertical-align=/.test(attrs)) continue; // already cached
      toProcess.push({ index: Number(indexStr) });
    }

    if (toProcess.length === 0) {
      logger.info("Vision formatting: all pages already have layout hints; nothing to do.");
      return markdown;
    }

    logger.info(
      `Vision formatting: analyzing ${toProcess.length} page(s) for alignment and background color...`,
    );

    const modelName = overrideModel || DEFAULT_MODEL;
    const openrouterProvider = createOpenRouter({ apiKey: openRouterApiKey });
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vision-fmt-"));

    // page index -> attribute string to append (only for successful pages)
    const results = new Map<number, string>();

    try {
      await runWithConcurrency(toProcess, concurrency, async (page) => {
        const jpgPath = path.join(tempDir, `page-${page.index}.jpg`);
        try {
          await renderPdfPageToImage(pdfPath, page.index, jpgPath, { dpi });
          const imageBuffer = await fs.readFile(jpgPath);

          const { object } = await generateObject({
            model: openrouterProvider(modelName),
            schema: VisionResultSchema,
            temperature: 0,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: VISION_PROMPT },
                  { type: "image", image: imageBuffer },
                ],
              },
            ],
          });

          // Background color is detected deterministically from the rendered page
          // (a uniform, non-white border = a solid page background), NOT from the
          // vision model. Only genuinely solid-color pages get a background-color.
          const bgColor = await detectSolidBackgroundColor(jpgPath);
          const bg = bgColor ? ` background-color="${bgColor}"` : "";
          results.set(
            page.index,
            ` vertical-align="${object.verticalAlign}" horizontal-align="${object.horizontalAlign}"${bg}`,
          );
          logger.verbose(
            `Vision formatting page ${page.index}: vertical=${object.verticalAlign}, horizontal=${object.horizontalAlign}, bg=${bgColor ?? "none"}`,
          );
        } catch (error) {
          // One bad page shouldn't abort the book; just leave it unannotated.
          logger.warn(`Vision formatting failed for page ${page.index}: ${error}`);
        } finally {
          await fs.rm(jpgPath, { force: true }).catch(() => {});
        }
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch((error) => {
        logger.warn(`Failed to clean up temp dir ${tempDir}: ${error}`);
      });
    }

    // Inject the detected attributes into each page comment, just before "-->".
    const updated = markdown.replace(PAGE_COMMENT_REGEX, (comment, indexStr, attrs) => {
      const addition = results.get(Number(indexStr));
      if (!addition) return comment;
      return `<!-- page index=${indexStr}${attrs.replace(/\s+$/, "")}${addition} -->`;
    });

    logger.info(`Vision formatting: annotated ${results.size} of ${toProcess.length} page(s).`);
    return updated;
  } finally {
    if (logCallback) logger.unsubscribe(logCallback);
  }
}
