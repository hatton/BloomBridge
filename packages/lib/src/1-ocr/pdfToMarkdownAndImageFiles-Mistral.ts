import { logger, LogEntry } from "../logger";
import fs from "fs";
import path from "path";
import { Mistral } from "@mistralai/mistralai";

// Type definitions for Mistral OCR API response
interface MistralOCRImage {
  id: string;
  topLeftX: number;
  topLeftY: number;
  bottomRightX: number;
  bottomRightY: number;
  imageBase64: string;
  imageAnnotation: string | null;
}

interface MistralOCRPageDimensions {
  dpi: number;
  height: number;
  width: number;
}

interface MistralOCRPage {
  index: number;
  markdown: string;
  images: MistralOCRImage[];
  dimensions: MistralOCRPageDimensions;
}

interface MistralOCRResponse {
  pages: MistralOCRPage[];
}

interface OCRImage {
  id: string;
  topLeftX: number;
  topLeftY: number;
  bottomRightX: number;
  bottomRightY: number;
  imageBase64: string;
  imageAnnotation: string | null;
  localPath: string;
}

/**
 * Converts a PDF file to markdown format using Mistral AI OCR
 * @param pdfPath - Path to the PDF file
 * @param imageOutputDir - Directory where extracted images will be saved
 * @param mistralApiKey - MistralAI API key for processing
 * @param logCallback - Optional callback to receive log messages
 * @returns Promise resolving to markdown string
 */
export async function pdfToMarkdownAndImageFiles(
  pdfPath: string,
  imageOutputDir: string,
  mistralApiKey: string,
  logCallback?: (log: LogEntry) => void,
): Promise<string> {
  if (logCallback) logger.subscribe(logCallback);

  try {
    // Validate API key
    if (!mistralApiKey || mistralApiKey.trim() === "") {
      logger.error("MistralAI API key is required");
      throw new Error("MistralAI API key is required");
    }

    logger.info(`Starting PDF to markdown conversion for: ${pdfPath}`);

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

    logger.info("Sending PDF to Mistral AI OCR API...");

    // Use the Mistral client for OCR processing
    const client = new Mistral({ apiKey: mistralApiKey });
    const ocrResponse = (await client.ocr.process({
      model: "mistral-ocr-latest",
      document: {
        type: "document_url",
        documentUrl: "data:application/pdf;base64," + base64Pdf,
      },
      includeImageBase64: true,
    })) as MistralOCRResponse;

    if (!ocrResponse) {
      logger.error("OCR request failed: No response received");
      throw new Error("OCR request failed: No response received");
    }

    logger.info("✅ Received response from Mistral AI OCR API");

    // Combine markdown from all pages. Each must start with a <!-- page {index:number} --> comment
    let markdown = ocrResponse.pages
      .map((page: MistralOCRPage, index: number) => {
        return `<!-- page index=${1 + index} -->\n${page.markdown}`;
      })
      .join("\n\n");

    // Ensure output directory exists
    logger.verbose("Creating output directory for images...");
    if (!fs.existsSync(imageOutputDir)) {
      fs.mkdirSync(imageOutputDir, { recursive: true });
    }

    // Process and save images
    logger.info("Saving extracted images...");
    const images: OCRImage[] = [];

    for (const page of ocrResponse.pages) {
      for (const img of page.images) {
        try {
          const imagePath = path.join(imageOutputDir, img.id);

          // Save the image file
          await saveBase64Image(img.imageBase64, imagePath);

          // Add to images array with local path
          images.push({
            id: img.id,
            topLeftX: img.topLeftX,
            topLeftY: img.topLeftY,
            bottomRightX: img.bottomRightX,
            bottomRightY: img.bottomRightY,
            imageBase64: img.imageBase64,
            imageAnnotation: img.imageAnnotation || null,
            localPath: imagePath,
          });

          logger.verbose(`Saved image: ${img.id}`);
        } catch (imageError) {
          logger.error(`Failed to save image ${img.id}: ${imageError}`);
        }
      }
    }

    // Enhance markdown with image dimensions
    markdown = enhanceMarkdownWithImageDimensions(markdown, images);

    logger.info("PDF to markdown conversion completed successfully");
    return markdown;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Mistral AI OCR failed: ${errorMessage}`);
    throw new Error(`Mistral AI OCR processing failed: ${errorMessage}`);
  } finally {
    if (logCallback) logger.unsubscribe(logCallback);
  }
}

/**
 * Calculate image dimensions from coordinates
 * @param image - OCR image with coordinate information
 * @returns Object containing width and height
 */
function calculateImageDimensions(image: OCRImage): {
  width: number;
  height: number;
} {
  const width = image.bottomRightX - image.topLeftX;
  const height = image.bottomRightY - image.topLeftY;
  return { width, height };
}

/**
 * Enhance markdown by adding image dimensions to image references
 * @param markdown - Original markdown content
 * @param images - Array of OCR images with coordinate information
 * @returns Enhanced markdown with dimension information
 */
function enhanceMarkdownWithImageDimensions(markdown: string, images: OCRImage[]): string {
  let enhancedMarkdown = markdown;

  for (const img of images) {
    const dimensions = calculateImageDimensions(img);

    // Find and replace image references with dimension info
    // Pattern: ![img-id](img-id) -> ![img-id](img-id){width=width,height=height}
    const imagePattern = new RegExp(`!\\[${img.id}\\]\\(${img.id}\\)`, "g");
    const replacement = `![${img.id}](${img.id}){width=${dimensions.width}}`;

    enhancedMarkdown = enhancedMarkdown.replace(imagePattern, replacement);
  }

  return enhancedMarkdown;
}

/**
 * Save a base64 image string to a file with the correct extension based on image type
 * @param base64ImageData - Base64 encoded image data (with or without data URL prefix)
 * @param filePath - Base file path (extension will be updated based on image type)
 * @returns Promise that resolves when the file is saved
 */
async function saveBase64Image(base64ImageData: string, filePath: string): Promise<void> {
  const justImageData = base64ImageData.replace(/^data:image\/[a-z]+;base64,/, "");

  // Save the image file
  fs.writeFileSync(filePath, justImageData, "base64");
}
