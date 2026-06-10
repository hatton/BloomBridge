# BloomBridge

A monorepo containing tools for converting PDF and ePUB documents to Bloom-compatible HTML through OCR, LLM processing, and HTML generation. Produces bilingual educational content.

## Packages

### [@bloombridge/lib](./packages/lib)

The core Node.js library that provides the BloomBridge document-to-Bloom conversion pipeline (OCR → LLM enrichment → Bloom plan → HTML).

### [@bloombridge/cli](./packages/cli)

A command-line interface for converting PDFs and markdown to Bloom format. See [its README](./packages/cli/README.md) for full usage — collections, targets, vision formatting, master pages, and more.

### [@bloombridge/gui](./packages/gui)

A local web app — the **Conversion Manager** — for browsing source documents, configuring conversions, running them, and live-watching progress. It's a React + Vite front end; the backend API and live (SSE) updates are served by Vite itself and drive the lib in-process (no separate server in dev).

### [@bloombridge/app](./packages/app)

A [Neutralino](https://neutralino.js.org) desktop app wrapping the GUI, packaged as a self-contained Windows installer. It runs the GUI's Node backend as a sidecar process. See [its README](./packages/app/README.md) for setup, running, and building the installer.

## Requirements

- Node.js 22 or higher
- For PDF conversion, an openrouter api key is needed.
- This project uses the [Vite+](https://viteplus.dev) toolchain (`vp`) with
  [pnpm](https://pnpm.io) as the package manager. Install the Vite+ CLI once,
  globally:

  ```bash
  npm install -g vite-plus-cli
  ```

## Development

```bash
# Install dependencies (and set up the pre-commit hook)
vp install

# Run the full GUI dev stack (gui + lib + cli in parallel watch mode).
# GUI Vite/React HMR on http://localhost:5180; lib and cli rebuild on change.
./go.sh          # or: vp run dev

# Watch a subset in parallel watch mode
pnpm dev:lib
pnpm dev:cli

# Run the desktop app (rebuilds lib + gui + sidecar, then launches the window)
pnpm app-setup   # first time only — downloads the Neutralino binaries
pnpm app-dev

# Build everything (lib before cli, dependency order)
pnpm build

# Run all tests once / in watch mode
vp test run
vp test watch

# Format + lint + type-check (run before committing)
vp check
```

To convert a document from the command line, see the [CLI README](./packages/cli/README.md).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
