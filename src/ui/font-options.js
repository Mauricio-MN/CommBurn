// Local Font Access (queryLocalFonts) exists only in Chromium-based browsers and needs permission.
// Callers pass the browser API object so the outcome can be tested without a browser.
export async function listSystemFontFamilies(api) {
  if (typeof api?.queryLocalFonts !== "function") return { status: "unsupported", families: [] };
  try {
    const fonts = await api.queryLocalFonts();
    const families = [...new Set(fonts.map((font) => font.family).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    return { status: "loaded", families };
  } catch {
    return { status: "failed", families: [] };
  }
}
