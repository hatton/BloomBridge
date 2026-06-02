import { describe, it, expect } from "vite-plus/test";
import { getMarkdownFromBook } from "./generateMarkdown";
import { BloomMarkdown } from "./parseMarkdown";
import { Book, Page, TextBlockElement, ImageElement } from "../types";
import { normalizeMarkdown } from "../test-utils";

describe("generateMarkdown", () => {
  describe("getMarkdownFromBook", () => {
    it("should generate basic markdown with frontmatter", () => {
      const book: Book = {
        frontMatterMetadata: {
          languages: { en: "English" },
          l1: "en",
        },
        pages: [],
      };

      const result = getMarkdownFromBook(book);

      expect(result).toContain("---");
      expect(result).toContain('l1: "en"');
      expect(result).toContain("languages:");
      expect(result).toContain('  en: "English"');
    });

    it("should handle complex metadata structures", () => {
      const book: Book = {
        frontMatterMetadata: {
          languages: {
            en: "English",
            fr: "French",
          },
          l1: "en",
          l2: "fr",
        },
        pages: [],
      };

      const result = getMarkdownFromBook(book);

      expect(result).toContain("languages:");
      expect(result).toContain('  en: "English"');
      expect(result).toContain('  fr: "French"');
      expect(result).toContain('l1: "en"');
      expect(result).toContain('l2: "fr"');
    });

    it("should generate page content with text elements", () => {
      const textElement: TextBlockElement = {
        type: "text",
        content: {
          en: "<p>Hello world</p>",
        },
      };

      const page: Page = {
        type: "content",
        appearsToBeBilingualPage: false,
        elements: [textElement],
      };

      const book: Book = {
        frontMatterMetadata: {
          languages: { en: "English" },
          l1: "en",
        },
        pages: [page],
      };

      const result = getMarkdownFromBook(book);

      expect(result).toContain('<!-- page index=1 type="content" -->');
      expect(result).toContain('<!-- text lang="en" -->');
      expect(result).toContain("Hello world");
    });

    it("should handle bilingual pages", () => {
      const textElement: TextBlockElement = {
        type: "text",
        content: {
          en: "<p>Hello world</p>",
          es: "<p>Hola mundo</p>",
        },
      };

      const page: Page = {
        type: "content",
        appearsToBeBilingualPage: true,
        elements: [textElement],
      };

      const book: Book = {
        frontMatterMetadata: {
          languages: { en: "English", es: "Spanish" },
          l1: "en",
          l2: "es",
        },
        pages: [page],
      };

      const result = getMarkdownFromBook(book);

      expect(result).toContain('bilingual="true"');
      expect(result).toContain('<!-- text lang="en" -->');
      expect(result).toContain('<!-- text lang="es" -->');
      expect(result).toContain("Hello world");
      expect(result).toContain("Hola mundo");
    });

    it("should handle image elements", () => {
      const imageElement: ImageElement = {
        type: "image",
        src: "test-image.jpg",
      };

      const page: Page = {
        type: "content",
        appearsToBeBilingualPage: false,
        elements: [imageElement],
      };

      const book: Book = {
        frontMatterMetadata: {
          languages: { en: "English" },
          l1: "en",
        },
        pages: [page],
      };

      const result = getMarkdownFromBook(book);

      expect(result).toContain("![](test-image.jpg)");
    });

    it("should handle image elements with attributes", () => {
      const imageElement: ImageElement = {
        type: "image",
        src: "img-0.jpeg",
        attributes: "{width=993}",
      };

      const page: Page = {
        type: "content",
        appearsToBeBilingualPage: false,
        elements: [imageElement],
      };

      const book: Book = {
        frontMatterMetadata: {
          languages: { en: "English" },
          l1: "en",
        },
        pages: [page],
      };

      const result = getMarkdownFromBook(book);

      expect(result).toContain("![](img-0.jpeg){width=993}");
    });

    it("should handle mixed content (text and images)", () => {
      const textElement: TextBlockElement = {
        type: "text",
        content: {
          en: "<p>Text before image</p>",
        },
      };

      const imageElement: ImageElement = {
        type: "image",
        src: "middle-image.jpg",
      };

      const textElement2: TextBlockElement = {
        type: "text",
        content: {
          en: "<p>Text after image</p>",
        },
      };

      const page: Page = {
        type: "content",
        appearsToBeBilingualPage: false,
        elements: [textElement, imageElement, textElement2],
      };

      const book: Book = {
        frontMatterMetadata: {
          languages: { en: "English" },
          l1: "en",
        },
        pages: [page],
      };

      const result = getMarkdownFromBook(book);

      expect(result).toContain("Text before image");
      expect(result).toContain("![](middle-image.jpg)");
      expect(result).toContain("Text after image");
    });

    it("should handle different page types", () => {
      const page: Page = {
        type: "front-matter",
        appearsToBeBilingualPage: false,
        elements: [],
      };

      const book: Book = {
        frontMatterMetadata: {
          languages: { en: "English" },
          l1: "en",
        },
        pages: [page],
      };

      const result = getMarkdownFromBook(book);

      expect(result).toContain('type="front-matter"');
    });

    it("should handle empty pages gracefully", () => {
      const page: Page = {
        type: "empty",
        appearsToBeBilingualPage: false,
        elements: [],
      };

      const book: Book = {
        frontMatterMetadata: {
          languages: { en: "English" },
          l1: "en",
        },
        pages: [page],
      };

      const result = getMarkdownFromBook(book);

      expect(result).toContain('<!-- page index=1 type="empty" -->');
    });

    it("should preserve image attributes in round-trip parsing", () => {
      // Test that we can parse markdown with image attributes and regenerate the same attributes
      const markdown = `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
l1: "en"
---
![img-0.jpeg](img-0.jpeg){width=993}
<!-- text lang="en" -->
Some text content`; // Parse the markdown
      const parser = new BloomMarkdown();
      const book = parser.parseMarkdown(markdown); // Verify the parsed image has attributes
      const imageElement = book.pages[0].elements[0] as ImageElement;
      expect(imageElement.type).toBe("image");
      expect(imageElement.src).toBe("img-0.jpeg");
      expect(imageElement.attributes).toBe("{width=993}");

      // Generate markdown again and verify attributes are preserved
      const regeneratedMarkdown = getMarkdownFromBook(book);
      expect(regeneratedMarkdown).toContain("![img-0.jpeg](img-0.jpeg){width=993}");
    });
  });

  it("another round-trip", () => {
    const input = `---
allTitles:
  fr: "La lune et la casquette"
  en: "The Moon and the Cap"
languages:
  fr: "française"
  en: "English"
l1: "fr"
l2: "en"
coverImage: "img-0.jpeg"
license: "CC-BY-4.0"
copyright: "Copyright (c) 2007, Pratham Books"
credits:
  author: "Noni"
  illustrator: "Angie & Upesh"
tags:
  topic: "Folktale"
publisher: "Pratham Books"
country: "France"
---
<!-- page index=1 -->
<!-- text lang="fr" field="title" -->
# La lune et la casquette 

<!-- text lang="en" field="title" -->
The Moon and the Cap

<!-- text lang="en" field="coverImage" -->
![img-0.jpeg](img-0.jpeg){width=993}

<!-- text lang="fr" field="author" -->
Auteur: Noni

<!-- text lang="fr" field="illustrator" -->
Illustration : Angie & Upesh

<!-- text lang="fr" field="tags" -->
française
Livre de récits

<!-- page index=2 -->
.

<!-- page index=3 -->
<!-- text lang="fr" field="title" -->
# La lune et la casquette 

<!-- text lang="en" field="title" -->
## The Moon and the Cap

<!-- text lang="en" field="credits" -->
Written by Noni Illustrations by Angie and Upesh

<!-- text lang="en" field="funding-info" -->
Funded the Corporation for Nationl Broadcasting

<!-- text lang="fr" field="tags" -->
française

<!-- text lang="fr" field="country" -->
France`;

    const parser = new BloomMarkdown();
    const book = parser.parseMarkdown(input);
    expect(book.pages.length).toBe(3); // notice that page 2 has only a dot (saw this is a real llm output)
  });

  it("should preserve fields in round-trip parsing", () => {
    // Test that we can parse markdown with image attributes and regenerate the same attributes
    const input = `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
l1: "en"
---

<!-- page index=1 type="front-matter" -->

<!-- text lang="en" field="acknowledgments" -->
first acknowledgment

<!-- text lang="fr" field="copyright" -->
Some copyright text

<!-- text lang="en" field="acknowledgments" -->
Some other acknowledgment

<!-- text lang="en" field="license" -->
Some license text

<!-- text lang="fr" field="acknowledgments" -->
Some french acknowledgment`;

    const parser = new BloomMarkdown();
    const book = parser.parseMarkdown(input);
    expect(book.pages.length).toBe(1);
    expect(book.pages[0].appearsToBeBilingualPage).toBe(undefined);
    expect((book.pages[0].elements[0] as TextBlockElement).field).toBe("acknowledgments");
    expect((book.pages[0].elements[1] as TextBlockElement).field).toBe("copyright");
    const output = getMarkdownFromBook(book);

    expect(normalizeMarkdown(output)).toEqual(normalizeMarkdown(input));
  });
});
