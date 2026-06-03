import { describe, it, expect } from "vite-plus/test";
import { BloomMarkdown } from "./parseMarkdown";
import type { TextBlockElement, ImageElement } from "../types";

describe("parse", () => {
  it("should parse valid frontmatter", () => {
    const content = `---
allTitles:
  en: "Test Book"
  es: "Libro de Prueba"
languages:
  en: "English"
  es: "Español"
l1: en
l2: es
---
<!-- text lang="en" -->
Hello world
<!-- text lang="es" -->
Hola mundo`;
    const parser = new BloomMarkdown();
    const result = parser.parseMarkdown(content);

    expect(result.frontMatterMetadata.l1).toBe("en");
    expect(result.frontMatterMetadata.l2).toBe("es");
    expect(result.pages).toHaveLength(1);
    expect((result.pages[0].elements[0] as TextBlockElement).content.en).toBe("Hello world");
    expect((result.pages[0].elements[0] as TextBlockElement).content.es).toBe("Hola mundo");
  });

  it("should parse import-source-hash and master-page from the page comment", () => {
    const content = `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
l1: en
---
<!-- page index=1 import-source-hash="deadbeef" -->
<!-- text lang="en" -->
A normal page
<!-- page index=2 import-source-hash="cafef00d" master-page="true" -->
_(page provided by master book)_`;
    const parser = new BloomMarkdown();
    const result = parser.parseMarkdown(content);

    expect(result.pages[0].importSourceHash).toBe("deadbeef");
    expect(result.pages[0].isMasterPage).toBeUndefined();
    expect(result.pages[1].importSourceHash).toBe("cafef00d");
    expect(result.pages[1].isMasterPage).toBe(true);
  });

  it("round-trips import-source-hash and master-page through addBloomPlanToMarkdown", async () => {
    const { addBloomPlanToMarkdown } = await import("../3-add-bloom-plan/addBloomPlan");
    const content = `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
l1: en
---
<!-- page index=1 import-source-hash="deadbeef" -->
<!-- text lang="en" -->
A normal page
<!-- page index=2 import-source-hash="cafef00d" master-page="true" -->
_(page provided by master book)_`;
    const planned = addBloomPlanToMarkdown(content);
    expect(planned).toContain('import-source-hash="deadbeef"');
    expect(planned).toContain('import-source-hash="cafef00d"');
    expect(planned).toContain('master-page="true"');
  });

  it("should detect page layouts correctly", () => {
    const content = `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
l1: en
---
![Test Image](test-image.png)
<!-- text lang="en" -->
Text after image
<!-- page -->
<!-- text lang="en" -->
Text before image
![Test Image](test-image.png)
<!-- page -->
<!-- text lang="en" -->
Text only page`;
    const parser = new BloomMarkdown();
    const result = parser.parseMarkdown(content);

    expect(result.pages).toHaveLength(3);
    // Note: layout field has been removed from Page interface
    // expect(result.pages[0].layout).toBe("image-top-text-bottom");
    // expect(result.pages[1].layout).toBe("text-image");
    // expect(result.pages[2].layout).toBe("text-only");
  });

  // todo this should be in its own test file
  //   it("should convert markdown formatting to HTML", () => {
  //     const content = `---
  // allTitles:
  //   en: "Test Book"
  // languages:
  //   en: "English"
  // l1: en
  // ---
  // <!-- text lang="en" -->
  // This is **bold** text and *italic* text.
  // Here's a [link](https://example.com).
  // Line one
  // Line two`;
  //     const parser = new BloomMarkdown();
  //     const result = parser.parseMarkdown(content);

  //     const htmlText = (result.pages[0].elements[0] as TextBlockElement).content
  //       .en;
  //     expect(htmlText).toContain("<strong>bold</strong>");
  //     expect(htmlText).toContain("<em>italic</em>");
  //     expect(htmlText).toContain('<a href="https://example.com">link</a>');
  //     expect(htmlText).toContain("<p>");
  //   });

  it("should use preserve line breaks in multi-line texts", () => {
    const content = `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
l1: en
---
<!-- text lang="en" -->
Line one
Line two`;
    const parser = new BloomMarkdown();
    const result = parser.parseMarkdown(content);

    const text = (result.pages[0].elements[0] as TextBlockElement).content.en;
    expect(text).toContain("Line one\nLine two");
  });

  it("should integrate metadata parsing with page parsing", () => {
    const content = `---
allTitles:
  en: "Test Book"
# Missing languages and l1
---
<!-- text lang="en" -->
Test content`;

    const parser = new BloomMarkdown();
    expect(() => parser.parseMarkdown(content)).toThrow("Validation failed");
  });

  it("should handle images without file validation", () => {
    const content = `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
l1: en
---
![Test Image](nonexistent-image.png)
<!-- text lang="en" -->
Text with image that doesn't exist on disk`;

    const parser = new BloomMarkdown();
    const result = parser.parseMarkdown(content);

    expect(result.pages).toHaveLength(1);
    // Note: layout field has been removed from Page interface
    // expect(result.pages[0].layout).toBe("image-top-text-bottom");
    expect((result.pages[0].elements[0] as ImageElement).src).toBe("nonexistent-image.png");
    expect((result.pages[0].elements[1] as TextBlockElement).content.en).toBe(
      "Text with image that doesn't exist on disk",
    );
    expect(result.pages[0]).toBeDefined();
  });

  it("should handle multiple languages correctly", () => {
    const content = `---
allTitles:
  en: "Test Book"
  fr: "Livre de Test"
  es: "Libro de Prueba"
languages:
  en: "English"
  fr: "French"
  es: "Spanish"
l1: en
l2: fr
---
<!-- text lang="en" -->
English text
<!-- text lang="fr" -->
French text
<!-- text lang=es -->
Spanish text`;

    const parser = new BloomMarkdown();
    const result = parser.parseMarkdown(content);

    expect(result.pages).toHaveLength(1);
    expect((result.pages[0].elements[0] as TextBlockElement).content.en).toBe("English text");
    expect((result.pages[0].elements[0] as TextBlockElement).content.fr).toBe("French text");
    expect((result.pages[0].elements[0] as TextBlockElement).content.es).toBe("Spanish text");
    expect(Object.keys((result.pages[0].elements[0] as TextBlockElement).content)).toHaveLength(3);
  });

  it("should handle empty pages correctly", () => {
    const content = `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
l1: en
---
<!-- page -->
<!-- text lang="en" -->
First page
<!-- page -->
<!-- Empty page with no content -->
<!-- page -->
<!-- text lang="en" -->
Third page`;

    const parser = new BloomMarkdown();
    const result = parser.parseMarkdown(content);

    // Empty pages should be filtered out
    expect(result.pages).toHaveLength(2);
    expect((result.pages[0].elements[0] as TextBlockElement).content.en).toBe("First page");
    expect((result.pages[1].elements[0] as TextBlockElement).content.en).toBe("Third page");
  });

  it("should handle pages with attributes correctly", () => {
    const content = `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
  es: "Español"
l1: en
l2: es
---
<!-- page type="cover" bilingual="true" -->
<!-- text lang="en" -->
Cover title in English
<!-- text lang="es" -->
Cover title in Spanish
<!-- page type="content" -->
<!-- text lang="en" -->
Regular content page
<!-- page bilingual="false" -->
<!-- text lang="en" -->
Monolingual page
<!-- page type="back-matter" bilingual="true" -->
<!-- text lang="en" -->
Back matter English
<!-- text lang="es" -->
Back matter Spanish`;

    const parser = new BloomMarkdown();
    const result = parser.parseMarkdown(content);

    expect(result.pages).toHaveLength(4);

    // First page: cover with bilingual content
    expect(result.pages[0].type).toBe("cover");
    expect(result.pages[0].appearsToBeBilingualPage).toBe(true);
    expect((result.pages[0].elements[0] as TextBlockElement).content.en).toBe(
      "Cover title in English",
    );
    expect((result.pages[0].elements[0] as TextBlockElement).content.es).toBe(
      "Cover title in Spanish",
    );

    // Second page: content type (default bilingual based on content)
    expect(result.pages[1].type).toBe("content");
    expect(!!result.pages[1].appearsToBeBilingualPage).toBe(false);
    expect((result.pages[1].elements[0] as TextBlockElement).content.en).toBe(
      "Regular content page",
    );

    // Third page: explicitly not bilingual
    expect(result.pages[2].type).toBe("content"); // Default type
    expect(result.pages[2].appearsToBeBilingualPage).toBe(false);
    expect((result.pages[2].elements[0] as TextBlockElement).content.en).toBe("Monolingual page");

    // Fourth page: back-matter with bilingual content
    expect(result.pages[3].type).toBe("back-matter");
    expect(result.pages[3].appearsToBeBilingualPage).toBe(true);
    expect((result.pages[3].elements[0] as TextBlockElement).content.en).toBe(
      "Back matter English",
    );
    expect((result.pages[3].elements[0] as TextBlockElement).content.es).toBe(
      "Back matter Spanish",
    );
  });

  it("should handle mixed attribute and non-attribute pages", () => {
    const content = `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
l1: en
---
<!-- page -->
<!-- text lang="en" -->
Page without attributes
<!-- page type="front-matter" -->
<!-- text lang="en" -->
Page with type only
<!-- page bilingual="true" -->
<!-- text lang="en" -->
Page with bilingual only
<!-- page type="content" bilingual="false" -->
<!-- text lang="en" -->
Page with both attributes`;

    const parser = new BloomMarkdown();
    const result = parser.parseMarkdown(content);

    expect(result.pages).toHaveLength(4);

    // Page 1: no attributes
    expect(result.pages[0].type).toBe("content");
    expect(result.pages[0].appearsToBeBilingualPage).toBeFalsy();

    // Page 2: type attribute only
    expect(result.pages[1].type).toBe("front-matter");
    expect(result.pages[1].appearsToBeBilingualPage).toBeFalsy();

    // Page 3: bilingual attribute only
    expect(result.pages[2].type).toBe("content");
    expect(result.pages[2].appearsToBeBilingualPage).toBe(true);

    // Page 4: both attributes
    expect(result.pages[3].type).toBe("content");
    expect(result.pages[3].appearsToBeBilingualPage).toBeFalsy();
  });

  it("should handle various page comment formats with attributes", () => {
    const content = `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
l1: en
---
<!-- page type="cover" -->
<!-- text lang="en" -->
Quoted type attribute
<!--page type=content bilingual=true-->
<!-- text lang="en" -->
No spaces, no quotes
<!--  page   type="front-matter"   bilingual="false"  -->
<!-- text lang="en" -->
Extra spaces
<!-- page bilingual='true' type='back-matter' -->
<!-- text lang="en" -->
Single quotes and different order`;

    const parser = new BloomMarkdown();
    const result = parser.parseMarkdown(content);

    expect(result.pages).toHaveLength(4);

    // Test various formatting styles are parsed correctly
    expect(result.pages[0].type).toBe("cover");
    expect(!!result.pages[0].appearsToBeBilingualPage).toBe(false);

    expect(result.pages[1].type).toBe("content");
    expect(result.pages[1].appearsToBeBilingualPage).toBe(true);

    expect(result.pages[2].type).toBe("front-matter");
    expect(!!result.pages[2].appearsToBeBilingualPage).toBe(false);

    expect(result.pages[3].type).toBe("back-matter");
    expect(result.pages[3].appearsToBeBilingualPage).toBe(true);
  });

  it("should handle multiple fields well", () => {
    // Test that we can parse markdown with image attributes and regenerate the same attributes
    const input = `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
l1: "en"
---

<!-- page index=1 type="front-matter" -->
<!-- text lang="en" field="copyright" -->
Some copyright text
<!-- text lang="fr" field="license" -->
French license text
<!-- text lang="en" field="acknowledgments" -->
English acknowledgment
<!-- text lang="fr" field="acknowledgments" -->
French acknowledgment

`;

    const parser = new BloomMarkdown();
    const book = parser.parseMarkdown(input);
    expect(book.pages.length).toBe(1);
    expect(book.pages[0].appearsToBeBilingualPage).toBe(undefined);
    expect((book.pages[0].elements[0] as TextBlockElement).field).toBe("copyright");
    expect((book.pages[0].elements[1] as TextBlockElement).field).toBe("license");
    // and this is single element with two languages
    expect((book.pages[0].elements[2] as TextBlockElement).field).toBe("acknowledgments");
    // should have english and french content
    expect((book.pages[0].elements[2] as TextBlockElement).content.en).toBe(
      "English acknowledgment",
    );
    expect((book.pages[0].elements[2] as TextBlockElement).content.fr).toBe(
      "French acknowledgment",
    );
  });

  it("should preserve text content when followed by an image", () => {
    const content = `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
  gon: "Gondi"
l1: en
l2: gon
---
<!-- text lang="en" field="bookTitle" -->

test me

![img-0.jpeg](img-0.jpeg){width=731}

<!-- text lang="gon" field="bookTitle" -->

ஹ்வ்லி (Gondi)`;

    const parser = new BloomMarkdown();
    const result = parser.parseMarkdown(content);

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].elements).toHaveLength(3);

    // First element should be the English book title with "test me"
    const englishTitle = result.pages[0].elements[0] as TextBlockElement;
    expect(englishTitle.type).toBe("text");
    expect(englishTitle.field).toBe("bookTitle");
    expect(englishTitle.content.en).toBe("test me");

    // Second element should be the image
    const image = result.pages[0].elements[1] as ImageElement;
    expect(image.type).toBe("image");
    expect(image.src).toBe("img-0.jpeg");

    // Third element should be the Gondi book title
    const gondiTitle = result.pages[0].elements[2] as TextBlockElement;
    expect(gondiTitle.type).toBe("text");
    expect(gondiTitle.field).toBe("bookTitle");
    expect(gondiTitle.content.gon).toBe("ஹ்வ்லி (Gondi)");
  });
});
