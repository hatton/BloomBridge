import { describe, it, expect } from "vite-plus/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { intrinsicSize, imageSizeFromFile } from "./imageSize";

// A minimal but real JPEG header (SOF0) declaring w×h, so intrinsicSize can read it.
function jpeg(w: number, h: number): Buffer {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (h >> 8) & 0xff,
    h & 0xff,
    (w >> 8) & 0xff,
    w & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  ]);
}

// A minimal PNG header with IHDR width/height (the only bytes intrinsicSize reads).
function png(w: number, h: number): Buffer {
  const buf = Buffer.alloc(25);
  buf[0] = 0x89;
  buf[1] = 0x50; // "P"
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  return buf;
}

describe("intrinsicSize", () => {
  it("reads a JPEG SOF0 header", () => {
    expect(intrinsicSize(jpeg(640, 480))).toEqual({ w: 640, h: 480 });
  });
  it("reads a PNG IHDR header", () => {
    expect(intrinsicSize(png(300, 200))).toEqual({ w: 300, h: 200 });
  });
  it("returns null for unrecognised data", () => {
    expect(intrinsicSize(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeNull();
    expect(intrinsicSize(Buffer.alloc(0))).toBeNull();
  });
});

describe("imageSizeFromFile", () => {
  it("reads dimensions from a file on disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imgsize-"));
    const file = path.join(dir, "t.jpg");
    fs.writeFileSync(file, new Uint8Array(jpeg(800, 600)));
    expect(imageSizeFromFile(file)).toEqual({ w: 800, h: 600 });
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("returns null for a missing file", () => {
    expect(imageSizeFromFile(path.join(os.tmpdir(), "does-not-exist-xyz.jpg"))).toBeNull();
  });
});
