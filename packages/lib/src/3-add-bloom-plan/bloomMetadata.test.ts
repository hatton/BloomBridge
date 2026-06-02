import { describe, it, expect, beforeEach } from "vite-plus/test";
import { BloomMetadataParser, FrontMatterMetadata } from "./bloomMetadata";

describe("BloomMetadataParser", () => {
  let parser: BloomMetadataParser;

  beforeEach(() => {
    parser = new BloomMetadataParser();
  });

  describe("extractFrontmatter", () => {
    it("should extract valid frontmatter and body", () => {
      const content = `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
l1: en
---
<!-- text lang="en" -->
Hello world`;

      const result = parser.extractFrontmatter(content);

      expect(result.frontmatter).toContain("allTitles:");
      expect(result.frontmatter).toContain('en: "Test Book"');
      expect(result.body).toContain(`<!-- text lang="en" -->`);
      expect(result.body).toContain("Hello world");
    });

    it("should handle content without frontmatter", () => {
      const content = `<!-- text lang="en" -->
Hello world`;

      const result = parser.extractFrontmatter(content);

      expect(result.frontmatter).toBe("");
      expect(result.body).toBe(content);
      expect(parser.getErrors()).toHaveLength(1);
      expect(parser.getErrors()[0].message).toBe("No YAML frontmatter found");
    });

    it("should handle different line endings", () => {
      const contentWithCRLF = `---\r\nallTitles:\r\n  en: "Test Book"\r\n---\r\n<!-- text lang="en" -->\r\nHello world`;

      const result = parser.extractFrontmatter(contentWithCRLF);

      expect(result.frontmatter).toContain("allTitles:");
      expect(result.body).toContain("Hello world");
    });
  });

  describe("parseMetadata", () => {
    it("should parse valid YAML frontmatter", () => {
      const frontmatter = `allTitles:
  en: "Test Book"
  es: "Libro de Prueba"
languages:
  en: "English"
  es: "Español"
l1: en
l2: es`;

      const result = parser.parseMetadata(frontmatter);

      expect(result.languages.en).toBe("English");
      expect(result.l1).toBe("en");
      expect(result.l2).toBe("es");
    });

    it("should handle invalid YAML", () => {
      const invalidYaml = `allTitles:
  en: "Test Book"
  invalid: yaml: content:`;

      const result = parser.parseMetadata(invalidYaml);

      expect(result).toEqual({});
      expect(parser.getErrors()).toHaveLength(1);
      expect(parser.getErrors()[0].message).toContain("Failed to parse YAML frontmatter");
    });

    it("should parse metadata with optional fields", () => {
      const frontmatter = `allTitles:
  en: "Test Book"
languages:
  en: "English"
l1: en
coverImage: "cover.jpg"
isbn: "978-1234567890"
license: "CC-BY-NC"
copyright: "Copyright 2023, Test Publisher"`;

      const result = parser.parseMetadata(frontmatter);

      expect(result.languages.en).toBe("English");
      expect(result.l1).toBe("en");
    });
  });

  describe("validateMetadata", () => {
    it("should validate required fields are present", () => {
      const validMetadata: FrontMatterMetadata = {
        languages: { en: "English" },
        l1: "en",
      };

      const isValid = parser.validateMetadata(validMetadata);

      expect(isValid).toBe(true);
      expect(parser.getErrors()).toHaveLength(0);
    });

    it("should report missing required fields", () => {
      const invalidMetadata = {} as FrontMatterMetadata;

      const isValid = parser.validateMetadata(invalidMetadata);

      expect(isValid).toBe(false);

      expect(parser.getErrors().map((e) => e.message)).toContain(
        "Missing required field: languages",
      );
      expect(parser.getErrors().map((e) => e.message)).toContain("Missing required field: l1");
    });

    it("should validate l1 exists in languages", () => {
      const invalidMetadata: FrontMatterMetadata = {
        languages: { es: "Spanish" },
        l1: "en", // en not in languages
      };

      const isValid = parser.validateMetadata(invalidMetadata);

      expect(isValid).toBe(false);
      expect(
        parser
          .getErrors()
          .some((e) => e.message.includes("Primary language 'en' not found in languages")),
      ).toBe(true);
    });

    it("should validate l2 exists in languages if specified", () => {
      const invalidMetadata: FrontMatterMetadata = {
        languages: { en: "English" },
        l1: "en",
        l2: "fr", // fr not in languages
      };

      const isValid = parser.validateMetadata(invalidMetadata);

      expect(isValid).toBe(false);
      expect(
        parser
          .getErrors()
          .some((e) => e.message.includes("Secondary language 'fr' not found in languages")),
      ).toBe(true);
    });

    it("should allow valid l2 when present in languages", () => {
      const validMetadata: FrontMatterMetadata = {
        languages: { en: "English", fr: "French" },
        l1: "en",
        l2: "fr",
      };

      const isValid = parser.validateMetadata(validMetadata);

      expect(isValid).toBe(true);
      expect(parser.getErrors()).toHaveLength(0);
    });
  });

  describe("error management", () => {
    it("should accumulate multiple errors", () => {
      // First create some errors
      parser.extractFrontmatter("no frontmatter");
      parser.validateMetadata({} as FrontMatterMetadata);

      const errors = parser.getErrors();
      expect(errors.length).toBeGreaterThan(1);
      expect(errors.some((e) => e.message.includes("No YAML frontmatter found"))).toBe(true);
      expect(errors.some((e) => e.message.includes("Missing required field"))).toBe(true);
    });

    it("should clear errors", () => {
      parser.extractFrontmatter("no frontmatter");
      expect(parser.getErrors()).toHaveLength(1);

      parser.clearErrors();
      expect(parser.getErrors()).toHaveLength(0);
    });
  });

  describe("integration with full markdown parsing", () => {
    it("should handle complete valid markdown with frontmatter", () => {
      const content = `---
allTitles:
  en: "Test Book"
  es: "Libro de Prueba"
languages:
  en: "English"
  es: "Español"
l1: en
l2: es
coverImage: "cover.jpg"
---
<!-- text lang="en" -->
Hello world
<!-- text lang=es -->
Hola mundo`;

      const { frontmatter, body } = parser.extractFrontmatter(content);
      const metadata = parser.parseMetadata(frontmatter);

      expect(metadata.l1).toBe("en");
      expect(metadata.l2).toBe("es");
      expect(body).toContain("Hello world");
      expect(parser.getErrors()).toHaveLength(0);
    });
  });
});
