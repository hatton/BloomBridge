import { logger, LogEntry } from "../logger";
import { generateText, CoreUserMessage } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import fs from "fs";
import path from "path";
import { Language } from "../types";
import { attemptCleanup } from "./post-llm-cleanup";
import { getModuleDir } from "../moduleDir";

export interface TagMarkdownOptions {
  logCallback?: (log: LogEntry) => void;
  overridePrompt?: string;
  overrideModel?: string; // an openrouter model name, e.g. "google/gemini-2.5-flash
  // AI can guess at these, but in the context of a bloom collection, we already know what to expect so we can provide these to help the AI model
  l1?: Language; // Primary language of the content
  l2?: Language; // Secondary language
  l3?: Language; // Tertiary language
}

/**
 * Enriches markdown content with additional processing
 */
export async function llmMarkdown(
  markdown: string,
  openRouterApiKey: string,
  options?: TagMarkdownOptions,
): Promise<{
  markdownResultFromLLM: string;
  cleanedUpMarkdown: string;
  valid: boolean;
  error?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}> {
  const { logCallback, overridePrompt, overrideModel } = options || {};

  if (logCallback) logger.subscribe(logCallback);

  try {
    logger.info("Starting markdown enrichment process");

    if (!openRouterApiKey) {
      logger.error("OpenRouter API key is required");
      throw new Error("OpenRouter API key is required");
    } // Read the enrichment prompt from file
    const promptPath = path.join(getModuleDir(), "llmPrompt.txt");
    let llmPrompt: string;

    try {
      llmPrompt = overridePrompt || fs.readFileSync(promptPath, "utf8");
      logger.verbose("Loaded enrichment prompt from file");
    } catch (error) {
      logger.error(`Failed to read enrichment prompt: ${String(error)}`);
      throw error;
    } // Configure OpenRouter with Gemini 3.1 Pro Preview
    const modelName = overrideModel || "google/gemini-3.1-pro-preview";
    const openrouterProvider = createOpenRouter({
      apiKey: openRouterApiKey,
    });

    logger.info(`Processing markdown with ${modelName} through OpenRouter API...`);

    const maxTokens = getMaxTokens(markdown, llmPrompt);
    logger.info(`Setting maxTokens to: ${maxTokens}`);

    let messages: CoreUserMessage[] = [
      {
        role: "user",
        content: llmPrompt,
      },
    ];
    if (options?.l1) {
      // build up a single message that conveys info about for each language that was provided, and is silent on the others
      // E.g. "We have reason to expect that some or all of these languages are in this document. [l1: {tag:"mza", "Mixteco de Santa María Zacatepec"}, l2: {tag:"en", name:"English"}]
      const languages: Language[] = [];
      if (options.l1) languages.push(options.l1);
      if (options.l2) languages.push(options.l2);
      if (options.l3) languages.push(options.l3);
      if (languages.length > 0) {
        messages.push({
          role: "user",
          content: `We have reason to expect that some or all of these languages are in the following document. ${JSON.stringify(
            languages,
          )}`,
        });
      }
    }
    messages.push({
      role: "user",
      content: `Here is the Markdown content:\n\n${markdown}`,
    });
    // Call the AI model to enrich the markdown
    const result = await generateText({
      model: openrouterProvider(modelName),
      messages,
      temperature: 0.0, // Deterministic, no creativity needed
      maxTokens,
      // Ask OpenRouter to include actual usage cost in the response.
      providerOptions: { openrouter: { usage: { include: true } } },
    });
    // OpenRouter surfaces the real cost via provider metadata when usage accounting
    // is on. Path varies by provider version, so read defensively.
    const pm = (result as any).providerMetadata?.openrouter;
    const llmCostUsd: number | undefined =
      typeof pm?.usage?.cost === "number"
        ? pm.usage.cost
        : typeof pm?.cost === "number"
          ? pm.cost
          : undefined;
    const finishReason = result.finishReason as string; // Cast to string to allow checking custom reasons like "payment"
    if (finishReason !== "stop") {
      console.log("⚠️ runPrompt: Non-stop finish reason detected", {
        finishReason,
      });
      if (finishReason === "length") {
        throw new Error("Ran out of tokens before finishing (max tokens reached)");
      }
      if (finishReason === "error" || finishReason === "payment") {
        throw new Error(
          "API request failed - this may be due to insufficient credits, invalid API key, or service unavailability. Please check your OpenRouter account and API key.",
        );
      }
      if (finishReason === "content-filter") {
        throw new Error("Content was filtered by the AI model's safety systems");
      }
      throw new Error(`Streaming finished with reason: ${finishReason}`);
    }
    let taggedContent = result.text;

    // Capture token usage (cost lookup is a later pass — see plan).
    const usage = result.usage
      ? {
          promptTokens: result.usage.promptTokens ?? 0,
          completionTokens: result.usage.completionTokens ?? 0,
          totalTokens: result.usage.totalTokens ?? 0,
        }
      : undefined;
    if (usage) {
      logger.event({
        kind: "tokens",
        stage: "llm",
        tokensIn: usage.promptTokens,
        tokensOut: usage.completionTokens,
        costUsd: llmCostUsd,
      });
    }

    logger.info("Markdown enrichment completed... validating...");
    logger.verbose(`Generated ${taggedContent.length} characters of markdown`);

    if (!taggedContent) {
      logger.error("No markdown content received from AI model");
      throw new Error("Failed to generate tagged markdown");
    }

    const cleanupResult = attemptCleanup(taggedContent);
    if (!cleanupResult.valid) {
      logger.error("Tagged markdown content failed validation checks");
      // don't throw: we want to save what we did so that it can be inspected: throw new Error("Tagged markdown content failed validation checks");
    } else {
      logger.info("Tagged markdown content passed validation checks");
    }
    return {
      markdownResultFromLLM: taggedContent,
      cleanedUpMarkdown: cleanupResult.cleaned,
      valid: cleanupResult.valid,
      usage,
    };
  } catch (error) {
    logger.error(`Markdown enrichment failed: ${String(error)}`);
    return {
      markdownResultFromLLM: "",
      cleanedUpMarkdown: "",
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (logCallback) logger.unsubscribe(logCallback);
  }
}

function getMaxTokens(markdown: string, llmPrompt: string): number {
  // Let's set the maxTokens to at least the length of the markdown content
  // because we're typically working on minority languages so can expect poor tokenization.

  const kMultiplierForOutput = 3; // While something like English might be 4:1 letter to token, some other script of an unknown language could be 1 token for each unicode byte?
  // todo: at the moment 1,411 input tokens are leading to 3,848 output tokens, probably from thinking. Really we don't
  // want to limit the thinking because if it doesn't finished, we're hosed.
  const kMultiplierForThinking = 6;
  const kMultiplierForAnnotations = 1;

  // Factor in prompt complexity - longer prompts typically require more thinking
  const kPromptThinkingFactor = 5; // Additional thinking tokens per character in prompt
  const promptThinkingTokens = llmPrompt.length * kPromptThinkingFactor;

  const maxTokens =
    markdown.length * (kMultiplierForOutput + kMultiplierForAnnotations + kMultiplierForThinking) +
    promptThinkingTokens;

  return Math.round(maxTokens);
}
