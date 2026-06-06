/**
 * Decide the earliest stage a (re-)run must start from, given the artifacts on disk,
 * their recorded provenance, the current built code, and the requested settings.
 *
 * A stage is stale when its code hash, settings hash, or consumed-input hash differs
 * from what's recorded — or when its artifact is missing, or an upstream stage will
 * re-run (cascade). The earliest stale stage at or after the `floor` (the earliest
 * stage runnable given the input) is the start stage; if nothing is stale the run is
 * already up to date.
 *
 * The logic is pure apart from reading files, so it's unit-testable by injecting
 * `codeFingerprints` and pointing `folder` at a fixture.
 */
import { detectArtifacts, startableStages, type ArtifactSet } from "../artifacts";
import {
  PIPELINE_STAGES,
  optionKeysAffectingStage,
  type PipelineStage,
  type StageFingerprints,
} from "./stageManifest";
import { readProvenance, hashFileContents, hashOptionsSubset } from "./provenance";

export type StageStatus =
  | "fresh" // up to date — will be skipped
  | "stale" // code/settings/input changed — will re-run
  | "missing" // no artifact on disk — will run
  | "upstream" // an earlier stage will re-run, so this one must too
  | "unavailable"; // can't run (no input) and no cached output to keep

export interface StagePlanEntry {
  stage: PipelineStage;
  status: StageStatus;
  willRun: boolean;
  reasons: string[];
}

export interface ResolvedStartPlan {
  /** Earliest stage to run, or null when everything is already up to date. */
  startStage: PipelineStage | null;
  /** Earliest stage runnable given the input artifact. */
  floor: PipelineStage;
  perStage: StagePlanEntry[];
  upToDate: boolean;
}

export interface ResolveStartStageArgs {
  folder: string;
  baseName: string;
  /** Settings keyed by `optionsSchema` key (see `runOptionsRecord`). */
  options: Record<string, unknown>;
  /** Current built code hashes (from `loadStageFingerprints()`). */
  codeFingerprints: Partial<StageFingerprints>;
  /** Earliest stage runnable given the input; defaults to the earliest startable. */
  floor?: PipelineStage;
}

/** The artifact a stage reads as input. */
function consumedArtifact(stage: PipelineStage, a: ArtifactSet): string | undefined {
  switch (stage) {
    case "ocr":
      return a.pdf;
    case "llm":
      return a.ocrMd;
    case "plan":
      return a.llmMd;
    case "html":
      return a.bloomMd;
  }
}

/** The artifact a stage writes as output. */
function producedArtifact(stage: PipelineStage, a: ArtifactSet): string | undefined {
  switch (stage) {
    case "ocr":
      return a.ocrMd;
    case "llm":
      return a.llmMd;
    case "plan":
      return a.bloomMd;
    case "html":
      return a.htm;
  }
}

function fmt(v: unknown): string {
  if (v === "" || v === undefined || v === null) return "(default)";
  return String(v);
}

/** Human-readable "settings changed" message naming the differing keys. */
function settingsDiff(
  oldOpts: Record<string, unknown> = {},
  cur: Record<string, unknown> = {},
): string {
  const keys = new Set([...Object.keys(oldOpts), ...Object.keys(cur)]);
  const parts: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(oldOpts[k] ?? null) !== JSON.stringify(cur[k] ?? null)) {
      parts.push(`${k}: ${fmt(oldOpts[k])} → ${fmt(cur[k])}`);
    }
  }
  return parts.length ? `settings changed (${parts.join(", ")})` : "settings changed";
}

export async function resolveStartStage(args: ResolveStartStageArgs): Promise<ResolvedStartPlan> {
  const a = await detectArtifacts(args.folder, args.baseName);
  const prov = await readProvenance(args.folder, args.baseName);
  const startable = new Set<PipelineStage>(startableStages(a) as PipelineStage[]);
  const floor: PipelineStage = args.floor ?? PIPELINE_STAGES.find((s) => startable.has(s)) ?? "ocr";
  const floorIdx = PIPELINE_STAGES.indexOf(floor);

  let upstreamWillRun = false;
  let startStage: PipelineStage | null = null;
  const perStage: StagePlanEntry[] = [];

  for (let i = 0; i < PIPELINE_STAGES.length; i++) {
    const stage = PIPELINE_STAGES[i];
    const reasons: string[] = [];

    // Below the floor: not runnable with the given input. Keep cached output if any.
    if (i < floorIdx) {
      const have = !!producedArtifact(stage, a);
      perStage.push({
        stage,
        status: have ? "fresh" : "unavailable",
        willRun: false,
        reasons: have ? ["using cached output (input not provided to re-run)"] : [],
      });
      continue;
    }

    const record = prov?.stages?.[stage];
    const codeHash = args.codeFingerprints[stage] ?? "";
    const keys = optionKeysAffectingStage(stage);
    const subset: Record<string, unknown> = {};
    for (const k of keys) subset[k] = args.options[k];
    const optionsHash = hashOptionsSubset(subset);
    const inputHash = await hashFileContents(consumedArtifact(stage, a));

    let status: StageStatus;
    let willRun = false;

    if (upstreamWillRun) {
      status = "upstream";
      willRun = true;
      reasons.push("an earlier stage will re-run");
    } else if (!producedArtifact(stage, a)) {
      status = "missing";
      willRun = true;
      reasons.push("output not present");
    } else if (!record) {
      status = "stale";
      willRun = true;
      reasons.push("no provenance recorded for this artifact");
    } else {
      if (record.codeHash !== codeHash) reasons.push("stage code changed");
      if (record.optionsHash !== optionsHash) reasons.push(settingsDiff(record.options, subset));
      if (record.inputHash !== inputHash) reasons.push("input changed since this was produced");
      status = reasons.length ? "stale" : "fresh";
      willRun = reasons.length > 0;
    }

    // Safety net: stale but nothing can feed it (no input, no upstream rebuild).
    if (willRun && !upstreamWillRun && !startable.has(stage)) {
      status = "unavailable";
      willRun = false;
      reasons.push("cannot re-run: required input is missing");
    }

    if (willRun && startStage === null) startStage = stage;
    if (willRun) upstreamWillRun = true;
    perStage.push({ stage, status, willRun, reasons });
  }

  return { startStage, floor, perStage, upToDate: startStage === null };
}
