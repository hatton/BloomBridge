import { describe, it, expect } from "vite-plus/test";
import { generateOrigamiHtml, OrigamiItem, Orientation } from "./origami";

// Helper function to normalize HTML strings for reliable comparison.
// It removes newlines, reduces multiple spaces to single ones,
// and trims whitespace between tags.
function normalizeHTML(html: string): string {
  return html
    .replace(/\s*\n\s*/g, "") // Remove newlines and surrounding whitespace
    .replace(/>\s+</g, "><") // Remove whitespace between tags
    .replace(/\s{2,}/g, " ") // Replace multiple spaces with a single space
    .trim(); // Trim leading/trailing whitespace from the whole string
}

describe("generateBloomHTML", () => {
  it("should throw an error for an empty sequence", () => {
    expect(() => generateOrigamiHtml([])).toThrow("Input sequence cannot be empty.");
  });

  // --- Single Item Cases ---
  it("should generate HTML for a single text item (default portrait)", () => {
    const sequence: OrigamiItem[] = [{ type: "text", content: { en: "Hello" } }];
    const expected = `
      <div class="split-pane-component-inner">
        <div class="bloom-translationGroup">
          <div class="bloom-editable" lang="en">
            <p>Hello</p>
          </div>
        </div>
      </div>`;
    expect(normalizeHTML(generateOrigamiHtml(sequence))).toBe(normalizeHTML(expected));
  });
  it("should generate HTML for a single image item (default portrait)", () => {
    const sequence: OrigamiItem[] = [{ type: "image", src: "test.png" }];
    const expected = `
      <div class="split-pane-component-inner">
        <div class="bloom-canvas bloom-leadingElement bloom-has-canvas-element">
          <div class="bloom-canvas-element bloom-backgroundImage">
            <div class="bloom-leadingElement bloom-imageContainer">
              <img src="test.png" />
            </div>
          </div>
        </div>
      </div>`;
    expect(normalizeHTML(generateOrigamiHtml(sequence))).toBe(normalizeHTML(expected));
  });
  it("should generate HTML for a single text item (explicit portrait)", () => {
    const sequence: OrigamiItem[] = [{ type: "text", content: { en: "test" } }];

    const expected = `
      <div class="split-pane-component-inner">
        <div class="bloom-translationGroup">
          <div class="bloom-editable" lang="en">
            <p>test</p>
          </div>
        </div>
      </div>`;
    expect(normalizeHTML(generateOrigamiHtml(sequence, Orientation.Portrait))).toBe(
      normalizeHTML(expected),
    );
  });
  it("should generate HTML for a single image item (explicit landscape)", () => {
    // Orientation doesn't change the structure for a single item
    const sequence: OrigamiItem[] = [{ type: "image", src: "test.png" }];

    const expected = `
      <div class="split-pane-component-inner">
        <div class="bloom-canvas bloom-leadingElement bloom-has-canvas-element">
          <div class="bloom-canvas-element bloom-backgroundImage">
            <div class="bloom-leadingElement bloom-imageContainer">
              <img src="test.png" />
            </div>
          </div>
        </div>
      </div>`;
    expect(normalizeHTML(generateOrigamiHtml(sequence, Orientation.Landscape))).toBe(
      normalizeHTML(expected),
    );
  });
  // --- Two Item Cases ---
  it("should generate HTML for [text, image] in portrait mode (default)", () => {
    const sequence: OrigamiItem[] = [
      { type: "text", content: { en: "test" } },
      { type: "image", src: "test.png" },
    ];
    const expected = `
      <div class="split-pane horizontal-percent">
        <div class="split-pane-component position-top">
          <div class="split-pane-component-inner">
            <div class="bloom-translationGroup">
              <div class="bloom-editable" lang="en">
                <p>test</p>
              </div>
            </div>
          </div>
        </div>
        <div class="split-pane-divider horizontal-divider"></div>
        <div class="split-pane-component position-bottom">
          <div class="split-pane-component-inner">
            <div class="bloom-canvas bloom-leadingElement bloom-has-canvas-element">
              <div class="bloom-canvas-element bloom-backgroundImage">
                <div class="bloom-leadingElement bloom-imageContainer">
                  <img src="test.png" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    expect(normalizeHTML(generateOrigamiHtml(sequence))).toBe(normalizeHTML(expected));
  });
  it("should generate HTML for [image, text] in landscape mode", () => {
    const sequence: OrigamiItem[] = [
      { type: "image", src: "test.png" },
      { type: "text", content: { en: "test" } },
    ];

    const expected = `
      <div class="split-pane vertical-percent">
        <div class="split-pane-component position-left">
          <div class="split-pane-component-inner">
            <div class="bloom-canvas bloom-leadingElement bloom-has-canvas-element">
              <div class="bloom-canvas-element bloom-backgroundImage">
                <div class="bloom-leadingElement bloom-imageContainer">
                  <img src="test.png" />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="split-pane-divider vertical-divider"></div>
        <div class="split-pane-component position-right">
          <div class="split-pane-component-inner">
            <div class="bloom-translationGroup">
              <div class="bloom-editable" lang="en">
                <p>test</p>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    expect(normalizeHTML(generateOrigamiHtml(sequence, Orientation.Landscape))).toBe(
      normalizeHTML(expected),
    );
  });
  // --- Three Item Cases ---
  it("should generate HTML for [text, image, text] in landscape mode (matches prompt example structure)", () => {
    const sequence: OrigamiItem[] = [
      { type: "text", content: { en: "test" } },
      { type: "image", src: "test.png" },
      { type: "text", content: { en: "test" } },
    ];

    const expected = `
      <div class="split-pane vertical-percent">
        <div class="split-pane-component position-left">
          <div class="split-pane-component-inner">
            <div class="bloom-translationGroup">
              <div class="bloom-editable" lang="en">
                <p>test</p>
              </div>
            </div>
          </div>
        </div>
        <div class="split-pane-divider vertical-divider"></div>
        <div class="split-pane-component position-right">
          <div class="split-pane-component-inner">
            <div class="split-pane vertical-percent">
              <div class="split-pane-component position-left">
                <div class="split-pane-component-inner">
                  <div class="bloom-canvas bloom-leadingElement bloom-has-canvas-element">
                    <div class="bloom-canvas-element bloom-backgroundImage">
                      <div class="bloom-leadingElement bloom-imageContainer">
                        <img src="test.png" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="split-pane-divider vertical-divider"></div>
              <div class="split-pane-component position-right">
                <div class="split-pane-component-inner">
                  <div class="bloom-translationGroup">
                    <div class="bloom-editable" lang="en">
                      <p>test</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    expect(normalizeHTML(generateOrigamiHtml(sequence, Orientation.Landscape))).toBe(
      normalizeHTML(expected),
    );
  });
  it("should generate HTML for [image, text, image] in portrait mode", () => {
    const sequence: OrigamiItem[] = [
      { type: "image", src: "test.png" },
      { type: "text", content: { en: "test" } },
      { type: "image", src: "test.png" },
    ];

    const expected = `
      <div class="split-pane horizontal-percent">
        <div class="split-pane-component position-top">
          <div class="split-pane-component-inner">
            <div class="bloom-canvas bloom-leadingElement bloom-has-canvas-element">
              <div class="bloom-canvas-element bloom-backgroundImage">
                <div class="bloom-leadingElement bloom-imageContainer">
                  <img src="test.png" />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="split-pane-divider horizontal-divider"></div>
        <div class="split-pane-component position-bottom">
          <div class="split-pane-component-inner">
            <div class="split-pane horizontal-percent">
              <div class="split-pane-component position-top">
                <div class="split-pane-component-inner">
                  <div class="bloom-translationGroup">
                    <div class="bloom-editable" lang="en">
                      <p>test</p>
                    </div>
                  </div>
                </div>
              </div>
              <div class="split-pane-divider horizontal-divider"></div>
              <div class="split-pane-component position-bottom">
                <div class="split-pane-component-inner">
                  <div class="bloom-canvas bloom-leadingElement bloom-has-canvas-element">
                    <div class="bloom-canvas-element bloom-backgroundImage">
                      <div class="bloom-leadingElement bloom-imageContainer">
                        <img src="test.png" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    expect(normalizeHTML(generateOrigamiHtml(sequence, Orientation.Portrait))).toBe(
      normalizeHTML(expected),
    );
  });
  // --- Four Item Case ---
  it("should generate HTML for [text, image, text, image] in landscape mode", () => {
    const sequence: OrigamiItem[] = [
      { type: "text", content: { en: "test" } },
      { type: "image", src: "test.png" },
      { type: "text", content: { en: "test" } },
      { type: "image", src: "test.png" },
    ];
    const expected = `
      <div class="split-pane vertical-percent">
        <div class="split-pane-component position-left">
          <div class="split-pane-component-inner">
            <div class="bloom-translationGroup">
              <div class="bloom-editable" lang="en">
                <p>test</p>
              </div>
            </div>
          </div>
        </div>
        <div class="split-pane-divider vertical-divider"></div>
        <div class="split-pane-component position-right">
          <div class="split-pane-component-inner">
            <div class="split-pane vertical-percent">
              <div class="split-pane-component position-left">
                <div class="split-pane-component-inner">
                  <div class="bloom-canvas bloom-leadingElement bloom-has-canvas-element">
                    <div class="bloom-canvas-element bloom-backgroundImage">
                      <div class="bloom-leadingElement bloom-imageContainer">
                        <img src="test.png" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="split-pane-divider vertical-divider"></div>
              <div class="split-pane-component position-right">
                <div class="split-pane-component-inner">
                  <div class="split-pane vertical-percent">
                    <div class="split-pane-component position-left">
                      <div class="split-pane-component-inner">
                        <div class="bloom-translationGroup">
                          <div class="bloom-editable" lang="en">
                            <p>test</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="split-pane-divider vertical-divider"></div>
                    <div class="split-pane-component position-right">
                      <div class="split-pane-component-inner">
                        <div class="bloom-canvas bloom-leadingElement bloom-has-canvas-element">
                          <div class="bloom-canvas-element bloom-backgroundImage">
                            <div class="bloom-leadingElement bloom-imageContainer">
                              <img src="test.png" />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    expect(normalizeHTML(generateOrigamiHtml(sequence, Orientation.Landscape))).toBe(
      normalizeHTML(expected),
    );
  });
});
