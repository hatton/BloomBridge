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

/** A running Bloom instance and the editable collection it currently has open. */
export interface RunningBloomInstance {
  port: number;
  collectionFolder: string;
  collectionName?: string;
}

/** The languages the open collection is configured for (external/collection-languages). */
export interface CollectionLanguages {
  /** Primary/vernacular language tag (BCP-47), always present. */
  L1Code: string;
  /** Second language tag, always present. */
  L2Code: string;
  /** Third language tag, or null when the collection has no third language. */
  L3Code: string | null;
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

/**
 * Find every running Bloom and report the editable collection each currently has
 * open. There can be more than one Bloom running at once (different collections),
 * so callers that need to pick a specific collection scan them all rather than
 * stopping at the first.
 */
export async function getRunningBloomInstances(): Promise<RunningBloomInstance[]> {
  const found: RunningBloomInstance[] = [];
  for (const port of CANDIDATE_PORTS) {
    try {
      const response = await fetch(`http://localhost:${port}/bloom/api/common/instanceInfo`, {
        signal: AbortSignal.timeout(PORT_PROBE_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const info = (await response.json()) as BloomInstanceInfo;
      if (info.instanceKind === "running-bloom" && info.editableCollectionFolder) {
        found.push({
          port,
          collectionFolder: info.editableCollectionFolder,
          collectionName: info.collectionName,
        });
      }
    } catch {
      // Nothing listening on this port (or it timed out); keep scanning.
    }
  }
  return found;
}

/**
 * Ask a running Bloom which languages its open collection is configured for
 * (GET external/collection-languages). Returns null when that Bloom is too old to
 * have this endpoint (it answers non-2xx) or the request otherwise fails — callers
 * must treat null as "can't determine", never as a match.
 */
export async function getCollectionLanguages(port: number): Promise<CollectionLanguages | null> {
  try {
    const response = await fetch(
      `http://localhost:${port}/bloom/api/external/collection-languages`,
      { signal: AbortSignal.timeout(PORT_PROBE_TIMEOUT_MS) },
    );
    if (!response.ok) return null; // an old Bloom without this endpoint, or an error
    return (await response.json()) as CollectionLanguages;
  } catch {
    return null;
  }
}

/** Compare two BCP-47 language tags case-insensitively (e.g. "Bo" === "bo"). */
function sameLanguageTag(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Scan every running Bloom for one whose open collection's primary language (L1)
 * matches `l1`, so a generated book is processed/added into a compatible collection.
 * A Bloom too old to answer collection-languages is skipped — we can't confirm it's
 * compatible, so we never use it. Returns the matching instance (with its languages)
 * or null when none match.
 */
export async function findBloomCollectionForLanguage(
  l1: string,
): Promise<(RunningBloomInstance & { languages: CollectionLanguages }) | null> {
  const instances = await getRunningBloomInstances();
  for (const instance of instances) {
    const languages = await getCollectionLanguages(instance.port);
    if (languages && sameLanguageTag(languages.L1Code, l1)) {
      return { ...instance, languages };
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
 *  (POST external/select-book). Used as the final step of Preview so Bloom
 *  actually shows the previewed book. */
export async function selectBookInBloom(bookId: string, port?: number): Promise<boolean> {
  const ports = port ? [port] : CANDIDATE_PORTS;
  for (const p of ports) {
    try {
      const response = await fetch(`http://localhost:${p}/bloom/api/external/select-book`, {
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

/**
 * Ask the running Bloom to run its full "make it right" pass on a book folder
 * (POST external/process-book with the book's absolute folder path). Bloom brings
 * the book structurally up to date, processes every page off-screen in a real
 * browser (applying the browser-only fix-ups — image sizing, canvas-element
 * layout, CSS, etc. — that raw generated HTML lacks), and writes the fixed .htm
 * back into that same folder. There is no collection involvement.
 *
 * Bloom may rename the folder to match the book title; in that case the returned
 * `bookFolderPath` differs from the path passed in. Callers MUST use the returned
 * path from then on.
 *
 * On success returns `{ ok: true, processed, bookFolderPath, htmPath }`. On failure
 * (Bloom not running, or it rejected the request) returns `{ ok: false, error }`.
 *
 * The call BLOCKS until processing finishes, which can take a while, so we set no
 * request timeout.
 */
export async function processBookInBloom(
  bookFolder: string,
  port?: number,
): Promise<{
  ok: boolean;
  processed?: number;
  bookFolderPath?: string;
  htmPath?: string;
  error?: string;
}> {
  const absoluteBookFolder = path.resolve(bookFolder);
  const ports = port ? [port] : CANDIDATE_PORTS;
  for (const p of ports) {
    try {
      const response = await fetch(`http://localhost:${p}/bloom/api/external/process-book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: absoluteBookFolder }),
      });
      if (response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          processed?: number;
          bookFolderPath?: string;
          htmPath?: string;
        };
        logger.info(`✅ Bloom processed the book (${data?.processed ?? "?"} page(s)).`);
        return {
          ok: true,
          processed: data?.processed,
          bookFolderPath: data?.bookFolderPath ?? absoluteBookFolder,
          htmPath: data?.htmPath,
        };
      }
      // Bloom answered but refused. The other candidate ports won't have a running
      // Bloom, so stop and report this.
      const text = await response.text().catch(() => "");
      const error = `Bloom rejected process-book (HTTP ${response.status}): ${text || response.statusText}`;
      logger.warn(error);
      return { ok: false, error };
    } catch {
      // Nothing listening on this port; keep scanning.
    }
  }
  return { ok: false, error: "No running Bloom found." };
}

/**
 * Ask a running Bloom to copy a finished book folder into its open collection and
 * select it (POST external/add-book with the book's absolute folder path). Bloom
 * copies the folder in (the source is left untouched), reloads its collection list
 * so the new book appears, and replies with the new book's id and final on-disk
 * location.
 *
 * Bloom only honors this while its Collection tab is active; if the user is mid-edit
 * it returns a failure with that reason. On success returns
 * `{ ok: true, id, bookFolderPath, htmPath }`; on failure `{ ok: false, error }`.
 */
export async function addBookToBloom(
  bookFolder: string,
  port?: number,
): Promise<{
  ok: boolean;
  id?: string;
  bookFolderPath?: string;
  htmPath?: string;
  error?: string;
}> {
  const absoluteBookFolder = path.resolve(bookFolder);
  const ports = port ? [port] : CANDIDATE_PORTS;
  for (const p of ports) {
    try {
      const response = await fetch(`http://localhost:${p}/bloom/api/external/add-book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: absoluteBookFolder }),
      });
      if (response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          id?: string;
          bookFolderPath?: string;
          htmPath?: string;
        };
        logger.info(`✅ Bloom added the book to its collection.`);
        return {
          ok: true,
          id: data?.id,
          bookFolderPath: data?.bookFolderPath ?? absoluteBookFolder,
          htmPath: data?.htmPath,
        };
      }
      // Bloom answered but refused (e.g. not on the Collection tab). Other candidate
      // ports won't have this Bloom, so stop and report it.
      const text = await response.text().catch(() => "");
      const error = `Bloom rejected add-book (HTTP ${response.status}): ${text || response.statusText}`;
      logger.warn(error);
      return { ok: false, error };
    } catch {
      // Nothing listening on this port; keep scanning.
    }
  }
  return { ok: false, error: "No running Bloom found." };
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
export async function readBookInstanceId(bookFolder: string): Promise<string | undefined> {
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
    const response = await fetch(`http://localhost:${port}/bloom/api/external/update-book`, {
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
