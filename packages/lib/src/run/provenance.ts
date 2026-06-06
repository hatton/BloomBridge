/**
 * The per-book provenance sidecar (`<bookName>.pipeline.json`) records, for each
 * stage that produced an artifact, the fingerprints of *what produced it*: the
 * stage's code hash, a hash of the settings that affect it, and a hash of the input
 * artifact it consumed. `resolveStartStage` compares these against the current code
 * + settings to decide which stages are stale.
 *
 * Writing is best-effort — a failure here never fails a conversion. A `formatVersion`
 * mismatch causes the whole record to be treated as absent (→ everything re-runs),
 * which is the safe direction.
 */
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import type { PipelineStage } from "./stageManifest";

export const PROVENANCE_FORMAT_VERSION = 1;

export interface StageProvenance {
  /** Build-time content hash of the stage's source (from stage-fingerprints.json). */
  codeHash: string;
  /** Hash of the settings subset that affects this stage. */
  optionsHash: string;
  /** Content hash of the artifact this stage consumed when it ran. */
  inputHash: string;
  /** The settings subset itself, kept for human-readable "what changed" messages. */
  options: Record<string, unknown>;
  producedAt: string;
}

export interface Provenance {
  formatVersion: number;
  stages: Partial<Record<PipelineStage, StageProvenance>>;
}

export function provenancePath(folder: string, baseName: string): string {
  return path.join(folder, `${baseName}.pipeline.json`);
}

/** Read the sidecar; returns null if missing, unparsable, or a stale format version. */
export async function readProvenance(folder: string, baseName: string): Promise<Provenance | null> {
  try {
    const raw = await fs.readFile(provenancePath(folder, baseName), "utf-8");
    const p = JSON.parse(raw) as Provenance;
    if (p.formatVersion !== PROVENANCE_FORMAT_VERSION) return null;
    return p;
  } catch {
    return null;
  }
}

/** Merge one stage's provenance into the sidecar (creating it if needed). */
export async function writeStageProvenance(
  folder: string,
  baseName: string,
  stage: PipelineStage,
  entry: StageProvenance,
): Promise<void> {
  try {
    const existing = (await readProvenance(folder, baseName)) ?? {
      formatVersion: PROVENANCE_FORMAT_VERSION,
      stages: {},
    };
    existing.stages[stage] = entry;
    await fs.writeFile(provenancePath(folder, baseName), JSON.stringify(existing, null, 2));
  } catch {
    /* best effort — never fail a conversion over provenance bookkeeping */
  }
}

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/** Hash a file's contents; returns "" if the path is missing/unreadable. */
export async function hashFileContents(p?: string): Promise<string> {
  if (!p) return "";
  try {
    return crypto
      .createHash("sha256")
      .update(await fs.readFile(p))
      .digest("hex");
  } catch {
    return "";
  }
}

/** Stable hash of a settings subset (key order independent). */
export function hashOptionsSubset(subset: Record<string, unknown>): string {
  const norm = Object.keys(subset)
    .sort()
    .map((k) => `${k}=${JSON.stringify(subset[k] ?? null)}`)
    .join("\n");
  return sha256(norm);
}
