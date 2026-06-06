# Development Instructions for LLMs

This is the BloomBridge monorepo for converting documents to Bloom format, with the following technical stack and conventions:

## Project Structure

This is a **Yarn workspaces monorepo** with three packages:

- `packages/lib` - Core TypeScript library with Vite build
- `packages/cli` - Command-line interface tool
- `packages/web` - React web interface with Vite + Tailwind CSS

## Package Manager

- **pnpm** - Use `pnpm`/`vp` commands, not `npm` or `yarn` (pinned via the `packageManager` field)
- **pnpm Workspaces** - All packages managed from root (`pnpm-workspace.yaml`)
- **Vite+ (`vp`)** - Unified toolchain; install once: `npm install -g vite-plus-cli`

## Language & Build Tools

- **TypeScript** - Primary language for source code
- **Node.js 22+** - No runtime pin
- **Vite+** - Build tool and bundler (Vite under the hood); `vite-plugin-dts` for type definitions (lib package)
- **Vitest** - Testing framework (via `vite-plus/test`)
- **oxfmt / oxlint** - Formatting and linting (via `vp fmt` / `vp lint` / `vp check`)
- **React** - Frontend framework for web package
- **Tailwind CSS** - Styling framework for web package

## Available Scripts (Root Level)

### Building

- `pnpm build` - Build all packages
- `pnpm build:lib` - Build only the lib package
- `pnpm build:cli` - Build only the CLI package

### Development

- `vp run dev` - Start development mode for all packages (parallel watch build)
- `pnpm dev:lib` - Start lib development only (build watch mode)
- `pnpm dev:cli` - Start CLI development only (build watch mode)

### CLI Usage

- `pnpm cli` - Run the built CLI tool

## Testing

- use `vp test run` to run all tests across packages. This often works better than the "run_tests" tool.
- Use **Vitest** for all tests
- Test files should end with `.test.ts`
- Import test utilities: `import { describe, it, expect } from 'vitest'`

## Build Output

### Lib Package

- Dual ESM/CJS builds via Vite (`dist/index.mjs` and `dist/index.cjs`)
- TypeScript declarations included (`dist/index.d.ts`)
- Custom Vite plugins for asset copying

### For file paths in commands:

- Use forward slashes `/` or escape backslashes `\\`

Important: do not recommend adding extensions on import statements, as this is a TypeScript project and extensions are not needed.

Do not tell me to do things or check things, do it yourself as an agent.

Ask me any clarifying questions.

When running add-hoc tests in the terminal, use the --output option to place outputs underneath the `test-outputs` directory, e.g. `pnpm test:md-to-tagged --output test-outputs/md-to-tagged`.

When doing debugging by writing temporary one-off code files in the terminal, remember not to leave them laying around.

YOU MUST ALWAYS include the --output option when running the CLI tool. The tool defaults to using the most recent Bloom collection when no --output or --collection is specified, but as a coding assistant, you should never rely on this default behavior. Always explicitly specify --output with a path under test-outputs/ to avoid interfering with the user's actual Bloom collections.
