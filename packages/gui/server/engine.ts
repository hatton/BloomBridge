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
  findBloomCollectionForLanguage,
  bringBloomToFront,
  processBookInBloom,
  revertOverflowingAutoSplits,
  addBookToBloom,
  notifyBloomOfBook,
  selectBookInBloom,
  setBookInstanceId,
  Parser,
  findMasterBookFolder,
  loadMasterPages,
  loadMasterPagesById,
  applyMasterPages,
  appendMasterMapping,
  clearMasterMapping,
  readMasterPageMap,
  type ConversionEvent,
  type RunArgs,
} from "@bloombridge/lib";
import { getSettings } from "./settings";
import { getBloomMsPerPage, recordBloomTiming } from "./bloomTiming";

export type RunStatus = "queued" | "running" | "failed" | "done" | "cancelled";
export type Rating = "none" | "keeper" | "disapproved";
/** A user's review verdict on one extracted-metadata item ("up"/"down"; absent = unreviewed). */
export type ChecklistMark = "up" | "down";

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
  /** Pinned runs survive when a new conversion of the same PDF disposes prior runs.
   *  Approving a run (rating "keeper") auto-pins it. */
  pinned?: boolean;
  params: Record<string, any>;
  collection?: string;
  target: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  /** The pipeline stage that was running when the run failed (for the UI banner). */
  failedStage?: string;
  stages: Record<string, StageMetric>;
  progress?: {
    stage: string;
    page: number;
    pageCount: number;
    /** Estimated duration (ms) of the current stage, when we can predict it (Bloom step). */
    etaMs?: number;
    /** Epoch ms when the current stage actually began (Bloom step) — drives the linear bar. */
    startedMs?: number;
  };
  notes: string;
  /** User review of the extracted metadata: item key → thumbs up/down. Absent keys
   *  are unreviewed. The set of items is fixed (CHECKLIST_ITEMS), so this only
   *  stores the marks given. */
  checklist?: Record<string, ChecklistMark>;
  runDir: string;
  bookFolderPath?: string;
  /** When set, the conversion reads from this artifact instead of `sourcePath`
   *  (used to resume a failed run from its last successful stage). */
  inputOverride?: string;
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

// OCR→HTML run in parallel across books, but Bloom can only process one book at a
// time. This promise-chain mutex serializes the final Bloom stage across all runs:
// each call waits for the prior holder to release before running.
let bloomLock: Promise<void> = Promise.resolve();
function withBloomLock<T>(fn: () => Promise<T>): Promise<T> {
  const prior = bloomLock;
  let release!: () => void;
  bloomLock = new Promise<void>((r) => (release = r));
  return prior.then(fn).finally(() => release());
}

// Live human-readable log lines per run (capped). Kept out of run.json to avoid
// bloating it; persisted to <runDir>/run.log when a run finishes.
const runLogs = new Map<string, string[]>();
const LOG_CAP = 4000;
const LOG_STAGE_LABEL: Record<string, string> = {
  ocr: "OCR",
  vision: "Vision",
  llm: "Think (LLM)",
  plan: "Plan",
  html: "HTML",
  bloom: "Bloom",
};

function eventToLogLine(e: ConversionEvent): string | null {
  const t = new Date().toTimeString().slice(0, 8);
  const stage = e.stage ? LOG_STAGE_LABEL[e.stage] || e.stage : "";
  switch (e.kind) {
    case "stage-start":
      return `[${t}] ▶ ${stage} — started`;
    case "stage-end":
      return `[${t}] ✓ ${stage} — done${
        typeof e.durationMs === "number" ? ` (${Math.round(e.durationMs / 1000)}s)` : ""
      }`;
    case "progress":
      return e.pageCount ? `[${t}]    ${stage}: page ${e.page}/${e.pageCount}` : null;
    case "tokens":
      return `[${t}]    ${stage}: ${e.tokensIn || 0} tok in / ${e.tokensOut || 0} out${
        typeof e.costUsd === "number" ? ` · $${e.costUsd.toFixed(4)}` : ""
      }`;
    case "error":
      return `[${t}] ✗ ERROR: ${e.message || ""}`;
    case "done":
      return `[${t}] ✓ Conversion complete`;
    case "log":
      return `[${t}] ${e.level && e.level !== "info" ? `[${e.level}] ` : ""}${e.message || ""}`;
    default:
      return null;
  }
}

function appendLog(runId: string, line: string) {
  const buf = runLogs.get(runId) || [];
  buf.push(line);
  if (buf.length > LOG_CAP) buf.splice(0, buf.length - LOG_CAP);
  runLogs.set(runId, buf);
  broadcast("run-log", { runId, line });
}

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
    // Starting a new conversion clears the slate: dispose prior unpinned runs for
    // this PDF (but never an in-flight run — only ones that have settled).
    for (const old of [...runs.values()]) {
      if (
        old.sourceId === src.id &&
        !old.pinned &&
        old.status !== "running" &&
        old.status !== "queued"
      ) {
        cancelFlags.add(old.id);
        runs.delete(old.id);
        await fs.rm(old.runDir, { recursive: true, force: true }).catch(() => {});
        broadcast("run-deleted", { runId: old.id, sourceId: old.sourceId });
      }
    }
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

async function copyDir(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

/** Error carrying an HTTP status so the /process endpoint can map failures back to
 *  the same response codes it used when the logic was inline. */
class BloomProcessError extends Error {
  httpStatus: number;
  constructor(message: string, httpStatus = 500) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

/**
 * Read the book's primary language tag (L1) from its generated .htm — the
 * `contentLanguage1` entry the HTML generator always writes into the bloomDataDiv.
 * Used to find a Bloom collection whose own L1 matches before we process/add the
 * book. Returns undefined when the .htm is missing or has no such tag.
 */
async function readBookL1(bookFolderPath: string): Promise<string | undefined> {
  let htmName: string | undefined;
  try {
    htmName = (await fs.readdir(bookFolderPath)).find((f) => /\.html?$/i.test(f));
  } catch {
    return undefined;
  }
  if (!htmName) return undefined;
  let html = "";
  try {
    html = await fs.readFile(path.join(bookFolderPath, htmName), "utf-8");
  } catch {
    return undefined;
  }
  const m = html.match(/data-book="contentLanguage1"[^>]*>\s*([^<\s]+)/);
  return m ? m[1].trim() : undefined;
}

/**
 * Find a running Bloom whose open collection's primary language (L1) matches this
 * book's L1, so process-book / add-book land in a compatible collection. There may
 * be several Blooms running; we scan them all (a Bloom too old to report its
 * collection languages is skipped, since we can't confirm it's compatible). Throws
 * BloomProcessError naming the language when none match, so the user can open the
 * right collection and retry.
 */
async function findCompatibleBloomForRun(
  rec: RunRecord,
): Promise<{ port: number; collectionName?: string; collectionFolder: string }> {
  const l1 = (await readBookL1(rec.bookFolderPath!)) || "";
  const match = l1 ? await findBloomCollectionForLanguage(l1) : null;
  if (!match) {
    const lang = l1 ? `"${l1}"` : "this book's";
    throw new BloomProcessError(
      `Couldn't find a running Bloom with a collection for the ${lang} language. ` +
        `Open a Bloom collection whose primary language is ${lang} (with its Collection tab showing), then try again.`,
      400,
    );
  }
  return {
    port: match.port,
    collectionName: match.collectionName,
    collectionFolder: match.collectionFolder,
  };
}

/** Read selected fields from a book folder's meta.json (empty object if unreadable). */
async function readBookMeta(
  bookFolder: string,
): Promise<{ title?: string; bookInstanceId?: string; pageCount?: number }> {
  try {
    return JSON.parse(await fs.readFile(path.join(bookFolder, "meta.json"), "utf-8")) as {
      title?: string;
      bookInstanceId?: string;
      pageCount?: number;
    };
  } catch {
    return {};
  }
}

/** A "Check - …"/"preview - …" throwaway copy we made — never the canonical book to replace. */
function isThrowawayCopy(folderName: string): boolean {
  const n = folderName.toLowerCase();
  return n.startsWith("check - ") || n.startsWith("preview - ");
}

/**
 * Find a book already in `collectionFolder` that is the same book as this run's —
 * i.e. the copy whose Bloom id we'd want to keep when replacing. Bloom renames a
 * book folder to its title and appends "-<id>"/" - <id>" when another book of that
 * title exists, so we can't rely on an exact folder-name match: we match on the
 * book's title (from meta.json) and, as a fallback, a folder name that equals or
 * begins with this run's book name. Throwaway "Check - …" copies we made are
 * skipped. Returns the existing book's folder + bookInstanceId, or null.
 */
async function findExistingBookInCollection(
  collectionFolder: string,
  rec: RunRecord,
): Promise<{ folder: string; id?: string } | null> {
  const runTitle = rec.bookFolderPath ? (await readBookMeta(rec.bookFolderPath)).title : undefined;
  const runTitleKey = runTitle?.toLowerCase();
  // Bloom names the folder after the book title (the run name is a fallback), so
  // match an existing folder that equals — or begins with, before Bloom's
  // "-<id>"/" - <id>" collision suffix — either of those bases.
  const bases = [rec.bookName, runTitle].filter((b): b is string => !!b);
  const nameMatches = (folderName: string) =>
    bases.some((base) => {
      if (folderName === base) return true;
      return folderName.startsWith(base) && /^[\s\-(]/.test(folderName.slice(base.length));
    });
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(collectionFolder, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory() || isThrowawayCopy(e.name)) continue;
    const folder = path.join(collectionFolder, e.name);
    const meta = await readBookMeta(folder);
    const titleMatch = !!runTitleKey && meta.title?.toLowerCase() === runTitleKey;
    if (nameMatches(e.name) || titleMatch) return { folder, id: meta.bookInstanceId };
  }
  return null;
}

/**
 * The "Process in Bloom" step, shared by the automatic final pipeline stage and the
 * manual /process endpoint. Before processing we confirm a running Bloom has a
 * collection whose L1 matches the book's L1 (see findCompatibleBloomForRun); if none
 * does we throw rather than process against an incompatible collection. Then we ask
 * that Bloom to process the run's book folder in place: Bloom applies its CSS +
 * browser-only fix-ups and writes the fixed .htm back into that same workspace
 * folder. No collection involvement — nothing is copied into Bloom's collection.
 * Throws BloomProcessError on any failure (no compatible Bloom, no book, processing
 * error).
 */
export async function processBookInBloomForRun(
  rec: RunRecord,
  opts: { onLog?: (line: string) => void } = {},
): Promise<{ processed?: number }> {
  const log = opts.onLog ?? (() => {});
  if (!rec.bookFolderPath)
    throw new BloomProcessError("This run hasn't produced a Bloom book yet.", 400);
  try {
    await fs.access(path.join(rec.bookFolderPath, "meta.json"));
  } catch {
    throw new BloomProcessError("This run has no Bloom book to process.", 400);
  }

  const bloom = await findCompatibleBloomForRun(rec);

  // Bring Bloom forward so the user can see its busy overlay while it processes.
  await bringBloomToFront(bloom.port);

  // When "fit image panes" is on, ask Bloom to auto-size the origami splitter on
  // illustration-plus-text pages while it processes them. Bloom has the real rendered
  // layout, so it fits the image to the text exactly (no estimation, no overflow). A
  // Bloom that predates this flag ignores it, in which case our Stage-4 guess stands and
  // the guard below is the safety net.
  const fitImageTextSplits = rec.params.fitImagePanes !== false;

  log("Bloom: processing book…");
  const result = await processBookInBloom(rec.bookFolderPath, bloom.port, { fitImageTextSplits });
  if (!result.ok)
    throw new BloomProcessError(result.error || "Bloom couldn't process the book.", 502);

  // Bloom may rename the folder to match the book title; if so, the returned path is
  // the new location. Track it so later artifact reads find the processed book.
  if (result.bookFolderPath && result.bookFolderPath !== rec.bookFolderPath) {
    rec.bookFolderPath = result.bookFolderPath;
  }

  // Fallback guard for a Bloom that didn't fit the splits itself (older Bloom, or the
  // setting off): if any page WE auto-split off 50/50 (data-auto-split) is still flagged
  // as overflowing in the saved .htm, revert just those pages to 50/50 and reprocess once
  // WITHOUT re-fitting (the 50% fallback is today's known-safe behavior). When Bloom did
  // fit the splits, those pages won't overflow, so this is a no-op.
  const htmPath =
    result.htmPath ?? path.join(rec.bookFolderPath, path.basename(rec.bookFolderPath) + ".htm");
  try {
    const reverted = await revertOverflowingAutoSplits(htmPath);
    if (reverted > 0) {
      log(`Fit image panes: reverted ${reverted} page(s) whose text overflowed.`);
      const reprocessed = await processBookInBloom(rec.bookFolderPath, bloom.port, {
        fitImageTextSplits: false,
      });
      if (reprocessed.bookFolderPath && reprocessed.bookFolderPath !== rec.bookFolderPath) {
        rec.bookFolderPath = reprocessed.bookFolderPath;
      }
    }
  } catch (err) {
    log(`Fit image panes guard skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  log("Bloom: done");
  return { processed: result.processed };
}

/**
 * The "Add finished product to Bloom Collection" action: copy this run's finished
 * book into a running Bloom's open collection (POST external/add-book) and select
 * it. Like process-book, this requires a running Bloom whose collection L1 matches
 * the book's L1 (findCompatibleBloomForRun). Bloom only accepts add-book while its
 * Collection tab is active, so this also fails (with Bloom's reason) when the user
 * is mid-edit. Throws BloomProcessError on any failure.
 */
export async function addFinishedBookToCollectionForRun(
  rec: RunRecord,
  mode?: "replace" | "new",
): Promise<{ id?: string; bookFolderPath?: string; needsChoice?: boolean; replaced?: boolean }> {
  if (!rec.bookFolderPath)
    throw new BloomProcessError("This run hasn't produced a Bloom book yet.", 400);
  try {
    await fs.access(path.join(rec.bookFolderPath, "meta.json"));
  } catch {
    throw new BloomProcessError("This run has no Bloom book to add.", 400);
  }

  const bloom = await findCompatibleBloomForRun(rec);
  await bringBloomToFront(bloom.port);

  // Is this book already in the collection (perhaps under a Bloom-renamed folder,
  // e.g. "<title>-<id>")? If so and the caller hasn't decided, ask whether to
  // replace that copy — keeping its bookInstanceId so a later Bloom Library upload
  // updates the same book — or add this conversion as a separate copy.
  const existing = await findExistingBookInCollection(bloom.collectionFolder, rec);
  if (existing && !mode) {
    return { needsChoice: true };
  }

  if (existing && mode === "replace") {
    // Overwrite the existing book in place (same folder, so Bloom sees the same
    // book) and reuse its bookInstanceId. Clear it first so stale files don't linger.
    const dest = existing.folder;
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
    await copyDir(rec.bookFolderPath, dest);
    await setBookInstanceId(dest, existing.id).catch(() => {});
    const notify = await notifyBloomOfBook(dest);
    if (notify.bookId) await selectBookInBloom(notify.bookId, bloom.port);
    return { id: existing.id, bookFolderPath: dest, replaced: true };
  }

  // No existing copy, or the user chose "add as a new copy": let Bloom copy it in
  // (it keeps this run's fresh bookInstanceId, so it's a distinct book) and select it.
  const result = await addBookToBloom(rec.bookFolderPath, bloom.port);
  if (!result.ok)
    throw new BloomProcessError(
      result.error || "Bloom couldn't add the book to its collection.",
      502,
    );
  return { id: result.id, bookFolderPath: result.bookFolderPath };
}

/**
 * Re-run a failed run starting from its last successful stage: find the furthest
 * intermediate artifact the failed run produced, copy that run's book folder
 * (intermediates + extracted images) into a fresh run folder, and start the
 * pipeline from that artifact. If nothing usable exists, this is a full re-run.
 */
export async function enqueueResume(runId: string): Promise<RunRecord> {
  await ensureLoaded();
  const orig = runs.get(runId);
  if (!orig) throw new Error("run not found");
  const { workspace } = await getSettings();
  const baseName = path.parse(orig.sourcePath).name;

  const newRunId = "r" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const runDir = path.join(workspace, orig.sourceId + "-" + slug(orig.bookName), newRunId);

  let inputOverride: string | undefined;
  if (orig.bookFolderPath) {
    const a = await detectArtifacts(orig.bookFolderPath, baseName);
    // Furthest produced intermediate, in pipeline order (latest wins).
    const furthest = a.bloomMd || a.llmMd || a.rawLlmMd || a.ocrMd;
    if (furthest) {
      const destBook = path.join(runDir, baseName);
      await copyDir(orig.bookFolderPath, destBook);
      inputOverride = path.join(destBook, path.basename(furthest));
    }
  }

  const rec: RunRecord = {
    id: newRunId,
    sourceId: orig.sourceId,
    sourcePath: orig.sourcePath,
    bookName: orig.bookName,
    status: "queued",
    rating: "none",
    params: { ...orig.params },
    collection: orig.collection,
    target: orig.target,
    createdAt: new Date().toISOString(),
    stages: {},
    notes: "",
    runDir,
    inputOverride,
  };
  runs.set(newRunId, rec);
  await writeRunJson(rec);
  queue.push(newRunId);
  pushRun(rec);
  pump();
  return rec;
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
  // Track the most recent stage that started, so a failure can name where it died.
  let lastStage: string | undefined;
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
      if (e.kind === "stage-start") {
        lastStage = e.stage;
        rec.progress = { stage: e.stage, page: 0, pageCount: 0 };
      }
      if (e.kind === "progress") {
        lastStage = e.stage;
        rec.progress = { stage: e.stage, page: e.page || 0, pageCount: e.pageCount || 0 };
      }
    }
    const line = eventToLogLine(e);
    if (line) appendLog(rec.id, line);
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
    input: rec.inputOverride || rec.sourcePath,
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
    trimWhitespace: rec.params.trimWhitespace,
    fitImagePanes: rec.params.fitImagePanes,
  };

  try {
    const result = await withRunContext(rec.id, onEvent, async () => {
      const plan = await planConversion(args);
      return runConversion(plan, { runId: rec.id, isCancelled: () => cancelFlags.has(rec.id) });
    });
    rec.bookFolderPath = result.bookFolderPath;
    rec.status = result.status === "completed" ? "done" : result.status;
    if (result.error) rec.error = result.error;
    if (result.status === "failed") rec.failedStage = lastStage;
    // A fresh conversion supersedes any prior master-splice baseline for this book.
    if (rec.bookFolderPath) {
      await fs
        .rm(path.join(rec.bookFolderPath, MASTER_BASELINE_NAME), { force: true })
        .catch(() => {});
    }

    // Final pipeline stage: hand the finished book to the running Bloom to apply its
    // CSS + browser-only fix-ups. Only when the run reached the Bloom HTML target and
    // produced a book. Serialized via withBloomLock — Bloom handles one book at a time,
    // so a run that finished HTML while another book is being processed shows "Bloom"
    // (running) and waits its turn here.
    if (rec.status === "done" && rec.target === "bloom" && rec.bookFolderPath) {
      const stamp = () => new Date().toTimeString().slice(0, 8);
      // The Bloom process-book step emits no per-page progress, but its duration scales
      // with page count, so estimate it as pageCount × the global per-page average from
      // prior books. The client uses startedMs + etaMs to advance a linear bar (when we
      // have no prior timing yet, etaMs stays undefined and the bar just doesn't tick).
      const { pageCount = 0 } = await readBookMeta(rec.bookFolderPath);
      const msPerPage = await getBloomMsPerPage();
      const etaMs = msPerPage && pageCount ? msPerPage * pageCount : undefined;

      // Keep the run "running" (in the Bloom stage) until Bloom actually finishes —
      // otherwise the row reads "done" while the book is still being styled, and the
      // compare pane has nothing to show yet.
      rec.status = "running";
      rec.progress = { stage: "bloom", page: 0, pageCount: 0 };
      appendLog(rec.id, `[${stamp()}] ▶ Bloom — started`);
      pushRun(rec);
      try {
        // Measure only the time actually processing in Bloom, not the time spent
        // waiting for the lock (queued behind another book).
        const durationMs = await withBloomLock(async () => {
          const startedMs = Date.now();
          // Real processing is starting now (we hold the lock, not just queued), so
          // publish the start time + ETA — that's what makes the GUI bar tick linearly.
          rec.progress = { stage: "bloom", page: 0, pageCount, startedMs, etaMs };
          pushRun(rec);
          await processBookInBloomForRun(rec, {
            onLog: (l) => appendLog(rec.id, `[${stamp()}]    ${l}`),
          });
          return Date.now() - startedMs;
        });
        rec.stages.bloom = { durationMs };
        rec.status = "done";
        // Fold this book's timing into the global per-page average so the next book's
        // bar is calibrated. Skipped when we couldn't read a page count.
        if (pageCount) await recordBloomTiming(durationMs, pageCount);
        appendLog(rec.id, `[${stamp()}] ✓ Bloom — done (${Math.round(durationMs / 1000)}s)`);
      } catch (err) {
        rec.status = "failed";
        rec.error = err instanceof Error ? err.message : String(err);
        rec.failedStage = "bloom";
        appendLog(rec.id, `[${stamp()}] ✗ ERROR: ${rec.error}`);
      }
    }
  } catch (err) {
    rec.status = "failed";
    rec.error = err instanceof Error ? err.message : String(err);
    rec.failedStage = lastStage;
  } finally {
    cancelFlags.delete(rec.id);
    rec.progress = undefined;
    rec.finishedAt = new Date().toISOString();
    await writeRunJson(rec);
    // Persist the run log alongside the run so it survives a server restart.
    const buf = runLogs.get(rec.id);
    if (buf && buf.length) {
      await fs.writeFile(path.join(rec.runDir, "run.log"), buf.join("\n")).catch(() => {});
    }
    pushRun(rec);
  }
}

/** The live (or persisted) human-readable log for a run. */
export async function getRunLog(runId: string): Promise<{ lines: string[] }> {
  await ensureLoaded();
  const buf = runLogs.get(runId);
  if (buf && buf.length) return { lines: buf };
  const rec = runs.get(runId);
  if (rec) {
    try {
      const txt = await fs.readFile(path.join(rec.runDir, "run.log"), "utf-8");
      return { lines: txt.split("\n") };
    } catch {
      /* no persisted log */
    }
  }
  return { lines: [] };
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
  // Approving a run pins it so a later conversion of the same PDF won't dispose it.
  if (rating === "keeper") rec.pinned = true;
  await writeRunJson(rec);
  pushRun(rec);
}

export async function setPinned(runId: string, pinned: boolean) {
  await ensureLoaded();
  const rec = runs.get(runId);
  if (!rec) return;
  rec.pinned = pinned;
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

/** Set (or clear, when mark is null) one metadata-review mark for a run. */
export async function setChecklistMark(runId: string, key: string, mark: ChecklistMark | null) {
  await ensureLoaded();
  const rec = runs.get(runId);
  if (!rec || !key) return;
  const checklist = (rec.checklist ||= {});
  if (mark === "up" || mark === "down") checklist[key] = mark;
  else delete checklist[key];
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
  pinned: boolean;
  stages: Record<string, boolean>;
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
  /** Per-item metadata-review marks (item key → "up"/"down"). */
  checklist: Record<string, ChecklistMark>;
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
  progress?: { stage: string; page: number; pages: number; etaMs?: number; startedMs?: number };
  error?: { stage?: string; code: string; message: string };
  /** Stages a re-run could start from given the artifacts on disk (resume). */
  resumeStage?: string;
}

function toGuiRun(rec: RunRecord): GuiRun {
  const mark = rec.rating === "keeper" ? "good" : rec.rating === "disapproved" ? "bad" : "neutral";
  // stages done: derived from artifacts if the book folder exists, else from recorded metrics
  const done: Record<string, boolean> = {
    ocr: false,
    llm: false,
    plan: false,
    html: false,
    bloom: false,
  };
  for (const s of STAGES) if (rec.stages[s]?.durationMs != null) done[s] = true;
  // "bloom" is the engine-level final stage (not a lib artifact), tracked separately.
  if (rec.stages.bloom?.durationMs != null) done.bloom = true;
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
    { key: "bloom", label: "Bloom" },
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
    // Hide the Bloom row until the Bloom stage has actually run (no duration yet).
    if (key === "bloom" && m?.durationMs == null) continue;
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
    pinned: !!rec.pinned,
    stages: done,
    model: rec.params.model || "",
    ocrMethod: rec.params.ocrMethod,
    tokensIn,
    tokensOut,
    cost,
    time: Math.round(time),
    // Full ISO timestamp (UTC, with the trailing Z); the GUI renders it in the
    // viewer's local time zone. Slicing off the timezone here made the client
    // misread a UTC instant as local wall-clock time.
    ts: rec.createdAt,
    startedAt: rec.startedAt ? Date.parse(rec.startedAt) : undefined,
    finishedAt: rec.finishedAt ? Date.parse(rec.finishedAt) : undefined,
    notes: rec.notes,
    checklist: rec.checklist || {},
    tags: [],
    params: rec.params,
    breakdown,
    progress: rec.progress
      ? {
          stage: rec.progress.stage,
          page: rec.progress.page,
          pages: rec.progress.pageCount,
          etaMs: rec.progress.etaMs,
          startedMs: rec.progress.startedMs,
        }
      : undefined,
    error:
      rec.status === "failed" && rec.error
        ? {
            stage: rec.failedStage || rec.progress?.stage,
            code: "ERROR",
            message: rec.error,
          }
        : undefined,
    resumeStage: rec.status === "failed" ? [...STAGES].reverse().find((s) => done[s]) : undefined,
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

// ---- extracted-metadata checklist ----
// The fixed set of metadata items a user reviews, in display order. Keep the keys
// in sync with the GUI's BLOOM.CHECKLIST_ITEMS (the review-status denominator).
const CHECKLIST_ITEMS: { key: string; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "author", label: "Author" },
  { key: "illustrator", label: "Illustrator" },
  { key: "copyright", label: "Copyright" },
  { key: "license", label: "License" },
  { key: "licenseNotes", label: "License Notes" },
  { key: "funding", label: "Funding / Acknowledgments" },
  { key: "isbn", label: "ISBN" },
  { key: "publisher", label: "Publisher" },
  { key: "languages", label: "Languages" },
  { key: "pageSize", label: "Paper Size & Orientation" },
  { key: "textPlacement", label: "Text Placement" },
  { key: "textSize", label: "Text Size" },
  { key: "font", label: "Font" },
];

/** Collect field-tagged text blocks → { field: { lang: text } } (first non-empty per lang). */
function collectChecklistFields(book: { pages: any[] }): Record<string, Record<string, string>> {
  const fields: Record<string, Record<string, string>> = {};
  for (const page of book.pages || []) {
    for (const el of page.elements || []) {
      if (el.type !== "text" || !el.field || el.field === "pageNumber") continue;
      const bucket = (fields[el.field] ??= {});
      for (const [lang, value] of Object.entries(el.content || {})) {
        const v = typeof value === "string" ? value.trim() : "";
        if (v && !bucket[lang]) bucket[lang] = v;
      }
    }
  }
  return fields;
}
function preferL1(content: Record<string, string> | undefined, l1: string): string {
  if (!content) return "";
  return content[l1] ?? Object.values(content)[0] ?? "";
}
function fmtPageSize(ps?: string): string {
  if (!ps) return "";
  const m = ps.match(
    /^(A3|A4|A5|A6|Letter|Legal|Device16x9|HalfLetter|QuarterLetter)(Portrait|Landscape)$/,
  );
  return m ? `${m[1]} ${m[2]}` : ps;
}
function summarizePlacement(book: { pages: any[] }): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const combos = new Map<string, number>();
  for (const p of book.pages || []) {
    if (!p.verticalAlign && !p.horizontalAlign) continue;
    const key = `${cap(p.verticalAlign ?? "—")} / ${cap(p.horizontalAlign ?? "—")}`;
    combos.set(key, (combos.get(key) || 0) + 1);
  }
  if (combos.size === 0) return "";
  if (combos.size === 1) return [...combos.keys()][0];
  const [top] = [...combos.entries()].sort((a, b) => b[1] - a[1]);
  return `Varies (mostly ${top[0]})`;
}

/**
 * Read layout facts from the HTML Bloom actually produced (the run's .htm): the
 * page-size/orientation class and the body-text "normal" style (font size + family)
 * from the `userModifiedStyles` block. These aren't reliably in the source metadata,
 * so we read them back out of the generated book.
 */
async function readBloomHtmlLayout(
  bookFolderPath: string,
): Promise<{ pageSize?: string; fontSizePt?: string; fontFamily?: string }> {
  let htmName: string | undefined;
  try {
    htmName = (await fs.readdir(bookFolderPath)).find((f) => /\.html?$/i.test(f));
  } catch {
    /* unreadable */
  }
  if (!htmName) return {};
  let html = "";
  try {
    html = await fs.readFile(path.join(bookFolderPath, htmName), "utf-8");
  } catch {
    return {};
  }
  const out: { pageSize?: string; fontSizePt?: string; fontFamily?: string } = {};
  const size = html.match(
    /class="[^"]*\b(A3|A4|A5|A6|Letter|Legal|Device16x9|HalfLetter|QuarterLetter)(Portrait|Landscape)\b/,
  );
  if (size) out.pageSize = `${size[1]} ${size[2]}`;
  // The "normal" style: `.normal-style { font-size: 12pt }` and a per-language
  // `.normal-style[lang="xx"] { … font-family: Andika … }`.
  const fontSize = html.match(/\.normal-style[^{}]*\{[^}]*font-size:\s*([\d.]+)pt/i);
  if (fontSize) out.fontSizePt = fontSize[1];
  const fontFamily = html.match(/\.normal-style[^{}]*\{[^}]*font-family:\s*([^;!}]+)/i);
  if (fontFamily) out.fontFamily = fontFamily[1].trim();
  return out;
}

/**
 * The extracted-metadata checklist for a run: every canonical item with the value
 * we extracted (empty string when not detected) plus the user's current marks.
 * Reads from the furthest Bloom-markdown artifact (parsed for front-matter + field
 * blocks) and meta.json as a fallback. Paper size, text size and font come from the
 * HTML Bloom produced (readBloomHtmlLayout). Items stay listed even when empty so a
 * missing field is itself reviewable.
 */
export async function getRunMetadata(runId: string): Promise<{
  items: { key: string; label: string; value: string }[];
  marks: Record<string, ChecklistMark>;
}> {
  await ensureLoaded();
  const rec = runs.get(runId);
  const marks = rec?.checklist || {};
  const empty = () => ({
    items: CHECKLIST_ITEMS.map((it) => ({ ...it, value: "" })),
    marks,
  });
  if (!rec || !rec.bookFolderPath) return empty();

  const baseName = path.parse(rec.sourcePath).name;
  let values: Record<string, string> = {};
  try {
    const a = await detectArtifacts(rec.bookFolderPath, baseName);
    const mdPath = a.bloomMd || a.llmMd || a.rawLlmMd || a.ocrMd;
    // Layout (paper size / text size / font) read back from the produced HTML.
    const layout = await readBloomHtmlLayout(rec.bookFolderPath);
    const layoutTextSize = layout.fontSizePt ? `${layout.fontSizePt} pt` : "";
    let meta: any = {};
    try {
      meta = JSON.parse(await fs.readFile(path.join(rec.bookFolderPath, "meta.json"), "utf-8"));
    } catch {
      /* no meta.json */
    }
    if (mdPath) {
      const content = await fs.readFile(mdPath, "utf-8");
      const book = new Parser().parseMarkdown(content);
      const fm: any = book.frontMatterMetadata || {};
      const l1 = fm.l1 || "en";
      const f = collectChecklistFields(book);
      const pick = (...keys: string[]) => {
        for (const k of keys) {
          const v = preferL1(f[k], l1);
          if (v) return v;
        }
        return "";
      };
      values = {
        title: pick("bookTitle", "title") || (meta.title ?? ""),
        author: pick("author") || (meta.author ?? ""),
        illustrator: pick("illustrator"),
        copyright: pick("copyright") || (meta.copyright ?? ""),
        license: meta.license || pick("license", "licenseUrl"),
        licenseNotes: pick("licenseNotes") || (meta.licenseNotes ?? ""),
        funding: pick("funding", "funding-info", "acknowledgements-original-version"),
        isbn: pick("isbn") || (meta.isbn ?? ""),
        publisher: pick("publisher", "originalPublisher") || (meta.publisher ?? ""),
        languages: Object.entries((fm.languages || {}) as Record<string, string>)
          .map(([code, name]) => `${name} (${code})`)
          .join(", "),
        // Paper size / text size / font come from what Bloom produced; fall back to
        // the source-detected front-matter values when the HTML lacks them.
        pageSize: layout.pageSize || fmtPageSize(fm.pageSize),
        textPlacement: summarizePlacement(book),
        textSize: layoutTextSize || (fm.normalFontSizePt ? `${fm.normalFontSizePt} pt` : ""),
        font: layout.fontFamily || fm.normalFontFamily || "",
      };
    } else {
      // No markdown yet, but a book folder exists — use meta.json + produced HTML.
      values = {
        title: meta.title ?? "",
        author: meta.author ?? "",
        copyright: meta.copyright ?? "",
        license: meta.license ?? "",
        licenseNotes: meta.licenseNotes ?? "",
        isbn: meta.isbn ?? "",
        publisher: meta.publisher ?? "",
        pageSize: layout.pageSize || "",
        textSize: layoutTextSize,
        font: layout.fontFamily || "",
      };
    }
  } catch {
    return empty();
  }
  return {
    items: CHECKLIST_ITEMS.map((it) => ({ ...it, value: values[it.key] ?? "" })),
    marks,
  };
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

/**
 * Show a native OS folder-picker and resolve to the chosen absolute path, or null
 * if the user cancelled. Runs synchronously from the user's point of view: the
 * dialog is modal in its own process and we await its stdout.
 */
export async function pickFolder(initial?: string): Promise<string | null> {
  const { spawn } = await import("node:child_process");
  let cmd: string;
  let args: string[];
  if (process.platform === "win32") {
    // -STA is required for FolderBrowserDialog; pwsh defaults to MTA.
    const start = initial ? `$d.SelectedPath = '${initial.replace(/'/g, "")}';` : "";
    const ps =
      `Add-Type -AssemblyName System.Windows.Forms;` +
      `$d = New-Object System.Windows.Forms.FolderBrowserDialog;` +
      `$d.Description = 'Select source folder';` +
      `$d.ShowNewFolderButton = $false;` +
      start +
      `if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }`;
    cmd = "powershell";
    args = ["-NoProfile", "-STA", "-Command", ps];
  } else if (process.platform === "darwin") {
    const loc = initial ? ` default location (POSIX file "${initial.replace(/"/g, "")}")` : "";
    cmd = "osascript";
    args = ["-e", `POSIX path of (choose folder with prompt "Select source folder"${loc})`];
  } else {
    cmd = "zenity";
    args = ["--file-selection", "--directory", "--title=Select source folder"];
    if (initial) args.push(`--filename=${initial.replace(/\/?$/, "/")}`);
  }
  return new Promise((resolve) => {
    let out = "";
    try {
      const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
      child.stdout.on("data", (b) => (out += b.toString()));
      child.on("error", () => resolve(null));
      child.on("close", () => {
        const picked = out.trim();
        resolve(picked || null);
      });
    } catch {
      resolve(null);
    }
  });
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

// ---- master-page reuse (GUI picker) ----

/** Sidecar holding the clean (pre-master-splice) Bloom-processed .htm, so clearing
 *  a mapping can restore the original page. Named without an .htm extension so the
 *  preview's "find the book's .htm" scan never picks it up. */
const MASTER_BASELINE_NAME = "master-baseline.bak";

/** The live book .htm in a folder (excludes the baseline sidecar). */
async function liveBookHtmName(folder: string): Promise<string | undefined> {
  try {
    return (await fs.readdir(folder)).find((f) => /\.html?$/i.test(f));
  } catch {
    return undefined;
  }
}

/**
 * Resolve the master book folder for a run: find the collection it targets (the
 * running Bloom's open collection when the run used the `__running__` sentinel),
 * then the sibling `*master` folder (excluding the book itself).
 */
async function resolveRunMasterFolder(rec: RunRecord): Promise<string | undefined> {
  const settings = await getSettings();
  let collectionFolder = rec.collection || settings.defaultCollection || undefined;
  if (!collectionFolder || collectionFolder === "__running__" || collectionFolder === "recent") {
    const bloom = await getRunningBloomCollection();
    collectionFolder =
      bloom?.collectionFolder || (collectionFolder === "recent" ? undefined : collectionFolder);
  }
  if (!collectionFolder || collectionFolder === "recent" || collectionFolder === "__running__") {
    return undefined;
  }
  return findMasterBookFolder(collectionFolder, rec.bookFolderPath);
}

/**
 * Map each source page number to its perceptual hash, read from the run's furthest
 * Markdown artifact (the .htm strips the hash from ordinary pages, but the markdown
 * keeps `import-source-hash` on every page).
 */
export async function getSourcePageHashes(runId: string): Promise<Record<number, string>> {
  await ensureLoaded();
  const rec = runs.get(runId);
  if (!rec || !rec.bookFolderPath) return {};
  const baseName = path.parse(rec.sourcePath).name;
  const a = await detectArtifacts(rec.bookFolderPath, baseName);
  const mdPath = a.bloomMd || a.llmMd || a.ocrMd;
  if (!mdPath) return {};
  let content: string;
  try {
    content = await fs.readFile(mdPath, "utf-8");
  } catch {
    return {};
  }
  const out: Record<number, string> = {};
  try {
    const book = new Parser().parseMarkdown(content);
    for (const page of book.pages) {
      if (typeof page.sourcePdfPage === "number" && page.importSourceHash) {
        out[page.sourcePdfPage] = page.importSourceHash;
      }
    }
  } catch {
    /* unparseable markdown — no hashes */
  }
  return out;
}

/**
 * List the master book's pages for the picker. `index` is the 1-based document
 * position used to render a thumbnail via `/master-page/__page-{index}.html`, which
 * resolves the same ordering back to this `id`.
 */
export async function listMasterPagesForRun(
  runId: string,
  sourceHash?: string,
): Promise<{
  ready: boolean;
  masterFolder?: string;
  pages: { id: string; index: number }[];
  // The master page already chosen for `sourceHash` (so the picker can highlight it),
  // or null when none is mapped / no sourceHash was asked about.
  selectedMasterPageId?: string | null;
}> {
  await ensureLoaded();
  const rec = runs.get(runId);
  if (!rec) return { ready: false, pages: [] };
  const masterFolder = await resolveRunMasterFolder(rec);
  if (!masterFolder) return { ready: false, pages: [] };
  const byId = await loadMasterPagesById(masterFolder);
  const pages = [...byId.values()].map((mp, i) => ({ id: mp.id, index: i + 1 }));
  let selectedMasterPageId: string | null = null;
  if (sourceHash) {
    const { entries } = await readMasterPageMap(masterFolder);
    selectedMasterPageId = entries.find((e) => e.sourceHash === sourceHash)?.masterPageId ?? null;
  }
  return { ready: true, masterFolder, pages, selectedMasterPageId };
}

/** The master book folder a run targets, or undefined when there is none. */
export async function getRunMasterFolder(runId: string): Promise<string | undefined> {
  await ensureLoaded();
  const rec = runs.get(runId);
  if (!rec) return undefined;
  return resolveRunMasterFolder(rec);
}

/** Resolve a master folder + 1-based page index to that page's id (picker ordering). */
export async function resolveMasterPageId(
  runId: string,
  index: number,
): Promise<{ masterFolder?: string; id?: string }> {
  await ensureLoaded();
  const rec = runs.get(runId);
  if (!rec) return {};
  const masterFolder = await resolveRunMasterFolder(rec);
  if (!masterFolder) return {};
  const byId = await loadMasterPagesById(masterFolder);
  const ids = [...byId.keys()];
  return { masterFolder, id: ids[index - 1] };
}

/** Record (or, with a null id, clear) a source-hash → master-page mapping. */
export async function saveMasterMappingForRun(
  runId: string,
  sourceHash: string,
  masterPageId: string | null,
): Promise<void> {
  await ensureLoaded();
  const rec = runs.get(runId);
  if (!rec) throw new Error("Run not found.");
  const masterFolder = await resolveRunMasterFolder(rec);
  if (!masterFolder) throw new Error("No master book found in this collection.");
  if (masterPageId) await appendMasterMapping(masterFolder, sourceHash, masterPageId);
  else await clearMasterMapping(masterFolder, sourceHash);
}

/** Add `data-import-source-hash` to each bloom-page div by its source page number,
 *  so the hash-driven `applyMasterPages` can match (the processed .htm omits it). */
function injectSourceHashes(html: string, pdfPageToHash: Record<number, string>): string {
  return html.replace(/<div\b[^>]*\bbloom-page\b[^>]*>/gi, (tag) => {
    if (/data-import-source-hash=/i.test(tag)) return tag;
    const m = tag.match(/data-source-pdf-page="(\d+)"/);
    const hash = m ? pdfPageToHash[Number(m[1])] : undefined;
    return hash ? tag.replace(/(<div\b)/i, `$1 data-import-source-hash="${hash}"`) : tag;
  });
}

/**
 * Re-apply master pages to a run's book for an immediate preview refresh — Stage 4
 * only, no OCR/LLM. Works on a one-time snapshot of the Bloom-processed .htm so that
 * non-master pages keep Bloom's layout and clearing a mapping reverts a page.
 */
export async function reapplyMastersForRun(runId: string): Promise<void> {
  await ensureLoaded();
  const rec = runs.get(runId);
  if (!rec || !rec.bookFolderPath) return;
  const folder = rec.bookFolderPath;
  const htmName = await liveBookHtmName(folder);
  if (!htmName) return;
  const livePath = path.join(folder, htmName);
  const baselinePath = path.join(folder, MASTER_BASELINE_NAME);

  // Snapshot the clean Bloom-processed document the first time we touch this run.
  try {
    await fs.access(baselinePath);
  } catch {
    await fs.copyFile(livePath, baselinePath);
  }

  let html = await fs.readFile(baselinePath, "utf-8");
  const masterFolder = await resolveRunMasterFolder(rec);
  if (masterFolder) {
    const masterPages = await loadMasterPages(masterFolder);
    const pdfPageToHash = await getSourcePageHashes(runId);
    html = injectSourceHashes(html, pdfPageToHash);
    html = await applyMasterPages(html, { masterPages, bookFolder: folder, masterFolder });
  }
  await fs.writeFile(livePath, html, "utf-8");
  pushRun(rec); // nudge the client to reload the preview iframe
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
