/* Persisted global estimate of how long Bloom's "process-book" step takes per page.
   That step is otherwise opaque (no per-page progress events), yet its duration
   scales with the book's page count, so a single global ms-per-page average lets the
   GUI draw a linear, time-based progress bar for it. A single global average is
   enough: process-book time barely varies with OCR method / model. Persisted next to
   settings.json at ~/.bloombridge/bloom-timing.json. Server-side only. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const TIMING_PATH = path.join(os.homedir(), ".bloombridge", "bloom-timing.json");

interface BloomTiming {
  /** Rolling average milliseconds spent in Bloom's process-book step per content page. */
  msPerPage: number;
  /** How many books have contributed (diagnostic only). */
  samples: number;
}

// New sample weight in the exponential moving average. Low enough to stay stable
// across noisy books, high enough to track a machine that's gotten faster/slower.
const EMA_ALPHA = 0.25;

let cached: BloomTiming | null = null;
let loaded = false;

async function load(): Promise<BloomTiming | null> {
  if (loaded) return cached;
  loaded = true;
  try {
    const raw = await fs.readFile(TIMING_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<BloomTiming>;
    if (typeof parsed.msPerPage === "number" && parsed.msPerPage > 0) {
      cached = { msPerPage: parsed.msPerPage, samples: parsed.samples ?? 1 };
    }
  } catch {
    /* no prior timing — first ever book */
  }
  return cached;
}

/**
 * Current estimate of ms-per-page for Bloom's process-book step, or null when no book
 * has been timed yet (the caller should then fall back to a non-time-driven bar).
 */
export async function getBloomMsPerPage(): Promise<number | null> {
  return (await load())?.msPerPage ?? null;
}

/**
 * Fold one completed Bloom-step timing into the running average. `durationMs` is the
 * measured process-book time and `pageCount` the book's content-page count (both must
 * be > 0, else the sample is ignored so it can't poison the average). Best-effort:
 * a write failure is swallowed.
 */
export async function recordBloomTiming(durationMs: number, pageCount: number): Promise<void> {
  if (!(durationMs > 0) || !(pageCount > 0)) return;
  const sample = durationMs / pageCount;
  const prev = await load();
  const next: BloomTiming = prev
    ? {
        msPerPage: prev.msPerPage * (1 - EMA_ALPHA) + sample * EMA_ALPHA,
        samples: prev.samples + 1,
      }
    : { msPerPage: sample, samples: 1 };
  cached = next;
  try {
    await fs.mkdir(path.dirname(TIMING_PATH), { recursive: true });
    await fs.writeFile(TIMING_PATH, JSON.stringify(next, null, 2));
  } catch {
    /* best effort */
  }
}
