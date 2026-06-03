import { describe, it, expect, beforeAll, afterAll } from "vite-plus/test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import sharp from "sharp";
import { hashPageImage, hashesMatch, hashDistance } from "./pageImageHash";

/** A grayscale ramp PNG: increasing left→right, or decreasing if `reversed`. */
function rampBuffer(w: number, h: number, reversed: boolean): Buffer {
  const arr = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round(((reversed ? w - 1 - x : x) / (w - 1)) * 255);
      const i = (y * w + x) * 3;
      arr[i] = arr[i + 1] = arr[i + 2] = v;
    }
  }
  return Buffer.from(arr);
}

describe("pageImageHash", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "pagehash-"));
    const write = (name: string, reversed: boolean) =>
      sharp(rampBuffer(32, 32, reversed), { raw: { width: 32, height: 32, channels: 3 } })
        .png()
        .toFile(path.join(dir, name));
    await write("ramp.png", false);
    await write("ramp-copy.png", false);
    await write("ramp-reversed.png", true);
    // A re-encoded, downscaled copy of ramp.png to mimic a compressed PDF render.
    await sharp(path.join(dir, "ramp.png"))
      .resize(13)
      .jpeg({ quality: 25 })
      .toFile(path.join(dir, "ramp-degraded.jpg"));
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("perceptual hash is stable for the same image", async () => {
    const a = await hashPageImage(path.join(dir, "ramp.png"));
    const b = await hashPageImage(path.join(dir, "ramp-copy.png"));
    expect(a).toBe(b);
  });

  it("perceptual hash matches a re-compressed copy but not a different image", async () => {
    const orig = await hashPageImage(path.join(dir, "ramp.png"));
    const degraded = await hashPageImage(path.join(dir, "ramp-degraded.jpg"));
    const reversed = await hashPageImage(path.join(dir, "ramp-reversed.png"));

    expect(hashesMatch(orig, degraded)).toBe(true);
    expect(hashesMatch(orig, reversed)).toBe(false);
    expect(hashDistance(orig, reversed)).toBeGreaterThan(10);
  });

  it("hashesMatch respects the distance threshold (perceptual)", () => {
    const base = "0000000000000000";
    expect(hashesMatch(base, "0000000000000003")).toBe(true); // 2 bits
    expect(hashesMatch(base, "00000000000003ff")).toBe(true); // exactly 10 bits (threshold)
    expect(hashesMatch(base, "0000000000000fff")).toBe(false); // 12 bits
    expect(hashesMatch(base, "ffffffffffffffff")).toBe(false); // 64 bits
  });

  it("exact mode requires byte-identical pixels", async () => {
    const a = await hashPageImage(path.join(dir, "ramp.png"), "exact");
    const b = await hashPageImage(path.join(dir, "ramp-copy.png"), "exact");
    const r = await hashPageImage(path.join(dir, "ramp-reversed.png"), "exact");
    expect(a).toBe(b);
    expect(a).not.toBe(r);
    expect(hashesMatch(a, r, "exact")).toBe(false);
  });
});
