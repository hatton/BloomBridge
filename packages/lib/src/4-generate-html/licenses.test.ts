import { describe, it, expect } from "vite-plus/test";
import { extractCcLicenseUrl, resolveCcLicenseUrl } from "./licenses";

describe("extractCcLicenseUrl", () => {
  it("pulls a CC license URL out of prose, dropping trailing punctuation", () => {
    const prose =
      "This work is licensed under the Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International License. To view a copy of this license, visit http://creativecommons.org/licenses/by-nc-nd/4.0/.";
    expect(extractCcLicenseUrl(prose)).toBe("http://creativecommons.org/licenses/by-nc-nd/4.0/");
  });

  it("matches the CC0 public-domain form", () => {
    expect(
      extractCcLicenseUrl("Released under https://creativecommons.org/publicdomain/zero/1.0/"),
    ).toBe("https://creativecommons.org/publicdomain/zero/1.0/");
  });

  it("returns undefined when there is no CC URL", () => {
    expect(extractCcLicenseUrl("All rights reserved.")).toBeUndefined();
    expect(extractCcLicenseUrl(undefined)).toBeUndefined();
  });
});

describe("resolveCcLicenseUrl", () => {
  it("prefers an explicit licenseUrl", () => {
    expect(resolveCcLicenseUrl({ licenseUrl: "http://creativecommons.org/licenses/by/4.0/" })).toBe(
      "http://creativecommons.org/licenses/by/4.0/",
    );
  });

  it("maps a license token", () => {
    expect(resolveCcLicenseUrl({ license: "CC-BY-NC-ND" })).toBe(
      "http://creativecommons.org/licenses/by-nc-nd/4.0/",
    );
  });

  it("falls back to a URL embedded in the prose description", () => {
    expect(
      resolveCcLicenseUrl({
        licenseDescription: "...visit http://creativecommons.org/licenses/by-nc-nd/4.0/.",
      }),
    ).toBe("http://creativecommons.org/licenses/by-nc-nd/4.0/");
  });

  it("returns undefined for a non-Creative-Commons license", () => {
    expect(resolveCcLicenseUrl({ license: "All rights reserved" })).toBeUndefined();
    expect(resolveCcLicenseUrl({})).toBeUndefined();
  });
});
