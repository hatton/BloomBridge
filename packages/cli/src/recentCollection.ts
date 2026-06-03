import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { XMLParser } from "fast-xml-parser";

/**
 * Extracts the most recently opened Bloom collection path across all channels
 * @returns {Promise<string|null>} The most recent collection path or null if none found
 */
export async function getMostRecentBloomCollection(): Promise<string | null> {
  const userDataPath = path.join(os.homedir(), "AppData", "Local");

  // Bloom channels
  const channels = ["Bloom", "BloomAlpha", "BloomBeta", "BloomBetaInternal"];

  let mostRecentPath: string | null = null;
  let mostRecentTime = 0;

  const silPath = path.join(userDataPath, "SIL");

  try {
    await fs.access(silPath);
  } catch {
    return null; // SIL directory doesn't exist
  }

  for (const channel of channels) {
    try {
      const channelPath = path.join(silPath, channel);

      // Check if this channel directory exists
      try {
        await fs.access(channelPath);
      } catch {
        continue; // Channel doesn't exist, try next one
      }

      // Find all version directories for this channel
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
      // Continue checking other channels if one fails
      console.warn(`Failed to check channel ${channel}:`, error.message);
    }
  }

  return mostRecentPath;
}

/**
 * Find all Bloom config directories (version directories) for a given channel
 */
async function findConfigDirectories(channelPath: string): Promise<string[]> {
  try {
    await fs.access(channelPath);
  } catch {
    return [];
  }

  const dirents = await fs.readdir(channelPath, { withFileTypes: true });
  const dirs = dirents
    .filter((dirent) => dirent.isDirectory())
    .filter((dirent) => {
      // Match version number pattern like "6.3.1036.0" or "6.1.1.0"
      return /^\d+\.\d+\.\d+\.\d+$/.test(dirent.name);
    })
    .map((dirent) => path.join(channelPath, dirent.name));

  return dirs;
}

/**
 * Find the user.config file in a config directory
 */
async function findUserConfig(configDir: string): Promise<string | null> {
  try {
    const files = await fs.readdir(configDir);
    const userConfig = files.find((file) => file === "user.config");
    return userConfig ? path.join(configDir, userConfig) : null;
  } catch (error) {
    return null;
  }
}

/**
 * Extract MRU path from a .NET user.config file
 */
async function extractMruFromConfig(configPath: string): Promise<string | null> {
  try {
    const configXml = await fs.readFile(configPath, "utf8");
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
    });
    const result = parser.parse(configXml);

    // Navigate the .NET config structure
    const userSettings = result?.configuration?.userSettings;
    if (!userSettings) {
      return null;
    }

    // Look for Bloom settings
    const bloomSettings = userSettings["Bloom.Properties.Settings"];
    if (!bloomSettings) {
      return null;
    }

    // Find MruProjects setting
    const settings = bloomSettings.setting;
    if (!settings) {
      return null;
    }

    // Handle both array and single setting cases
    const settingsArray = Array.isArray(settings) ? settings : [settings];
    const mruSetting = settingsArray.find((s) => s.name === "MruProjects");
    if (!mruSetting?.value) {
      return null;
    }

    // The MRU value is already parsed, no need to parse it again
    const mruData = mruSetting.value;

    // Extract the most recent path - check both 'Path' and 'Paths' for compatibility
    let paths = mruData?.RecentlyUsedFiles?.Path;
    if (!paths) {
      paths = mruData?.RecentlyUsedFiles?.Paths?.string;
    }

    if (paths && Array.isArray(paths) && paths.length > 0) {
      // Return the first path (most recent)
      return paths[0];
    } else if (typeof paths === "string") {
      // Single path case
      return paths;
    }

    return null;
  } catch (error: any) {
    console.warn(`Failed to parse config file ${configPath}:`, error.message);
    return null;
  }
}
