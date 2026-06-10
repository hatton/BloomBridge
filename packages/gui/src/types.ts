/* Domain model for the Conversion Manager.
   Mirrors the mock data shape; the server will later return these same shapes. */

export type Stage = "ocr" | "llm" | "plan" | "html" | "bloom";

/** Raw lifecycle status stored on a run. */
export type RunStatus = "notrun" | "queued" | "running" | "failed" | "done";

/** Quality rating a user applies to a completed run. */
export type Mark = "good" | "bad" | "neutral";

/** A user's review verdict on one extracted-metadata item (absent = unreviewed). */
export type ChecklistMark = "up" | "down";

/** One extracted-metadata item shown in the review checklist. */
export interface MetadataItem {
  key: string;
  label: string;
  /** The value we extracted; "" when nothing was detected. */
  value: string;
}

/**
 * Effective status — the unified value shown in the UI. Rating folds into status
 * once a run is completed: done+good = keeper, done+bad = disapproved. An unrated
 * completed run is "completed" ("Awaiting Review") until every Conversion Review
 * Checklist item has been worked through, at which point it becomes "reviewed".
 */
export type EffStatus =
  | "notrun"
  | "queued"
  | "running"
  | "failed"
  | "completed"
  | "reviewed"
  | "keeper"
  | "disapproved";

export interface Params {
  ocrMethod: string; // --ocr   (gpt | mistral | unpdf)
  model: string; // --model (OpenRouter model for LLM enrichment)
  visionFormatting: boolean; // --vision-formatting / --no-vision-formatting
  visionModel: string; // --vision-model
  coverMode: string; // --cover (auto | render | none)
  complexBecomesImage: string; // --complex-becomes-image (covers | busy | anyCanvas | all)
  trimWhitespace: boolean; // --trim-whitespace (crop white margins off illustrations)
  target: string; // --target (images | ocr | tagged | bloom)
}

export interface StageBreakdown {
  stage: string;
  label?: string;
  dur: number;
  tin: number;
  tout: number;
  cost: number;
}

export interface RunError {
  stage?: Stage;
  code: string;
  message: string;
}

export interface RunProgress {
  stage: Stage;
  page: number;
  pages: number;
}

export interface Run {
  id: string;
  status: RunStatus;
  mark: Mark;
  /** Pinned runs survive when a new conversion of the same PDF disposes prior runs. */
  pinned?: boolean;
  stages: Record<Stage, boolean>;
  model: string;
  ocrMethod?: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  time: number;
  ts: string;
  /** Epoch ms when the run started executing / finished (for elapsed display). */
  startedAt?: number;
  finishedAt?: number;
  notes: string;
  /** Per-item metadata-review marks (item key → "up"/"down"); absent = unreviewed. */
  checklist?: Record<string, ChecklistMark>;
  tags: string[];
  params: Params;
  preset?: string;
  breakdown: StageBreakdown[];
  progress?: RunProgress;
  error?: RunError;
  /** When failed: the last stage that succeeded, if any (for resume). */
  resumeStage?: Stage;
}

export interface Source {
  id: string;
  name: string;
  file: string;
  pages?: number;
  size: string;
  lang?: string;
  added?: string;
  /** absolute path to the source PDF (from the server) */
  path?: string;
  relPath?: string;
  hue: number;
  runs: Run[];
}

export interface RecentFolder {
  path: string;
  count: number;
  active?: boolean;
}

export interface ModelInfo {
  label: string;
  inCost: number;
  outCost: number;
}

export interface ArtifactNode {
  type: "dir" | "file";
  name: string;
  open?: boolean;
  size?: string;
  kind?: "text" | "image" | "code";
  body?: string;
  hue?: number;
  children?: ArtifactNode[];
}

export interface Settings {
  openrouterKey: string;
  mistralKey: string;
  workspace: string;
  collection: string;
  preset: string;
  parallelism: number;
}

/** Focus target for the right detail pane. */
export type Focus =
  | { type: "pdf"; sourceId: string }
  | { type: "run"; sourceId: string; runId: string }
  | null;
