/**
 * The map from pipeline stages to (a) the source files whose CONTENT defines each
 * stage's behavior and (b) the conversion options that affect each stage. Together
 * these let us fingerprint "what produced this artifact" so a re-run can skip the
 * stages whose code and settings haven't changed.
 *
 * Code hashes are computed at BUILD time (see the `stage-fingerprints` plugin in
 * `packages/lib/vite.config.ts`) and emitted to `dist/stage-fingerprints.json`, so
 * the fingerprint always matches exactly the built code that will run. The runtime
 * reads that file via `loadStageFingerprints()`; it never re-hashes source.
 *
 * Correctness-first: a stage's file set is deliberately conservative. Re-running a
 * stage that didn't strictly need it only costs time; *missing* a real change would
 * produce stale output. If a shared file is proven to only affect later stages,
 * narrow its attribution here — this manifest is the single tuning knob.
 */
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { getModuleDir } from "../moduleDir";
import { optionsSchema, type OptionSpec } from "../options/optionsSchema";

/** The four resumable pipeline stages, in order. */
export type PipelineStage = "ocr" | "llm" | "plan" | "html";
export const PIPELINE_STAGES: PipelineStage[] = ["ocr", "llm", "plan", "html"];

/** Per-stage code fingerprints (content hashes), keyed by stage. */
export type StageFingerprints = Record<PipelineStage, string>;

/** Filename of the build-emitted fingerprint manifest (sits in the lib's dist dir). */
export const FINGERPRINTS_FILENAME = "stage-fingerprints.json";

/**
 * Source files shared (effectively) across stages: the core types and the Markdown
 * contract serializer/parser plus cross-cutting infra. A change here conservatively
 * invalidates every stage that lists it.
 */
const SHARED = ["types.ts", "logger.ts", "moduleDir.ts"];

/**
 * Source globs (relative to `packages/lib/src`) per stage. A trailing `/**` matches a
 * directory recursively; anything else is a literal file path. Test files and docs
 * are excluded by the collector (they don't affect runtime behavior).
 */
export const STAGE_SOURCE_GLOBS: Record<PipelineStage, string[]> = {
  // OCR emits Markdown (generateMarkdown) but reads no prior artifact's contract.
  ocr: ["1-ocr/**", "bloom-markdown/generateMarkdown.ts", ...SHARED],
  // LLM round-trips the full Markdown contract (parse + generate) and uses its prompt.
  llm: ["2-llm/**", "bloom-markdown/**", ...SHARED],
  plan: ["3-add-bloom-plan/**", "bloom-markdown/**", ...SHARED],
  // HTML parses the Markdown and applies master pages.
  html: [
    "4-generate-html/**",
    "master/**",
    "bloom-markdown/parseMarkdown.ts",
    "bloom-markdown/pageLayoutHints.ts",
    ...SHARED,
  ],
};

/**
 * `optionsSchema` tags each option with a finer-grained `stage` than the four
 * pipeline stages. Map an option's schema stage to the pipeline stage(s) whose
 * artifact it invalidates. `output`/`general` carry no mapping here — they're
 * handled by the explicit overrides below.
 */
function schemaStageToPipeline(stage: OptionSpec["stage"]): PipelineStage[] {
  switch (stage) {
    case "ocr":
      return ["ocr"];
    case "vision":
      return ["ocr"]; // vision-formatting runs inside Stage 1 (OCR)
    case "llm":
      return ["llm"];
    case "plan":
      return ["plan"];
    case "html":
      return ["html"];
    default:
      return [];
  }
}

/**
 * Options whose real impact spans stages (or is nil), overriding the schema's single
 * `stage` field. Keyed by option `key`.
 */
const OPTION_STAGE_OVERRIDES: Record<string, PipelineStage[]> = {
  prompt: ["ocr", "llm"], // used as the GPT-OCR prompt and/or the enrichment prompt
  emitSourceHashes: ["ocr", "html"], // tags pages in Stage 1, skips substitution in Stage 4
  verbose: [], // logging only — no effect on output
  target: [], // bounds the stop stage, not staleness
};

/** The option keys (from `optionsSchema`) whose values affect a given stage. */
export function optionKeysAffectingStage(stage: PipelineStage): string[] {
  return optionsSchema
    .filter((o) =>
      (OPTION_STAGE_OVERRIDES[o.key] ?? schemaStageToPipeline(o.stage)).includes(stage),
    )
    .map((o) => o.key);
}

// ---- code fingerprinting (build-time + tests) ----

const CODE_EXT = new Set([".ts", ".txt"]);
function isHashableFile(rel: string): boolean {
  if (!CODE_EXT.has(path.extname(rel))) return false;
  if (rel.endsWith(".d.ts")) return false;
  if (/\.(test|manual\.test|spec)\./.test(path.basename(rel))) return false;
  return true;
}

/** Expand one stage's globs to a sorted, de-duped list of existing relative paths. */
function collectStageFiles(srcRoot: string, globs: string[]): string[] {
  const found = new Set<string>();
  const addFile = (rel: string) => {
    if (isHashableFile(rel)) found.add(rel.split(path.sep).join("/"));
  };
  const walk = (relDir: string) => {
    const abs = path.join(srcRoot, relDir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = path.join(relDir, e.name);
      if (e.isDirectory()) walk(rel);
      else addFile(rel);
    }
  };
  for (const g of globs) {
    if (g.endsWith("/**")) walk(g.slice(0, -3));
    else {
      const norm = g.split("/").join(path.sep);
      if (fs.existsSync(path.join(srcRoot, norm))) addFile(norm);
    }
  }
  return [...found].sort();
}

function hashFileList(srcRoot: string, relPaths: string[]): string {
  const h = crypto.createHash("sha256");
  for (const rel of relPaths) {
    const content = fs.readFileSync(path.join(srcRoot, rel.split("/").join(path.sep)));
    h.update(rel);
    h.update("\0");
    h.update(crypto.createHash("sha256").update(content).digest("hex"));
    h.update("\n");
  }
  return h.digest("hex");
}

/**
 * Compute per-stage code fingerprints from a `src` root. Called at build time by the
 * Vite plugin and by tests; never on the runtime hot path.
 */
export function computeStageFingerprints(srcRoot: string): StageFingerprints {
  const out = {} as StageFingerprints;
  for (const stage of PIPELINE_STAGES) {
    out[stage] = hashFileList(srcRoot, collectStageFiles(srcRoot, STAGE_SOURCE_GLOBS[stage]));
  }
  return out;
}

/**
 * Load the build-emitted fingerprint manifest from the running bundle's directory.
 * Returns `{}` if absent (e.g. running from source in tests) — callers treat a
 * missing/empty code hash as "differs", which fails safe toward re-running.
 */
export async function loadStageFingerprints(): Promise<Partial<StageFingerprints>> {
  try {
    const file = path.join(getModuleDir(), FINGERPRINTS_FILENAME);
    return JSON.parse(await fsp.readFile(file, "utf-8")) as Partial<StageFingerprints>;
  } catch {
    return {};
  }
}
