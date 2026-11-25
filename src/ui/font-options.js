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

// A datalist only suggests options that match the text already in the field, so a field showing
// "sans-serif" offers nothing else. The text is cleared while the field has focus and restored
// when it loses focus untouched. The capture-phase "change" listener runs before the editor's own
// handler and drops the empty change that clearing causes, so the font is not replaced by accident.
export function showAllFontOptionsOnFocus(input) {
  let previous = null;
  input.addEventListener("focus", () => {
    previous = input.value;
    input.value = "";
  });
  input.addEventListener("change", (event) => {
    if (previous === null || input.value !== "") return;
    input.value = previous;
    event.stopImmediatePropagation();
  }, { capture: true });
  input.addEventListener("blur", () => {
    if (previous !== null && input.value === "") input.value = previous;
    previous = null;
  });
}
