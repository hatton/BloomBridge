import { describe, it, expect, beforeAll, afterAll } from "vite-plus/test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import sharp from "sharp";
import { hashPageImage } from "./pageImageHash";

describe("hashPageImage", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "pagehash-"));
    const solid = (r: number, g: number, b: number) =>
      sharp({ create: { width: 8, height: 8, channels: 3, background: { r, g, b } } }).png();
    await solid(255, 0, 0).toFile(path.join(dir, "red.png"));
    await solid(255, 0, 0).toFile(path.join(dir, "red-copy.png"));
    await solid(0, 0, 255).toFile(path.join(dir, "blue.png"));
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("is stable for identical pixels", async () => {
    const a = await hashPageImage(path.join(dir, "red.png"));
    const b = await hashPageImage(path.join(dir, "red-copy.png"));
    expect(a).toBe(b);
  });

  it("differs for different pixels", async () => {
    const red = await hashPageImage(path.join(dir, "red.png"));
    const blue = await hashPageImage(path.join(dir, "blue.png"));
    expect(red).not.toBe(blue);
  });
});
