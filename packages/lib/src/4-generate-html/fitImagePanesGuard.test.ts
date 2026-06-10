import { describe, it, expect } from "vite-plus/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { revertOverflowingAutoSplits } from "./fitImagePanesGuard";

/** A single horizontal-split page. `attrs` go on the bloom-page div; `editableClass`
 *  is the class on the inner editable (where Bloom would stamp an overflow marker). */
function page(opts: { attrs: string; imagePct: number; editableClass?: string }): string {
  const B = 100 - opts.imagePct; // text (bottom) pane share
  const ec = opts.editableClass ?? "bloom-editable normal-style";
  return `    <div class="bloom-page numberedPage customPage A5Portrait" id="pg"${opts.attrs}>
      <div class="marginBox">
        <div class="split-pane horizontal-percent">
          <div class="split-pane-component position-top" style="bottom: ${B}%">
            <div class="split-pane-component-inner">
              <div class="bloom-canvas-element bloom-backgroundImage" style="width: 468px; height: ${600}px; left: 0px; top: 0px;"></div>
            </div>
          </div>
          <div class="split-pane-divider horizontal-divider" style="bottom: ${B}%"></div>
          <div class="split-pane-component position-bottom" style="height: ${B}%">
            <div class="split-pane-component-inner">
              <div class="bloom-translationGroup">
                <div class="${ec}" lang="en"><p>hi</p></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function doc(...pages: string[]): string {
  return `<!doctype html><html><head></head><body>\n${pages.join("\n")}\n</body></html>`;
}

async function runOn(html: string): Promise<{ count: number; out: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fitguard-"));
  const file = path.join(dir, "book.htm");
  fs.writeFileSync(file, html);
  const count = await revertOverflowingAutoSplits(file);
  const out = fs.readFileSync(file, "utf-8");
  fs.rmSync(dir, { recursive: true, force: true });
  return { count, out };
}

describe("revertOverflowingAutoSplits", () => {
  it("reverts an adjusted page whose editable overflowed", async () => {
    const html = doc(
      page({
        attrs: ' data-auto-split="70"',
        imagePct: 70,
        editableClass: "bloom-editable normal-style overflow",
      }),
    );
    const { count, out } = await runOn(html);
    expect(count).toBe(1);
    // Split reset to 50/50.
    expect(out).toContain('style="bottom: 50%"');
    expect(out).toContain('style="height: 50%"');
    expect(out).not.toContain("30%");
    // Marker renamed; overflow class dropped.
    expect(out).toContain('data-auto-split-reverted="70"');
    expect(out).not.toMatch(/\bdata-auto-split="70"/);
    expect(out).not.toMatch(/\boverflow\b/);
    // The image rect (px) is untouched.
    expect(out).toContain("height: 600px");
  });

  it("leaves an adjusted but non-overflowing page alone", async () => {
    const html = doc(page({ attrs: ' data-auto-split="70"', imagePct: 70 }));
    const { count, out } = await runOn(html);
    expect(count).toBe(0);
    expect(out).toContain('data-auto-split="70"');
    expect(out).toContain('style="bottom: 30%"');
  });

  it("never touches an unadjusted page even if it overflows", async () => {
    const html = doc(
      page({ attrs: "", imagePct: 50, editableClass: "bloom-editable normal-style overflow" }),
    );
    const { count, out } = await runOn(html);
    expect(count).toBe(0);
    // Pre-existing overflow that we didn't cause is preserved (the user should see it).
    expect(out).toMatch(/\boverflow\b/);
  });

  it("recognises thisOverflowingParent / childOverflowingThis markers", async () => {
    for (const cls of ["thisOverflowingParent", "childOverflowingThis"]) {
      const html = doc(
        page({
          attrs: ' data-auto-split="65"',
          imagePct: 65,
          editableClass: `bloom-editable ${cls}`,
        }),
      );
      const { count } = await runOn(html);
      expect(count).toBe(1);
    }
  });

  it("reverts only the overflowing adjusted page among several", async () => {
    const html = doc(
      page({ attrs: ' data-auto-split="70"', imagePct: 70 }), // clean adjusted
      page({
        attrs: ' data-auto-split="68"',
        imagePct: 68,
        editableClass: "bloom-editable overflow",
      }), // overflowing adjusted
      page({ attrs: "", imagePct: 50 }), // not adjusted
    );
    const { count, out } = await runOn(html);
    expect(count).toBe(1);
    expect(out).toContain('data-auto-split="70"'); // clean one kept
    expect(out).toContain('data-auto-split-reverted="68"'); // overflowing one reverted
  });
});
