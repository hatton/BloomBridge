import { describe, it, expect } from "vite-plus/test";
import { HtmlGenerator } from "./html-generator";
import { Book } from "../types";

describe("generateHtmlDocument", () => {
  it("should convert simple book to Bloom HTML", () => {
    const book: Book = {
      frontMatterMetadata: {
        languages: { en: "English" },
        l1: "en",
      },
      pages: [
        {
          type: "content" as const,
          appearsToBeBilingualPage: false,
          elements: [
            {
              type: "text" as const,
              field: "bookTitle",
              content: { en: "Title in English" },
            },
            {
              type: "text" as const,

              content: { en: "<p>Hello world</p>" },
            },
          ],
        },
      ],
    };

    const result = HtmlGenerator.generateHtmlDocument(book, () => {});

    expect(result).toContain("<!doctype html>");
    expect(result).toContain("<title>Title in English</title>");
    expect(result).toContain("Hello world");
    expect(result).toContain("bloom-editable");
  });

  it("forces a white cover background and preserves it from Bloom's random cover color", () => {
    const book: Book = {
      frontMatterMetadata: { languages: { en: "English" }, l1: "en" },
      pages: [
        {
          type: "front-matter" as const,
          elements: [
            { type: "text" as const, field: "bookTitle", content: { en: "T" } },
            { type: "image" as const, src: "cover.jpg" },
          ],
        },
      ],
    };

    const result = HtmlGenerator.generateHtmlDocument(book, () => {});

    expect(result).toContain("--cover-background-color: white");
    // Without this meta, Bloom's Book.InitCoverColor() assigns a random cover color
    // on load, overwriting our white. (Bug fix.)
    expect(result).toContain('<meta name="preserveCoverColor" content="true"');
  });

  it("does not force a white cover for a book without a full-page cover image", () => {
    const book: Book = {
      frontMatterMetadata: { languages: { en: "English" }, l1: "en" },
      pages: [
        {
          type: "content" as const,
          elements: [{ type: "text" as const, content: { en: "hi" } }],
        },
      ],
    };
    const result = HtmlGenerator.generateHtmlDocument(book, () => {});
    expect(result).not.toContain("preserveCoverColor");
  });

  it("applies a detected background color to a canvas page (no white border)", () => {
    const book: Book = {
      frontMatterMetadata: { languages: { en: "English" }, l1: "en", pageSize: "A4Portrait" },
      pages: [
        {
          type: "content" as const,
          backgroundColor: "#79d3f5",
          canvasTextBoxes: [{ x: 0.13, y: 0.07, w: 0.74, h: 0.86 }],
          elements: [
            { type: "image" as const, src: "image-6-1.png" },
            { type: "text" as const, content: { en: "You can use these questions" } },
          ],
        },
      ],
    };

    const result = HtmlGenerator.generateHtmlDocument(book, () => {});

    // The canvas page renders and carries the page background color via Bloom's
    // custom property so the page margin matches the full-bleed art.
    expect(result).toContain('data-tool-id="canvas"');
    expect(result).toContain("--page-background-color: #79d3f5");
  });

  it("renders a flattened (too-complex) page as a full-page image with a conversion note", () => {
    const book: Book = {
      frontMatterMetadata: { languages: { en: "English" }, l1: "en", pageSize: "A4Portrait" },
      pages: [
        {
          type: "content" as const,
          flattenAsImage: "page-6.jpg",
          flattenScore: 7,
          flattenLevel: "4",
          // Even though it still carries text + boxes, the flatten path wins.
          canvasTextBoxes: [{ x: 0.1, y: 0.1, w: 0.8, h: 0.1 }],
          elements: [{ type: "text" as const, content: { en: "You can use these questions" } }],
        },
      ],
    };

    const result = HtmlGenerator.generateHtmlDocument(book, () => {});

    expect(result).toContain('src="page-6.jpg"');
    expect(result).toContain("data-conversion-note=");
    expect(result).toContain("complex-page-flattened");
    expect(result).toContain("--complex-becomes-image off");
    // A flattened full-page image suppresses its page number (no number on the art).
    expect(result).toContain("--pageNumber-show: none;");
    // The questions text is NOT laid out as editable bubbles — the page is an image.
    expect(result).not.toContain("You can use these questions");
    // A numeric complexity level is NOT "always" mode → no xMatter suppression.
    expect(result).not.toContain('name="xmatter"');
  });

  it('suppresses xMatter in "always"-flatten mode', () => {
    const book: Book = {
      frontMatterMetadata: { languages: { en: "English" }, l1: "en" },
      pages: [
        {
          type: "content" as const,
          flattenAsImage: "page-1.jpg",
          flattenLevel: "always",
          elements: [],
        },
        {
          type: "content" as const,
          flattenAsImage: "page-2.jpg",
          flattenLevel: "always",
          elements: [],
        },
      ],
    };

    const result = HtmlGenerator.generateHtmlDocument(book, () => {});

    // Every page is a full-page image, so Bloom must add no front/back xMatter.
    expect(result).toContain('<meta name="xmatter" content="Null" />');
  });

  describe("multiple pages", () => {
    it("should generate HTML for multiple pages with different types", () => {
      const book = {
        frontMatterMetadata: {
          languages: { en: "English" },
          l1: "en",
        },
        pages: [
          {
            type: "front-matter" as const,
            appearsToBeBilingualPage: false,
            elements: [
              {
                type: "text" as const,
                field: "bookTitle",
                content: { en: "Title in English" },
              },
              {
                type: "text" as const,
                content: { en: "<p>Title Page</p>" },
              },
            ],
          },
          {
            type: "content" as const,
            appearsToBeBilingualPage: false,
            elements: [
              {
                type: "text" as const,
                content: { en: "<p>First content page</p>" },
              },
              {
                type: "image" as const,
                src: "image1.jpg",
              },
            ],
          },
          {
            type: "content" as const,
            appearsToBeBilingualPage: false,
            elements: [
              {
                type: "text" as const,
                content: { en: "<p>Second content page</p>" },
              },
            ],
          },
          {
            type: "back-matter" as const,
            appearsToBeBilingualPage: false,
            elements: [
              {
                type: "text" as const,
                content: { en: "<p>Back matter</p>" },
              },
            ],
          },
        ],
      };

      const html = HtmlGenerator.generateHtmlDocument(book);

      // Content pages are rendered.
      expect(html).toContain("First content page");
      expect(html).toContain("Second content page");
      expect(html).toContain("image1.jpg");

      // Front-matter and back-matter pages are NOT rendered as pages — their
      // metadata goes into the dataDiv and Bloom regenerates the xMatter pages.
      // (The bookTitle still appears, but in the dataDiv, not as a content page.)
      expect(html).not.toContain("<p>Title Page</p>");
      expect(html).not.toContain("Back matter");
      expect(html).not.toContain("bloom-frontMatter");
      expect(html).not.toContain("bloom-backMatter");
      expect(html).toContain('data-book="bookTitle"'); // title preserved as metadata

      // Only the two content pages are rendered (now carrying the default page-size class).
      const contentPageMatches = html.match(
        /class="bloom-page numberedPage customPage A5Portrait"/g,
      );
      expect(contentPageMatches).toHaveLength(2);
    });

    it("applies the detected font size/family to both normal-style and Bubble-style", () => {
      const book = {
        frontMatterMetadata: {
          languages: { en: "English" },
          l1: "en",
          normalFontSizePt: 18,
          normalFontFamily: "Andika",
        },
        pages: [
          {
            type: "content" as const,
            appearsToBeBilingualPage: false,
            elements: [{ type: "text" as const, content: { en: "<p>Hi</p>" } }],
          },
        ],
      };
      const html = HtmlGenerator.generateHtmlDocument(book);
      expect(html).toContain(".normal-style { font-size: 18pt !important; }");
      expect(html).toContain(".Bubble-style { font-size: 18pt !important; }");
      expect(html).toContain(
        '.Bubble-style[lang="en"] { font-size: 18pt !important; font-family: Andika !important; }',
      );
    });

    it("uses just the organization as copyright, stripping a 'Published by' prefix", () => {
      const book = {
        frontMatterMetadata: { languages: { en: "English" }, l1: "en" },
        pages: [
          {
            type: "back-matter" as const,
            appearsToBeBilingualPage: false,
            elements: [
              {
                type: "text" as const,
                field: "copyright",
                content: { en: "Published by Library For All Ltd" },
              },
            ],
          },
          {
            type: "content" as const,
            appearsToBeBilingualPage: false,
            elements: [{ type: "text" as const, content: { en: "<p>Story</p>" } }],
          },
        ],
      };

      const html = HtmlGenerator.generateHtmlDocument(book);
      expect(html).toContain('data-book="copyright" lang="en">Library For All Ltd<');
      expect(html).not.toContain("Published by Library For All Ltd");
    });

    it("drops a picture on the title page (Bloom does not support title-page images)", () => {
      const book = {
        frontMatterMetadata: { languages: { en: "English" }, l1: "en" },
        pages: [
          // Content page first (its image becomes the coverImage), mirroring thief
          // where page 1 is the cover — so the title image isn't used as a fallback cover.
          {
            type: "content" as const,
            appearsToBeBilingualPage: false,
            elements: [
              { type: "image" as const, src: "cover-art.png" },
              { type: "text" as const, content: { en: "<p>Story</p>" } },
            ],
          },
          // Title page with a picture — Bloom can't show a title-page image, so drop it.
          {
            type: "front-matter" as const,
            appearsToBeBilingualPage: false,
            elements: [
              { type: "text" as const, field: "bookTitle", content: { en: "My Title" } },
              { type: "image" as const, src: "title-pic.png" },
            ],
          },
        ],
      };

      const html = HtmlGenerator.generateHtmlDocument(book);
      // The title page (front-matter) is not rendered, so its picture is gone entirely.
      expect(html).not.toContain("title-pic.png");
      expect(html).toContain("Story");
    });

    it("should handle bilingual pages correctly", () => {
      const book: Book = {
        frontMatterMetadata: {
          languages: { en: "English", es: "Spanish" },
          l1: "en",
          l2: "es",
        },
        pages: [
          {
            type: "content" as const,
            appearsToBeBilingualPage: true,
            elements: [
              {
                type: "text" as const,
                field: "bookTitle",
                content: { en: "Title in English" },
              },
              {
                type: "text" as const,
                content: {
                  en: "<p>English text</p>",
                  es: "<p>Texto en español</p>",
                },
              },
            ],
          },
          {
            type: "content" as const,
            appearsToBeBilingualPage: true,
            elements: [
              {
                type: "text" as const,
                content: {
                  en: "<p>More English</p>",
                  es: "<p>Más español</p>",
                },
              },
            ],
          },
        ],
      };

      const html = HtmlGenerator.generateHtmlDocument(book);

      // Should contain both languages
      expect(html).toContain("English text");
      expect(html).toContain("Texto en español");
      expect(html).toContain("More English");
      expect(html).toContain("Más español");

      // Should include L2 in data div since more than half of pages are bilingual
      expect(html).toContain('data-book="contentLanguage2"');
      expect(html).toContain(">es</div>");
    });

    it("should handle Text-Image-Text bilingual pages with special translation groups", () => {
      const book: Book = {
        frontMatterMetadata: {
          languages: { en: "English", fr: "French" },
          l1: "en",
          l2: "fr",
        },
        pages: [
          {
            type: "content" as const,
            appearsToBeBilingualPage: true,
            elements: [
              {
                type: "text" as const,
                content: {
                  en: "<p>First text</p>",
                },
              },
              {
                type: "image" as const,
                src: "middle-image.jpg",
              },
              {
                type: "text" as const,
                content: {
                  en: "<p>Second text</p>",
                  fr: "<p>Deuxième texte</p>",
                },
              },
            ],
          },
        ],
      };

      const html = HtmlGenerator.generateHtmlDocument(book);

      expect(html).toContain("First text");
      expect(html).toContain("middle-image.jpg");
      expect(html).toContain("Second text");
      expect(html).toContain("Deuxième texte");

      // Should contain V and N1 translation group variables for T-I-T pattern
      expect(html).toContain('data-default-languages="V"');
      expect(html).toContain('data-default-languages="N1"');
    });

    it("should handle L2-only page with N1 translation group", () => {
      const book: Book = {
        frontMatterMetadata: {
          languages: { en: "English", fr: "French" },
          l1: "en",
          l2: "fr",
        },
        pages: [
          {
            type: "content" as const,
            appearsToBeBilingualPage: false,
            elements: [
              {
                type: "text" as const,
                content: {
                  fr: "<p>Seulement en français</p>",
                },
              },
            ],
          },
        ],
      };

      const html = HtmlGenerator.generateHtmlDocument(book);

      expect(html).toContain("Seulement en français");
      expect(html).toContain('data-default-languages="N1"');
    });

    it("should handle pages with mixed content types", () => {
      const book = {
        frontMatterMetadata: {
          languages: { en: "English" },
          l1: "en",
        },
        pages: [
          {
            type: "content" as const,
            appearsToBeBilingualPage: false,
            elements: [
              {
                type: "image" as const,
                src: "first-image.jpg",
              },
              {
                type: "text" as const,
                content: { en: "<p>Text after image</p>" },
              },
              {
                type: "image" as const,
                src: "second-image.jpg",
              },
            ],
          },
        ],
      };

      const html = HtmlGenerator.generateHtmlDocument(book);

      expect(html).toContain("first-image.jpg");
      expect(html).toContain("Text after image");
      expect(html).toContain("second-image.jpg");
    });

    it("should handle empty pages gracefully", () => {
      const book = {
        frontMatterMetadata: {
          languages: { en: "English" },
          l1: "en",
        },
        pages: [
          {
            type: "empty" as const,
            appearsToBeBilingualPage: false,
            elements: [],
          },
        ],
      };

      const html = HtmlGenerator.generateHtmlDocument(book);

      // Should still generate a page with an empty text block
      expect(html).toContain('class="bloom-page numberedPage customPage A5Portrait"');
      expect(html).toContain("marginBox");
    });
  });

  describe("generateBloomDataDiv", () => {
    it("should include L2 when more than half of pages are bilingual", () => {
      const book = {
        frontMatterMetadata: {
          languages: { en: "English", es: "Spanish" },
          l1: "en",
          l2: "es",
        },
        pages: [
          {
            type: "content" as const,
            appearsToBeBilingualPage: true,
            elements: [{ type: "text" as const, content: { en: "test", es: "prueba" } }],
          },
          {
            type: "content" as const,
            appearsToBeBilingualPage: true,
            elements: [
              {
                type: "text" as const,
                content: { en: "test2", es: "prueba2" },
              },
            ],
          },
          {
            type: "content" as const,
            appearsToBeBilingualPage: false,
            elements: [{ type: "text" as const, content: { en: "english only" } }],
          },
        ],
      };

      const html = HtmlGenerator.generateHtmlDocument(book);

      expect(html).toContain('data-book="contentLanguage1" lang="*">en</div>');
      expect(html).toContain('data-book="contentLanguage2" lang="*">es</div>');
    });

    it("should not include L2 when less than half of pages are bilingual", () => {
      const book = {
        frontMatterMetadata: {
          languages: { en: "English", es: "Spanish" },
          l1: "en",
          l2: "es",
        },
        pages: [
          {
            type: "content" as const,
            appearsToBeBilingualPage: true,
            elements: [{ type: "text" as const, content: { en: "test", es: "prueba" } }],
          },
          {
            type: "content" as const,
            appearsToBeBilingualPage: false,
            elements: [{ type: "text" as const, content: { en: "english only 1" } }],
          },
          {
            type: "content" as const,
            appearsToBeBilingualPage: false,
            elements: [{ type: "text" as const, content: { en: "english only 2" } }],
          },
        ],
      };

      const html = HtmlGenerator.generateHtmlDocument(book);

      expect(html).toContain('data-book="contentLanguage1" lang="*">en</div>');
      expect(html).not.toContain('data-book="contentLanguage2"');
    });

    it("should include all titles for multiple languages", () => {
      const book = {
        frontMatterMetadata: {
          languages: { en: "English", es: "Spanish", fr: "French" },
          l1: "en",
        },
        pages: [
          {
            type: "content" as const,
            appearsToBeBilingualPage: false,
            elements: [
              {
                type: "text" as const,
                field: "bookTitle",
                content: {
                  en: "Multi-Language Book",
                  es: "Libro Multi-Idioma",
                  fr: "Livre Multi-Langues",
                },
              },
            ],
          },
        ],
      };

      const html = HtmlGenerator.generateHtmlDocument(book);

      expect(html).toContain('data-book="bookTitle" lang="en">Multi-Language Book</div>');
      expect(html).toContain('data-book="bookTitle" lang="es">Libro Multi-Idioma</div>');
      expect(html).toContain('data-book="bookTitle" lang="fr">Livre Multi-Langues</div>');
    });

    it("should escape HTML characters in frontMatterMetadata", () => {
      const book = {
        frontMatterMetadata: {
          languages: { en: "English" },
          l1: "en",
        },
        pages: [
          // credits page with copyright
          {
            type: "content" as const,
            appearsToBeBilingualPage: false,
            elements: [
              {
                type: "text" as const,
                field: "bookTitle",
                content: { en: 'Book with <tags> & "quotes"' },
              },
              {
                type: "text" as const,
                field: "copyright",
                content: { en: 'Copyright © 2023 <Publisher> & "Authors"' },
              },
            ],
          },
        ],
      };

      const html = HtmlGenerator.generateHtmlDocument(book);

      expect(html).toContain("Book with &lt;tags&gt; &amp; &quot;quotes&quot;");
      expect(html).toContain("Copyright © 2023 &lt;Publisher&gt; &amp; &quot;Authors&quot;");

      expect(html).not.toContain("<Publisher>");
    });

    it("should handle missing optional fields gracefully", () => {
      const book = {
        frontMatterMetadata: {
          languages: { en: "English" },
          l1: "en",
          // No optional fields
        },
        pages: [
          {
            type: "content" as const,
            appearsToBeBilingualPage: false,
            elements: [
              {
                type: "text" as const,
                field: "bookTitle",
                content: { en: "Book Title" },
              },
            ],
          },
        ],
      };

      const html = HtmlGenerator.generateHtmlDocument(book);

      expect(html).toContain('<div id="bloomDataDiv">');
      expect(html).toContain('data-book="contentLanguage1"');
      expect(html).toContain('data-book="bookTitle"');
      expect(html).not.toContain('data-book="coverImage"');
      expect(html).not.toContain('data-book="ISBN"');
      expect(html).not.toContain('data-book="copyright"');
      expect(html).not.toContain('data-book="licenseUrl"');
    });

    it("should filter out pageNumber field elements", () => {
      const book: Book = {
        frontMatterMetadata: {
          languages: { en: "English" },
          l1: "en",
        },
        pages: [
          {
            type: "content" as const,
            appearsToBeBilingualPage: false,
            elements: [
              {
                type: "text" as const,
                content: { en: "This is regular content" },
              },
              {
                type: "text" as const,
                field: "pageNumber",
                content: { zxx: "1" },
              },
              {
                type: "text" as const,
                field: "bookTitle",
                content: { en: "My Book Title" },
              },
              {
                type: "text" as const,
                field: "pageNumber",
                content: { zxx: "2" },
              },
            ],
          },
        ],
      };

      const html = HtmlGenerator.generateHtmlDocument(book);

      // Should contain regular content and metadata fields
      expect(html).toContain("This is regular content");
      expect(html).toContain('data-book="bookTitle"');
      expect(html).toContain("My Book Title");

      // Should NOT contain page numbers in the content or metadata
      expect(html).not.toContain('data-book="pageNumber"');
      // Check that page numbers aren't rendered as standalone content
      expect(html).not.toContain('lang="zxx">1');
      expect(html).not.toContain('lang="zxx">2');
    });

    it("should concatenate multiple fields that map to the same output field", () => {
      const book: Book = {
        frontMatterMetadata: {
          languages: { en: "English" },
          l1: "en",
        },
        pages: [
          {
            type: "content" as const,
            appearsToBeBilingualPage: false,
            elements: [
              {
                type: "text" as const,
                field: "bookTitle",
                content: { en: "Test Book" },
              },
              {
                type: "text" as const,
                field: "credits",
                content: { en: "Written by Jane Doe" },
              },
              {
                type: "text" as const,
                field: "author",
                content: { en: "John Smith" },
              },
              {
                type: "text" as const,
                field: "illustrator",
                content: { en: "Alice Brown" },
              },
              {
                type: "text" as const,
                field: "publisher",
                content: { en: "Test Publishing" },
              },
              {
                type: "text" as const,
                field: "isbn",
                content: { en: "978-1234567890" },
              },
            ],
          },
        ],
      };

      const result = HtmlGenerator.generateHtmlDocument(book);

      // Should have one originalAcknowledgments div with concatenated content
      const originalAckMatches = result.match(/data-book="originalAcknowledgments"/g);
      expect(originalAckMatches).toHaveLength(1);

      // Should have one ISBN div
      const isbnMatches = result.match(/data-book="ISBN"/g);
      expect(isbnMatches).toHaveLength(1);

      // Check that the concatenated content includes all mapped fields with <br> separators
      expect(result).toContain('data-book="originalAcknowledgments"');
      expect(result).toContain(
        "Written by Jane Doe<br>John Smith<br>Alice Brown<br>Test Publishing",
      );

      // Check that ISBN field is separate
      expect(result).toContain('data-book="ISBN"');
      expect(result).toContain("978-1234567890");
    });
  });
});
