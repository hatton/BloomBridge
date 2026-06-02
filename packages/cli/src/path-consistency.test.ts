/// <reference types="node" />
import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "node:url";
import { processConversion, Arguments, Artifact } from "./process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Path consistency between PDF and non-PDF inputs", () => {
  const testInputDir = path.resolve(__dirname, "../../../test-inputs");
  const testCollectionDir = path.resolve(__dirname, "../../../test-outputs/path-consistency-test");

  beforeEach(async () => {
    // Create test collection directory
    await fs.mkdir(testCollectionDir, { recursive: true });

    // Create a test .raw-llm.md file
    const testMarkdownContent = `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
l1: en
---

<!-- text lang="en" -->
This is test content.

<!-- page index=1 -->

<!-- text lang="en" -->
Page 2 content.
`;

    await fs.writeFile(path.join(testInputDir, "children-come.raw-llm.md"), testMarkdownContent);
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.rm(testCollectionDir, { recursive: true, force: true });
      await fs.unlink(path.join(testInputDir, "children-come.raw-llm.md"));
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should create the same directory structure for PDF and non-PDF inputs", async () => {
    const baseArgs: Omit<Arguments, "input"> = {
      target: Artifact.HTML,
      output: testCollectionDir,
      verbose: false,
      ocrMethod: "4o",
      parserEngine: "native",
      imager: "poppler",
    };

    // Test with .raw-llm.md input
    const markdownArgs: Arguments = {
      ...baseArgs,
      input: path.join(testInputDir, "children-come.raw-llm.md"),
    };

    // This should create outputs in testCollectionDir/children-come/ just like a PDF would
    await processConversion(markdownArgs.input, markdownArgs);

    // Check that the book directory was created
    const expectedBookDir = path.join(testCollectionDir, "children-come");
    const bookDirExists = await fs
      .access(expectedBookDir)
      .then(() => true)
      .catch(() => false);

    expect(bookDirExists).toBe(true);

    // Check that output files are in the book directory, not directly in collection
    const expectedLlmFile = path.join(expectedBookDir, "children-come.llm.md");
    const llmFileExists = await fs
      .access(expectedLlmFile)
      .then(() => true)
      .catch(() => false);

    expect(llmFileExists).toBe(true);

    // Verify that files are NOT directly in the collection directory
    const wrongLlmFile = path.join(testCollectionDir, "children-come.llm.md");
    const wrongLlmFileExists = await fs
      .access(wrongLlmFile)
      .then(() => true)
      .catch(() => false);

    expect(wrongLlmFileExists).toBe(false);
  });

  it("should use the base filename consistently regardless of input type", async () => {
    const baseArgs: Omit<Arguments, "input"> = {
      target: Artifact.MarkdownReadyForBloom,
      output: testCollectionDir,
      verbose: false,
      ocrMethod: "4o",
      parserEngine: "native",
      imager: "poppler",
    };

    // Test with .raw-llm.md input
    const markdownArgs: Arguments = {
      ...baseArgs,
      input: path.join(testInputDir, "children-come.raw-llm.md"),
    };

    await processConversion(markdownArgs.input, markdownArgs);

    // The book folder should be named "children-come", not "children-come.raw-llm"
    const expectedBookDir = path.join(testCollectionDir, "children-come");
    const bookDirExists = await fs
      .access(expectedBookDir)
      .then(() => true)
      .catch(() => false);

    expect(bookDirExists).toBe(true);

    // The wrong book folder should not exist
    const wrongBookDir = path.join(testCollectionDir, "children-come.raw-llm");
    const wrongBookDirExists = await fs
      .access(wrongBookDir)
      .then(() => true)
      .catch(() => false);

    expect(wrongBookDirExists).toBe(false);
  });

  it("should use existing book directory when input file is already in collection", async () => {
    // Create a fake collection directory structure
    const fakeCollectionDir = path.join(testCollectionDir, "fake-collection");
    const existingBookDir = path.join(fakeCollectionDir, "existing-book-name");
    await fs.mkdir(existingBookDir, { recursive: true });

    // Create a .bloomCollection file
    await fs.writeFile(
      path.join(fakeCollectionDir, "fake-collection.bloomCollection"),
      "fake collection content",
    );

    // Create the input file in the existing book directory
    const inputFilePath = path.join(existingBookDir, "children-come.raw-llm.md");
    await fs.writeFile(
      inputFilePath,
      `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
l1: en
---

<!-- text lang="en" -->
This is test content.`,
    );

    const baseArgs: Omit<Arguments, "input"> = {
      target: Artifact.MarkdownReadyForBloom,
      collection: fakeCollectionDir,
      verbose: false,
      ocrMethod: "4o",
      parserEngine: "native",
      imager: "poppler",
    };

    // Test with .raw-llm.md input that's already in a collection
    const markdownArgs: Arguments = {
      ...baseArgs,
      input: inputFilePath,
    };

    await processConversion(markdownArgs.input, markdownArgs);

    // Should use the existing book directory, not create a new "children-come" directory
    const outputFilePath = path.join(existingBookDir, "children-come.bloom.md");
    const outputFileExists = await fs
      .access(outputFilePath)
      .then(() => true)
      .catch(() => false);

    expect(outputFileExists).toBe(true);

    // Should NOT create a new "children-come" directory
    const wrongBookDir = path.join(fakeCollectionDir, "children-come");
    const wrongBookDirExists = await fs
      .access(wrongBookDir)
      .then(() => true)
      .catch(() => false);

    expect(wrongBookDirExists).toBe(false);
  });
});
