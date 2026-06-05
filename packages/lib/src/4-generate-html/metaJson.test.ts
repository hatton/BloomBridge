import { describe, it, expect } from "vite-plus/test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { buildBookMetaData, writeAppearanceJson } from "./metaJson";
import type { Book } from "../types";

function makeBook(): Book {
  return {
    frontMatterMetadata: {
      languages: { en: "English", fr: "French" },
      l1: "en",
      l2: "fr",
    },
    pages: [
      {
        type: "front-matter",
        elements: [
          { type: "text", field: "bookTitle", content: { en: "The Cat", fr: "Le Chat" } },
          { type: "text", field: "author", content: { en: "Jane Doe" } },
          { type: "text", field: "license", content: { en: "CC-BY-NC-ND" } },
          { type: "text", field: "copyright", content: { en: "Copyright © 2025" } },
          { type: "text", field: "isbn", content: { "*": "978-1-23" } },
        ],
      },
      { type: "content", elements: [{ type: "text", content: { en: "page 1" } }] },
      { type: "content", elements: [{ type: "text", content: { en: "page 2" } }] },
      { type: "back-matter", elements: [] },
    ],
  };
}

describe("buildBookMetaData", () => {
  it("extracts title, author, license token, and counts content pages", () => {
    const meta = buildBookMetaData(makeBook());
    expect(meta.title).toBe("The Cat");
    expect(meta.originalTitle).toBe("The Cat");
    expect(meta.allTitles).toBe(JSON.stringify({ en: "The Cat", fr: "Le Chat" }));
    expect(meta.author).toBe("Jane Doe");
    expect(meta.license).toBe("cc-by-nc-nd"); // CC license -> lowercase token
    expect(meta.copyright).toBe("Copyright © 2025");
    expect(meta.isbn).toBe("978-1-23");
    expect(meta.pageCount).toBe(2); // only "content" pages
    expect(meta.formatVersion).toBe("2.1");
    expect(meta.suitableForMakingShells).toBe(false);
    expect(meta.bookInstanceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("preserves an existing bookInstanceId so it counts as an update, not a new book", () => {
    const existing = { bookInstanceId: "keep-this-id", customBloomField: 42 };
    const meta = buildBookMetaData(makeBook(), existing);
    expect(meta.bookInstanceId).toBe("keep-this-id");
    // Fields we don't model are carried through.
    expect(meta.customBloomField).toBe(42);
  });

  it("marks non-Creative-Commons licenses as custom", () => {
    const book = makeBook();
    (book.pages[0].elements[2] as any).content = { en: "All rights reserved" };
    expect(buildBookMetaData(book).license).toBe("custom");
  });
});

describe("writeAppearanceJson", () => {
  async function appearanceFor(book: Book): Promise<Record<string, unknown> | null> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "appearance-"));
    try {
      await writeAppearanceJson(dir, book);
      try {
        return JSON.parse(await fs.readFile(path.join(dir, "appearance.json"), "utf-8"));
      } catch {
        return null; // not written (ordinary bordered book)
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  it("sets fullBleed for a page flattened into a full-page image", async () => {
    const book: Book = {
      frontMatterMetadata: { languages: { en: "English" }, l1: "en" },
      pages: [
        { type: "content", flattenAsImage: "page-1.jpg", flattenLevel: "always", elements: [] },
      ],
    };
    const appearance = await appearanceFor(book);
    expect(appearance?.fullBleed).toBe(true);
  });

  it("does not write appearance.json for an ordinary bordered book", async () => {
    const book: Book = {
      frontMatterMetadata: { languages: { en: "English" }, l1: "en" },
      pages: [{ type: "content", elements: [{ type: "text", content: { en: "hi" } }] }],
    };
    expect(await appearanceFor(book)).toBeNull();
  });
});
