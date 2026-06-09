/**
 * Bloom collection + PDF-folder discovery, shared by the CLI and the GUI server.
 * (Moved out of the CLI so both packages use one implementation.)
 */
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { XMLParser } from "fast-xml-parser";
import { logger } from "../logger";
import type { Language } from "../types";

// ----------------------------------------------------------------------------
// Most-recent collection (reads Bloom's .NET user.config MRU list)
// ----------------------------------------------------------------------------

export async function getMostRecentBloomCollection(): Promise<string | null> {
  const userDataPath = path.join(os.homedir(), "AppData", "Local");
  const channels = ["Bloom", "BloomAlpha", "BloomBeta", "BloomBetaInternal"];

  let mostRecentPath: string | null = null;
  let mostRecentTime = 0;

  const silPath = path.join(userDataPath, "SIL");
  try {
    await fs.access(silPath);
  } catch {
    return null;
  }

  for (const channel of channels) {
    try {
      const channelPath = path.join(silPath, channel);
      try {
        await fs.access(channelPath);
      } catch {
        continue;
      }
      const configDirs = await findConfigDirectories(channelPath);
      for (const configDir of configDirs) {
        const configFile = await findUserConfig(configDir);
        if (configFile) {
          const mruPath = await extractMruFromConfig(configFile);
          if (mruPath) {
            const stats = await fs.stat(configFile);
            if (stats.mtime.getTime() > mostRecentTime) {
              mostRecentTime = stats.mtime.getTime();
              mostRecentPath = mruPath;
            }
          }
        }
      }
    } catch (error: any) {
      logger.warn(`Failed to check Bloom channel ${channel}: ${error?.message ?? error}`);
    }
  }

  return mostRecentPath;
}

async function findConfigDirectories(channelPath: string): Promise<string[]> {
  try {
    await fs.access(channelPath);
  } catch {
    return [];
  }
  const dirents = await fs.readdir(channelPath, { withFileTypes: true });
  return dirents
    .filter((d) => d.isDirectory())
    .filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d.name))
    .map((d) => path.join(channelPath, d.name));
}

async function findUserConfig(configDir: string): Promise<string | null> {
  try {
    const files = await fs.readdir(configDir);
    const userConfig = files.find((f) => f === "user.config");
    return userConfig ? path.join(configDir, userConfig) : null;
  } catch {
    return null;
  }
}

async function extractMruFromConfig(configPath: string): Promise<string | null> {
  try {
    const configXml = await fs.readFile(configPath, "utf8");
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
    const result = parser.parse(configXml);

    const userSettings = result?.configuration?.userSettings;
    if (!userSettings) return null;
    const bloomSettings = userSettings["Bloom.Properties.Settings"];
    if (!bloomSettings) return null;
    const settings = bloomSettings.setting;
    if (!settings) return null;

    const settingsArray = Array.isArray(settings) ? settings : [settings];
    const mruSetting = settingsArray.find((s) => s.name === "MruProjects");
    if (!mruSetting?.value) return null;

    const mruData = mruSetting.value;
    let paths = mruData?.RecentlyUsedFiles?.Path;
    if (!paths) paths = mruData?.RecentlyUsedFiles?.Paths?.string;

    if (Array.isArray(paths) && paths.length > 0) return paths[0];
    if (typeof paths === "string") return paths;
    return null;
  } catch (error: any) {
    logger.warn(`Failed to parse Bloom config ${configPath}: ${error?.message ?? error}`);
    return null;
  }
}

// ----------------------------------------------------------------------------
// Resolve a collection path (name | full path | .bloomCollection | "recent")
// ----------------------------------------------------------------------------

function isSimpleDirectoryName(collectionPath: string): boolean {
  const normalizedPath = path.normalize(collectionPath);
  return (
    !path.isAbsolute(normalizedPath) &&
    !normalizedPath.includes(path.sep) &&
    !normalizedPath.includes("/") &&
    !normalizedPath.includes("\\") &&
    normalizedPath === collectionPath
  );
}

export async function validateAndResolveCollectionPath(collectionPath: string): Promise<{
  collectionFolderPath: string;
  collectionFilePath: string;
}> {
  let resolvedPath: string;

  if (collectionPath.toLowerCase() === "recent") {
    logger.info("Looking up most recent Bloom collection...");
    const recentPath = await getMostRecentBloomCollection();
    if (!recentPath) throw new Error("No recent Bloom collections found in user settings");
    logger.info(`Found most recent collection: ${recentPath}`);
    return validateAndResolveCollectionPath(recentPath);
  }

  if (isSimpleDirectoryName(collectionPath)) {
    const homeDir = os.homedir();
    const possiblePaths = [
      path.join(homeDir, "OneDrive", "Documents", "Bloom", collectionPath),
      path.join(homeDir, "Documents", "Bloom", collectionPath),
    ];
    let documentsBloomPath: string | null = null;
    for (const possiblePath of possiblePaths) {
      try {
        await fs.access(possiblePath);
        documentsBloomPath = possiblePath;
        break;
      } catch {
        // try next
      }
    }
    if (!documentsBloomPath) documentsBloomPath = possiblePaths[0];
    resolvedPath = path.resolve(documentsBloomPath);
    logger.info(`Expanding simple collection name '${collectionPath}' to: ${resolvedPath}`);
  } else {
    resolvedPath = path.resolve(collectionPath);
  }

  try {
    const stats = await fs.stat(resolvedPath);
    if (stats.isFile()) {
      if (!resolvedPath.endsWith(".bloomCollection")) {
        throw new Error(`Collection file must end with .bloomCollection, got: ${resolvedPath}`);
      }
      return { collectionFolderPath: path.dirname(resolvedPath), collectionFilePath: resolvedPath };
    } else if (stats.isDirectory()) {
      const files = await fs.readdir(resolvedPath);
      const bloomCollectionFile = files.find((f) => f.endsWith(".bloomCollection"));
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
    if (error.code === "ENOENT") throw new Error(`Collection path does not exist: ${resolvedPath}`);
    throw error;
  }
}

// ----------------------------------------------------------------------------
// Read L1/L2/L3 language hints from a .bloomCollection settings file
// ----------------------------------------------------------------------------

export async function readBloomCollectionSettingsIfFound(
  folderPath: string,
): Promise<{ l1?: Language; l2?: Language; l3?: Language } | null> {
  let settingsFilePath: string | null = null;

  try {
    const files = await fs.readdir(folderPath);
    const bloomCollectionFile = files.find((file) => file.endsWith(".bloomCollection"));
    if (bloomCollectionFile) settingsFilePath = path.join(folderPath, bloomCollectionFile);
  } catch (error) {
    logger.warn(`Could not read directory ${folderPath}: ${String(error)}`);
  }

  if (!settingsFilePath) {
    const parentPath = path.dirname(folderPath);
    try {
      const parentFiles = await fs.readdir(parentPath);
      const bloomCollectionFile = parentFiles.find((file) => file.endsWith(".bloomCollection"));
      if (bloomCollectionFile) settingsFilePath = path.join(parentPath, bloomCollectionFile);
    } catch (error) {
      logger.warn(`Could not read parent directory ${parentPath}: ${String(error)}`);
    }
  }

  if (!settingsFilePath) {
    logger.warn(
      `No .bloomCollection file found in ${folderPath}. Using default language settings.`,
    );
    return null;
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
    logger.error(`Error reading Bloom collection settings: ${String(error)}`);
    throw error;
  }
}

// ----------------------------------------------------------------------------
// Scan a folder for PDF files (the GUI's source list)
// ----------------------------------------------------------------------------

export interface ScannedPdf {
  /** absolute path to the PDF */
  path: string;
  /** file name without extension (the book name) */
  name: string;
  /** path relative to the scanned root (for grouping by subfolder) */
  relPath: string;
  /** size in bytes */
  size: number;
}

/**
 * List every convertible source (PDF or EPUB) under `dir`. Recurses into
 * subfolders by default. Ignores hidden folders and a couple of well-known noise
 * dirs. (Named `scanPdfFolder` for history; it also matches `.epub`.)
 */
export async function scanPdfFolder(
  dir: string,
  options?: { recursive?: boolean },
): Promise<ScannedPdf[]> {
  const recursive = options?.recursive ?? true;
  const root = path.resolve(dir);
  const out: ScannedPdf[] = [];

  async function walk(current: string) {
    let entries: import("fs").Dirent[] = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!recursive) continue;
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        await walk(full);
      } else if (
        entry.isFile() &&
        (entry.name.toLowerCase().endsWith(".pdf") || entry.name.toLowerCase().endsWith(".epub"))
      ) {
        let size = 0;
        try {
          size = (await fs.stat(full)).size;
        } catch {
          // leave size 0
        }
        out.push({
          path: full,
          name: path.parse(entry.name).name,
          relPath: path.relative(root, full),
          size,
        });
      }
    }
  }

  await walk(root);
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}
