import * as path from "path";
import { fileURLToPath } from "url";

/**
 * Resolve the directory of the current module in a way that works for both the
 * ESM (`index.mjs`) and CJS (`index.cjs`) builds.
 *
 * - In the ESM bundle, `__dirname` is not defined, but `import.meta.url` is.
 * - In the CJS bundle, the bundler replaces `import.meta.url` with `{}` (so
 *   `fileURLToPath` throws), but `__dirname` is defined.
 *
 * Returns the directory containing the running bundle (e.g. `dist/`), which is
 * where build-time assets such as `llmPrompt.txt` and the Poppler `bin/` are copied.
 */
export function getModuleDir(): string {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return __dirname;
  }
}
