import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../logger";

// Import Sharp at module level for proper resolution
import sharp from "sharp";

export interface ExtractedImage {
  buffer: Buffer;
  pageNumber: number;
  imageIndex: number; // Index of the image within the page (1-based)
  filename: string; // e.g., "image-1-1.png", "image-2-3.png"
}

/**
 * Extracts all images from a PDF file and returns them with proper naming
 * @param pdfPath - Path to the PDF file or ArrayBuffer containing PDF data
 * @returns Promise resolving to array of extracted images with metadata
 */
export async function extractImagesFromPdf(
  pdfPath: string | ArrayBuffer,
): Promise<ExtractedImage[]> {
  try {
    logger.info("Starting image extraction from PDF using PDF.js + Sharp");

    const loadingTask = getDocument(pdfPath);
    const pdf = await loadingTask.promise;

    const numPages = pdf.numPages;
    const extractedImages: ExtractedImage[] = [];

    logger.info(`PDF has ${numPages} pages`);

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      logger.info(`Processing page ${pageNum}`);

      const page = await pdf.getPage(pageNum);
      const ops = await page.getOperatorList();

      let imageIndexOnPage = 1; // 1-based index for images on this page

      for (let j = 0; j < ops.fnArray.length; j++) {
        if (ops.fnArray[j] === OPS.paintImageXObject) {
          try {
            const args = ops.argsArray[j] as unknown[];
            const imgName = args[0] as string;

            // Wait for the object to be resolved
            await new Promise<void>((resolve) => {
              const checkResolved = () => {
                if (page.objs.has(imgName)) {
                  resolve();
                } else {
                  // If not resolved yet, wait a bit and try again
                  setTimeout(checkResolved, 10);
                }
              };
              checkResolved();
            });

            const imgObj = page.objs.get(imgName) as NodeJS.Dict<unknown>;

            const { width, height, data: imgData } = imgObj;

            if (
              !(imgData instanceof Uint8ClampedArray || imgData instanceof Uint8Array) ||
              typeof width !== "number" ||
              typeof height !== "number"
            ) {
              logger.warn(`Skipping invalid image data on page ${pageNum}`);
              continue;
            }

            // Convert Uint8Array to Uint8ClampedArray if needed
            const clampedImgData =
              imgData instanceof Uint8ClampedArray ? imgData : new Uint8ClampedArray(imgData);

            // Check if data appears to be RGB (3 channels) or RGBA (4 channels)
            const bytesPerPixel = clampedImgData.length / (width * height);
            let imageBuffer: Buffer;

            if (bytesPerPixel === 3) {
              // RGB data - convert to PNG using Sharp
              imageBuffer = await sharp(Buffer.from(clampedImgData), {
                raw: {
                  width,
                  height,
                  channels: 3,
                },
              })
                .png()
                .toBuffer();
            } else if (bytesPerPixel === 4) {
              // RGBA data - convert to PNG using Sharp
              imageBuffer = await sharp(Buffer.from(clampedImgData), {
                raw: {
                  width,
                  height,
                  channels: 4,
                },
              })
                .png()
                .toBuffer();
            } else {
              // Assume RGB and pad to 4 channels if needed
              const rgbaData = new Uint8ClampedArray(width * height * 4);
              for (let i = 0; i < width * height; i++) {
                const srcOffset = i * bytesPerPixel;
                const dstOffset = i * 4;
                rgbaData[dstOffset] = clampedImgData[srcOffset] || 0; // R
                rgbaData[dstOffset + 1] = clampedImgData[srcOffset + 1] || 0; // G
                rgbaData[dstOffset + 2] = clampedImgData[srcOffset + 2] || 0; // B
                rgbaData[dstOffset + 3] = 255; // A
              }
              imageBuffer = await sharp(Buffer.from(rgbaData), {
                raw: {
                  width,
                  height,
                  channels: 4,
                },
              })
                .png()
                .toBuffer();
            }

            const filename = `image-${pageNum}-${imageIndexOnPage}.png`;

            extractedImages.push({
              buffer: imageBuffer,
              pageNumber: pageNum,
              imageIndex: imageIndexOnPage,
              filename: filename,
            });

            logger.info(`Extracted image: ${filename} (${width}x${height})`);
            imageIndexOnPage++;
          } catch (error) {
            logger.error(`Error extracting image on page ${pageNum}: ${error}`);
          }
        }
      }
    }

    logger.info(`Extraction complete. Found ${extractedImages.length} images total`);
    return extractedImages;
  } catch (error) {
    logger.error(`Error during PDF image extraction: ${error}`);
    throw error;
  }
}

/**
 * Extracts images from a PDF file and saves them to a specified directory
 * @param pdfPath - Path to the PDF file
 * @param outputDir - Directory where images will be saved
 * @returns Promise resolving to array of saved file paths
 */
export async function extractAndSaveImages(pdfPath: string, outputDir: string): Promise<string[]> {
  try {
    // Read the PDF file
    const pdfBuffer = await fs.readFile(pdfPath);

    // Extract images
    const extractedImages = await extractImagesFromPdf(pdfBuffer.buffer);

    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Save each image
    const savedPaths: string[] = [];
    for (const image of extractedImages) {
      const outputPath = path.join(outputDir, image.filename);
      await fs.writeFile(outputPath, image.buffer);
      savedPaths.push(outputPath);
      logger.info(`Saved image: ${outputPath}`);
    }

    return savedPaths;
  } catch (error) {
    logger.error(`Error saving extracted images: ${error}`);
    throw error;
  }
}
