/* Desktop boot logic. Runs on Neutralino's own origin (so the Neutralino client
   stays available for the whole app lifetime). It:
     1. starts the Node backend sidecar (gui/server-dist/serve.cjs) via os.spawnProcess,
     2. waits until the sidecar's HTTP port is reachable,
     3. points a full-window <iframe> at it (the GUI then runs same-origin inside),
     4. kills the sidecar when the window closes.
   See ../neutralino.config.json and ../../gui/server/serve.ts. */

const BACKEND_PORT = 5181;
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;
const HEALTH_URL = `${BACKEND_ORIGIN}/api/health`;
const READY_TIMEOUT_MS = 45000;
const POLL_INTERVAL_MS = 400;

// The id Neutralino assigns to the sidecar we spawn (null if it was already running
// or we never spawned it — in which case we must not kill it on close).
let spawnedId = null;
let backendLog = "";
// Guards main() against running twice (ready event + the timeout fallback).
let started = false;

const $status = () => document.getElementById("status");
const $error = () => document.getElementById("error");

function setStatus(text) {
  const el = $status();
  if (el) el.textContent = text;
}

function showError(message) {
  const el = $error();
  if (el) {
    el.hidden = false;
    el.textContent = message + (backendLog ? `\n\n--- backend output ---\n${backendLog}` : "");
  }
  const sp = document.querySelector("#splash .spinner");
  if (sp) sp.style.display = "none";
  setStatus("Couldn't start the conversion engine.");
}

/** Probe the sidecar. mode:'no-cors' sidesteps CORS — any HTTP response (opaque)
 *  means the server is listening; a connection refusal rejects. */
async function isBackendUp() {
  try {
    await fetch(HEALTH_URL, { mode: "no-cors", cache: "no-store" });
    return true;
  } catch {
    return false;
  }
}

/** The app's base directory (absolute). In `neu run` this is the desktop package
 *  folder; in an installed release it's the install dir (the installer's shortcut
 *  sets WorkingDir to it). Falls back to the relative NL_PATH ('.') if needed. */
function baseDir() {
  return typeof NL_CWD === "string" && NL_CWD ? NL_CWD : NL_PATH;
}

/** True when running from a `neu build --release` bundle (vs `neu run` dev mode). */
function isBundled() {
  return typeof NL_RESMODE !== "undefined" && NL_RESMODE === "bundle";
}

/**
 * How to launch the Node sidecar, per layout:
 *   - release bundle: a portable node.exe + sidecar shipped beside the app
 *       <base>/node.exe  <base>/app/server-dist/serve.cjs   (cwd <base>/app)
 *   - dev (neu run): system `node` + the sibling gui package's build
 *       node  <base>/../gui/server-dist/serve.cjs           (cwd <base>/../gui)
 * Returns { command, cwd } for Neutralino.os.spawnProcess.
 */
function backendLaunch() {
  const base = baseDir();
  if (isBundled()) {
    const node = `${base}/node.exe`;
    const script = `${base}/app/server-dist/serve.cjs`;
    return { command: `"${node}" "${script}" --port ${BACKEND_PORT}`, cwd: `${base}/app` };
  }
  const script = [base, "..", "gui", "server-dist", "serve.cjs"].join("/");
  return { command: `node "${script}" --port ${BACKEND_PORT}`, cwd: [base, "..", "gui"].join("/") };
}

function log(msg) {
  // Writes to neutralinojs.log — handy when debugging the boot sequence from
  // outside the webview.
  try {
    Neutralino.debug.log(`[bloombridge boot] ${msg}`);
  } catch {
    /* debug.log not allowed / unavailable */
  }
}

// Capture anything that blows up before/around init so it's not invisible.
window.addEventListener("error", (e) =>
  log(`window.error: ${e.message || (e.error && e.error.message) || e}`),
);
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  log(`unhandledrejection: ${(r && (r.message || r.code)) || JSON.stringify(r)}`);
});

async function spawnBackend() {
  const { command, cwd } = backendLaunch();
  log(`spawning: ${command} (cwd=${cwd})`);
  // cwd holds node_modules so Node resolves @bloombridge/lib + sharp + exiftool
  // (the bundle marks all packages external). Neutralino 6.x takes an options
  // object as the 2nd arg (not a positional cwd string).
  const proc = await Neutralino.os.spawnProcess(command, { cwd });
  spawnedId = proc.id;
  log(`spawned sidecar id=${proc.id} pid=${proc.pid}`);
}

/** Surface backend stdout/stderr (so a crash on startup is visible on the splash). */
function watchBackendOutput() {
  Neutralino.events.on("spawnedProcess", (evt) => {
    const d = evt && evt.detail;
    if (!d || (spawnedId !== null && d.id !== spawnedId)) return;
    if (d.action === "stdOut" || d.action === "stdErr") {
      backendLog = (backendLog + d.data).slice(-4000);
    } else if (d.action === "exit") {
      // The sidecar died — if we hadn't already handed off to the iframe, report it.
      if (document.getElementById("app").hidden) {
        showError(`The conversion engine exited (code ${d.data}).`);
      }
    }
  });
}

async function waitForBackend() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isBackendUp()) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

function showApp() {
  const iframe = document.getElementById("app");
  iframe.src = `${BACKEND_ORIGIN}/`;
  iframe.hidden = false;
  const splash = document.getElementById("splash");
  if (splash) splash.style.display = "none";
  // Check for a newer release in the background (no-op in dev). Never blocks the UI.
  if (window.BloomBridgeUpdater) window.BloomBridgeUpdater.check();
}

/** The app version Neutralino injects from neutralino.config.json (kept in sync with
 *  package.json by scripts/sync-version.mjs). Empty if somehow unavailable. */
function appVersion() {
  return typeof NL_APPVERSION === "string" ? NL_APPVERSION : "";
}

/** Show the version after the app name — in the window title bar and on the splash. */
function showVersion() {
  const v = appVersion();
  const title = v ? `BloomBridge - ${v}` : "BloomBridge";
  try {
    void Neutralino.window.setTitle(title);
  } catch {
    /* window API not ready / not allowed */
  }
  const el = document.getElementById("appVersion");
  if (el && v) el.textContent = `v${v}`;
}

// ---------------------------------------------------------------------------
// Window state persistence — remember the window's position, size, and maximized
// state across sessions. (Pane-split positions are GUI state and persist via
// localStorage on the backend origin; see packages/gui/src/App.tsx.)
//
// Neutralino emits no move/resize events, so we poll the bounds on an interval,
// remember the last *un-maximized* bounds (so un-maximizing returns to a sensible
// size), and write a JSON file under the OS data dir. That dir is the only
// reliably writable spot once installed: the install dir can be read-only, and
// Neutralino's random http port makes localStorage on this origin useless across
// runs.
// ---------------------------------------------------------------------------

const WINDOW_STATE_DIR_NAME = "BloomBridge";
const WINDOW_STATE_FILE_NAME = "window-state.json";
const WINDOW_STATE_POLL_MS = 800;

// Mirror neutralino.config.json's modes.window minimums so a restored size can
// never shrink the window below what the layout needs.
const MIN_WIN_WIDTH = 900;
const MIN_WIN_HEIGHT = 600;

let windowStateDir = null;
// Most recent un-maximized bounds observed (what we persist as the restore size).
let lastBounds = null;
let lastMaximized = false;
// JSON of what we last wrote, so the poll loop only writes when something changed.
let lastWrittenJson = "";

async function windowStateFilePath() {
  if (!windowStateDir) {
    const dataDir = await Neutralino.os.getPath("data");
    windowStateDir = `${dataDir}/${WINDOW_STATE_DIR_NAME}`;
    try {
      await Neutralino.filesystem.createDirectory(windowStateDir);
    } catch {
      /* already exists */
    }
  }
  return `${windowStateDir}/${WINDOW_STATE_FILE_NAME}`;
}

/** Restore the saved bounds/maximize before the app is revealed. Best-effort:
 *  any failure (no file yet, bad JSON, API error) just leaves the config defaults. */
async function restoreWindowState() {
  try {
    const path = await windowStateFilePath();
    const raw = await Neutralino.filesystem.readFile(path);
    const s = JSON.parse(raw);
    const w = Number(s.width);
    const h = Number(s.height);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      await Neutralino.window.setSize({
        width: Math.max(MIN_WIN_WIDTH, Math.round(w)),
        height: Math.max(MIN_WIN_HEIGHT, Math.round(h)),
      });
    }
    const x = Number(s.x);
    const y = Number(s.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      await Neutralino.window.move(Math.round(x), Math.round(y));
    }
    if (s.maximize) {
      await Neutralino.window.maximize();
      lastMaximized = true;
    }
    log(`restored window state from ${path}`);
  } catch (e) {
    log(`no saved window state (${(e && (e.message || e.code)) || e})`);
  }
}

/** Snapshot the current window geometry. While maximized we keep the previously
 *  recorded un-maximized bounds (getSize would report the maximized dimensions). */
async function captureWindowState() {
  const maximized = await Neutralino.window.isMaximized();
  if (!maximized) {
    const size = await Neutralino.window.getSize();
    const pos = await Neutralino.window.getPosition();
    lastBounds = { width: size.width, height: size.height, x: pos.x, y: pos.y };
  }
  lastMaximized = maximized;
  return { ...lastBounds, maximize: lastMaximized };
}

/** Persist the current geometry, skipping the write when nothing changed. */
async function saveWindowState() {
  try {
    const state = await captureWindowState();
    if (state.width == null || state.height == null) return; // nothing observed yet
    const json = JSON.stringify(state);
    if (json === lastWrittenJson) return;
    const path = await windowStateFilePath();
    await Neutralino.filesystem.writeFile(path, json);
    lastWrittenJson = json;
  } catch (e) {
    log(`saveWindowState failed: ${(e && (e.message || e.code)) || e}`);
  }
}

/** Poll the window geometry so resizes/moves are persisted even if the app is
 *  killed without a clean windowClose. */
function trackWindowState() {
  setInterval(() => void saveWindowState(), WINDOW_STATE_POLL_MS);
}

async function shutdown() {
  try {
    if (spawnedId !== null) {
      await Neutralino.os.updateSpawnedProcess(spawnedId, "exit");
    }
  } catch {
    /* best effort */
  } finally {
    Neutralino.app.exit();
  }
}

async function main() {
  if (started) return;
  started = true;
  log("main() started");
  watchBackendOutput();
  // Restore the saved window bounds before the splash hands off to the app, then
  // start tracking geometry changes so they're remembered next launch.
  await restoreWindowState();
  trackWindowState();
  // Persist the final geometry, then clean up the sidecar, when the window closes
  // (we own the process lifecycle because exitProcessOnClose is false in config).
  Neutralino.events.on("windowClose", () => {
    void saveWindowState().finally(() => shutdown());
  });

  try {
    log(`mode=${isBundled() ? "bundle" : "dev"} base=${baseDir()}`);
    if (await isBackendUp()) {
      // Already running (e.g. a leftover from a prior session) — reuse it; don't
      // kill it on close since we didn't start it.
      log("backend already reachable; reusing it");
      setStatus("Connecting…");
    } else {
      setStatus("Starting conversion engine…");
      await spawnBackend();
      setStatus("Waiting for the conversion engine…");
    }

    if (await waitForBackend()) {
      log("backend reachable; showing app");
      showApp();
    } else {
      log("backend did not become reachable before timeout");
      showError(
        `The conversion engine didn't become reachable on ${BACKEND_ORIGIN} within ` +
          `${Math.round(READY_TIMEOUT_MS / 1000)}s.\n` +
          `Make sure the backend is built (pnpm --filter @bloombridge/gui build:server) and ` +
          `that Node is on PATH.`,
      );
    }
  } catch (e) {
    log(`error: ${(e && (e.message || e.code)) || e}`);
    showError(`Failed to launch the conversion engine.\n${(e && e.message) || e}`);
  }
}

// Native API calls must wait until the Neutralino client is connected.
Neutralino.init();
Neutralino.events.on("ready", () => {
  log("ready event fired");
  showVersion();
  void main();
});
// Fallback: if the `ready` event never arrives, still try after a short delay so a
// missed-event timing issue doesn't leave the app stuck on the splash forever.
setTimeout(() => {
  if (!started) {
    log("ready not seen after 1.5s; starting anyway");
    void main();
  }
}, 1500);
