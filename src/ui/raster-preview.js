const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_RASTER_SELECTION = 20;
const MAX_SELECTION_RUNS = 16;
const MAX_PIXELS = 4_000_000;
const MAX_DIMENSION = 4096;

function needsPageFont(node) {
  return node.localName === "text" && /^CommBurn (Sans|Serif|Mono)$/i.test(node.getAttribute("font-family") ?? "");
}

export function selectionRuns(nodes, ids) {
  const selected = new Set(ids);
  const runs = [];
  let run = null;
  for (const node of nodes) {
    if (selected.has(node.dataset.id)) {
      if (!run) runs.push(run = []);
      run.push(node);
    } else {
      run = null;
    }
  }
  return runs;
}

export function rasterDimensions(width, height) {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) {
    throw new RangeError("Invalid raster preview dimensions");
  }
  const scale = Math.min(1, MAX_DIMENSION / width, MAX_DIMENSION / height, Math.sqrt(MAX_PIXELS / width / height));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

function snapshot(artboard, nodes) {
  const matrix = artboard.getScreenCTM();
  if (!matrix) throw new Error("Cannot rasterize a detached artboard");
  const inverse = matrix.inverse();
  const point = artboard.createSVGPoint();
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const node of nodes) {
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const nodeMatrix = node.getScreenCTM();
    const strokeWidth = style.stroke === "none" ? 0 : Number.parseFloat(style.strokeWidth) || 0;
    const strokePadding = nodeMatrix
      ? 2 * strokeWidth * Math.max(Math.hypot(nodeMatrix.a, nodeMatrix.b), Math.hypot(nodeMatrix.c, nodeMatrix.d))
      : 0;
    for (const [x, y] of [
      [box.left - strokePadding, box.top - strokePadding],
      [box.right + strokePadding, box.top - strokePadding],
      [box.left - strokePadding, box.bottom + strokePadding],
      [box.right + strokePadding, box.bottom + strokePadding]
    ]) {
      point.x = x;
      point.y = y;
      const local = point.matrixTransform(inverse);
      left = Math.min(left, local.x);
      right = Math.max(right, local.x);
      top = Math.min(top, local.y);
      bottom = Math.max(bottom, local.y);
    }
  }
  const pixelsPerMm = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
  if (!(pixelsPerMm > 0)) throw new Error("Cannot rasterize an unscaled artboard");
  const padding = 2 / pixelsPerMm;
  left -= padding;
  top -= padding;
  right += padding;
  bottom += padding;
  const width = right - left;
  const height = bottom - top;
  const resolution = rasterDimensions(width * pixelsPerMm * (window.devicePixelRatio || 1), height * pixelsPerMm * (window.devicePixelRatio || 1));
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("viewBox", `${left} ${top} ${width} ${height}`);
  svg.setAttribute("width", resolution.width);
  svg.setAttribute("height", resolution.height);
  for (const node of nodes) {
    const clone = node.cloneNode(true);
    clone.classList.remove("selected", "layer-glow", "missing-font");
    clone.removeAttribute("data-id");
    clone.removeAttribute("data-layer-id");
    svg.append(clone);
  }
  return { source: new XMLSerializer().serializeToString(svg), x: left, y: top, width, height, pixelWidth: resolution.width, pixelHeight: resolution.height };
}

async function rasterize(source, width, height) {
  const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.drawImage(image, 0, 0);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class RasterPreview {
  constructor(artboard, objects, { makeSnapshot = snapshot, render = rasterize } = {}) {
    this.artboard = artboard;
    this.objects = objects;
    this.makeSnapshot = makeSnapshot;
    this.render = render;
    this.cache = new Map();
    this.move = null;
    this.flashVersion = 0;
    this.flashNode = null;
  }

  async imageFor(nodes) {
    const result = this.makeSnapshot(this.artboard, nodes);
    let promise = this.cache.get(result.source);
    if (!promise) {
      promise = this.render(result.source, result.pixelWidth, result.pixelHeight);
      this.cache.set(result.source, promise);
      while (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value);
      promise.catch(() => {
        if (this.cache.get(result.source) === promise) this.cache.delete(result.source);
      });
    }
    const href = await promise;
    const image = document.createElementNS(SVG_NS, "image");
    image.setAttribute("x", result.x);
    image.setAttribute("y", result.y);
    image.setAttribute("width", result.width);
    image.setAttribute("height", result.height);
    image.setAttribute("href", href);
    image.setAttribute("pointer-events", "none");
    return image;
  }

  async flash(layerId) {
    const version = ++this.flashVersion;
    this.flashNode?.remove();
    this.flashNode = null;
    const nodes = [...this.objects.children].filter((node) => node.dataset.layerId === layerId);
    if (!nodes.length) return;
    const vectorFlash = () => {
      for (const node of nodes) node.classList.remove("layer-glow");
      void this.objects.getBoundingClientRect();
      for (const node of nodes) node.classList.add("layer-glow");
    };
    if (nodes.some(needsPageFont)) {
      vectorFlash();
      return;
    }
    try {
      const image = await this.imageFor(nodes);
      if (version !== this.flashVersion) return;
      image.classList.add("layer-glow");
      this.objects.after(image);
      this.flashNode = image;
      image.addEventListener("animationend", () => {
        image.remove();
        if (this.flashNode === image) this.flashNode = null;
      }, { once: true });
    } catch (error) {
      console.error("Could not rasterize layer glow:", error);
      if (version === this.flashVersion) vectorFlash();
    }
  }

  preview(ids, dx, dy) {
    if (!this.move) {
      this.flashVersion += 1;
      this.flashNode?.remove();
      this.flashNode = null;
      const runs = selectionRuns(this.objects.children, ids);
      const nodes = runs.flat();
      const move = this.move = {
        nodes,
        transforms: nodes.map((node) => node.getAttribute("transform") ?? ""),
        images: null,
        dx,
        dy
      };
      if (nodes.length >= MIN_RASTER_SELECTION && runs.length <= MAX_SELECTION_RUNS && !nodes.some(needsPageFont)) {
        Promise.all(runs.map((run) => this.imageFor(run))).then((images) => {
          if (this.move !== move) return;
          move.images = images;
          for (let index = 0; index < runs.length; index += 1) {
            const image = images[index];
            image.classList.add("raster-selection");
            runs[index][0].before(image);
            for (const node of runs[index]) node.style.visibility = "hidden";
          }
          this.shift(move, move.dx, move.dy);
        }).catch((error) => console.error("Could not rasterize moving selection:", error));
      }
    }
    this.shift(this.move, dx, dy);
  }

  shift(move, dx, dy) {
    move.dx = dx;
    move.dy = dy;
    if (move.images) {
      for (const image of move.images) image.setAttribute("transform", `translate(${dx} ${dy})`);
    } else {
      move.nodes.forEach((node, index) => {
        const base = move.transforms[index];
        node.setAttribute("transform", `translate(${dx} ${dy})${base ? ` ${base}` : ""}`);
      });
    }
  }

  finish({ cancelled = false } = {}) {
    const move = this.move;
    this.move = null;
    if (!move) return false;
    for (const image of move.images ?? []) image.remove();
    move.nodes.forEach((node, index) => {
      node.style.visibility = "";
      const base = move.transforms[index];
      const transform = cancelled ? base : `translate(${move.dx} ${move.dy})${base ? ` ${base}` : ""}`;
      if (transform) node.setAttribute("transform", transform);
      else node.removeAttribute("transform");
    });
    return !cancelled && move.nodes.length > 0;
  }

  reset() {
    this.finish({ cancelled: true });
    this.flashVersion += 1;
    this.flashNode?.remove();
    this.flashNode = null;
  }
}
