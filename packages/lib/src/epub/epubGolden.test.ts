/**
 * Structural golden regression for the EPUB → Bloom pipeline (the "ultimate output").
 *
 * For each sample EPUB present under `large-local-test-inputs/`, this runs the REAL CLI
 * end-to-end (deterministic for EPUB — no OCR/LLM/API) and fingerprints the generated
 * Bloom `.htm`: page count, the page-size token, and per-page the stable page-class
 * tokens plus counts of text blocks (bloom-translationGroup) and images. The fingerprint
 * is compared against a committed golden JSON, so a change that silently alters how a
 * CLASS of books converts (orientation, xMatter classification, page splitting, image
 * handling) fails the build.
 *
 * This is intentionally fixture-gated: the corpus EPUBs are large/local (gitignored), so
 * the test SKIPS books that aren't present and a CLI that hasn't been built — matching the
 * repo convention that some tests need local fixtures. The goldens themselves are tiny and
 * committed. Bootstrap or refresh them with `UPDATE_GOLDENS=1 vp test run packages/lib`.
 *
 * NOTE: visual/render-level regressions (how Bloom actually paints the page) are a separate,
 * heavier layer — see `.claude/bloom-automation/captureBookPages.mjs` for the CDP harness.
 */
/// <reference types="node" />
import { describe, it, expect } from "vite-plus/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CORPUS_DIR = path.join(REPO_ROOT, "large-local-test-inputs");
const CLI = path.join(REPO_ROOT, "packages/cli/dist/index.js");
const GOLDEN_DIR = path.join(__dirname, "__goldens__");
const UPDATE = !!process.env.UPDATE_GOLDENS;

// Representative corpus: portrait LFA, landscape StoryWeaver, landscape FXL, a novel.
const CORPUS = [
  "4788 A Thief In The Night.epub",
  "4800 Angie Visits the Volcano.epub",
  "4811 Why Rat and Cat Became Enemies.epub",
  "317894-paahaacha-upare-bhokilaa-jiba.epub",
  "cole-voyage-of-life.epub",
  "alice-gutenberg.epub",
];

interface PageFingerprint {
  classes: string;
  texts: number;
  images: number;
}
interface BookFingerprint {
  pageCount: number;
  pageSize: string;
  pages: PageFingerprint[];
}

// Stable bloom-page class tokens worth locking (drop volatile/cosmetic ones).
const KEEP_CLASS = new Set([
  "bloom-frontMatter",
  "bloom-backMatter",
  "cover",
  "frontCover",
  "outsideFrontCover",
  "titlePage",
  "credits",
  "theEndPage",
  "outsideBackCover",
  "numberedPage",
  "customPage",
  "bloom-customLayout",
  "A5Portrait",
  "A5Landscape",
  "A4Portrait",
  "A4Landscape",
  "Device16x9Portrait",
  "Device16x9Landscape",
]);

function fingerprintHtml(html: string): BookFingerprint {
  const pageSize = (html.match(/A[45](?:Portrait|Landscape)|Device16x9(?:Portrait|Landscape)/) || [
    "A5Portrait",
  ])[0];
  // Split into .bloom-page slices by the start of each page div's class attribute.
  const starts: number[] = [];
  const re = /class="bloom-page\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) starts.push(m.index);
  const pages: PageFingerprint[] = [];
  for (let i = 0; i < starts.length; i++) {
    const slice = html.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : undefined);
    const classAttr = (slice.match(/class="([^"]*)"/) || ["", ""])[1];
    const classes = classAttr
      .split(/\s+/)
      .filter((c) => KEEP_CLASS.has(c))
      .sort()
      .join(" ");
    pages.push({
      classes,
      texts: (slice.match(/bloom-translationGroup/g) || []).length,
      images: (slice.match(/<img\b/g) || []).length,
    });
  }
  return { pageSize, pageCount: pages.length, pages };
}

function convertToHtml(epubPath: string): string {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "epub-golden-"));
  execFileSync("node", [CLI, epubPath, "--output", out], { stdio: "pipe" });
  const bookDir = path.join(out, fs.readdirSync(out)[0]);
  const htm = fs.readdirSync(bookDir).find((f) => f.endsWith(".htm"));
  if (!htm) throw new Error(`no .htm produced for ${path.basename(epubPath)}`);
  return fs.readFileSync(path.join(bookDir, htm), "utf8");
}

describe("EPUB → Bloom structural goldens", () => {
  const haveCli = fs.existsSync(CLI);
  const present = fs.existsSync(CORPUS_DIR)
    ? CORPUS.filter((b) => fs.existsSync(path.join(CORPUS_DIR, b)))
    : [];

  if (!haveCli || present.length === 0) {
    it.skip(`skipped (need built CLI + corpus in large-local-test-inputs/) — cli:${haveCli} books:${present.length}`, () => {});
    return;
  }
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });

  for (const book of present) {
    it(`converts "${book}" to the expected Bloom structure`, () => {
      const fp = fingerprintHtml(convertToHtml(path.join(CORPUS_DIR, book)));
      const goldenPath = path.join(GOLDEN_DIR, book.replace(/\.epub$/i, "") + ".json");
      if (UPDATE || !fs.existsSync(goldenPath)) {
        fs.writeFileSync(goldenPath, JSON.stringify(fp, null, 2) + "\n");
        console.warn(`golden ${UPDATE ? "updated" : "created"}: ${path.basename(goldenPath)}`);
        return;
      }
      expect(fp).toEqual(JSON.parse(fs.readFileSync(goldenPath, "utf8")));
    });
  }
});
