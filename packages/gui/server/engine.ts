/* In-process run engine + workspace store. Drives the lib conversion pipeline,
   keeps run state in memory, persists run.json per run, and broadcasts live
   events to SSE subscribers. Server-side only. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  planConversion,
  runConversion,
  withRunContext,
  Artifact,
  scanPdfFolder,
  detectArtifacts,
  startableStages,
  getRunningBloomCollection,
  type ConversionEvent,
  type RunArgs,
} from "@pdf-to-bloom/lib";
import { getSettings } from "./settings";

export type RunStatus = "queued" | "running" | "failed" | "done" | "cancelled";
export type Rating = "none" | "keeper" | "disapproved";

export interface StageMetric {
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
}

export interface RunRecord {
  id: string;
  sourceId: string;
  sourcePath: string;
  bookName: string;
  status: RunStatus;
  rating: Rating;
  params: Record<string, any>;
  collection?: string;
  target: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  stages: Record<string, StageMetric>;
  progress?: { stage: string; page: number; pageCount: number };
  notes: string;
  runDir: string;
  bookFolderPath?: string;
}

const STAGES = ["ocr", "llm", "plan", "html"] as const;
const TARGET_MAP: Record<string, Artifact> = {
  images: Artifact.Images,
  ocr: Artifact.MarkdownFromOCR,
  tagged: Artifact.MarkdownReadyForBloom,
  bloom: Artifact.HTML,
};

function sourceIdFor(absPath: string): string {
  return "s" + crypto.createHash("sha1").update(absPath).digest("hex").slice(0, 10);
}
function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "book";
}

// ---- in-memory state ----
const runs = new Map<string, RunRecord>();
const cancelFlags = new Set<string>();
const queue: string[] = [];
let running = 0;
let loaded = false;

type Client = (event: string, data: unknown) => void;
const clients = new Set<Client>();

export function addClient(c: Client): () => void {
  clients.add(c);
  return () => clients.delete(c);
}
function broadcast(event: string, data: unknown) {
  for (const c of clients) {
    try {
      c(event, data);
    } catch {
      /* ignore a dead client */
    }
  }
}
/** Push a run's current state (with its sourceId so the client can place it). */
function pushRun(rec: RunRecord) {
  broadcast("run-update", { sourceId: rec.sourceId, run: toGuiRun(rec) });
}

// ---- workspace load ----
async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  const { workspace } = await getSettings();
  await fs.mkdir(workspace, { recursive: true }).catch(() => {});
  let sourceDirs: string[] = [];
  try {
    const entries = await fs.readdir(workspace, { withFileTypes: true });
    sourceDirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(workspace, e.name));
  } catch {
    return;
  }
  for (const sourceDir of sourceDirs) {
    let runDirs: string[] = [];
    try {
      const entries = await fs.readdir(sourceDir, { withFileTypes: true });
      runDirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(sourceDir, e.name));
    } catch {
      continue;
    }
    for (const runDir of runDirs) {
      try {
        const raw = await fs.readFile(path.join(runDir, "run.json"), "utf-8");
        const rec = JSON.parse(raw) as RunRecord;
        // A run left queued/running when the server stopped is interrupted: mark it
        // failed (visible) and persist so it can't reappear as queued on next load.
        if (rec.status === "running" || rec.status === "queued") {
          rec.status = "failed";
          rec.error = rec.error || "Interrupted — the server stopped before this run finished.";
          rec.progress = undefined;
          runs.set(rec.id, rec);
          await writeRunJson(rec);
        } else {
          runs.set(rec.id, rec);
        }
      } catch {
        /* not a run dir */
      }
    }
  }
}

async function writeRunJson(rec: RunRecord) {
  try {
    await fs.mkdir(rec.runDir, { recursive: true });
    await fs.writeFile(path.join(rec.runDir, "run.json"), JSON.stringify(rec, null, 2));
  } catch {
    /* best effort */
  }
}

// ---- launching ----
export async function enqueueRuns(
  sources: { id: string; path: string; name: string }[],
  params: Record<string, any>,
  collection?: string,
): Promise<RunRecord[]> {
  await ensureLoaded();
  const { workspace } = await getSettings();
  const created: RunRecord[] = [];
  for (const src of sources) {
    const runId = "r" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const runDir = path.join(workspace, src.id + "-" + slug(src.name), runId);
    const rec: RunRecord = {
      id: runId,
      sourceId: src.id,
      sourcePath: src.path,
      bookName: src.name,
      status: "queued",
      rating: "none",
      params: { ...params },
      collection: collection || undefined,
      target: params.target || "bloom",
      createdAt: new Date().toISOString(),
      stages: {},
      notes: "",
      runDir,
    };
    runs.set(runId, rec);
    await writeRunJson(rec);
    queue.push(runId);
    created.push(rec);
    pushRun(rec);
  }
  pump();
  return created;
}

async function pump() {
  const { maxParallel } = await getSettings();
  while (running < Math.max(1, maxParallel) && queue.length > 0) {
    const runId = queue.shift()!;
    const rec = runs.get(runId);
    if (!rec || rec.status !== "queued") continue;
    if (cancelFlags.has(runId)) {
      cancelFlags.delete(runId);
      rec.status = "cancelled";
      await writeRunJson(rec);
      pushRun(rec);
      continue;
    }
    running++;
    void executeRun(rec).finally(() => {
      running--;
      void pump();
    });
  }
}

async function executeRun(rec: RunRecord) {
  rec.status = "running";
  rec.startedAt = new Date().toISOString();
  pushRun(rec);

  const settings = await getSettings();
  const onEvent = (e: ConversionEvent) => {
    if (e.stage) {
      // Keep OCR / vision / LLM separate so their costs show individually.
      const m = (rec.stages[e.stage] ||= {});
      if (e.kind === "stage-end" && typeof e.durationMs === "number") m.durationMs = e.durationMs;
      if (e.kind === "tokens") {
        m.tokensIn = (m.tokensIn || 0) + (e.tokensIn || 0);
        m.tokensOut = (m.tokensOut || 0) + (e.tokensOut || 0);
        if (typeof e.costUsd === "number") m.costUsd = (m.costUsd || 0) + e.costUsd;
      }
      if (e.kind === "stage-start") rec.progress = { stage: e.stage, page: 0, pageCount: 0 };
      if (e.kind === "progress") {
        rec.progress = { stage: e.stage, page: e.page || 0, pageCount: e.pageCount || 0 };
      }
    }
    // Push updated run state on meaningful events (skip log spam).
    if (e.kind !== "log") pushRun(rec);
  };

  // Resolve the "use the running Bloom's open collection" sentinel to that
  // collection's folder. Other values (a real path, or "recent" which the lib
  // resolves to the most-recently-opened collection) pass through unchanged.
  let resolvedCollection = rec.collection || settings.defaultCollection || undefined;
  if (resolvedCollection === "__running__") {
    const bloom = await getRunningBloomCollection();
    resolvedCollection = bloom?.collectionFolder || undefined;
  }

  const args: RunArgs = {
    input: rec.sourcePath,
    output: rec.runDir,
    collection: resolvedCollection,
    target: TARGET_MAP[rec.target] ?? Artifact.HTML,
    verbose: false,
    openrouterKey: settings.openrouterKey || undefined,
    mistralKey: settings.mistralKey || undefined,
    modelName: rec.params.model,
    ocrMethod: rec.params.ocrMethod || "gpt",
    cover: rec.params.coverMode,
    visionFormatting: rec.params.visionFormatting,
    visionModelName: rec.params.visionModel,
    complexBecomesImage: rec.params.complexBecomesImage,
  };

  try {
    const result = await withRunContext(rec.id, onEvent, async () => {
      const plan = await planConversion(args);
      return runConversion(plan, { runId: rec.id, isCancelled: () => cancelFlags.has(rec.id) });
    });
    rec.bookFolderPath = result.bookFolderPath;
    rec.status = result.status === "completed" ? "done" : result.status;
    if (result.error) rec.error = result.error;
  } catch (err) {
    rec.status = "failed";
    rec.error = err instanceof Error ? err.message : String(err);
  } finally {
    cancelFlags.delete(rec.id);
    rec.progress = undefined;
    rec.finishedAt = new Date().toISOString();
    await writeRunJson(rec);
    pushRun(rec);
  }
}

export async function cancelRun(runId: string) {
  await ensureLoaded();
  const rec = runs.get(runId);
  if (!rec) return;
  cancelFlags.add(runId);
  if (rec.status === "queued") {
    rec.status = "cancelled";
    await writeRunJson(rec);
    pushRun(rec);
  }
}

export async function setRating(runId: string, rating: Rating) {
  await ensureLoaded();
  const rec = runs.get(runId);
  if (!rec) return;
  // One keeper per book: demote any other keeper of the same source.
  if (rating === "keeper") {
    for (const other of runs.values()) {
      if (other.sourceId === rec.sourceId && other.id !== runId && other.rating === "keeper") {
        other.rating = "none";
        await writeRunJson(other);
        pushRun(other);
      }
    }
  }
  rec.rating = rating;
  await writeRunJson(rec);
  pushRun(rec);
}

export async function setNotes(runId: string, notes: string) {
  await ensureLoaded();
  const rec = runs.get(runId);
  if (!rec) return;
  rec.notes = notes;
  await writeRunJson(rec);
  pushRun(rec);
}

/** Remove failed runs and disapproved runs (and their folders). Returns the count. */
export async function cleanupRuns(): Promise<number> {
  await ensureLoaded();
  let removed = 0;
  for (const rec of [...runs.values()]) {
    if (rec.status === "failed" || rec.rating === "disapproved") {
      cancelFlags.add(rec.id);
      runs.delete(rec.id);
      await fs.rm(rec.runDir, { recursive: true, force: true }).catch(() => {});
      broadcast("run-deleted", { runId: rec.id, sourceId: rec.sourceId });
      removed++;
    }
  }
  return removed;
}

export async function deleteRun(runId: string) {
  await ensureLoaded();
  const rec = runs.get(runId);
  if (!rec) return;
  cancelFlags.add(runId);
  runs.delete(runId);
  await fs.rm(rec.runDir, { recursive: true, force: true }).catch(() => {});
  broadcast("run-deleted", { runId, sourceId: rec.sourceId });
}

// ---- queries ----
export interface GuiRun {
  id: string;
  status: string; // notrun|queued|running|failed|done
  mark: string; // good|bad|neutral
  stages: Record<string, boolean>;
  model: string;
  ocrMethod?: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  time: number;
  ts: string;
  notes: string;
  tags: string[];
  params: Record<string, any>;
  breakdown: {
    stage: string;
    label: string;
    dur: number;
    tin: number;
    tout: number;
    cost: number;
  }[];
  progress?: { stage: string; page: number; pages: number };
  error?: { stage: string; code: string; message: string; hint: string };
}

function toGuiRun(rec: RunRecord): GuiRun {
  const mark = rec.rating === "keeper" ? "good" : rec.rating === "disapproved" ? "bad" : "neutral";
  // stages done: derived from artifacts if the book folder exists, else from recorded metrics
  const done: Record<string, boolean> = { ocr: false, llm: false, plan: false, html: false };
  for (const s of STAGES) if (rec.stages[s]?.durationMs != null) done[s] = true;
  let tokensIn = 0,
    tokensOut = 0,
    time = 0,
    cost = 0;
  // Per-stage metrics in pipeline order, with Vision broken out from OCR.
  const METRIC_ROWS: { key: string; label: string }[] = [
    { key: "ocr", label: "OCR" },
    { key: "vision", label: "Vision" },
    { key: "llm", label: "Think (LLM)" },
    { key: "plan", label: "Plan" },
    { key: "html", label: "HTML" },
  ];
  const breakdown: {
    stage: string;
    label: string;
    dur: number;
    tin: number;
    tout: number;
    cost: number;
  }[] = [];
  for (const { key, label } of METRIC_ROWS) {
    const m = rec.stages[key];
    // Hide the Vision row when vision-formatting didn't run (no data).
    if (key === "vision" && (!m || (!m.tokensIn && !m.tokensOut && !m.costUsd))) continue;
    const mm = m || {};
    tokensIn += mm.tokensIn || 0;
    tokensOut += mm.tokensOut || 0;
    time += (mm.durationMs || 0) / 1000;
    cost += mm.costUsd || 0;
    breakdown.push({
      stage: key,
      label,
      dur: Math.round((mm.durationMs || 0) / 1000),
      tin: mm.tokensIn || 0,
      tout: mm.tokensOut || 0,
      cost: mm.costUsd || 0,
    });
  }
  const guiStatus = rec.status === "cancelled" ? "failed" : rec.status;
  return {
    id: rec.id,
    status: guiStatus,
    mark,
    stages: done,
    model: rec.params.model || "",
    ocrMethod: rec.params.ocrMethod,
    tokensIn,
    tokensOut,
    cost,
    time: Math.round(time),
    ts: rec.createdAt.replace("T", " ").slice(0, 16),
    notes: rec.notes,
    tags: [],
    params: rec.params,
    breakdown,
    progress: rec.progress
      ? { stage: rec.progress.stage, page: rec.progress.page, pages: rec.progress.pageCount }
      : undefined,
    error:
      rec.status === "failed" && rec.error
        ? {
            stage: rec.progress?.stage || "?",
            code: "ERROR",
            message: rec.error,
            hint: "Check the run's settings and API keys, then re-run.",
          }
        : undefined,
  };
}

/** Build the GUI book/run tree for a folder of PDFs, merged with workspace runs. */
export async function getFolderTree(folderPath: string) {
  await ensureLoaded();
  const pdfs = await scanPdfFolder(folderPath, { recursive: true });
  return pdfs.map((pdf) => {
    const id = sourceIdFor(pdf.path);
    const sourceRuns = [...runs.values()]
      .filter((r) => r.sourceId === id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toGuiRun);
    return {
      id,
      name: pdf.name,
      file: path.basename(pdf.path),
      path: pdf.path,
      relPath: pdf.relPath,
      size: humanSize(pdf.size),
      hue: hueFor(pdf.name),
      runs: sourceRuns,
    };
  });
}

export async function getRunArtifacts(runId: string) {
  await ensureLoaded();
  const rec = runs.get(runId);
  if (!rec || !rec.bookFolderPath)
    return { tree: [] as any[], bookFolder: undefined as string | undefined };
  const baseName = path.parse(rec.sourcePath).name;
  const a = await detectArtifacts(rec.bookFolderPath, baseName);
  // Tag each artifact with the pipeline stage that produced it (for grouping).
  const files: { name: string; path: string; kind: string; stage: string }[] = [];
  const push = (p: string | undefined, kind: string, stage: string) => {
    if (p) files.push({ name: path.basename(p), path: p, kind, stage });
  };
  push(a.ocrMd, "text", "ocr");
  for (const img of a.images)
    files.push({ name: path.basename(img), path: img, kind: "image", stage: "ocr" });
  push(a.rawLlmMd, "text", "llm");
  push(a.llmMd, "text", "llm");
  push(a.bloomMd, "text", "plan");
  push(a.htm, "code", "html");
  return { tree: files, startable: startableStages(a), bookFolder: rec.bookFolderPath };
}

/**
 * Open a path with the OS: "file" = default app for the type, "folder" = file
 * manager, "vscode" = VS Code. Uses a shell command string so paths with spaces
 * are quoted correctly. Callers must validate the path (we restrict to workspace).
 */
export async function osOpen(target: string, mode: "file" | "folder" | "vscode"): Promise<void> {
  const { spawn } = await import("node:child_process");
  const q = (s: string) => '"' + s.replace(/"/g, "") + '"';
  let cmd: string;
  if (mode === "vscode") {
    cmd = `code ${q(target)}`;
  } else if (process.platform === "win32") {
    cmd = mode === "folder" ? `explorer ${q(target)}` : `start "" ${q(target)}`;
  } else if (process.platform === "darwin") {
    cmd = `open ${q(target)}`;
  } else {
    cmd = `xdg-open ${q(target)}`;
  }
  spawn(cmd, { detached: true, stdio: "ignore", shell: true }).unref();
}

export async function readArtifactFile(runId: string, file: string): Promise<string | null> {
  await ensureLoaded();
  const rec = runs.get(runId);
  if (!rec || !rec.bookFolderPath) return null;
  const full = path.join(rec.bookFolderPath, path.basename(file));
  // keep reads inside the book folder
  if (!full.startsWith(path.resolve(rec.bookFolderPath))) return null;
  try {
    return await fs.readFile(full, "utf-8");
  } catch {
    return null;
  }
}

export async function getRunRecord(runId: string) {
  await ensureLoaded();
  return runs.get(runId);
}

function humanSize(bytes: number): string {
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + " KB";
  return bytes + " B";
}
function hueFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export { sourceIdFor };
