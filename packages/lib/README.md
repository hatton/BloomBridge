# @bloombridge/core

The core Node.js library for converting PDF documents to Bloom-compatible HTML format.

## Installation

```bash
pnpm add @bloombridge/core
```

## Usage

```typescript
import {
  pdfToBloomFolder,
  makeMarkdownFromPDF,
  tagMarkdown,
  mdToBloomHtml,
} from "@bloombridge/core";

// Convert PDF directly to Bloom HTML
const bloomHtmlPath = await pdfToBloomFolder("./document.pdf", "./output", "your-mistral-api-key");

// Or use individual functions
const markdown = await makeMarkdownFromPDF("./document.pdf", "./output", "your-mistral-api-key");
const taggedMarkdown = await tagMarkdown(markdown, "your-openrouter-api-key");
const bloomHtml = await mdToBloomHtml(taggedMarkdown);
```

## API

### `pdfToBloomFolder(pdfPath, outputDir, mistralApiKey, logCallback?)`

Complete pipeline that converts a PDF to Bloom HTML format.

### `makeMarkdownFromPDF(pdfPath, outputDir, mistralApiKey, logCallback?)`

Extract and convert PDF content to markdown using MistralAI.

### `tagMarkdown(markdown, openRouterApiKey, options?)`

Enhance the markdown content using an LLM

### `mdToBloomHtml(markdown, options?)`

Convert markdown to Bloom-compatible HTML format.
