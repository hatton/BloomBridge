import { describe, it, expect } from "vite-plus/test";
import { llmMarkdown } from "@pdf-to-bloom/lib";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { LogEntry } from "../logger";

// This test file is designed to run manually to validate LLM prompt processing
// It will NOT run as part of the regular test suite due to the .manual.test.ts naming
// Run manually with: pnpm test:manual-llm

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Manual LLM Prompt Test", () => {
  it.skip("should process testme.ocr.md through LLM and validate output", async () => {
    // Path to the testme.ocr.md file
    const testmeOcrPath = path.resolve(__dirname, "../../../../testme/testme.ocr.md");

    // Read the OCR markdown file
    const ocrContent = await fs.readFile(testmeOcrPath, "utf-8");

    // Validate the input file exists and has content
    expect(ocrContent.trim()).not.toBe("");
    expect(ocrContent).toContain("<!-- page index=");

    console.log("📝 Input OCR markdown content:");
    console.log("Length:", ocrContent.length, "characters");
    console.log("First 200 characters:", ocrContent.substring(0, 200));

    // Get API key from environment
    const openRouterApiKey = process.env.OPENROUTER_KEY;

    if (!openRouterApiKey) {
      console.warn("⚠️ OPENROUTER_KEY not found in environment variables");
      console.log("To run this test manually, set OPENROUTER_KEY environment variable");
      console.log("Skipping test...");
      return;
    }

    console.log("✅ OPENROUTER_KEY found, proceeding with API call...");

    // Set up logging to capture the process
    const logs: LogEntry[] = [];
    const logCallback = (log: LogEntry) => {
      logs.push(log);
      console.log(`[${log.level.toUpperCase()}] ${log.message}`);
    };

    console.log("\n🤖 Starting LLM processing...");

    // Process through LLM
    const result = await llmMarkdown(ocrContent, openRouterApiKey, {
      logCallback,
    });

    console.log("\n📊 LLM processing completed");
    console.log("Result valid:", result.valid);
    console.log("Result error:", result.error || "none");
    console.log("Raw LLM output length:", result.markdownResultFromLLM.length);
    console.log("Cleaned output length:", result.cleanedUpMarkdown.length);

    // Validate the results
    expect(result).toHaveProperty("markdownResultFromLLM");
    expect(result).toHaveProperty("cleanedUpMarkdown");
    expect(result).toHaveProperty("valid");

    // Check for errors first before claiming success
    if (result.error) {
      console.log(`\n❌ LLM processing failed with error: ${result.error}`);
      expect(result.error).toBeUndefined(); // This will fail the test with a clear message
    }

    // The result should be valid
    expect(result.valid).toBe(true);

    // Should contain basic structure
    expect(result.cleanedUpMarkdown).toContain("---"); // YAML frontmatter
    expect(result.cleanedUpMarkdown).toContain("allTitles:");
    expect(result.cleanedUpMarkdown).toContain("languages:");
    expect(result.cleanedUpMarkdown).toContain("l1:");
    expect(result.cleanedUpMarkdown).toContain("<!-- text lang=");

    // Should not contain code block wrappers
    expect(result.cleanedUpMarkdown).not.toContain("```");

    // Check for expected language detection (based on the Gondi content in testme.ocr.md)
    expect(result.cleanedUpMarkdown).toMatch(/lang="(en|gon|unk)"/);

    // Write output files for manual inspection
    const outputDir = path.resolve(__dirname, "../../../../testme");
    const rawOutputPath = path.join(outputDir, "testme.manual-test-raw.md");
    const cleanedOutputPath = path.join(outputDir, "testme.manual-test-cleaned.md");

    await fs.writeFile(rawOutputPath, result.markdownResultFromLLM);
    await fs.writeFile(cleanedOutputPath, result.cleanedUpMarkdown);

    console.log(`\n📁 Output files written:`);
    console.log(`Raw LLM output: ${rawOutputPath}`);
    console.log(`Cleaned output: ${cleanedOutputPath}`);

    // Log summary
    console.log(`\n📊 Processing Summary:`);
    console.log(`Input length: ${ocrContent.length} characters`);
    console.log(`Output length: ${result.cleanedUpMarkdown.length} characters`);
    console.log(`Valid result: ${result.valid}`);
    console.log(`Error: ${result.error || "none"}`);
    console.log(`Log entries: ${logs.length}`);

    // Check for common LLM processing errors in logs
    const errorLogs = logs.filter((log) => log.level === "error");
    const warningLogs = logs.filter((log) => log.level === "warn");

    if (errorLogs.length > 0) {
      console.log(`\n❌ Errors found (${errorLogs.length}):`);
      errorLogs.forEach((log) => console.log(`  - ${log.message}`));
    }

    if (warningLogs.length > 0) {
      console.log(`\n⚠️ Warnings found (${warningLogs.length}):`);
      warningLogs.forEach((log) => console.log(`  - ${log.message}`));
    }

    // Final validation - no errors should occur for a valid test
    expect(errorLogs.length).toBe(0);
  }, 30000); // 30 second timeout for actual API call
});
