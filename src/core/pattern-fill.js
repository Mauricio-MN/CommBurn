import { ClipperD, ClipType, EndType, FillRule, JoinType, inflatePathsD, unionD } from "../../node_modules/clipper2-ts/dist/clipper2.min.mjs";
import { CommBurnRangeError } from "./i18n.js";

const PRECISION = 6;
const MAX_POINTS = 100000;
const MAX_OFFSET_PASSES = 10000;
const MAX_GEOMETRY_WORK = 2000000;

function tooComplex(id) {
  return new CommBurnRangeError("grbl.patternTooComplex", { id, limit: MAX_POINTS }, {
    message: `Fill pattern for ${id} is too complex; increase spacing or simplify the geometry`
  });
}

function hilbertPoint(index, size) {
  let x = 0;
  let y = 0;
  for (let scale = 1; scale < size; scale *= 2) {
    const rx = Math.floor(index / 2) % 2;
    const ry = (index % 2) ^ rx;
    if (ry === 0) {
      if (rx === 1) {
        x = scale - 1 - x;
        y = scale - 1 - y;
      }
      [x, y] = [y, x];
    }
    x += scale * rx;
    y += scale * ry;
    index = Math.floor(index / 4);
  }
  return [x, y];
}

export function patternFillPaths(element, polygons, algorithm, spacing) {
  const coordinates = polygons.flat();
  if (!coordinates.length) return [];
  if (spacing < 10 ** -PRECISION) {
    throw new CommBurnRangeError("grbl.patternPrecision", { id: element.id }, {
      message: `Fill spacing for ${element.id} is below the supported pattern precision`
    });
  }
  if (spacing * 10 ** PRECISION > Number.MAX_SAFE_INTEGER / 8
    || coordinates.some(([x, y]) => Math.max(Math.abs(x), Math.abs(y)) * 10 ** PRECISION > Number.MAX_SAFE_INTEGER / 8)) {
    throw tooComplex(element.id);
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of coordinates) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if ((maxX > minX && maxX - minX < 10 ** -PRECISION) || (maxY > minY && maxY - minY < 10 ** -PRECISION)) {
    throw new CommBurnRangeError("grbl.patternPrecision", { id: element.id }, {
      message: `Fill geometry for ${element.id} is below the supported pattern precision`
    });
  }
  const cols = Math.ceil((maxX - minX) / spacing);
  const rows = Math.ceil((maxY - minY) / spacing);
  if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows)) throw tooComplex(element.id);
  const region = polygons.map((path) => path.map(([x, y]) => ({ x, y })));
  const requireCoverage = (paths) => {
    if (paths.length === 0 && unionD(region, FillRule.EvenOdd, PRECISION).length > 0) {
      throw new CommBurnRangeError("grbl.patternNoCoverage", { id: element.id }, {
        message: `Fill pattern does not reach ${element.id}; reduce spacing or choose another pattern`
      });
    }
    return paths;
  };

  if (algorithm === "inset") {
    const normalized = unionD(region, FillRule.EvenOdd, PRECISION);
    const result = [];
    let points = 0;
    const passes = Math.ceil(Math.min(maxX - minX, maxY - minY) / (2 * spacing));
    if (passes > MAX_OFFSET_PASSES || passes * coordinates.length > MAX_GEOMETRY_WORK) throw tooComplex(element.id);
    for (let pass = 0; pass < passes; pass += 1) {
      const contours = inflatePathsD(normalized, -(pass + 0.5) * spacing, JoinType.Miter, EndType.Polygon, 2, PRECISION);
      if (!contours.length) break;
      for (const contour of contours) {
        points += contour.length + 1;
        if (points > MAX_POINTS) throw tooComplex(element.id);
        const path = contour.map(({ x, y }) => [x, y]);
        if (path.length >= 3) result.push([...path, path[0]]);
      }
    }
    return requireCoverage(result);
  }

  const candidates = [];
  if (algorithm === "squares") {
    if (cols * rows * 5 > MAX_POINTS) throw tooComplex(element.id);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = minX + (col + 0.25) * spacing, y = minY + (row + 0.25) * spacing;
        const side = spacing / 2;
        candidates.push([[x, y], [x + side, y], [x + side, y + side], [x, y + side], [x, y]]);
      }
    }
  } else if (algorithm === "zigzag") {
    if (rows * (cols + 1) > MAX_POINTS) throw tooComplex(element.id);
    for (let row = 0; row < rows; row += 1) {
      const path = [];
      for (let col = 0; col <= cols; col += 1) {
        path.push([minX + col * spacing, minY + (row + (col % 2)) * spacing]);
      }
      if (path.length > 1) candidates.push(path);
    }
  } else if (algorithm === "hilbert") {
    const size = 2 ** Math.ceil(Math.log2(Math.max(cols, rows, 2)));
    if (size * size > MAX_POINTS) throw tooComplex(element.id);
    const path = [];
    for (let index = 0; index < size * size; index += 1) {
      const [x, y] = hilbertPoint(index, size);
      path.push([minX + (x + 0.5) * spacing, minY + (y + 0.5) * spacing]);
    }
    candidates.push(path);
  } else {
    throw new CommBurnRangeError("layers.invalidFillAlgorithm", { id: element.id, algorithm });
  }
  const candidatePoints = candidates.reduce((sum, path) => sum + path.length, 0);
  if (candidatePoints * coordinates.length > MAX_GEOMETRY_WORK) throw tooComplex(element.id);
  const clipper = new ClipperD(PRECISION);
  clipper.addClipPaths(region);
  clipper.addOpenSubjectPaths(candidates.map((path) => path.map(([x, y]) => ({ x, y }))));
  const closed = [], open = [];
  if (!clipper.execute(ClipType.Intersection, FillRule.EvenOdd, closed, open)) {
    throw new CommBurnRangeError("grbl.patternClippingFailed", { id: element.id }, {
      message: `Could not clip fill pattern for ${element.id}`
    });
  }
  let points = 0;
  return requireCoverage(open.map((path) => {
    points += path.length;
    if (points > MAX_POINTS) throw tooComplex(element.id);
    return path.map(({ x, y }) => [x, y]);
  }));
}
