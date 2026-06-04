/* Local settings store for the Conversion Manager (API keys, workspace, defaults).
   Persisted to ~/.pdf2bloom/settings.json. Server-side only. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

export interface ServerSettings {
  openrouterKey: string;
  mistralKey: string;
  workspace: string;
  defaultCollection: string;
  maxParallel: number;
}

const CONFIG_DIR = path.join(os.homedir(), ".pdf2bloom");
const SETTINGS_PATH = path.join(CONFIG_DIR, "settings.json");

function defaults(): ServerSettings {
  return {
    openrouterKey: process.env.OPENROUTER_KEY || "",
    mistralKey: process.env.MISTRAL_API_KEY || "",
    workspace: path.join(CONFIG_DIR, "workspace"),
    defaultCollection: "",
    maxParallel: 2,
  };
}

let cached: ServerSettings | null = null;

export async function getSettings(): Promise<ServerSettings> {
  if (cached) return cached;
  try {
    const raw = await fs.readFile(SETTINGS_PATH, "utf-8");
    cached = { ...defaults(), ...JSON.parse(raw) };
  } catch {
    cached = defaults();
  }
  return cached;
}

export async function saveSettings(patch: Partial<ServerSettings>): Promise<ServerSettings> {
  const current = await getSettings();
  const next: ServerSettings = { ...current, ...patch };
  cached = next;
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(next, null, 2));
  return next;
}

/** Keys are never sent to the browser verbatim; we send whether each is set. */
export function redactSettings(s: ServerSettings) {
  return {
    openrouterKeySet: !!s.openrouterKey,
    mistralKeySet: !!s.mistralKey,
    workspace: s.workspace,
    defaultCollection: s.defaultCollection,
    maxParallel: s.maxParallel,
  };
}
