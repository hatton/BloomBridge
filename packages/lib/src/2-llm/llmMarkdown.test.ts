import { describe, it, expect, vi } from "vite-plus/test";
import { llmMarkdown } from "./llmMarkdown";
import { LogEntry } from "../logger";

// Mock the AI SDK generateText function
vi.mock("ai", () => ({
  generateText: vi.fn().mockResolvedValue({
    text: "<!-- Tagged Content via OpenRouter -->\n\n# Test Content\n\nThis is tagged test content.",
    finishReason: "stop",
  }),
}));

// Mock the OpenRouter provider
vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: vi.fn().mockReturnValue(() => ({})),
}));

describe("llmMarkdown", () => {
  it("should return error when API key is missing", async () => {
    const logs: LogEntry[] = [];

    const result = await llmMarkdown("# Test", "", {
      logCallback: (log) => logs.push(log),
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe("OpenRouter API key is required");
    expect(result.markdownResultFromLLM).toBe("");
    expect(result.cleanedUpMarkdown).toBe("");

    expect(
      logs.some((log) => log.level === "error" && log.message === "OpenRouter API key is required"),
    ).toBe(true);
  });
  it("should log enrichment process", async () => {
    const logs: LogEntry[] = [];
    const result = await llmMarkdown("# Test", "valid-key", {
      logCallback: (log) => logs.push(log),
    });

    expect(
      logs.some(
        (log) => log.level === "info" && log.message === "Starting markdown enrichment process",
      ),
    ).toBe(true);
    expect(
      logs.some(
        (log) =>
          log.level === "info" && log.message === "Markdown enrichment completed... validating...",
      ),
    ).toBe(true);

    // Result is an object with properties, not a string
    expect(result).toHaveProperty("markdownResultFromLLM");
    expect(result).toHaveProperty("cleanedUpMarkdown");
    expect(result).toHaveProperty("valid");
    expect(result.cleanedUpMarkdown).toContain("<!-- Tagged Content via OpenRouter -->");
  });
  it("should work without options", async () => {
    const result = await llmMarkdown("# Test", "valid-key");
    expect(result).toHaveProperty("markdownResultFromLLM");
    expect(result).toHaveProperty("cleanedUpMarkdown");
    expect(result).toHaveProperty("valid");
    expect(result.cleanedUpMarkdown).toContain("<!-- Tagged Content via OpenRouter -->");
  });

  it("should work with partial options", async () => {
    const result = await llmMarkdown("# Test", "valid-key", {
      overridePrompt: "Custom prompt",
      overrideModel: "custom-model",
    });
    expect(result).toHaveProperty("markdownResultFromLLM");
    expect(result).toHaveProperty("cleanedUpMarkdown");
    expect(result).toHaveProperty("valid");
    expect(result.cleanedUpMarkdown).toContain("<!-- Tagged Content via OpenRouter -->");
  });
});
