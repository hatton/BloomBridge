import { describe, it, expect } from "vite-plus/test";
import { pdfToMarkdownWithUnpdf } from "./pdfToMarkdownWithUnpdf";

describe("pdfToMarkdownWithUnpdf - basic import", () => {
  it("should import the function successfully", () => {
    expect(typeof pdfToMarkdownWithUnpdf).toBe("function");
  });
});
