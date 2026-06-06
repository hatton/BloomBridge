# BloomBridge

A monorepo containing tools for converting PDF documents to Bloom-compatible HTML format through intelligent markdown processing.

## Packages

This monorepo contains two packages:

### [@bloombridge/lib](./packages/lib)

The core Node.js library that provides the BloomBridge document-to-Bloom conversion functionality.

### [@bloombridge/cli](./packages/cli)

A command-line interface for converting PDFs to Bloom format.

## Requirements

- Node.js 22 or higher
- OpenRouter API key
- This project uses the [Vite+](https://viteplus.dev) toolchain (`vp`) with
  [pnpm](https://pnpm.io) as the package manager. Install the Vite+ CLI once,
  globally:

  ```bash
  npm install -g vite-plus-cli
  ```

## Development

### Setup

```bash
# Clone the repository
git clone <repository-url>
cd pdf-to-bloom

# Install dependencies (also sets up the formatting pre-commit hook)
vp install
```

### Developing

```bash

# Watch both lib and cli in parallel
vp run dev

# Run all tests once
vp test run

# Run tests in watch mode
vp test watch


# convert a pdf. When --collection is used, the languages specified in the .bloomCollection will be fed to the llm as a hint of what languages to expect
pnpm cli input.pdf # defaults to most recently opened Bloom collection for better language detection
pnpm cli input.pdf --collection recent # explicitly use the most recently opened Bloom collection (release, alpha, beta, or betainternal)
pnpm cli input.pdf --collection path/to/bloom/collection # output to a particular collection
pnpm cli input.pdf --output path/to/output/directory # output to a specific directory instead of a collection


# Extract only images from a PDF
pnpm cli input.pdf --target images

# Extract markdown and images from PDF
pnpm cli input.pdf --target ocr
pnpm cli input.pdf --target ocr --ocr google/gemini-2.5-pro # specify an llm to do the ocr
```

See [./packages/cli/README.md](./packages/cli/README.md) for details

### Code formatting

Formatting is handled by Vite+'s built-in [oxfmt](https://viteplus.dev)
formatter, configured in [vite.config.ts](./vite.config.ts) under the `fmt`
field (defaults). A pre-commit hook (`.vite-hooks/pre-commit` → `vp staged`)
runs `vp check --fix` on staged files, so commits are auto-formatted. Install
the recommended `VoidZero.vite-plus-extension-pack` extension for matching
format-on-save in VS Code.

### Building

```bash
pnpm build
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
