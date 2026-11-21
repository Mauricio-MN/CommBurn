const GENERIC_FAMILIES = new Set(["sans-serif", "serif", "monospace", "CommBurn Sans", "CommBurn Serif", "CommBurn Mono"]);
const FALLBACK_FAMILIES = ["monospace", "serif", "sans-serif"];
const SAMPLE_TEXT = "mmmmmmmmmmlli0WgyQ@#";
const cache = new Map();
let measureContext = null;

// A name is installed when it renders differently from every generic fallback. Browsers
// do not expose installed system fonts without permission, so this measures glyph widths.
export function isFontInstalled(name) {
  const family = String(name ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
  if (GENERIC_FAMILIES.has(family)) return true;
  // Font lists cannot be measured as one family; trust them rather than block the job.
  if (!family || family.includes(",")) return true;
  if (cache.has(family)) return cache.get(family);
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return true;
  const installed = FALLBACK_FAMILIES.some((fallback) => {
    measureContext.font = `64px ${fallback}`;
    const fallbackWidth = measureContext.measureText(SAMPLE_TEXT).width;
    measureContext.font = `64px "${family.replaceAll('"', "")}", ${fallback}`;
    return measureContext.measureText(SAMPLE_TEXT).width !== fallbackWidth;
  });
  cache.set(family, installed);
  return installed;
}
