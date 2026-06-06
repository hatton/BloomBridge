import { describe, it, expect, afterAll } from "vite-plus/test";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as os from "os";
import * as path from "path";
import sharp from "sharp";
import { ExifTool } from "exiftool-vendored";
import type { Book } from "../types";
import { collectImageIntellectualProperty, writeImageMetadata } from "./imageMetadata";

function makeBook(overrides: Partial<Record<string, Record<string, string>>> = {}): Book {
  const fields: Record<string, Record<string, string>> = {
    illustrator: { en: "Jose Foo" },
    copyright: { en: "Copyright © 2025, ACME" },
    license: { en: "CC-BY-NC" },
    licenseNotes: { en: "Ask before translating" },
    ...overrides,
  };
  return {
    frontMatterMetadata: { languages: { en: "English" }, l1: "en" },
    pages: [
      {
        type: "front-matter",
        elements: Object.entries(fields).map(([field, content]) => ({
          type: "text" as const,
          field,
          content,
        })),
      },
    ],
  };
}

describe("collectImageIntellectualProperty", () => {
  it("maps illustrator/copyright/license-notes and resolves a CC license to a URL", () => {
    const ip = collectImageIntellectualProperty(makeBook());
    expect(ip.creator).toBe("Jose Foo");
    expect(ip.copyright).toBe("Copyright © 2025, ACME");
    expect(ip.rightsStatement).toBe("Ask before translating");
    expect(ip.licenseUrl).toBe("http://creativecommons.org/licenses/by-nc/4.0/");
  });

  it("uses a ready licenseUrl field when present", () => {
    const ip = collectImageIntellectualProperty(
      makeBook({
        license: {} as Record<string, string>,
        licenseUrl: { "*": "http://creativecommons.org/licenses/by/4.0/" },
      }),
    );
    expect(ip.licenseUrl).toBe("http://creativecommons.org/licenses/by/4.0/");
  });

  it("recovers the CC license URL from a prose licenseDescription (no token present)", () => {
    const ip = collectImageIntellectualProperty(
      makeBook({
        license: {} as Record<string, string>,
        licenseDescription: {
          en: "This work is licensed under the Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International License. To view a copy of this license, visit http://creativecommons.org/licenses/by-nc-nd/4.0/.",
        },
      }),
    );
    expect(ip.licenseUrl).toBe("http://creativecommons.org/licenses/by-nc-nd/4.0/");
  });

  it("does not set a license URL for a non-Creative-Commons license", () => {
    const ip = collectImageIntellectualProperty(
      makeBook({ license: { en: "All rights reserved" } }),
    );
    expect(ip.licenseUrl).toBeUndefined();
  });

  it("prefers the primary language", () => {
    const book = makeBook({ illustrator: { fr: "Pierre", en: "Peter" } });
    book.frontMatterMetadata.l1 = "fr";
    expect(collectImageIntellectualProperty(book).creator).toBe("Pierre");
  });
});

describe("writeImageMetadata (round-trip via exiftool)", () => {
  const tmp = path.join(os.tmpdir(), `bloombridge-imgmeta-${process.pid}`);

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("writes XMP tags Bloom reads, and leaves no _original backup", async () => {
    await fs.mkdir(tmp, { recursive: true });
    const img = path.join(tmp, "image-1-1.png");
    await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 100, b: 50 } },
    })
      .png()
      .toFile(img);

    await writeImageMetadata(tmp, makeBook());

    const exiftool = new ExifTool();
    try {
      const tags = (await exiftool.read(img)) as Record<string, unknown>;
      // Creator (the illustrator) is what makes Bloom attribute the artist.
      // dc:creator is an XMP list, so exiftool returns it as an array.
      expect([tags.Creator].flat()).toContain("Jose Foo");
      expect(String(tags.Rights)).toContain("ACME");
      expect(String(tags.License)).toBe("http://creativecommons.org/licenses/by-nc/4.0/");
    } finally {
      await exiftool.end();
    }

    // -overwrite_original must prevent a sibling backup file.
    expect(existsSync(`${img}_original`)).toBe(false);
  });
});
