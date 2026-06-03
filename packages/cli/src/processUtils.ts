import * as fs from "fs/promises"; // Use promises API for async file operations
import * as path from "path";
import os from "os"; // For temporary directory creation
import chalk from "chalk";
import { XMLParser } from "fast-xml-parser";
import { Language } from "@pdf-to-bloom/lib";
import { getMostRecentBloomCollection } from "./recentCollection";

// --- Helper Functions from original code, slightly adapted for async/promises ---

export function getApiKeys(options: any) {
  const mistralKey = options.mistralApiKey || process.env.MISTRAL_API_KEY;
  const openrouterKey = options.openrouterKey || process.env.OPENROUTER_KEY;
  return { mistralKey, openrouterKey };
}

/**
 * Checks if a path is a simple directory name (not a full path)
 * @param collectionPath The path to check
 * @returns true if it's a simple directory name, false if it's a full path
 */
function isSimpleDirectoryName(collectionPath: string): boolean {
  // Check if it contains path separators or is an absolute path
  const normalizedPath = path.normalize(collectionPath);

  // If it's the same after resolving and doesn't contain separators, it's likely a simple name
  // Also check common absolute path patterns
  return (
    !path.isAbsolute(normalizedPath) &&
    !normalizedPath.includes(path.sep) &&
    !normalizedPath.includes("/") &&
    !normalizedPath.includes("\\") &&
    normalizedPath === collectionPath
  );
}

/**
 * Validates and resolves a collection path.
 * If a simple directory name is provided (e.g., "palɨ Books"), it will be expanded to
 * the user's Documents/Bloom folder (e.g., "C:/Users/username/Documents/Bloom/palɨ Books").
 * If "recent" is provided, it will find the most recently opened Bloom collection.
 * @param collectionPath Path to either a Bloom collection folder or .bloomCollection file, simple directory name, or "recent"
 * @returns Object containing the collection folder path and collection file path
 * @throws Error if the path is invalid
 */
export async function validateAndResolveCollectionPath(collectionPath: string): Promise<{
  collectionFolderPath: string;
  collectionFilePath: string;
}> {
  let resolvedPath: string;

  // Handle "recent" special case
  if (collectionPath.toLowerCase() === "recent") {
    console.log(chalk.blue("Looking up most recent Bloom collection..."));
    const recentPath = await getMostRecentBloomCollection();
    if (!recentPath) {
      throw new Error("No recent Bloom collections found in user settings");
    }
    console.log(chalk.green(`Found most recent collection: ${recentPath}`));
    // Recursively call this function with the found path
    return validateAndResolveCollectionPath(recentPath);
  }

  // Check if this is a simple directory name that should be expanded to Documents/Bloom
  if (isSimpleDirectoryName(collectionPath)) {
    const homeDir = os.homedir();

    // Try OneDrive Documents first (common on Windows), then fallback to regular Documents
    const possiblePaths = [
      path.join(homeDir, "OneDrive", "Documents", "Bloom", collectionPath),
      path.join(homeDir, "Documents", "Bloom", collectionPath),
    ];

    let documentsBloomPath: string | null = null;

    // Check which path exists
    for (const possiblePath of possiblePaths) {
      try {
        await fs.access(possiblePath);
        documentsBloomPath = possiblePath;
        break;
      } catch {
        // Path doesn't exist, try next one
      }
    }

    if (!documentsBloomPath) {
      // If neither path exists, use the first one for error reporting
      documentsBloomPath = possiblePaths[0];
    }

    resolvedPath = path.resolve(documentsBloomPath);
    console.log(
      chalk.blue(`Expanding simple collection name '${collectionPath}' to: ${resolvedPath}`),
    );
  } else {
    resolvedPath = path.resolve(collectionPath);
  }

  // Check if path exists
  try {
    const stats = await fs.stat(resolvedPath);

    if (stats.isFile()) {
      // If it's a file, it should end with .bloomCollection
      if (!resolvedPath.endsWith(".bloomCollection")) {
        throw new Error(`Collection file must end with .bloomCollection, got: ${resolvedPath}`);
      }

      return {
        collectionFolderPath: path.dirname(resolvedPath),
        collectionFilePath: resolvedPath,
      };
    } else if (stats.isDirectory()) {
      // If it's a directory, look for a .bloomCollection file inside
      const files = await fs.readdir(resolvedPath);
      const bloomCollectionFile = files.find((file) => file.endsWith(".bloomCollection"));

      if (!bloomCollectionFile) {
        throw new Error(`No .bloomCollection file found in directory: ${resolvedPath}`);
      }

      return {
        collectionFolderPath: resolvedPath,
        collectionFilePath: path.join(resolvedPath, bloomCollectionFile),
      };
    } else {
      throw new Error(`Collection path must be a file or directory: ${resolvedPath}`);
    }
  } catch (error: any) {
    if (error.code === "ENOENT") {
      throw new Error(`Collection path does not exist: ${resolvedPath}`);
    }
    throw error;
  }
}

export async function createTempDir(): Promise<string> {
  // Creates a unique temporary directory
  return fs.mkdtemp(path.join(os.tmpdir(), "pdf-to-bloom-"));
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

/* example Bloom Collection Settings:
<?xml version="1.0" encoding="utf-8"?>
<Collection version="0.2">
  <Language1Name>Edolo</Language1Name>
  <Language1Iso639Code>etr</Language1Iso639Code>
  <Language2Name>Tok Pisin</Language2Name>
  <Language2Iso639Code>tpi</Language2Iso639Code>
  <Language3Name>English</Language3Name>
  <Language3Iso639Code>en</Language3Iso639Code>
</Collection>
*/
export async function readBloomCollectionSettingsIfFound(
  folderPath: string,
): Promise<{ l1?: Language; l2?: Language; l3?: Language } | null> {
  // the settingFilePath will be the first file that ends in ".bloomCollection". It does not end in "xml"
  // search a file ending in ".bloomCollection" in the folderPath, then one level up if not found

  let settingsFilePath: string | null = null;

  // First, try the current folder
  try {
    const files = await fs.readdir(folderPath);
    const bloomCollectionFile = files.find((file) => file.endsWith(".bloomCollection"));
    if (bloomCollectionFile) {
      settingsFilePath = path.join(folderPath, bloomCollectionFile);
    }
  } catch (error) {
    console.warn(chalk.yellow(`Could not read directory ${folderPath}: ${error}`));
  }

  // If not found, try one level up
  if (!settingsFilePath) {
    const parentPath = path.dirname(folderPath);
    try {
      const parentFiles = await fs.readdir(parentPath);
      const bloomCollectionFile = parentFiles.find((file) => file.endsWith(".bloomCollection"));
      if (bloomCollectionFile) {
        settingsFilePath = path.join(parentPath, bloomCollectionFile);
      }
    } catch (error) {
      console.warn(chalk.yellow(`Could not read parent directory ${parentPath}: ${error}`));
    }
  }

  if (!settingsFilePath || !(await fileExists(settingsFilePath))) {
    console.warn(
      chalk.yellow(
        `No .bloomCollection file found in ${folderPath}. Using default language settings.`,
      ),
    );
    return null; // No settings file found
  }
  try {
    const content = await fs.readFile(settingsFilePath, "utf-8");

    const parser = new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: false,
      parseTagValue: false,
      trimValues: true,
    });

    const xmlData = parser.parse(content);
    const collection = xmlData.Collection;

    const l1Name = collection?.Language1Name;
    const l1IsoCode = collection?.Language1Iso639Code;
    const l2Name = collection?.Language2Name;
    const l2IsoCode = collection?.Language2Iso639Code;
    const l3Name = collection?.Language3Name;
    const l3IsoCode = collection?.Language3Iso639Code;

    return {
      l1: l1Name && l1IsoCode ? { tag: l1IsoCode, name: l1Name } : undefined,
      l2: l2Name && l2IsoCode ? { tag: l2IsoCode, name: l2Name } : undefined,
      l3: l3Name && l3IsoCode ? { tag: l3IsoCode, name: l3Name } : undefined,
    };
  } catch (error) {
    console.error(chalk.red(`Error reading Bloom collection settings: ${error}`));
    throw error;
  }
}
