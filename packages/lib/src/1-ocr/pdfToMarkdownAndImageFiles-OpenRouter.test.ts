import { describe, it, expect } from "vite-plus/test";
import { getModelAliases } from "../1-ocr/pdfToMarkdownAndImageFiles-OpenRouter";

describe("OpenRouter Model Aliases", () => {
  it("should have correct model aliases", () => {
    const aliases = getModelAliases();

    expect(aliases).toEqual({
      gemini: "google/gemini-2.0-flash-exp",
      gpt: "openai/gpt-5.4",
    });
  });

  it("should include gemini alias", () => {
    const aliases = getModelAliases();
    expect(aliases.gemini).toBe("google/gemini-2.0-flash-exp");
  });

  it("should include gpt alias", () => {
    const aliases = getModelAliases();
    expect(aliases["gpt"]).toBe("openai/gpt-5.4");
  });
});
