export const STAGE_BACKGROUND_DEFAULT = "#ffffff";
export const STAGE_BACKGROUND_STORAGE_KEY = "commburn.stageBackground";

export function normalizeStageBackground(value) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value.toLowerCase()
    : STAGE_BACKGROUND_DEFAULT;
}

export function applyStageBackground(artboard, color) {
  artboard.style.setProperty("--artboard-bg", normalizeStageBackground(color));
}
