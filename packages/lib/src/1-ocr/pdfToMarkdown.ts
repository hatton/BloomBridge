import { logger, LogEntry } from "../logger";
import fs from "fs";

// Type definitions for OpenRouter response
interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

// Type definitions for OpenRouter file content (from their original approach)
interface OpenRouterMessage {
  role: "user" | "assistant" | "system";
  content: Array<{
    type: "text" | "file";
    text?: string;
    file?: {
      filename: string;
      file_data: string;
    };
  }>;
}

/**
 * Model aliases for easier use
 */
const MODEL_ALIASES: Record<string, string> = {
  gemini: "google/3.1-pro-preview",
  gpt: "openai/gpt-5.4",
};

/**
 * Resolve model name from alias or return as-is
 */
function resolveModelName(model: string): string {
  return MODEL_ALIASES[model] || model;
}

/**
 * Converts a PDF file to markdown format using OpenRouter models with simple file upload
 * @param pdfPath - Path to the PDF file
 * @param openRouterApiKey - OpenRouter API key for processing
 * @param modelName - Model name (can be alias like "gemini" or full name like "google/3.1-pro-preview")
 * @param logCallback - Optional callback to receive log messages
 * @param customPrompt - Optional custom prompt to override the default system prompt
 * @returns Promise resolving to markdown string
 */
export async function pdfToMarkdown(
  pdfPath: string,
  openRouterApiKey: string,
  modelName: string = "gemini",
  logCallback?: (log: LogEntry) => void,
  customPrompt?: string,
): Promise<string> {
  if (logCallback) logger.subscribe(logCallback);

  try {
    // Validate API key
    if (!openRouterApiKey || openRouterApiKey.trim() === "") {
      logger.error("OpenRouter API key is required");
      throw new Error("OpenRouter API key is required");
    }

    const resolvedModel = resolveModelName(modelName);
    logger.info(
      `Starting PDF to markdown conversion for: ${pdfPath} using model: ${resolvedModel}`,
    );

    // Check if PDF file exists
    if (!fs.existsSync(pdfPath)) {
      logger.error(`PDF file not found: ${pdfPath}`);
      throw new Error(`PDF file not found: ${pdfPath}`);
    }

    // Get file size for logging
    const fileStats = fs.statSync(pdfPath);
    logger.info(`PDF file size: ${Math.round(fileStats.size / 1024)} KB`);

    // Read and encode PDF as base64
    logger.verbose("Reading PDF file and encoding to base64...");
    const pdfBuffer = fs.readFileSync(pdfPath);
    const base64Pdf = pdfBuffer.toString("base64");

    logger.info(`Sending PDF to  ${resolvedModel} for OCR'ing...`);

    // Default system prompt copied from the original file
    const defaultSystemPrompt = `Return this book in markdown format, both text and image references. 
    
    # Images
    For the image references, make sure to given them at the correct location with respect to the text, and use the format ![image](image-x-y.png){width=400px} where x is the page where it was found an y is nth image on that page. Make sure to output all images, some pages have more than one image.

    # Pages
    Starting with the very first line and then again for each page, insert a <!-- page-index="1" -->. Drop the text giving the page number at the bottom.  Be super careful with the transcription, preferring the embedded unicode over optical recognition. 

    # Text
    This book may include minority language text with unusual characters. Therefore, do not omit or substitute any characters, and preserve all Unicode exactly as present, including rare IPA symbols and diacritics. 

    # Special First Page Instructions
    It is common to have a bit of text in one corner and another bit of text across from it in the other corner. When you see this, output them as two separate paragraphs. In doing so, Make sure to output all images, some pages have more than one image.
    
    # Markdown
    You will return both text and markdown image references. `;

    const systemPrompt = customPrompt || defaultSystemPrompt;

    if (customPrompt) {
      logger.info("Using custom prompt for OCR processing");
    }

    // Prepare the request for OpenRouter using the file content type
    // This uses an undocumented but working file content type from the original implementation
    const userMessage: OpenRouterMessage = {
      role: "user",
      content: [
        {
          type: "text",
          text: "Please convert this PDF to markdown format following the requirements specified in the system prompt.",
        },
        {
          type: "file",
          file: {
            filename: "document.pdf",
            file_data: `data:application/pdf;base64,${base64Pdf}`,
          },
        },
      ],
    };

    const requestBody = {
      model: resolvedModel,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        userMessage,
      ],
      temperature: 0.0,
      max_tokens: 8000, // todo Increase max tokens for longer documents
    };

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/hatton/pdf-to-bloom",
        "X-Title": "PDF to Bloom Converter",
      },
      body: JSON.stringify(requestBody),
    });

    logger.info(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`OpenRouter API request failed: ${response.status} ${response.statusText}`);
      logger.error(`Error details: ${errorText}`);
      throw new Error(`OpenRouter API request failed: ${response.status} ${response.statusText}`);
    }

    let ocrResponse: OpenRouterResponse;
    try {
      ocrResponse = (await response.json()) as OpenRouterResponse;
      logger.verbose("Received response from OpenRouter model");
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      logger.error(`Failed to parse JSON response: ${message}`);
      throw new Error(`Failed to parse OpenRouter response: ${message}`);
    }

    if (!ocrResponse.choices || ocrResponse.choices.length === 0) {
      logger.error("OCR request failed: No response choices received");
      throw new Error("OCR request failed: No response choices received");
    }

    logger.info("✅ Received response from OpenRouter model");

    let markdown = ocrResponse.choices[0].message.content;

    logger.info(`Received markdown content: ${markdown.length} characters`);

    // Extract markdown from code blocks if wrapped
    const codeBlockMatch = markdown.match(/```markdown\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      markdown = codeBlockMatch[1];
      logger.info("✅ Extracted markdown content from code block");
    }

    // Ensure we have page markers if not present
    if (!markdown.includes("<!-- page")) {
      markdown = `<!-- page-index="1" -->\n${markdown}`;
    }

    logger.info("PDF to markdown conversion completed successfully");
    return markdown;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`OpenRouter OCR failed: ${errorMessage}`);
    throw new Error(`OpenRouter OCR processing failed: ${errorMessage}`);
  } finally {
    if (logCallback) logger.unsubscribe(logCallback);
  }
}

/**
 * Get available model aliases
 */
export function getModelAliases(): Record<string, string> {
  return { ...MODEL_ALIASES };
}
