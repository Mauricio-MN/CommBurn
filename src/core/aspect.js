import { SVGPathData } from "../../node_modules/svg-pathdata/lib/SVGPathData.module.js";
import { CommBurnRangeError } from "./i18n.js";

// Width / height of a vector path's own geometry, before the object was stretched; null when it has no area.
export function pathAspectRatio(pathData) {
  const bounds = new SVGPathData(pathData).getBounds();
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  return width > 0 && height > 0 ? width / height : null;
}

// Keeps the current width and the top-left corner, and gives the object back its natural height.
export function restoreProportionPatch(element, naturalRatio) {
  if (!Number.isFinite(naturalRatio) || naturalRatio <= 0) {
    throw new CommBurnRangeError("aspect.noNaturalRatio", { id: element.id }, {
      message: `Element ${element.id} has no natural proportion to restore`
    });
  }
  return { heightMm: element.widthMm / naturalRatio };
}
