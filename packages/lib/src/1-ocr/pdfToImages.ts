import { spawn } from "child_process";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";
import * as os from "os";
import { logger } from "../logger";
import { getModuleDir } from "../moduleDir";

export interface PdfImage {
  pageNumber: number;
  imageIndex: number; // Index of the image within the page (1-based)
  filename: string; // e.g., "image-1-1.png", "image-2-3.png"
  originalFilename: string; // The filename that pdfimages generates
  width: number;
  height: number;
  type: string; // e.g., "image", "jpeg", "png"
}

/**
 * Gets the path to the pdfimages executable
 * First tries the bundled version, then falls back to system PATH
 */
function getPdfImagesPath(): string {
  // The Poppler binaries are copied into `<dist>/bin/win32` at build time. Depending
  // on whether this module is running bundled (dist/index.{mjs,cjs}) or unbundled
  // (src during tests), the binaries sit at a different relative offset, so try the
  // likely candidates before falling back to the system PATH.
  const moduleDir = getModuleDir();
  const candidates = [
    path.resolve(moduleDir, "bin", "win32", "pdfimages.exe"), // bundled: dist/bin/win32
    path.resolve(moduleDir, "..", "bin", "win32", "pdfimages.exe"), // legacy nested layout
    path.resolve(moduleDir, "..", "..", "bin", "win32", "pdfimages.exe"), // src/1-ocr -> packages/lib/bin
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Fall back to system PATH
  logger.info("Using pdfimages from system PATH");
  return "pdfimages";
}

/**
 * Runs pdfimages command and returns the output
 */
async function runPdfImages(args: string[]): Promise<string> {
  const pdfImagesPath = getPdfImagesPath();

  return new Promise((resolve, reject) => {
    const childProcess = spawn(pdfImagesPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LANG: "en_US.UTF-8" },
    });

    let stdout = "";
    let stderr = "";

    childProcess.stdout.on("data", (data: Buffer) => {
      stdout += data.toString("utf8");
    });

    childProcess.stderr.on("data", (data: Buffer) => {
      stderr += data.toString("utf8");
    });

    childProcess.on("close", (code: number | null) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`pdfimages failed with code ${code}: ${stderr}`));
      }
    });

    childProcess.on("error", (error: Error) => {
      reject(new Error(`Failed to run pdfimages: ${error.message}`));
    });
  });
}

/**
 * Parses the output of `pdfimages -list` to get image information
 */
function parseImageList(listOutput: string): Array<{
  page: number;
  num: number;
  type: string;
  width: number;
  height: number;
  enc: string; // encoding type (jpeg, png, image, etc.)
}> {
  const lines = listOutput.trim().split("\n");
  const images: Array<{
    page: number;
    num: number;
    type: string;
    width: number;
    height: number;
    enc: string;
  }> = [];

  // Skip header lines (first 2 lines are usually headers)
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse line format: page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio
    const parts = line.split(/\s+/);
    if (parts.length >= 9) {
      const page = parseInt(parts[0]);
      const num = parseInt(parts[1]);
      const type = parts[2];
      const width = parseInt(parts[3]);
      const height = parseInt(parts[4]);
      const enc = parts[8]; // encoding is the 9th column (index 8)

      if (!isNaN(page) && !isNaN(num) && !isNaN(width) && !isNaN(height)) {
        images.push({ page, num, type, width, height, enc });
      }
    }
  }

  return images;
}

/**
 * Extracts images from a PDF using pdfimages and returns metadata with proper naming
 * @param pdfPath - Path to the PDF file
 * @param outputDir - Directory where images will be extracted
 * @returns Promise resolving to array of extracted image metadata
 */
export async function extractImagesWithPdfImages(
  pdfPath: string,
  outputDir: string,
): Promise<PdfImage[]> {
  try {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // First, get the list of images to understand the structure
    const listOutput = await runPdfImages(["-list", pdfPath]);
    const imageList = parseImageList(listOutput);

    logger.info(`Found ${imageList.length} images in PDF`);

    if (imageList.length === 0) {
      return [];
    }

    // Use a temporary directory with ASCII-only path to avoid Unicode issues with pdfimages
    const tempDir = path.join(
      os.tmpdir(),
      `pdfimages_${Date.now()}_${Math.random().toString(36).substring(2)}`,
    );
    await fs.mkdir(tempDir, { recursive: true });

    try {
      // Create a temporary prefix for pdfimages output in the temp directory
      const tempPrefix = path.join(tempDir, "temp_img");

      // Extract all images using Poppler, forcing PNG output. `-png` decodes every
      // source encoding (raw "image", ccitt/stencil bilevel, jpeg, etc.) to a valid
      // PNG with deterministic `temp_img-NNN.png` names. `-all` instead emits native
      // formats (e.g. `.ccitt`) that aren't web-usable and break filename matching.
      await runPdfImages(["-png", pdfPath, tempPrefix]);

      // Process extracted images and rename them to match our naming convention
      const extractedImages: PdfImage[] = [];
      const pageImageCounts = new Map<number, number>(); // Track image count per page

      for (const imageInfo of imageList) {
        // Skip soft masks (smask) as they are transparency masks, not standalone images
        if (imageInfo.type === "smask") {
          logger.info(`Skipping soft mask on page ${imageInfo.page} (image ${imageInfo.num})`);
          continue;
        }

        // Calculate the image index within the page
        const currentCount = pageImageCounts.get(imageInfo.page) || 0;
        pageImageCounts.set(imageInfo.page, currentCount + 1);
        const imageIndexOnPage = currentCount + 1;

        // `-png` always emits PNG, so our output and the source file are both .png.
        const ourFilename = `image-${imageInfo.page}-${imageIndexOnPage}.png`;

        // pdfimages names files `<prefix>-<num>.png`, where <num> is the (zero-based,
        // 3-padded) value from the `-list` output.
        const pdfImagesPath = path.join(
          tempDir,
          `temp_img-${String(imageInfo.num).padStart(3, "0")}.png`,
        );

        if (!existsSync(pdfImagesPath)) {
          logger.warn(
            `Could not find extracted image file for image ${imageInfo.num} at ${pdfImagesPath}`,
          );
          continue;
        }

        const finalPath = path.join(outputDir, ourFilename);

        try {
          // Move the file from temp directory to final location
          await fs.rename(pdfImagesPath, finalPath);

          extractedImages.push({
            pageNumber: imageInfo.page,
            imageIndex: imageIndexOnPage,
            filename: ourFilename,
            originalFilename: path.basename(pdfImagesPath),
            width: imageInfo.width,
            height: imageInfo.height,
            type: imageInfo.type,
          });

          logger.info(`${ourFilename} (${imageInfo.width}x${imageInfo.height})`);
        } catch (error) {
          logger.warn(`Failed to process image ${imageInfo.num}: ${error}`);
        }
      }

      logger.info(`Extraction complete. Successfully extracted ${extractedImages.length} images`);
      return extractedImages;
    } finally {
      // Clean up the temporary directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        logger.warn(`Failed to clean up temp directory ${tempDir}: ${error}`);
      }
    }
  } catch (error) {
    logger.error(`Error during PDF image extraction: ${error}`);
    throw error;
  }
}

/**
 * Higher-level function that extracts images and returns the file paths
 * Compatible with the existing extractAndSaveImages interface
 */
export async function extractAndSaveImagesWithPdfImages(
  pdfPath: string,
  outputDir: string,
): Promise<string[]> {
  try {
    const extractedImages = await extractImagesWithPdfImages(pdfPath, outputDir);
    return extractedImages.map((img) => path.join(outputDir, img.filename));
  } catch (error) {
    logger.error(`Error saving extracted images with pdfimages: ${error}`);
    throw error;
  }
}
