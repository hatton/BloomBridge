/**
 * Detect which pipeline artifacts already exist in a book/run folder, and from
 * which stages a (re-)run could therefore start. Used by the server to show
 * per-run stage badges and to constrain the GUI's "resume from stage" stepper.
 *
 * The artifact order mirrors the CLI's `Artifact` enum
 * (`packages/cli/src/process.ts`): PDF → Images → .ocr.md → .raw-llm.md →
 * .llm.md → .bloom.md → .htm
 */
import * as fs from "fs/promises";
import * as path from "path";

export interface ArtifactSet {
  pdf?: string;
  ocrMd?: string;
  rawLlmMd?: string;
  llmMd?: string;
  bloomMd?: string;
  htm?: string;
  images: string[];
}

/** GUI resume-stepper stages, in pipeline order. */
export type ResumeStage = "ocr" | "llm" | "plan" | "html";

const IMAGE_RE = /^(image-.*\.(png|jpg|jpeg)|cover\.jpg|back-cover\.jpg)$/i;

/**
 * Scan `folder` for the artifacts belonging to `baseName` (the input file's base
 * name, e.g. "clever-tortoise"). Returns absolute paths for those that exist.
 */
export async function detectArtifacts(folder: string, baseName: string): Promise<ArtifactSet> {
  const result: ArtifactSet = { images: [] };
  let entries: string[] = [];
  try {
    entries = await fs.readdir(folder);
  } catch {
    return result;
  }
  const has = (name: string) => entries.includes(name);
  const abs = (name: string) => path.join(folder, name);

  if (has(`${baseName}.pdf`)) result.pdf = abs(`${baseName}.pdf`);
  if (has(`${baseName}.ocr.md`)) result.ocrMd = abs(`${baseName}.ocr.md`);
  if (has(`${baseName}.raw-llm.md`)) result.rawLlmMd = abs(`${baseName}.raw-llm.md`);
  if (has(`${baseName}.llm.md`)) result.llmMd = abs(`${baseName}.llm.md`);
  if (has(`${baseName}.bloom.md`)) result.bloomMd = abs(`${baseName}.bloom.md`);
  if (has(`${baseName}.htm`)) result.htm = abs(`${baseName}.htm`);
  result.images = entries.filter((e) => IMAGE_RE.test(e)).map(abs);

  return result;
}

/**
 * Which stages a run can START from given the artifacts present. A stage is
 * startable when the artifact feeding it exists:
 *   - ocr   ← the PDF
 *   - llm   ← .ocr.md (OCR output)
 *   - plan  ← .llm.md (enriched output)
 *   - html  ← .bloom.md (bloom plan)
 */
export function startableStages(a: ArtifactSet): ResumeStage[] {
  const stages: ResumeStage[] = [];
  if (a.pdf) stages.push("ocr");
  if (a.ocrMd) stages.push("llm");
  if (a.llmMd) stages.push("plan");
  if (a.bloomMd) stages.push("html");
  return stages;
}
