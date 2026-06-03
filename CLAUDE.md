# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

> **Working on the conversion pipeline? Read [`conversion-process.md`](conversion-process.md) first.**
> It is the architecture reference: what each stage does, how every CLI parameter
> influences each stage, the intermediate Markdown format, the variety of inputs we
> handle, and known issues. This file (CLAUDE.md) is just toolchain/build/test guidance.

## Project Overview

pnpm workspaces monorepo converting PDF documents to Bloom-compatible HTML through OCR, LLM processing, and HTML generation. Produces bilingual educational content.

**Two packages:**

- `packages/lib` (`@pdf-to-bloom/lib`) — core TypeScript library, dual ESM/CJS build
- `packages/cli` (`@pdf-to-bloom/cli`) — Commander.js CLI that imports the lib

## Toolchain

- **[Vite+](https://viteplus.dev) (`vp`)** — unified toolchain bundling Vite, Vitest, oxfmt, oxlint. Install once globally: `npm install -g vite-plus-cli`
- **pnpm** — package manager, pinned via `packageManager` field, provisioned by Vite+/Corepack. Do not use `npm` or `yarn`.
- **Node.js 22+** — no pin; install your own.
- **Supply-chain guard** — `pnpm-workspace.yaml` sets `minimumReleaseAge: 10080` (7 days). pnpm will refuse to resolve any package version newer than 7 days old. Vite+ toolchain packages are excluded from this guard. Do not bump package versions to the very latest just because it exists.

## Install

```bash
vp install   # installs deps and sets up the pre-commit hook
```

## Build

Build order matters: lib must be built before cli (cli imports lib).

```bash
pnpm build         # builds both packages in dependency order
pnpm build:lib     # lib only
pnpm build:cli     # cli only (requires lib already built)
```

Builds are run via `vp run -r build` under the hood. Each package's `vp build` call compiles TypeScript via Vite with `vite-plugin-dts` for type declarations.

**Output:**

- `packages/lib/dist/index.mjs` + `index.cjs` + type declarations
- `packages/cli/dist/index.js` (ESM, with `#!/usr/bin/env node` banner)

The lib package has an `exports` map that routes ESM imports to `.mjs` and CJS require to `.cjs`. This is load-bearing — do not remove it.

## Test

```bash
vp test run          # all packages, run once
vp test watch        # all packages, watch mode
pnpm test:lib        # lib only (vp test run packages/lib)
pnpm test:lib:watch  # lib only, watch mode
```

`vp test` discovers both packages via `test.projects: ['packages/*']` in the root `vite.config.ts`. Each package has its own `vitest.config.ts`.

Test imports use `vite-plus/test`, not `vitest` directly:

```ts
import { describe, it, expect } from "vite-plus/test";
```

Many tests require missing test fixtures (PDFs) or live API keys (`MISTRAL_API_KEY`, `OPENROUTER_KEY`) and will fail without them — this is expected. Focus on the tests that don't require external resources.

To run a single test file manually:

```bash
vp run -F @pdf-to-bloom/lib test packages/lib/src/2-llm/llmMarkdown.manual.test.ts
```

## Format, Lint, Type-check

```bash
vp fmt       # format with oxfmt (Vite+'s default formatter)
vp lint      # lint with oxlint
vp check     # format + lint + type-check (run this before committing)
```

The pre-commit hook (`.vite-hooks/pre-commit`) runs `vp staged` which calls `vp check --fix` on staged files automatically. The formatter settings live in `vite.config.ts` under `fmt: {}` (oxfmt defaults).

## Development Watch Mode

```bash
vp run dev     # both packages in parallel watch mode
pnpm dev:lib   # lib only
pnpm dev:cli   # cli only
```

Note: `vp dev` is the Vite dev server (not useful for this library-only monorepo). Use `vp run dev` instead, which runs the `dev` npm script.

## Run the CLI

The CLI must be built first.

```bash
pnpm cli input.pdf                          # convert PDF → Bloom HTML
pnpm cli input.pdf --target ocr            # OCR only (markdown + images)
pnpm cli input.pdf --target tagged         # through LLM processing
pnpm cli input.pdf --collection recent     # use most recently opened Bloom collection
pnpm cli input.pdf --output test-outputs/  # write to a specific directory
pnpm test:md-to-tagged                      # build both packages then run a test conversion
```

When running ad-hoc tests, use `--output test-outputs/...` so output lands in the gitignored directory.

## API Keys Required

Set these in your environment before running OCR/LLM stages:

- `OPENROUTER_KEY` — GPT/OpenRouter OCR (the default), LLM enrichment, and vision-formatting
- `MISTRAL_API_KEY` — only needed for `--ocr mistral`

## Pipeline Architecture

A 4-stage conversion (Stage 1 OCR → Stage 2 LLM enrichment → Stage 3 Bloom plan →
Stage 4 HTML), with the Markdown artifact between stages doubling as a cache. Stage
code lives in `packages/lib/src/{1-ocr,2-llm,3-add-bloom-plan,4-generate-html,5-notify-bloom}`;
the Markdown contract is in `packages/lib/src/bloom-markdown/` and core types
(`Book`, `Page`, `PageElement`, `FrontMatterMetadata`) in `packages/lib/src/types.ts`.

**See [`conversion-process.md`](conversion-process.md) for the full reference** — every
stage in depth, the CLI-option-to-stage mapping, the intermediate Markdown format, the
variety of inputs and how each is handled, and vestigial code / known issues. Read it
before changing anything in the pipeline.

## Root Config Files

- `vite.config.ts` — workspace root config: `staged` (pre-commit), `fmt`, `lint`, `test.projects`
- `pnpm-workspace.yaml` — workspace packages, `minimumReleaseAge`, `allowBuilds`, `catalog` (vite/vitest/vite-plus versions)
- `packages/lib/vite.config.ts` — lib build config (plugins: dts, copy-llm-prompt, copy-pdf-worker, copy-poppler-binaries)
- `packages/cli/vite.config.ts` — cli build config
- `packages/*/vitest.config.ts` — per-package test config (discovered by root `test.projects`)
