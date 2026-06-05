import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../logger";

/**
 * Telling a running Bloom to add or refresh a book.
 *
 * After we write (or overwrite) a book folder inside a Bloom collection, we can
 * tell an already-running Bloom to add the new book to its collection list or
 * refresh a book it already knows about. This is plain HTTP against the local
 * server that every running Bloom hosts; there is no SDK.
 *
 * See notify-bloom.md at the repo root for the full contract.
 */

// Bloom picks its HTTP port dynamically: it tries 8089 first, and reserves ports
// 3 at a time (HTTP, WebSocket, remote-debugging), so candidate HTTP ports are
// 8089 + 3*n. Scanning the first ~7 covers all realistic cases.
const CANDIDATE_PORTS = [8089, 8092, 8095, 8098, 8101, 8104, 8107];

const PORT_PROBE_TIMEOUT_MS = 500;

interface BloomInstanceInfo {
  instanceKind?: string;
  editableCollectionFolder?: string;
  collectionName?: string;
}

export interface NotifyBloomResult {
  /** True if a matching running Bloom was found and accepted the update. */
  notified: boolean;
  /** Human-readable explanation of what happened. */
  reason: string;
  /** The port of the Bloom instance we talked to, if any. */
  port?: number;
  /** The book's bookInstanceId (from meta.json), if it could be read. */
  bookId?: string;
}

/** Normalize a path for case-insensitive comparison with trailing slashes removed. */
function normalizeFolder(p: string): string {
  return p.replace(/[\\/]+$/, "").toLowerCase();
}

/**
 * Find a running Bloom and report which collection it currently has open. Lets a
 * caller preview a book into the very collection Bloom is showing.
 */
export async function getRunningBloomCollection(): Promise<{
  port: number;
  collectionFolder: string;
  collectionName?: string;
} | null> {
  for (const port of CANDIDATE_PORTS) {
    try {
      const response = await fetch(`http://localhost:${port}/bloom/api/common/instanceInfo`, {
        signal: AbortSignal.timeout(PORT_PROBE_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const info = (await response.json()) as BloomInstanceInfo;
      if (info.instanceKind === "running-bloom" && info.editableCollectionFolder) {
        return {
          port,
          collectionFolder: info.editableCollectionFolder,
          collectionName: info.collectionName,
        };
      }
    } catch {
      // keep scanning
    }
  }
  return null;
}

/** Ask the running Bloom to reload its open collection (POST common/reloadCollection). */
export async function reloadBloomCollection(port?: number): Promise<boolean> {
  const ports = port ? [port] : CANDIDATE_PORTS;
  for (const p of ports) {
    try {
      const response = await fetch(`http://localhost:${p}/bloom/api/common/reloadCollection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(PORT_PROBE_TIMEOUT_MS),
      });
      if (response.ok) return true;
    } catch {
      // keep scanning
    }
  }
  return false;
}

/** Ask the running Bloom to select (open) a book by its bookInstanceId
 *  (POST external/selectBook). Used as the final step of Preview so Bloom
 *  actually shows the previewed book. */
export async function selectBookInBloom(bookId: string, port?: number): Promise<boolean> {
  const ports = port ? [port] : CANDIDATE_PORTS;
  for (const p of ports) {
    try {
      const response = await fetch(`http://localhost:${p}/bloom/api/external/selectBook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: bookId }),
        signal: AbortSignal.timeout(PORT_PROBE_TIMEOUT_MS),
      });
      if (response.ok) return true;
    } catch {
      // keep scanning
    }
  }
  return false;
}

/** Bring the running Bloom window to the foreground (POST external/bringToFront). */
export async function bringBloomToFront(port?: number): Promise<boolean> {
  const ports = port ? [port] : CANDIDATE_PORTS;
  for (const p of ports) {
    try {
      const response = await fetch(`http://localhost:${p}/bloom/api/external/bringToFront`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(PORT_PROBE_TIMEOUT_MS),
      });
      if (response.ok) return true;
    } catch {
      // keep scanning
    }
  }
  return false;
}

/** True if `parent` is the immediate parent folder of `child`. */
function isParentOf(parent: string, child: string): boolean {
  return normalizeFolder(path.dirname(child)) === normalizeFolder(parent);
}

/** Read the book's bookInstanceId from its meta.json, or undefined if unavailable. */
async function readBookInstanceId(bookFolder: string): Promise<string | undefined> {
  const metaPath = path.join(bookFolder, "meta.json");
  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    const meta = JSON.parse(raw) as { bookInstanceId?: string };
    return meta.bookInstanceId || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Scan the candidate ports for a running Bloom whose open collection is the
 * parent folder of `bookFolder`. Returns that instance's port, or null.
 */
async function findBloomForCollection(bookFolder: string): Promise<number | null> {
  for (const port of CANDIDATE_PORTS) {
    try {
      const response = await fetch(`http://localhost:${port}/bloom/api/common/instanceInfo`, {
        signal: AbortSignal.timeout(PORT_PROBE_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const info = (await response.json()) as BloomInstanceInfo;
      if (
        info.instanceKind === "running-bloom" &&
        info.editableCollectionFolder &&
        isParentOf(info.editableCollectionFolder, bookFolder)
      ) {
        return port;
      }
    } catch {
      // Nothing listening on this port (or it timed out); keep scanning.
    }
  }
  return null;
}

/**
 * Attempt to tell a running Bloom that we just added or updated a book in its
 * collection. Bloom decides whether the book is new (adds it) or already present
 * (refreshes it) and shows a toast. This is safe to call every time; if no
 * matching Bloom is running, it simply reports that and does nothing.
 *
 * Writes a message to the console (via the logger) describing whether a Bloom
 * was found and updated.
 */
export async function notifyBloomOfBook(bookFolder: string): Promise<NotifyBloomResult> {
  const absoluteBookFolder = path.resolve(bookFolder);

  const bookId = await readBookInstanceId(absoluteBookFolder);
  if (!bookId) {
    const reason =
      "Could not notify Bloom: no bookInstanceId found (the book folder has no meta.json with an 'id').";
    logger.warn(reason);
    return { notified: false, reason };
  }

  const port = await findBloomForCollection(absoluteBookFolder);
  if (port == null) {
    const reason =
      "No running Bloom found with this book's collection open; skipping live refresh. " +
      "Bloom will pick up the book the next time that collection is opened.";
    logger.info(reason);
    return { notified: false, reason, bookId };
  }

  try {
    const response = await fetch(`http://localhost:${port}/bloom/api/external/updateBook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: bookId, folderPath: absoluteBookFolder }),
    });

    if (response.ok) {
      const reason = `Notified the running Bloom on port ${port} to add/refresh this book.`;
      logger.info(`✅ ${reason}`);
      return { notified: true, reason, port, bookId };
    }

    const reason = `Found a running Bloom on port ${port}, but it rejected the update (HTTP ${response.status} ${response.statusText}).`;
    logger.warn(reason);
    return { notified: false, reason, port, bookId };
  } catch (error) {
    const reason = `Found a running Bloom on port ${port}, but the update request failed: ${error instanceof Error ? error.message : String(error)}`;
    logger.warn(reason);
    return { notified: false, reason, port, bookId };
  }
}
