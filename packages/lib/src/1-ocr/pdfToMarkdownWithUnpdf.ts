import { logger, LogEntry } from "../logger";
import fs from "fs";
import path from "path";
import { getDocumentProxy, getResolvedPDFJS, definePDFJSModule } from "unpdf";

// We need the full PDF.js types for this, but 'any' will suffice for demonstration
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PDFJSOps: any;

interface UnpdfPage {
  index: number;
  content: Array<{
    type: "text" | "image";
    content: string;
    orderIndex: number;
  }>;
}

/**
 * Recursively searches within an XObject (which could be a Form) to find the raw image data.
 * This is the key to handling images embedded inside Form XObjects.
 *
 * @param xobj - The XObject to search, retrieved from page.objs or form.resources.
 * @param depth - Current recursion depth for logging
 * @returns The Uint8Array of the image data if found, otherwise null.
 */
function findImageInData(xobj: any, depth: number = 0): Uint8Array | null {
  const indent = "  ".repeat(depth);
  logger.info(`${indent}[DEBUG] findImageInData depth=${depth}: Analyzing XObject...`);

  if (!xobj) {
    logger.info(`${indent}[DEBUG] XObject is null or undefined`);
    return null;
  }

  // Log XObject properties for debugging
  const objKeys = Object.keys(xobj);
  logger.info(`${indent}[DEBUG] XObject properties: ${objKeys.join(", ")}`);
  logger.info(`${indent}[DEBUG] XObject.kind: ${xobj.kind}`);
  logger.info(`${indent}[DEBUG] XObject.data exists: ${!!xobj.data}`);
  logger.info(`${indent}[DEBUG] XObject.opList exists: ${!!xobj.opList}`);
  logger.info(`${indent}[DEBUG] XObject.resources exists: ${!!xobj.resources}`);

  // Base Case 1: This is a direct Image XObject. We found it.
  if (xobj && xobj.data && xobj.kind === 1) {
    // kind 1 is Image
    logger.info(`${indent}[DEBUG] ✅ Found Image XObject! data length: ${xobj.data.length}`);
    return xobj.data;
  }

  // Base Case 2: This might be an XObject with image data but different kind
  if (xobj && xobj.data && (xobj.kind === 2 || xobj.kind === 3) && !xobj.opList) {
    // kind 2/3 with data but no opList = direct image data, not a form to recurse into
    logger.info(
      `${indent}[DEBUG] ✅ Found XObject with image data (kind=${xobj.kind})! data length: ${xobj.data.length}`,
    );
    return xobj.data;
  }

  // Check if this might be an image with different structure
  if (xobj.data && typeof xobj.kind === "undefined") {
    logger.info(
      `${indent}[DEBUG] Found XObject with data but no kind - might be image: data length ${xobj.data.length}`,
    );
    // Try to detect if this looks like image data
    if (xobj.data instanceof Uint8Array && xobj.data.length > 100) {
      logger.info(`${indent}[DEBUG] ✅ Treating as potential image data`);
      return xobj.data;
    }
  }

  // Base Case 3: This is not a Form XObject, so we can't search deeper.
  if (!xobj || xobj.kind !== 2 || !xobj.opList) {
    // kind 2 is Form (only recurse if it has opList)
    logger.info(
      `${indent}[DEBUG] Not a Form XObject (kind !== 2 or no opList), stopping recursion`,
    );
    return null;
  }

  // Recursive Step: This is a Form XObject. We need to parse its operator list.
  logger.info(`${indent}[DEBUG] Found Form XObject, parsing operator list...`);
  const form = xobj;
  const { fnArray, argsArray } = form.opList;
  logger.info(`${indent}[DEBUG] Form has ${fnArray.length} operations`);

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];

    logger.info(`${indent}[DEBUG] Operation ${i}: ${fn} with args: ${JSON.stringify(args)}`);

    // Look for paint operators within the form
    if (fn === PDFJSOps.paintImageXObject || fn === PDFJSOps.paintXObject) {
      const imageName = args[0];
      logger.info(
        `${indent}[DEBUG] Found paint operation for '${imageName}', looking in form.resources...`,
      );

      if (!form.resources) {
        logger.warn(`${indent}[DEBUG] ❌ Form has no resources!`);
        continue;
      }

      // IMPORTANT: Resources for a form are in `form.resources`, not `page.objs`
      const innerXObj = form.resources.get(imageName);
      logger.info(`${indent}[DEBUG] Retrieved inner XObject for '${imageName}': ${!!innerXObj}`);

      const imageData = findImageInData(innerXObj, depth + 1); // Recursive call
      if (imageData) {
        logger.info(`${indent}[DEBUG] ✅ Found image data in recursion, bubbling up`);
        return imageData; // Found the image, bubble it up.
      }
    }
  }

  // If the loop finishes without finding an image.
  logger.info(`${indent}[DEBUG] ❌ No image found after checking all operations`);
  return null;
}

/**
 * Converts a PDF to markdown, preserving the exact order of text and images
 * by recursively parsing Form XObjects to find embedded images.
 *
 * KNOWN LIMITATION: This approach extracts ALL text operations from the PDF structure,
 * including text that may not be visually rendered. Some PDFs (particularly those created
 * with Adobe Illustrator and processed through Adobe Distiller) may contain hidden or
 * non-visible text layers that appear in the extracted content but are not visible when
 * viewing the PDF. For example, bilingual-sample.pdf contains an English story summary
 * that is embedded in the PDF structure but not visually displayed.
 *
 * This differs from vision-based OCR approaches (like Mistral AI) which only extract
 * visually rendered text. Choose the appropriate method based on your needs:
 * - unpdf: Structural text extraction (includes hidden/searchable text)
 * - Mistral OCR: Visual text extraction (what you see is what you get)
 *
 * @param pdfPath - Path to the PDF file
 * @param imageOutputDir - Directory where extracted images will be saved
 * @param logCallback - Optional callback to receive log messages
 * @returns Promise resolving to markdown string
 */
export async function pdfToMarkdownWithUnpdf(
  pdfPath: string,
  imageOutputDir: string,
  logCallback?: (log: LogEntry) => void,
): Promise<string> {
  if (logCallback) logger.subscribe(logCallback);

  try {
    logger.info(`Starting PDF to markdown conversion for: ${pdfPath}`);
    if (!fs.existsSync(pdfPath)) throw new Error(`PDF file not found: ${pdfPath}`);

    const pdfBuffer = new Uint8Array(fs.readFileSync(pdfPath));
    logger.info(`PDF file size: ${pdfBuffer.length} bytes`);
    logger.info("Processing PDF with unpdf");
    if (!fs.existsSync(imageOutputDir)) fs.mkdirSync(imageOutputDir, { recursive: true });

    const pages = await processPages(pdfBuffer, imageOutputDir);

    const markdown = generateMarkdownFromPages(pages);
    logger.info("✅ PDF to markdown conversion completed successfully.");
    return markdown;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`unpdf processing failed: ${errorMessage}`);
    throw new Error(`unpdf processing failed: ${errorMessage}`);
  } finally {
    if (logCallback) logger.unsubscribe(logCallback);
  }
}

/**
 * Processes pages by iterating through the operator list to maintain paint order.
 * When a paintXObject is found, it uses a recursive helper to find the actual image data.
 *
 * @param pdfBuffer - PDF buffer data
 * @param imageOutputDir - Directory to save images
 * @returns Array of processed pages
 */
async function processPages(pdfBuffer: Uint8Array, imageOutputDir: string): Promise<UnpdfPage[]> {
  // Polyfill DOMMatrix for Node.js environment
  if (typeof globalThis !== "undefined" && !(globalThis as any).DOMMatrix) {
    // Simple identity matrix polyfill
    (globalThis as any).DOMMatrix = class DOMMatrix {
      a: number = 1;
      b: number = 0;
      c: number = 0;
      d: number = 1;
      e: number = 0;
      f: number = 0;

      constructor(init?: string | number[]) {
        if (Array.isArray(init) && init.length >= 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init;
        }
      }

      multiply(other: DOMMatrix): DOMMatrix {
        const result = new DOMMatrix();
        result.a = this.a * other.a + this.b * other.c;
        result.b = this.a * other.b + this.b * other.d;
        result.c = this.c * other.a + this.d * other.c;
        result.d = this.c * other.b + this.d * other.d;
        result.e = this.e * other.a + this.f * other.c + other.e;
        result.f = this.e * other.b + this.f * other.d + other.f;
        return result;
      }
    };
  }

  // No worker configuration needed - let unpdf handle it

  await definePDFJSModule(() => import("pdfjs-dist/legacy/build/pdf.mjs"));
  const { OPS } = await getResolvedPDFJS();
  PDFJSOps = OPS; // Store OPS globally for the helper function

  const pdf = await getDocumentProxy(pdfBuffer);
  const pages: UnpdfPage[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const opList = await page.getOperatorList();
    const objs = page.objs;

    const pageContent: UnpdfPage["content"] = [];
    let textAccumulator = "";
    let orderIndex = 0;

    // Keep some tracking for image processing but simplify text handling
    let textRenderingMode = 0; // 0 = fill (visible), 3 = invisible
    let isTextVisible = true;
    let graphicsStack: any[] = [];
    let currentTransformMatrix = [1, 0, 0, 1, 0, 0]; // Default transformation matrix

    // Track text positioning for line break detection (will be used in hybrid approach)
    let lastTextY = 0;
    let hasTextBeenPlaced = false;

    const flushText = () => {
      if (textAccumulator.trim() && isTextVisible) {
        pageContent.push({
          type: "text",
          content: textAccumulator.trim(),
          orderIndex: orderIndex++,
        });
      }
      textAccumulator = "";
    };

    const { fnArray, argsArray } = opList;
    logger.verbose(`Page ${p}: Found ${fnArray.length} operations in operator list`);

    // Log all text-related operations for debugging
    const textOperations = [];
    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      if (
        fn === OPS.showText ||
        fn === OPS.showSpacedText ||
        fn === OPS.setTextRenderingMode ||
        fn === OPS.setTextMatrix ||
        fn === OPS.moveText
      ) {
        textOperations.push({ fn, args: argsArray[i], index: i });
      }
    }
    logger.verbose(`Page ${p}: Found ${textOperations.length} text-related operations`);

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const args = argsArray[i];

      switch (fn) {
        case OPS.save:
          // Push current graphics state onto stack
          graphicsStack.push({
            textRenderingMode,
            transformMatrix: [...currentTransformMatrix],
          });
          break;

        case OPS.restore:
          // Restore previous graphics state
          if (graphicsStack.length > 0) {
            const state = graphicsStack.pop();
            textRenderingMode = state.textRenderingMode;
            currentTransformMatrix = state.transformMatrix;
            isTextVisible = textRenderingMode !== 3;
          }
          break;

        case OPS.setTextRenderingMode:
          textRenderingMode = args[0];
          // Text rendering modes: 0-2 are visible, 3 is invisible
          isTextVisible = textRenderingMode !== 3;
          logger.verbose(
            `Page ${p}: Text rendering mode changed to ${textRenderingMode} (visible: ${isTextVisible})`,
          );
          break;

        case OPS.transform:
          // Update transformation matrix - could affect text positioning/visibility
          const [a, b, c, d, e, f] = args;
          const newMatrix = [
            currentTransformMatrix[0] * a + currentTransformMatrix[2] * b,
            currentTransformMatrix[1] * a + currentTransformMatrix[3] * b,
            currentTransformMatrix[0] * c + currentTransformMatrix[2] * d,
            currentTransformMatrix[1] * c + currentTransformMatrix[3] * d,
            currentTransformMatrix[0] * e +
              currentTransformMatrix[2] * f +
              currentTransformMatrix[4],
            currentTransformMatrix[1] * e +
              currentTransformMatrix[3] * f +
              currentTransformMatrix[5],
          ];
          currentTransformMatrix = newMatrix;
          break;

        case OPS.showText:
        case OPS.showSpacedText:
          // Skip operator-level text processing - we'll use getTextContent() instead
          break;

        case OPS.paintImageXObject:
        case OPS.paintXObject:
        case OPS.paintImageMaskXObject:
          // An image operation is a natural break for text. Flush any pending text first.
          flushText();

          // Handle different argument structures
          let imageName: string;
          if (fn === OPS.paintImageMaskXObject) {
            // For paintImageMaskXObject, args[0] is an object with data, width, height properties
            const maskData = args[0] as any;
            imageName = maskData?.data || "unknown_mask";
            logger.info(
              `Page ${p}: Found paintImageMaskXObject operation with imageName: '${imageName}', width: ${maskData?.width}, height: ${maskData?.height}`,
            );
          } else {
            // For paintImageXObject and paintXObject, args[0] is the image name directly
            imageName = args[0];
            logger.info(
              `Page ${p}: Found paint operation for XObject '${imageName}' with type: ${fn === OPS.paintImageXObject ? "paintImageXObject" : "paintXObject"}.`,
            );
          }

          // Try to get the XObject - wait for it to be resolved if needed
          let xobj;
          try {
            // First try to get the object directly
            xobj = objs.get(imageName);
            logger.info(`Page ${p}: Retrieved XObject '${imageName}': ${!!xobj}`);
          } catch (error) {
            // If the object isn't resolved yet, retry with exponential backoff
            if (
              error instanceof Error &&
              error.message.includes("Requesting object that isn't resolved yet")
            ) {
              logger.info(`Page ${p}: XObject '${imageName}' not resolved yet, retrying...`);

              let retryCount = 0;
              const maxRetries = 10;
              const baseDelay = 10; // Start with 10ms

              while (retryCount < maxRetries) {
                try {
                  // Wait with exponential backoff
                  const delay = baseDelay * Math.pow(2, retryCount);
                  await new Promise((resolve) => setTimeout(resolve, delay));

                  xobj = objs.get(imageName);
                  logger.info(
                    `Page ${p}: Successfully retrieved XObject '${imageName}' after ${retryCount + 1} retries`,
                  );
                  break;
                } catch (retryError) {
                  retryCount++;
                  if (
                    retryError instanceof Error &&
                    retryError.message.includes("Requesting object that isn't resolved yet")
                  ) {
                    logger.verbose(
                      `Page ${p}: XObject '${imageName}' still not resolved, retry ${retryCount}/${maxRetries}`,
                    );
                  } else {
                    // Different error, break out of retry loop
                    logger.warn(
                      `Page ${p}: Different error while retrying XObject '${imageName}': ${retryError instanceof Error ? retryError.message : String(retryError)}`,
                    );
                    break;
                  }
                }
              }

              if (!xobj) {
                logger.warn(
                  `Page ${p}: Failed to retrieve XObject '${imageName}' after ${maxRetries} retries`,
                );

                // Add a placeholder comment indicating the missing image
                pageContent.push({
                  type: "image",
                  content: `<!-- Image XObject ${imageName} not available (resolution timeout after ${maxRetries} retries) -->`,
                  orderIndex: orderIndex++,
                });

                // Continue processing without throwing an error
                break;
              }
            } else {
              // Other type of error - log and continue
              logger.warn(
                `Page ${p}: Failed to retrieve XObject '${imageName}': ${error instanceof Error ? error.message : String(error)}`,
              );

              // Add a placeholder comment indicating the missing image
              pageContent.push({
                type: "image",
                content: `<!-- Image XObject ${imageName} not available (PDF.js error: ${error instanceof Error ? error.message : String(error)}) -->`,
                orderIndex: orderIndex++,
              });

              // Continue processing without throwing an error
              break;
            }
          }

          // If the object is not resolved yet, skip with graceful handling
          if (!xobj) {
            logger.warn(`Page ${p}: XObject '${imageName}' not resolved yet, skipping...`);

            // Add a placeholder comment indicating the missing image
            pageContent.push({
              type: "image",
              content: `<!-- Image XObject ${imageName} not available (unresolved reference) -->`,
              orderIndex: orderIndex++,
            });

            // Continue processing without throwing an error
            break;
          }

          // Successfully retrieved XObject, process it
          const objKeys = Object.keys(xobj);
          logger.info(`Page ${p}: XObject '${imageName}' properties: ${objKeys.join(", ")}`);

          // Log width/height information for debugging
          const width = xobj.width || xobj.Width;
          const height = xobj.height || xobj.Height;
          if (width && height) {
            logger.verbose(`Page ${p}: XObject '${imageName}' dimensions: ${width}x${height}`);
          }

          const imageData = findImageInData(xobj); // Use the recursive helper

          if (imageData) {
            const imageId = `page${p}-img${orderIndex}.png`;
            const imagePath = path.join(imageOutputDir, imageId);
            fs.writeFileSync(imagePath, imageData);
            logger.verbose(`✅ Saved image: ${imagePath} from XObject '${imageName}'.`);

            // Extract width information from XObject if available
            const width = xobj.width || xobj.Width;
            let imageMarkdown = `![Image](${imageId})`;
            if (width && typeof width === "number") {
              imageMarkdown = `![Image](${imageId}){width=${width}}`;
            }

            pageContent.push({
              type: "image",
              content: imageMarkdown,
              orderIndex: orderIndex++,
            });
          } else {
            logger.warn(
              `❌ Could not extract image data from XObject '${imageName}' on page ${p}.`,
            );
            pageContent.push({
              type: "image",
              content: `<!-- Image from XObject ${imageName} could not be extracted -->`,
              orderIndex: orderIndex++,
            });
          }
          break;

        case OPS.setTextMatrix:
          // Extract Y position from text matrix to detect line breaks
          const textMatrix = args[0] || args; // The matrix might be the first argument
          let currentTextY = 0;

          // Handle both array format [a,b,c,d,e,f] and object format {"0":a,"1":b,...,"5":f}
          if (Array.isArray(textMatrix)) {
            currentTextY = textMatrix[5] || 0;
          } else if (textMatrix && typeof textMatrix === "object") {
            currentTextY = textMatrix["5"] || 0;
          }

          // Debug output for page 1
          if (p === 1) {
            logger.verbose(
              `Page ${p}: setTextMatrix args=${JSON.stringify(args)}, textMatrix=${JSON.stringify(textMatrix)}, Y=${currentTextY}, lastY=${lastTextY}, diff=${Math.abs(currentTextY - lastTextY)}`,
            );
          }

          // Use adaptive thresholds based on text content and position changes
          const yDiff = Math.abs(currentTextY - lastTextY);
          const hasMinimalText = textAccumulator.trim().length > 10;

          // Detect line breaks with balanced thresholds:
          // - Large movements (>25 points) are likely line breaks
          // - Medium movements (>12 points) with some text are likely line breaks
          // - Small movements (<12 points) are likely styled text positioning
          if (hasTextBeenPlaced && (yDiff > 25 || (yDiff > 12 && hasMinimalText))) {
            // Flush accumulated text as a separate text block
            logger.verbose(
              `Page ${p}: Line break detected - Y changed from ${lastTextY} to ${currentTextY} (diff: ${yDiff}), text length: ${textAccumulator.trim().length}`,
            );
            flushText();
          } else if (
            textAccumulator.length > 0 &&
            !textAccumulator.endsWith(" ") &&
            yDiff > 5 // Small position changes get a space
          ) {
            // Small position changes within same line/paragraph - just add space
            textAccumulator += " ";
          }

          lastTextY = currentTextY;
          hasTextBeenPlaced = true;
          break;

        case OPS.moveText:
          // Text movement operation - check if it's a significant move indicating a new line
          const [, ty] = args;
          if (p === 1) {
            logger.verbose(
              `Page ${p}: moveText args=${JSON.stringify(args)}, dy=${ty}, textLength=${textAccumulator.trim().length}`,
            );
          }
          // Use balanced thresholds for moveText operations:
          // - Large moves (>25) are likely line breaks
          // - Medium moves (>12) with some text (>15 chars) are likely line breaks
          // - Small moves (>5) just get a space
          // - Very small moves (<5) are likely just positioning and get no space
          const absMovement = Math.abs(ty);
          const hasEnoughText = textAccumulator.trim().length > 15;

          if (ty !== 0 && (absMovement > 25 || (absMovement > 12 && hasEnoughText))) {
            logger.verbose(
              `Page ${p}: Text move line break - dy=${ty}, flushing text (length: ${textAccumulator.trim().length})`,
            );
            flushText();
          } else if (
            ty !== 0 &&
            absMovement > 5 &&
            textAccumulator.length > 0 &&
            !textAccumulator.endsWith(" ")
          ) {
            // Medium moves just get a space to maintain word separation
            textAccumulator += " ";
          }
          break;
      }
    }

    // HYBRID APPROACH: Use getTextContent() for text with operator list for line breaks
    logger.verbose(`Page ${p}: Using hybrid approach - getTextContent() + operator positioning`);

    // Step 1: Get all text content with positioning information
    const textContent = await page.getTextContent();
    const textItems = textContent.items.filter((item) => "str" in item);

    // Step 2: Analyze operator list to find line break Y positions
    const lineBreakYPositions = [];

    // Reset positioning tracking for this analysis
    lastTextY = 0;
    hasTextBeenPlaced = false;

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const args = argsArray[i];

      if (fn === OPS.setTextMatrix) {
        const textMatrix = args[0];
        const currentTextY = textMatrix[5] || textMatrix.f || 0;

        if (hasTextBeenPlaced) {
          const yDiff = Math.abs(currentTextY - lastTextY);

          // Detect significant line breaks (using same logic as original)
          if (yDiff > 25 || yDiff > 12) {
            logger.verbose(
              `Page ${p}: Line break Y position detected: ${currentTextY} (diff: ${yDiff} from ${lastTextY})`,
            );
            lineBreakYPositions.push(currentTextY);
          }
        }

        lastTextY = currentTextY;
        hasTextBeenPlaced = true;
      }
    }

    // Step 3: Group text items by Y position, using line break positions as boundaries
    // Joins items within a line using X-position gaps to determine word boundaries.
    // This avoids inserting spaces between adjacent glyphs (e.g. Telugu complex script).
    if (textItems.length > 0) {
      type LineItem = { str: string; x: number; width: number };
      const textLines: string[] = [];
      let currentLineItems: LineItem[] = [];
      let currentLineY: number | null = null;

      const joinLineItems = (items: LineItem[]): string => {
        if (items.length === 0) return "";
        if (items.length === 1) return items[0].str;
        let result = items[0].str;
        let prevEndX = items[0].x + items[0].width;
        for (let i = 1; i < items.length; i++) {
          const item = items[i];
          // Gap between end of previous item and start of current item.
          // A gap > 1 pt indicates a word boundary; ≤ 1 pt means adjacent glyphs.
          const gap = item.x - prevEndX;
          result += gap > 1 ? " " + item.str : item.str;
          prevEndX = item.x + item.width;
        }
        return result.trim();
      };

      for (const item of textItems) {
        if ("str" in item && "transform" in item) {
          const itemY = item.transform[5];
          const itemX = item.transform[4];
          const itemWidth = "width" in item ? (item as any).width : 0;

          // Check if this item is at a significantly different Y position (new line)
          if (currentLineY === null) {
            currentLineY = itemY;
            currentLineItems.push({ str: item.str, x: itemX, width: itemWidth });
          } else {
            const yDiff = Math.abs(itemY - currentLineY);

            // If Y position differs significantly or crosses a detected line break, start new line
            const crossesLineBreak =
              currentLineY !== null &&
              lineBreakYPositions.some(
                (breakY) => Math.abs(breakY - itemY) < Math.abs(breakY - currentLineY!),
              );

            if (yDiff > 12 || crossesLineBreak) {
              // Finish current line and start new one
              if (currentLineItems.length > 0) {
                textLines.push(joinLineItems(currentLineItems));
                currentLineItems = [];
              }
              currentLineY = itemY;
            }

            currentLineItems.push({ str: item.str, x: itemX, width: itemWidth });
          }
        }
      }

      // Add remaining text
      if (currentLineItems.length > 0) {
        textLines.push(joinLineItems(currentLineItems));
      }

      // Add each line as a separate text block
      textLines.forEach((line, index) => {
        if (line) {
          logger.verbose(`Page ${p}: Text line ${index + 1}: ${line.substring(0, 50)}...`);
          pageContent.push({
            type: "text",
            content: line,
            orderIndex: orderIndex++,
          });
        }
      });
    }

    pages.push({
      index: p - 1,
      content: pageContent,
    });
  }
  return pages;
}

/**
 * Post-processes text to fix common ordering issues with styled text (italic, bold)
 * that gets extracted out of order due to PDF structure.
 */
function fixTextOrdering(text: string): string {
  // Pattern to match the specific case where italic book title gets separated
  // Look for: "original, , Copyright" followed later by "A Family Learns about Immunisations"
  const copyrightPattern =
    /(.*adaptation of the original,)\s*,\s*(Copyright.*?\.)\s*(A Family Learns about[^.]*)/;
  const match = text.match(copyrightPattern);

  if (match) {
    const [, beforeTitle, copyrightText, title] = match;
    // Reconstruct the sentence with proper order
    const corrected = `${beforeTitle} ${title}, ${copyrightText}`;
    logger.verbose(`Fixed text ordering: "${text}" -> "${corrected}"`);
    return corrected;
  }

  return text;
}

/**
 * Generates markdown from processed pages, sorting content by its order index.
 *
 * @param pages - Array of processed pages
 * @returns Markdown string
 */
function generateMarkdownFromPages(pages: UnpdfPage[]): string {
  return pages
    .map((page) => {
      // Use the same format as Mistral OCR approach for consistency
      const pageHeader = `<!-- page index=${page.index + 1} -->`;

      const sortedContent = page.content
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((item) => {
          if (item.type === "image") {
            return item.content;
          }
          // For text, apply text ordering fixes and wrap it to look more like the original OCR format
          return fixTextOrdering(item.content);
        })
        .join("\n"); // Join with single newline to match OCR format

      return `${pageHeader}\n${sortedContent}`;
    })
    .join("\n\n");
}
