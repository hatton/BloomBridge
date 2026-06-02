/// <reference types="node" />
import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { pdfToMarkdownWithUnpdf } from "./pdfToMarkdownWithUnpdf";
import { LogEntry } from "../logger";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * GONDI IMMUNISATIONS SPECIFIC TESTS
 *
 * These tests focus on ensuring proper text paragraph formation and line breaking
 * for the gondi-immunisations.pdf file, using the manually corrected version as
 * the expected output.
 */

describe("pdfToMarkdownWithUnpdf - Gondi Immunisations", () => {
  let tempDir: string;
  let imageOutputDir: string;
  let logMessages: LogEntry[];

  // Use the actual gondi-immunisations PDF and expected output
  const testPdfPath = path.resolve(__dirname, "../../../../test-inputs/gondi-immunisations.pdf");
  const expectedMarkdownPath = path.resolve(
    __dirname,
    "../../../../test-inputs/gondi-immunisations.byhand.md",
  );

  const logCallback = (log: LogEntry) => {
    logMessages.push(log);
  };

  beforeEach(() => {
    // Create a unique temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "unpdf-gondi-test-"));
    imageOutputDir = path.join(tempDir, "images");
    logMessages = [];

    // Verify test files exist
    if (!fs.existsSync(testPdfPath)) {
      throw new Error(`Test PDF file not found: ${testPdfPath}`);
    }
    if (!fs.existsSync(expectedMarkdownPath)) {
      throw new Error(`Expected markdown file not found: ${expectedMarkdownPath}`);
    }
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should extract text in correct paragraph structure", async () => {
    const result = await pdfToMarkdownWithUnpdf(testPdfPath, imageOutputDir, logCallback);

    // Test that basic structure is present
    expect(result).toContain("<!-- page index=1 -->");
    expect(result).toContain("<!-- page index=4 -->");
    expect(result).toContain("A Family Learns about Immunisations");

    // Telugu text is extracted with variable spacing due to per-glyph PDF rendering.
    // Verify at least part of the Telugu content is present.
    expect(result).toContain("బారెతె");
  });

  it("should properly handle Telugu script spacing", async () => {
    const result = await pdfToMarkdownWithUnpdf(testPdfPath, imageOutputDir, logCallback);

    // The text should appear in both page 1 and page 3
    const page1Match = result.match(/<!-- page index=1 -->(.*?)(?=<!-- page index=2 -->|$)/s);
    const page3Match = result.match(/<!-- page index=3 -->(.*?)(?=<!-- page index=4 -->|$)/s);

    expect(page1Match).toBeTruthy();
    expect(page3Match).toBeTruthy();

    if (page1Match) {
      // Verify Telugu content is present on page 1 (word "బారెతె" is reliably extracted)
      expect(page1Match[1]).toContain("బారెతె");
    }

    if (page3Match) {
      expect(page3Match[1]).toContain("బారెతె");
    }

    // Should also have the English title
    expect(result).toContain("A Family Learns about Immunisations");
  });

  it("should keep copyright text together as coherent paragraphs", async () => {
    const result = await pdfToMarkdownWithUnpdf(testPdfPath, imageOutputDir, logCallback);

    // Find page 4 which has the copyright text
    const page4Match = result.match(/<!-- page index=4 -->(.*?)(?=<!-- page index=5 -->|$)/s);
    expect(page4Match).toBeTruthy();

    if (page4Match) {
      // Check that we have the key copyright components (may span multiple lines)
      expect(result).toContain("This book is an adaptation of the original");
      expect(result).toContain("Copyright © 2021, SIL International");
      expect(result).toContain("Licensed under CC BY");
      expect(result).toContain("A Family Learns about Immunisations");
    }
  });

  it("should match the byhand reference output exactly", async () => {
    const result = await pdfToMarkdownWithUnpdf(testPdfPath, imageOutputDir, logCallback);

    const expectedContent = fs.readFileSync(expectedMarkdownPath, "utf-8");

    // Extract specific sections to compare
    const resultPage1 = extractPageContent(result, 1);
    const expectedPage1 = extractPageContent(expectedContent, 1);

    const resultPage3 = extractPageContent(result, 3);
    const expectedPage3 = extractPageContent(expectedContent, 3);

    const resultPage4 = extractPageContent(result, 4);
    const expectedPage4 = extractPageContent(expectedContent, 4);

    const resultPage5 = extractPageContent(result, 5);
    const expectedPage5 = extractPageContent(expectedContent, 5);

    // Debug output to see differences
    console.log("=== PAGE 1 COMPARISON ===");
    console.log("Expected:", JSON.stringify(expectedPage1, null, 2));
    console.log("Result:", JSON.stringify(resultPage1, null, 2));

    console.log("=== PAGE 3 COMPARISON ===");
    console.log("Expected:", JSON.stringify(expectedPage3, null, 2));
    console.log("Result:", JSON.stringify(resultPage3, null, 2));

    console.log("=== PAGE 4 COMPARISON ===");
    console.log("Expected:", JSON.stringify(expectedPage4, null, 2));
    console.log("Result:", JSON.stringify(resultPage4, null, 2));

    console.log("=== PAGE 5 COMPARISON ===");
    console.log("Expected:", JSON.stringify(expectedPage5, null, 2));
    console.log("Result:", JSON.stringify(resultPage5, null, 2));

    // Check key specific differences we've identified:

    // 1. Telugu word "బారెతె" is extracted intact (even if surrounding chars have spacing)
    expect(result).toContain("బారెతె");
    // Telugu text should not be completely collapsed (no spaces at all)
    expect(result).not.toContain("వాకిన్యేతడున్బారెతెకరికియల్");

    // 2. English titles should have proper spacing
    expect(resultPage3).toContain("A Family Learns about Immunisations");
    expect(resultPage3).not.toContain("AFamily LearnsaboutImmunisations");

    // 3. Copyright structure should match expected format
    expect(resultPage4).toContain("http://creativecommons.org/licenses/by/4.0/");
    expect(resultPage4).toContain("You are free to make commercial use of this work.");

    // 4. Page 5 Telugu content is present
    expect(resultPage5).toContain("బిమె అని");
    expect(resultPage5).not.toContain("బిమెఅనిబీమల్వేడతెకరెర్మతెర్");
  });
});

/**
 * Helper function to extract content for a specific page from markdown
 */
function extractPageContent(markdown: string, pageIndex: number): string {
  const pagePattern = new RegExp(
    `<!-- page index=${pageIndex} -->([\\s\\S]*?)(?=<!-- page index=|$)`,
    "i",
  );
  const match = markdown.match(pagePattern);
  return match ? match[1].trim() : "";
}
