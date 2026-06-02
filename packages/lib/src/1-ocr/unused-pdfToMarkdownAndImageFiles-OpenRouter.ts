import { logger, LogEntry } from "../logger";
import fs from "fs";

// Type definitions for OpenRouter OCR response
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

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
      annotations?: Array<{
        type?: string;
        file?: {
          filename?: string;
          content?: Array<{
            type: string;
            text?: string;
            image_url?: {
              url: string;
            };
          }>;
        };
      }>;
    };
  }>;
}

/**
 * Model aliases for easier use
 */
const MODEL_ALIASES: Record<string, string> = {
  gemini: "google/gemini-2.5-pro",
  gpt: "openai/gpt-5.4",
};

/**
 * Resolve model name from alias or return as-is
 */
function resolveModelName(model: string): string {
  return MODEL_ALIASES[model] || model;
}

/**
 * Converts a PDF file to markdown format using OpenRouter models
 * @param pdfPath - Path to the PDF file
 * @param imageOutputDir - Directory where extracted images will be saved
 * @param openRouterApiKey - OpenRouter API key for processing
 * @param modelName - Model name (can be alias like "gemini" or full name like "google/gemini-2.5-pro")
 * @param parserEngine - PDF parsing engine: "native", "mistral-ocr", or "pdf-text"
 * @param logCallback - Optional callback to receive log messages
 * @param customPrompt - Optional custom prompt to override the default system prompt
 * @returns Promise resolving to markdown string
 */
export async function pdfToMarkdownAndImageFiles(
  pdfPath: string,
  imageOutputDir: string,
  openRouterApiKey: string,
  modelName: string = "gemini",
  parserEngine: string = "native",
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
    logger.info(`Using PDF parser engine: ${parserEngine}`);

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

    logger.info("Sending PDF to OpenRouter model...");

    // Prepare the request for OpenRouter
    const defaultSystemPrompt = `Return this book in markdown format, both text and image references. For the image references, make sure to given them at the correct location with respect to the text, and use the format ![image](image-x-y.png) where x is the page where it was found an y is nth image on that page.
Starting with the very first line and then again for each page, insert a <!-- page-index="1" -->. Drop the text giving the page number at the bottom.  Be super careful with the transcription, preferring the embedded unicode over optical recognition. 
This book may include minority language text with unusual characters. Therefore, do not omit or substitute any characters, and preserve all Unicode exactly as present, including rare IPA symbols and diacritics. You will return both text and markdown image references. `;

    // You MUST NOT add text, not even to say "This page is blank".
    // You MUST NOT respond with any introductory text, e.g. about your limitations. It is vital that you faithfully return the text of the book, without any additional commentary or interpretation. Do not say "I'm unable..." Do not say "If you need more pages transcribed, please let me know!". That will break our app.`;

    const systemPrompt = customPrompt || defaultSystemPrompt;

    if (customPrompt) {
      logger.info("Using custom prompt for OCR processing");
    }

    // Upload the PDF using OpenRouter's file format
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
      plugins: [
        {
          id: "file-parser",
          pdf: {
            engine: parserEngine,
          },
        },
      ],
      temperature: 0.1,
      max_tokens: 4096,
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

    logger.info(`🔍 DEBUG: Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`OpenRouter API request failed: ${response.status} ${response.statusText}`);
      logger.error(`Error details: ${errorText}`);
      throw new Error(`OpenRouter API request failed: ${response.status} ${response.statusText}`);
    }

    let ocrResponse: OpenRouterResponse;
    try {
      ocrResponse = (await response.json()) as OpenRouterResponse;

      // Log the full response structure for debugging
      logger.info("Full OpenRouter API response structure:");
      logger.info(JSON.stringify(ocrResponse, null, 2));
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

    // Check for annotations that might contain image data (mistral-ocr parser)
    const choice = ocrResponse.choices[0];
    let imageCounter = 1;

    if (choice.message.annotations) {
      logger.info(`Found annotations with potential image data`);

      choice.message.annotations.forEach((annotation) => {
        if (annotation.file?.content) {
          annotation.file.content.forEach((item) => {
            if (item.type === "image_url" && item.image_url?.url) {
              // Extract and save image if it's base64 data
              if (item.image_url.url.startsWith("data:image/")) {
                try {
                  const base64Match = item.image_url.url.match(/^data:image\/(\w+);base64,(.+)$/);
                  if (base64Match) {
                    const imageExtension = base64Match[1];
                    const base64Data = base64Match[2];
                    const imagePath = `${imageOutputDir}/image${imageCounter}.${imageExtension}`;

                    logger.info(`Saving extracted image: image${imageCounter}.${imageExtension}`);
                    fs.writeFileSync(imagePath, Buffer.from(base64Data, "base64"));
                    imageCounter++;
                  }
                } catch (imageError) {
                  logger.error(
                    `Failed to save image: ${imageError instanceof Error ? imageError.message : String(imageError)}`,
                  );
                }
              }
            }
          });
        }
      });

      if (imageCounter > 1) {
        logger.info(`✅ Successfully extracted ${imageCounter - 1} images from annotations`);
      }
    } else {
      logger.info("No annotations found - checking for embedded images in markdown content");
    }

    let markdown = choice.message.content;

    logger.info("Extracting markdown from API response structure:");
    logger.info(`- choices[0].message.content length: ${markdown.length} characters`);

    // Extract markdown from code blocks if wrapped
    const codeBlockMatch = markdown.match(/```markdown\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      markdown = codeBlockMatch[1];
      logger.info("✅ Extracted markdown content from code block in choices[0].message.content");
      logger.info(`- Extracted markdown length: ${markdown.length} characters`);
    } else {
      logger.info(
        "No markdown code block found, using raw content from choices[0].message.content",
      );
    }

    // Also log any annotations structure if present
    if (choice.message.annotations) {
      logger.info(
        `- Found ${choice.message.annotations.length} annotation(s) in choices[0].message.annotations`,
      );
      choice.message.annotations.forEach((annotation, index) => {
        if (annotation.file?.content) {
          logger.info(
            `  - Annotation ${index}: file.content array with ${annotation.file.content.length} items`,
          );
        }
      });
    }

    // Extract base64 images from markdown content (native parser approach)
    const imageRegex = /!\[([^\]]*)\]\(data:image\/(\w+);base64,([^)]+)\)/g;
    let match;
    let extractedFromMarkdown = 0;

    while ((match = imageRegex.exec(markdown)) !== null) {
      const [fullMatch, altText, imageExtension, base64Data] = match;
      try {
        const imagePath = `${imageOutputDir}/image${imageCounter}.${imageExtension}`;
        const imageFilename = `image${imageCounter}.${imageExtension}`;

        logger.info(`Extracting image from markdown: ${imageFilename}`);
        fs.writeFileSync(imagePath, Buffer.from(base64Data, "base64"));

        // Replace the data URI with a file reference
        markdown = markdown.replace(fullMatch, `![${altText}](${imageFilename})`);

        imageCounter++;
        extractedFromMarkdown++;
      } catch (imageError) {
        logger.error(
          `Failed to save image from markdown: ${imageError instanceof Error ? imageError.message : String(imageError)}`,
        );
      }
    }

    if (extractedFromMarkdown > 0) {
      logger.info(
        `✅ Successfully extracted ${extractedFromMarkdown} images from markdown content`,
      );
    }

    // Ensure we have page markers if not present
    if (!markdown.includes("<!-- page")) {
      markdown = `<!-- page index=1 -->\n${markdown}`;
    }

    // Ensure output directory exists
    logger.verbose("Creating output directory for images...");
    if (!fs.existsSync(imageOutputDir)) {
      fs.mkdirSync(imageOutputDir, { recursive: true });
    }

    // Note: OpenRouter models typically don't extract separate images like Mistral's OCR
    // The images are described in the markdown text rather than provided as separate base64 data
    // If image extraction is needed, additional processing would be required

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
