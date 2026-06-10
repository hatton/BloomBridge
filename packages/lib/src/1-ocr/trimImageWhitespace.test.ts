import { describe, it, expect, beforeAll, afterAll } from "vite-plus/test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import sharp from "sharp";
import { trimWhitespaceInBookFolder } from "./trimImageWhitespace";

/**
 * A red square centered inside a white canvas — i.e. artwork with a wide white
 * margin, the exact shape this feature exists to crop. `inner` is the red box
 * side; the surrounding white border is `(size - inner) / 2` on each edge.
 */
async function whiteBordered(file: string, size: number, inner: number): Promise<void> {
  const pad = Math.round((size - inner) / 2);
  const red = await sharp({
    create: { width: inner, height: inner, channels: 3, background: { r: 220, g: 20, b: 20 } },
  })
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: red, top: pad, left: pad }])
    .toFile(file);
}

async function size(file: string): Promise<{ w: number; h: number }> {
  const m = await sharp(file).metadata();
  return { w: m.width!, h: m.height! };
}

describe("trimWhitespaceInBookFolder", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "trimws-"));
    // An illustration with a white margin — should be cropped to the red box.
    await whiteBordered(path.join(dir, "image-3-1.png"), 200, 80);
    // Reserved / excluded names that carry the same margin but must be left alone.
    await whiteBordered(path.join(dir, "cover.jpg"), 200, 80);
    await whiteBordered(path.join(dir, "back-cover.jpg"), 200, 80);
    await whiteBordered(path.join(dir, "page-5.jpg"), 200, 80);
    await whiteBordered(path.join(dir, "i-2.jpg"), 200, 80);
    // A non-image file must be ignored entirely.
    await fs.writeFile(path.join(dir, "notes.txt"), "hello");
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("crops the white margin off an illustration down to its artwork", async () => {
    const result = await trimWhitespaceInBookFolder(dir);
    const trimmed = await size(path.join(dir, "image-3-1.png"));
    // The 80px red box (±1px of trim slack) remains; the margin is gone.
    expect(trimmed.w).toBeLessThanOrEqual(82);
    expect(trimmed.w).toBeGreaterThanOrEqual(78);
    expect(trimmed.h).toBeLessThanOrEqual(82);
    expect(trimmed.h).toBeGreaterThanOrEqual(78);
    expect(result.trimmed).toBe(1);
  });

  it("leaves covers, per-page snapshots, and decorative icons untouched", async () => {
    for (const name of ["cover.jpg", "back-cover.jpg", "page-5.jpg", "i-2.jpg"]) {
      const s = await size(path.join(dir, name));
      expect(s).toEqual({ w: 200, h: 200 });
    }
  });
});
