import * as fs from "fs/promises"; // Use promises API for async file operations
import * as path from "path";
import os from "os"; // For temporary directory creation
import chalk from "chalk";
import {
  validateAndResolveCollectionPath,
  readBloomCollectionSettingsIfFound,
} from "@bloombridge/lib";

// The collection helpers now live in the lib (so the GUI server can use them too);
// re-export here so existing CLI imports keep working unchanged.
export { validateAndResolveCollectionPath, readBloomCollectionSettingsIfFound };

// --- Helper Functions from original code, slightly adapted for async/promises ---

export function getApiKeys(options: any) {
  const mistralKey = options.mistralApiKey || process.env.MISTRAL_API_KEY;
  const openrouterKey = options.openrouterKey || process.env.OPENROUTER_KEY;
  return { mistralKey, openrouterKey };
}

export async function createTempDir(): Promise<string> {
  // Creates a unique temporary directory
  return fs.mkdtemp(path.join(os.tmpdir(), "bloombridge-"));
}

export async function cleanUpTempDir(dirPath: string) {
  if (dirPath && (await fileExists(dirPath))) {
    await fs.rm(dirPath, { recursive: true, force: true });
    console.log(chalk.gray(`Cleaned up temporary directory: ${dirPath}`));
  }
}

export function createLogCallback(showVerbose: boolean) {
  return (log: any) => {
    switch (log.level) {
      case "error":
        console.error(chalk.red(`❌ ${log.message}`));
        break;
      case "info":
        console.info(chalk.blue(`${log.message}`));
        break;
      case "warn":
        console.warn(chalk.yellow(`⚠️ ${log.message}`));
        break;

      case "verbose":
        if (showVerbose) {
          console.log(chalk.gray(`${log.message}`));
        }
        break;
    }
  };
}

// More robust check for YAML front matter presence
export async function checkIfTagged(filePath: string): Promise<boolean> {
  if (!(await fileExists(filePath))) return false;
  const content = await fs.readFile(filePath, "utf-8");
  // Check for '---' at the very beginning (trimmed), followed by content, then another '---'
  // (which typically implies a YAML block end marker, on a new line or not)
  return content.trim().startsWith("---") && content.includes("---", 3);
}

export function getFileNameWithoutExtension(filePath: string): string {
  return path.parse(filePath).name;
}

export function getFileExtension(filePath: string): string {
  return path.parse(filePath).ext;
}

export async function findMarkdownFileInDirectory(dirPath: string): Promise<string | null> {
  const files = await fs.readdir(dirPath);
  const mdFiles = files.filter((f) => f.toLowerCase().endsWith(".md"));
  if (mdFiles.length === 0) {
    return null;
  } else if (mdFiles.length === 1) {
    return path.join(dirPath, mdFiles[0]);
  } else {
    // If multiple .md files exist, warn and pick the first one as per original code.
    // In a real-world scenario, you might want to throw an error or ask the user to specify.
    console.warn(
      chalk.yellow(
        `Warning: Multiple .md files found in ${dirPath}. Using the first one: ${mdFiles[0]}`,
      ),
    );
    return path.join(dirPath, mdFiles[0]);
  }
}
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
