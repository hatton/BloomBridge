/// <reference types="node" />
import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { pdfToMarkdownAndImageFiles } from "./pdfToMarkdownAndImageFiles-Mistral";
import { LogEntry } from "../logger";
import fs from "fs";
import path from "path";
import os from "os";

// Mock the Mistral client
// Note: mockImplementation must use a regular function (not arrow function) because
// vite-plus/test uses Reflect.construct() when the mock is called with `new`, and
// arrow functions cannot be used as constructors.
vi.mock("@mistralai/mistralai", () => ({
  Mistral: vi.fn().mockImplementation(function () {
    return {
      ocr: {
        process: vi.fn().mockResolvedValue({
          pages: [
            {
              index: 0,
              markdown:
                "# Document from /testme.pdf\n\nSample content with an image:\n\n![image1](image1)",
              images: [
                {
                  id: "image1.png",
                  topLeftX: 100,
                  topLeftY: 50,
                  bottomRightX: 300,
                  bottomRightY: 150,
                  imageBase64: "cHJldGVuZCBpbWFnZSBjb250ZW50",
                  imageAnnotation: "Sample image",
                },
              ],
              dimensions: {
                dpi: 72,
                height: 792,
                width: 612,
              },
            },
          ],
        }),
      },
    };
  }),
}));

describe("pdfToMarkdownAndImageFiles", () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a unique temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bloombridge-test-"));

    // Create a mock PDF file for testing
    const testPdfPath = path.join(tempDir, "testme.pdf");
    // Create a minimal PDF content (just enough to pass file existence check)
    fs.writeFileSync(testPdfPath, "Mock PDF content for testing");
  });

  afterEach(() => {
    // Clean up the temporary directory after each test
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  it("should throw error when API key is missing", async () => {
    const logs: LogEntry[] = [];

    await expect(
      pdfToMarkdownAndImageFiles(path.join(tempDir, "testme.pdf"), tempDir, "", (log) =>
        logs.push(log),
      ),
    ).rejects.toThrow("MistralAI API key is required");

    expect(
      logs.some((log) => log.level === "error" && log.message === "MistralAI API key is required"),
    ).toBe(true);
  });
  it("should log conversion process", async () => {
    const logs: LogEntry[] = [];
    const result = await pdfToMarkdownAndImageFiles(
      path.join(tempDir, "testme.pdf"),
      tempDir,
      "valid-key",
      (log) => logs.push(log),
    );

    expect(
      logs.some(
        (log) =>
          log.level === "info" && log.message.includes("Starting PDF to markdown conversion"),
      ),
    ).toBe(true);
    expect(logs.some((log) => log.level === "verbose")).toBe(true);
    expect(
      logs.some(
        (log) =>
          log.level === "info" &&
          log.message === "PDF to markdown conversion completed successfully",
      ),
    ).toBe(true);
    expect(result).toContain("# Document from /testme.pdf");
  });
  it("should create files in the output directory", async () => {
    const logs: LogEntry[] = [];
    await pdfToMarkdownAndImageFiles(
      path.join(tempDir, "testme.pdf"),
      tempDir,
      "valid-key",
      (log) => logs.push(log),
    );

    // Verify that the image file was created in the temp directory
    const imagePath = path.join(tempDir, "image1.png");
    expect(fs.existsSync(imagePath)).toBe(true);

    // Verify the content of the created file
    const imageContent = fs.readFileSync(imagePath, "utf8");
    expect(imageContent).toBe("pretend image content");
  });
  it("should call the Mistral OCR API with correct parameters", async () => {
    const logs: LogEntry[] = [];
    const { Mistral } = await import("@mistralai/mistralai");

    await pdfToMarkdownAndImageFiles(
      path.join(tempDir, "testme.pdf"),
      tempDir,
      "test-api-key",
      (log) => logs.push(log),
    );

    // Verify Mistral client was created with the API key
    expect(Mistral).toHaveBeenCalledWith({ apiKey: "test-api-key" });

    // Get the mock instance and verify OCR process was called
    const mockInstance = vi.mocked(Mistral).mock.results[0].value;
    expect(mockInstance.ocr.process).toHaveBeenCalledWith({
      model: "mistral-ocr-latest",
      document: {
        type: "document_url",
        documentUrl: expect.stringMatching(/^data:application\/pdf;base64,/),
      },
      includeImageBase64: true,
    });
  });
  it("should handle OCR response with multiple pages", async () => {
    const logs: LogEntry[] = [];
    const { Mistral } = await import("@mistralai/mistralai");

    // Create a new mock for this test with multiple pages
    const mockMultiPageResponse = {
      pages: [
        {
          index: 0,
          markdown: "# Page 1\n\nFirst page content\n\n![image1](image1)",
          images: [
            {
              id: "image1.png",
              topLeftX: 100,
              topLeftY: 50,
              bottomRightX: 300,
              bottomRightY: 150,
              imageBase64: "cHJldGVuZCBpbWFnZSBjb250ZW50",
              imageAnnotation: "First image",
            },
          ],
          dimensions: { dpi: 72, height: 792, width: 612 },
        },
        {
          index: 1,
          markdown: "# Page 2\n\nSecond page content\n\n![image2](image2)",
          images: [
            {
              id: "image2.jpg",
              topLeftX: 50,
              topLeftY: 100,
              bottomRightX: 250,
              bottomRightY: 200,
              imageBase64: "YW5vdGhlciBpbWFnZQ==",
              imageAnnotation: "Second image",
            },
          ],
          dimensions: { dpi: 72, height: 792, width: 612 },
        },
      ],
    };

    // Reset and create a new mock for this specific test
    vi.clearAllMocks();
    vi.mocked(Mistral).mockImplementation(function () {
      return {
        ocr: {
          process: vi.fn().mockResolvedValue(mockMultiPageResponse),
        },
      } as any;
    });

    const result = await pdfToMarkdownAndImageFiles(
      path.join(tempDir, "testme.pdf"),
      tempDir,
      "valid-key",
      (log) => logs.push(log),
    );

    // Verify the result contains content from both pages
    expect(result).toContain("# Page 1");
    expect(result).toContain("# Page 2");
    expect(result).toContain("First page content");
    expect(result).toContain("Second page content");

    // Verify both images were saved
    expect(fs.existsSync(path.join(tempDir, "image1.png"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "image2.jpg"))).toBe(true);
  });
});
