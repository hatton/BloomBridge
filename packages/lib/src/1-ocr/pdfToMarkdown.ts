import { logger, LogEntry } from "../logger";
import fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import { getPdfPageInfo } from "./coverDetection";
import { renderPdfPageToImage } from "./renderPdfPage";
import { hashPageImage } from "./pageImageHash";

// A streamed chat-completion chunk (Server-Sent Events `data:` payload).
interface OpenRouterStreamChunk {
  choices?: Array<{ delta?: { content?: string } }>;
  error?: { message?: string; code?: string | number; metadata?: unknown };
}

/**
 * Read an OpenRouter streaming (SSE) chat-completion response and return the
 * concatenated assistant content. Streaming is used so that a long OCR job
 * doesn't exceed the HTTP body timeout while the model works.
 */
async function readOpenRouterStream(response: Response): Promise<string> {
  if (!response.body) {
    throw new Error("OpenRouter response has no body to stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

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

  return content;
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
): Promise<string> {
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

  let markdown = await readOpenRouterStream(response);
  // Strip a ```markdown ... ``` (or plain ```) wrapper if the model added one.
  const fenced = markdown.match(/^```(?:markdown)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenced) markdown = fenced[1];
  return markdown.trim();
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
      if (masterHashes?.has(hash)) {
        logger.info(`Page ${page}/${pageCount} matched master, skipping OCR`);
        return { md: "_(page provided by master book)_", hash, matched: true };
      }

      const jpegBase64 = (await fsp.readFile(imagePath)).toString("base64");
      const prompt = customPrompt ?? buildPagePrompt(page);
      const md = await ocrPageImage(resolvedModel, openRouterApiKey, jpegBase64, prompt);
      logger.info(`OCR'd page ${page}/${pageCount} (${md.length} chars)`);
      return { md, hash, matched: false };
    });

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
