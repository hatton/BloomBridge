// Capture screenshots of a book's pages from the preview pane of a running Bloom,
// so we can eyeball the result of a pdf-to-bloom conversion and compare it to the
// source PDF page images.
//
// How it works: a running Bloom shows the *selected* collection book in a preview
// iframe (`/book-preview/index.htm`) on the Collection tab. Every page of the book
// is a `.bloom-page` element inside that iframe. This helper attaches to Bloom's
// embedded WebView2 over CDP (via the globally-installed `dev-browser` CLI), selects
// the requested book, and screenshots the requested pages to PNG files we can Read.
//
// Usage:
//   node captureBookPages.mjs --book <bookInstanceId|name> [--pages all|0|0-3|0,2,5]
//                             [--out <dir>] [--reload] [--http-port <p>]
//
//   --book      data-book-id (== meta.json bookInstanceId) OR the exact caption
//               text shown under the book button (e.g. "thief-vision"). If omitted,
//               whatever book is currently selected is captured.
//   --pages     which pages (0-based index into the preview's .bloom-page list).
//               "all" (default), a single index, a "start-end" range, or a CSV list.
//   --out       directory to write page-NN.png files into (default ./bloom-screenshots).
//   --reload    POST external/updateBook for --book first, so Bloom re-reads it from
//               disk before we screenshot (use after re-running a conversion).
//   --http-port Bloom HTTP port (default: scan the standard 8089+3n range).
//
// Requires: `dev-browser` on PATH (https://github.com/SawyerHood/dev-browser).

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CANDIDATE_HTTP_PORTS = [8089, 8092, 8095, 8098, 8101, 8104, 8107];
const DEV_BROWSER_TMP = path.join(os.homedir(), ".dev-browser", "tmp");

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    book: undefined,
    pages: "all",
    out: "bloom-screenshots",
    reload: false,
    httpPort: undefined,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--book") opts.book = args[++i];
    else if (a === "--pages") opts.pages = args[++i];
    else if (a === "--out") opts.out = args[++i];
    else if (a === "--reload") opts.reload = true;
    else if (a === "--http-port") opts.httpPort = Number(args[++i]);
    else if (a === "--help") {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

function printHelp() {
  console.log(
    "Usage: node captureBookPages.mjs --book <id|name> [--pages all|0|0-3|0,2] [--out dir] [--reload] [--http-port p]",
  );
}

async function fetchInstanceInfo(port) {
  try {
    const r = await fetch(`http://localhost:${port}/bloom/api/common/instanceInfo`, {
      signal: AbortSignal.timeout(600),
    });
    if (!r.ok) return undefined;
    return await r.json();
  } catch {
    return undefined;
  }
}

async function resolveInstance(httpPort) {
  const ports = httpPort ? [httpPort] : CANDIDATE_HTTP_PORTS;
  for (const port of ports) {
    const info = await fetchInstanceInfo(port);
    if (info) return info;
  }
  throw new Error(
    `No running Bloom found on ${ports.join(", ")}. Start it with D:\\bloom.worktrees\\Remote-Reload\\go.sh.`,
  );
}

async function maybeReload(httpPort, bookId) {
  if (!bookId) throw new Error("--reload needs --book to be a bookInstanceId.");
  const r = await fetch(`http://localhost:${httpPort}/bloom/api/external/updateBook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: bookId }),
  });
  console.log(`external/updateBook -> HTTP ${r.status}`);
}

// Turn the --pages spec into a JS array literal the dev-browser script can use, or
// the string "all" to mean "every page".
function pagesSpecToLiteral(spec) {
  if (!spec || spec === "all") return "all";
  if (spec.includes("-") && !spec.includes(",")) {
    const [a, b] = spec.split("-").map(Number);
    const list = [];
    for (let i = a; i <= b; i++) list.push(i);
    return JSON.stringify(list);
  }
  return JSON.stringify(spec.split(",").map((s) => Number(s.trim())));
}

function buildDevBrowserScript(cdpPort, book, pagesLiteral) {
  // This source runs inside dev-browser's QuickJS sandbox. It can only write
  // screenshots into ~/.dev-browser/tmp via saveScreenshot(); we copy them out
  // afterwards. It prints a JSON line {saved:[...]} we parse from stdout.
  const bookSelector = book
    ? `// select the requested book by data-book-id or by exact caption text
    let btn = page.locator('.book-button[data-book-id=${JSON.stringify(book)}] button');
    if (await btn.count() === 0) {
      btn = page.locator('.book-button', { hasText: ${JSON.stringify(book)} }).locator('button');
    }
    if (await btn.count() === 0) throw new Error('book not found: ' + ${JSON.stringify(book)});
    await btn.first().click();
    await page.waitForTimeout(3000);`
    : `// no --book: capture whatever is already selected`;

  return `
const pages = await browser.listPages();
const target = pages.find(p => /\\/bloom\\//.test(p.url) && !p.url.startsWith('devtools://'));
if (!target) throw new Error('no Bloom WebView2 target found');
const page = await browser.getPage(target.id);
page.setDefaultTimeout(15000);
await page.waitForLoadState('domcontentloaded');
${bookSelector}
let frame = null;
for (let i = 0; i < 40 && !frame; i++) {
  frame = page.frames().find(f => f.url().includes('book-preview'));
  if (!frame) await page.waitForTimeout(250);
}
if (!frame) throw new Error('preview iframe not found (is Bloom on the Collection tab?)');
await frame.waitForLoadState('domcontentloaded');
const total = await frame.evaluate(() => document.querySelectorAll('.bloom-page').length);
const want = ${pagesLiteral === "all" ? "Array.from({length: total}, (_, i) => i)" : pagesLiteral};
const saved = [];
for (const idx of want) {
  if (idx < 0 || idx >= total) { console.warn('skip out-of-range page ' + idx); continue; }
  const el = await frame.$('.bloom-page >> nth=' + idx);
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const name = 'bloompage-' + String(idx).padStart(2, '0') + '.png';
  await saveScreenshot(await el.screenshot(), name);
  saved.push(name);
}
console.log('DEVBROWSER_RESULT ' + JSON.stringify({ total, saved }));
`;
}

async function main() {
  const opts = parseArgs();
  const info = await resolveInstance(opts.httpPort);
  const httpPort = info.httpPort;
  const cdpPort = info.cdpPort;
  if (!cdpPort) throw new Error("Running Bloom did not report a CDP port.");
  console.log(`Bloom HTTP ${httpPort}, CDP ${cdpPort}, collection "${info.collectionName}".`);

  if (opts.reload) await maybeReload(httpPort, opts.book);

  const script = buildDevBrowserScript(cdpPort, opts.book, pagesSpecToLiteral(opts.pages));
  const result = spawnSync(
    // One command string + shell:true so Windows resolves the dev-browser.cmd
    // shim on PATH (and we avoid the args-with-shell deprecation warning).
    `dev-browser --connect http://localhost:${cdpPort} --timeout 120`,
    { input: script, encoding: "utf8", shell: true },
  );
  if (result.stderr) process.stderr.write(result.stderr);
  process.stdout.write(result.stdout || "");
  if (result.status !== 0) throw new Error(`dev-browser exited ${result.status}`);

  const line = (result.stdout || "").split("\n").find((l) => l.includes("DEVBROWSER_RESULT"));
  if (!line) throw new Error("dev-browser did not report a result.");
  const { total, saved } = JSON.parse(line.slice(line.indexOf("{")));

  fs.mkdirSync(opts.out, { recursive: true });
  const outPaths = [];
  for (const name of saved) {
    const from = path.join(DEV_BROWSER_TMP, name);
    const to = path.join(opts.out, name);
    fs.copyFileSync(from, to);
    outPaths.push(to);
  }
  console.log(`Preview has ${total} pages. Captured ${outPaths.length}:`);
  for (const p of outPaths) console.log("  " + p);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
