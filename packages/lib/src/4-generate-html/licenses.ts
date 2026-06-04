export const LICENSE_MAPPING: Record<string, string> = {
  "CC-BY": "http://creativecommons.org/licenses/by/4.0/",
  "CC-BY-SA": "http://creativecommons.org/licenses/by-sa/4.0/",
  "CC-BY-ND": "http://creativecommons.org/licenses/by-nd/4.0/",
  "CC-BY-NC": "http://creativecommons.org/licenses/by-nc/4.0/",
  "CC-BY-NC-SA": "http://creativecommons.org/licenses/by-nc-sa/4.0/",
  "CC-BY-NC-ND": "http://creativecommons.org/licenses/by-nc-nd/4.0/",
  CC0: "http://creativecommons.org/publicdomain/zero/1.0/",
};

export function getUrlFromLicense(license: string): string {
  // If it's already a URL, return as-is
  if (license.toLowerCase().startsWith("http://") || license.toLowerCase().startsWith("https://")) {
    return license;
  }

  // Convert license to uppercase for case-insensitive matching
  const normalizedLicense = license.toUpperCase();
  // Check for case-insensitive matches in the mapping
  const match = Object.entries(LICENSE_MAPPING).find(
    ([key]) => key.toUpperCase() === normalizedLicense,
  );

  return match ? match[1] : license;
}

export function getLicenseFromUrl(url: string): string {
  // Case-insensitive search for URL
  const normalizedUrl = url.toLowerCase();
  const entry = Object.entries(LICENSE_MAPPING).find(
    ([, value]) => value.toLowerCase() === normalizedUrl,
  );
  return entry ? entry[0] : url; // Return the license key or original URL if not found
}

/**
 * Find a Creative Commons license URL embedded in free text. OCR/LLM output often
 * leaves the whole CC statement in `licenseDescription` (e.g. "...To view a copy of
 * this license, visit http://creativecommons.org/licenses/by-nc-nd/4.0/.") without
 * ever filling the structured `license`/`licenseUrl` fields. Matches both the
 * `licenses/<code>/<version>` and `publicdomain/zero/<version>` (CC0) forms, and
 * stops before any trailing sentence punctuation.
 */
export function extractCcLicenseUrl(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = text.match(
    /https?:\/\/creativecommons\.org\/(?:licenses\/[a-z+-]+\/[0-9.]+|publicdomain\/zero\/[0-9.]+)\/?/i,
  );
  return match ? match[0] : undefined;
}

/** A book's license-related fields, each already reduced to a single string. */
export interface LicenseFields {
  license?: string;
  licenseUrl?: string;
  licenseDescription?: string;
  licenseNotes?: string;
}

/**
 * Resolve a book's Creative Commons license URL from whatever license signal it
 * carries, in priority order: an explicit `licenseUrl`, a `license` token (mapped
 * via `LICENSE_MAPPING`), then a CC URL embedded in the prose `licenseDescription`
 * or `licenseNotes`. Returns undefined when there is no Creative Commons license
 * (e.g. a custom or all-rights-reserved license).
 */
export function resolveCcLicenseUrl(fields: LicenseFields): string | undefined {
  const candidate =
    (fields.licenseUrl ? getUrlFromLicense(fields.licenseUrl) : undefined) ||
    (fields.license ? getUrlFromLicense(fields.license) : undefined) ||
    extractCcLicenseUrl(fields.licenseDescription) ||
    extractCcLicenseUrl(fields.licenseNotes);
  return candidate && /creativecommons\.org/i.test(candidate) ? candidate : undefined;
}
