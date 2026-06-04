import { logger, LogEntry } from "../logger";
import fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import { getPdfPageInfo } from "./coverDetection";
import { renderPdfPageToImage } from "./renderPdfPage";
import { hashPageImage, hashesMatch } from "./pageImageHash";

// A streamed chat-completion chunk (Server-Sent Events `data:` payload).
interface OpenRouterStreamChunk {
  id?: string;
  choices?: Array<{ delta?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  error?: { message?: string; code?: string | number; metadata?: unknown };
}

export interface OcrUsage {
  promptTokens: number;
  completionTokens: number;
  /** Actual USD cost (OpenRouter returns this in `usage` when usage.include=true). */
  costUsd?: number;
  /** OpenRouter generation id, for a later $-cost lookup. */
  generationId?: string;
}

interface StreamResult {
  content: string;
  usage?: OcrUsage;
}

/**
 * Read an OpenRouter streaming (SSE) chat-completion response and return the
 * concatenated assistant content plus token usage. Streaming is used so that a
 * long OCR job doesn't exceed the HTTP body timeout while the model works; with
 * `usage: { include: true }` the final SSE chunk carries the usage totals.
 */
async function readOpenRouterStream(response: Response): Promise<StreamResult> {
  if (!response.body) {
    throw new Error("OpenRouter response has no body to stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usage: OcrUsage | undefined;
  let generationId: string | undefined;

  const handleData = (data: string) => {
    if (data === "[DONE]") return;
    let chunk: OpenRouterStreamChunk;
    try {
      chunk = JSON.parse(data) as OpenRouterStreamChunk;
    } catch {
      return; // ignore non-JSON keep-alive payloads
    }
    if (chunk.error) {
      logger.error(`OpenRouter stream error (full): ${JSON.stringify(chunk.error).slice(0, 3000)}`);
      throw new Error(`OpenRouter stream error: ${chunk.error.message ?? "unknown"}`);
    }
    if (chunk.id) generationId = chunk.id;
    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens ?? 0,
        completionTokens: chunk.usage.completion_tokens ?? 0,
        costUsd: typeof chunk.usage.cost === "number" ? chunk.usage.cost : undefined,
      };
    }
    const delta = chunk.choices?.[0]?.delta?.content;
    if (typeof delta === "string") content += delta;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // keep the trailing partial line
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip blanks and ": OPENROUTER PROCESSING" keep-alive comments.
      if (!trimmed.startsWith("data:")) continue;
      handleData(trimmed.slice("data:".length).trim());
    }
  }

  const tail = buffer.trim();
  if (tail.startsWith("data:")) handleData(tail.slice("data:".length).trim());

  if (usage && generationId) usage.generationId = generationId;
  return { content, usage };
}

/**
 * Model aliases for easier use
 */
const MODEL_ALIASES: Record<string, string> = {
  gemini: "google/3.1-pro-preview",
  gpt: "openai/gpt-5.4",
};

// Render pages at this DPI before sending to the vision model. High enough for
// small body text, low enough to keep each request fast.
const OCR_RENDER_DPI = 200;

// How many pages to OCR concurrently. Keeps us well under provider rate limits
// while still being much faster than serial.
const OCR_CONCURRENCY = 5;

/**
 * Resolve model name from alias or return as-is
 */
function resolveModelName(model: string): string {
  return MODEL_ALIASES[model] || model;
}

/** Build the per-page OCR prompt. `pageNumber` lets the model name images correctly. */
function buildPagePrompt(pageNumber: number): string {
  return `You are transcribing a single page (page ${pageNumber}) of a book to Markdown.

- Transcribe ALL visible text exactly. Preserve every Unicode character as-is, including rare IPA symbols and diacritics; do not omit or substitute characters.
- Use Markdown headings (#, ##, ###, …) for text that is visually a heading or title.
- For each picture on the page, output an image reference at its location in the form ![image](image-${pageNumber}-K.png){width=400} where K is the 1-based index of the picture on this page (first picture = 1). Output one reference per picture; some pages have more than one.
- If the page has a bit of text in one corner and another bit in another corner, output them as separate paragraphs.
- Drop any page-number text (e.g. a lone number at the top or bottom).
- Output ONLY the Markdown for this page. Do NOT add a page-marker comment, code fences, or any commentary.`;
}

/** Run an async mapper over items with bounded concurrency, preserving order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = Array.from({ length: items.length }) as R[];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Send one page image to the model and return its transcribed Markdown. */
async function ocrPageImage(
  model: string,
  apiKey: string,
  jpegBase64: string,
  prompt: string,
): Promise<{ markdown: string; usage?: OcrUsage }> {
  const requestBody = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpegBase64}` } },
        ],
      },
    ],
    temperature: 0.0,
    max_tokens: 8000,
    stream: true,
    // Ask OpenRouter to include token usage in the final SSE chunk.
    usage: { include: true },
  };

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/hatton/pdf-to-bloom",
      "X-Title": "PDF to Bloom Converter",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenRouter request failed: ${response.status} ${response.statusText} — ${errorText.slice(0, 500)}`,
    );
  }

  const { content, usage } = await readOpenRouterStream(response);
  let markdown = content;
  // Strip a ```markdown ... ``` (or plain ```) wrapper if the model added one.
  const fenced = markdown.match(/^```(?:markdown)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenced) markdown = fenced[1];
  return { markdown: markdown.trim(), usage };
}

/**
 * Convert a PDF to markdown by OCR-ing one page at a time with an OpenRouter
 * vision model.
 *
 * Each page is rendered to an image (via Poppler `pdftocairo`) and sent in its
 * own request. Doing the whole book in a single request times out at the
 * provider for large/image-heavy books (HTTP 504); per-page requests stay small
 * and fast, and run with bounded concurrency.
 *
 * @param pdfPath - Path to the PDF file
 * @param openRouterApiKey - OpenRouter API key
 * @param modelName - Model name or alias (e.g. "gpt" -> "openai/gpt-5.4")
 * @param logCallback - Optional callback to receive log messages
 * @param customPrompt - Optional override for the per-page prompt
 * @param options - Optional extras. `masterHashes` is the set of page-image
 *        hashes held by a "master" book; any source page whose render matches one
 *        skips OCR entirely (its content is supplied later by master-page
 *        substitution — see master/masterPages.ts).
 * @returns Promise resolving to the assembled markdown (with page markers)
 */
export async function pdfToMarkdown(
  pdfPath: string,
  openRouterApiKey: string,
  modelName: string = "gpt",
  logCallback?: (log: LogEntry) => void,
  customPrompt?: string,
  options?: { masterHashes?: Set<string> },
): Promise<string> {
  if (logCallback) logger.subscribe(logCallback);

  let tempDir: string | undefined;
  try {
    if (!openRouterApiKey || openRouterApiKey.trim() === "") {
      logger.error("OpenRouter API key is required");
      throw new Error("OpenRouter API key is required");
    }
    if (!fs.existsSync(pdfPath)) {
      logger.error(`PDF file not found: ${pdfPath}`);
      throw new Error(`PDF file not found: ${pdfPath}`);
    }

    const resolvedModel = resolveModelName(modelName);
    const { pageCount } = await getPdfPageInfo(pdfPath);
    logger.info(
      `OCR'ing ${pageCount} page(s) of ${path.basename(pdfPath)} with ${resolvedModel}, ${OCR_CONCURRENCY} at a time...`,
    );
    if (customPrompt) logger.info("Using custom per-page prompt for OCR processing");

    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pdf-ocr-"));
    const pageNumbers = Array.from({ length: pageCount }, (_, i) => i + 1);

    const masterHashes = options?.masterHashes;

    const pageResults = await mapWithConcurrency(pageNumbers, OCR_CONCURRENCY, async (page) => {
      const imagePath = path.join(tempDir!, `page-${page}.jpg`);
      await renderPdfPageToImage(pdfPath, page, imagePath, { dpi: OCR_RENDER_DPI });
      const hash = await hashPageImage(imagePath);

      // If this page's render matches one of the master book's pages, skip OCR:
      // the master supplies its exact HTML + images during substitution. Emit a
      // short placeholder so the page survives parsing (an empty page is dropped).
      // Matching is perceptual (Hamming distance), so a compressed copy still hits.
      if (masterHashes && [...masterHashes].some((mh) => hashesMatch(hash, mh))) {
        logger.info(`Page ${page}/${pageCount} matched master, skipping OCR`);
        return { md: "_(page provided by master book)_", hash, matched: true, usage: undefined };
      }

      const jpegBase64 = (await fsp.readFile(imagePath)).toString("base64");
      const prompt = customPrompt ?? buildPagePrompt(page);
      const { markdown: md, usage } = await ocrPageImage(
        resolvedModel,
        openRouterApiKey,
        jpegBase64,
        prompt,
      );
      logger.info(`OCR'd page ${page}/${pageCount} (${md.length} chars)`);
      logger.event({ kind: "progress", stage: "ocr", page, pageCount });
      return { md, hash, matched: false, usage };
    });

    // Aggregate token usage + cost across pages and emit a single tokens event.
    let ocrTokensIn = 0;
    let ocrTokensOut = 0;
    let ocrCost = 0;
    let haveCost = false;
    const generationIds: string[] = [];
    for (const r of pageResults) {
      if (r.usage) {
        ocrTokensIn += r.usage.promptTokens;
        ocrTokensOut += r.usage.completionTokens;
        if (typeof r.usage.costUsd === "number") {
          ocrCost += r.usage.costUsd;
          haveCost = true;
        }
        if (r.usage.generationId) generationIds.push(r.usage.generationId);
      }
    }
    if (ocrTokensIn || ocrTokensOut) {
      logger.event({
        kind: "tokens",
        stage: "ocr",
        tokensIn: ocrTokensIn,
        tokensOut: ocrTokensOut,
        costUsd: haveCost ? ocrCost : undefined,
        generationIds,
      });
    }

    const markdown = pageResults
      .map(({ md, hash, matched }, i) => {
        // `master-page` forces the page to render as a splice target even if the
        // LLM classifies it as back-matter (which would otherwise be dropped).
        const masterAttr = matched ? ` master-page="true"` : "";
        return `<!-- page index=${i + 1} import-source-hash="${hash}"${masterAttr} -->\n${md}`;
      })
      .join("\n\n");

    logger.info("PDF to markdown conversion completed successfully");
    return markdown;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`OpenRouter OCR failed: ${errorMessage}`);
    throw new Error(`OpenRouter OCR processing failed: ${errorMessage}`);
  } finally {
    if (tempDir) {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
    if (logCallback) logger.unsubscribe(logCallback);
  }
}

/**
 * Get available model aliases
 */
export function getModelAliases(): Record<string, string> {
  return { ...MODEL_ALIASES };
}
