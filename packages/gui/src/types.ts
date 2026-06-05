/* Domain model for the Conversion Manager.
   Mirrors the mock data shape; the server will later return these same shapes. */

export type Stage = "ocr" | "llm" | "plan" | "html";

/** Raw lifecycle status stored on a run. */
export type RunStatus = "notrun" | "queued" | "running" | "failed" | "done";

/** Quality rating a user applies to a completed run. */
export type Mark = "good" | "bad" | "neutral";

/**
 * Effective status — the unified 7-state value shown in the UI. Rating folds
 * into status once a run is completed: done+good = keeper, done+bad = disapproved,
 * done+neutral = completed ("Awaiting Review").
 */
export type EffStatus =
  | "notrun"
  | "queued"
  | "running"
  | "failed"
  | "completed"
  | "keeper"
  | "disapproved";

export interface Params {
  ocrMethod: string; // --ocr   (gpt | mistral | unpdf)
  model: string; // --model (OpenRouter model for LLM enrichment)
  visionFormatting: boolean; // --vision-formatting / --no-vision-formatting
  visionModel: string; // --vision-model
  coverMode: string; // --cover (auto | render | none)
  complexBecomesImage: string; // --complex-becomes-image (off | 0..5 | always)
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
