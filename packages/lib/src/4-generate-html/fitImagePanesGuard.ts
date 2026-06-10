import * as fs from "fs/promises";
import { logger } from "../logger";
import { extractBloomPageDivs } from "../master/masterPages";

/**
 * The safety net for the "fit image panes" feature (GUI path only — the CLI never runs
 * process-book). After a running Bloom processes a converted book, it bakes its own
 * overflow markers into the saved .htm. This reverts any page WE adjusted off 50/50
 * (`data-auto-split`) whose text Bloom then flagged as overflowing — putting that page
 * back to Bloom's safe default split. Pages we didn't adjust are never touched: overflow
 * that predates this feature is the user's to see, not ours to silently "fix".
 *
 * Bloom records overflow with these classes on the editable (or an ancestor); they
 * survive into the saved file until the next edit-page load. `pageOverflows` is NOT used
 * — Bloom suppresses it on Device16x9 layouts (BL-11949), and EPUB imports default to
 * Device16x9, so only the editable-level classes are reliable across page sizes.
 */
const OVERFLOW_CLASSES = ["overflow", "thisOverflowingParent", "childOverflowingThis"];

/** A page carries one of Bloom's overflow markers as a whole class token. */
function hasOverflowClass(pageHtml: string): boolean {
  return OVERFLOW_CLASSES.some((c) =>
    new RegExp(`class="[^"]*\\b${c}\\b[^"]*"`, "i").test(pageHtml),
  );
}

/** Our marker percent (`data-auto-split="N"`) if this page's splitter was auto-sized. */
function autoSplitPct(pageHtml: string): string | null {
  const m = pageHtml.match(/\bdata-auto-split=["'](\d+)["']/i);
  return m ? m[1] : null;
}

/**
 * Reset one adjusted, overflowing page: put its top-level split back to 50/50, drop
 * Bloom's overflow markers (so they don't re-trigger), and rename our marker to
 * `data-auto-split-reverted` so the page is left alone on any later pass.
 *
 * Auto-split pages are always a single horizontal (top/bottom) split — the page stack is
 * generated Portrait — so the split percentages are the only `%` values in the page (the
 * image's canvas-element rect is sized in px). That lets us reset every `bottom:`/`height:`
 * percentage to 50% without disturbing the image geometry.
 */
function revertPage(pageHtml: string): string {
  let out = pageHtml
    .replace(/bottom:\s*[\d.]+%/gi, "bottom: 50%")
    .replace(/height:\s*[\d.]+%/gi, "height: 50%");
  // Strip the overflow marker classes (whole tokens only) from every class attribute.
  out = out.replace(/class="([^"]*)"/gi, (_full, cls: string) => {
    const kept = cls
      .split(/\s+/)
      .filter((t) => t && !OVERFLOW_CLASSES.includes(t))
      .join(" ");
    return `class="${kept}"`;
  });
  // Keep the percent for the record, but stop treating the page as auto-split.
  out = out.replace(/\bdata-auto-split=/i, "data-auto-split-reverted=");
  return out;
}

/**
 * Revert every auto-split page in `htmPath` that Bloom flagged as overflowing, writing
 * the file back in place. Returns the number of pages reverted (0 if none, or if the
 * file couldn't be read). The caller (GUI server) reprocesses the book once more when
 * this is > 0 so Bloom re-lays-out the reset pages.
 */
export async function revertOverflowingAutoSplits(htmPath: string): Promise<number> {
  let html: string;
  try {
    html = await fs.readFile(htmPath, "utf-8");
  } catch (error) {
    logger.warn(`Fit image panes guard: could not read ${htmPath}: ${error}`);
    return 0;
  }

  const replacements: Array<{ start: number; end: number; html: string }> = [];
  for (const page of extractBloomPageDivs(html)) {
    if (autoSplitPct(page.html) === null) continue; // only pages we adjusted
    if (!hasOverflowClass(page.html)) continue; // and only if Bloom flagged overflow
    replacements.push({ start: page.start, end: page.end, html: revertPage(page.html) });
  }
  if (replacements.length === 0) return 0;

  let out = html;
  for (const r of replacements.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, r.start) + r.html + out.slice(r.end);
  }
  await fs.writeFile(htmPath, out, "utf-8");
  return replacements.length;
}
