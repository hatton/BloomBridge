import { spawn } from "child_process";
import { existsSync } from "fs";
import * as path from "path";
import { logger } from "../logger";
import { getModuleDir } from "../moduleDir";

/**
 * Resolve the path to a bundled Poppler command-line tool (e.g. "pdfimages",
 * "pdftocairo", "pdfinfo"). The Poppler binaries are copied into
 * `<dist>/bin/win32` at build time. Depending on whether this module runs
 * bundled (dist/index.{mjs,cjs}) or unbundled (src during tests), the binaries
 * sit at a different relative offset, so try the likely candidates before
 * falling back to the system PATH.
 */
export function getPopplerToolPath(tool: string): string {
  const exe = `${tool}.exe`;
  const moduleDir = getModuleDir();
  const candidates = [
    path.resolve(moduleDir, "bin", "win32", exe), // bundled: dist/bin/win32
    path.resolve(moduleDir, "..", "bin", "win32", exe), // legacy nested layout
    path.resolve(moduleDir, "..", "..", "bin", "win32", exe), // src/1-ocr -> packages/lib/bin
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Fall back to system PATH (works on non-win32 platforms where the operator
  // has installed Poppler themselves).
  logger.info(`Using ${tool} from system PATH`);
  return tool;
}

/**
 * Run a Poppler tool and resolve with its stdout. Rejects on a non-zero exit.
 */
export function runPopplerTool(tool: string, args: string[]): Promise<string> {
  const toolPath = getPopplerToolPath(tool);

  return new Promise((resolve, reject) => {
    const childProcess = spawn(toolPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LANG: "en_US.UTF-8" },
    });

    let stdout = "";
    let stderr = "";

    childProcess.stdout.on("data", (data: Buffer) => {
      stdout += data.toString("utf8");
    });

    childProcess.stderr.on("data", (data: Buffer) => {
      stderr += data.toString("utf8");
    });

    childProcess.on("close", (code: number | null) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${tool} failed with code ${code}: ${stderr}`));
      }
    });

    childProcess.on("error", (error: Error) => {
      reject(new Error(`Failed to run ${tool}: ${error.message}`));
    });
  });
}
