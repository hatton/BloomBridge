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
