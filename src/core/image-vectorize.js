const MAX_SAMPLES = 2_000_000;
const MAX_PATHS = 15_000;
const HEX_COLOR = /^#([0-9a-f]{6})$/i;

function positiveFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite number greater than zero`);
  }
  return value;
}

function colorComponents(value) {
  const match = HEX_COLOR.exec(value);
  if (!match) throw new TypeError("targetColor must be a six-digit hex color");
  return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16));
}

function pixelPower(pixels, offset, target, tolerance, minimumPower, maximumPower) {
  const red = pixels[offset];
  const green = pixels[offset + 1];
  const blue = pixels[offset + 2];
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const tone = (255 - luminance) / 255;
  const distance = Math.hypot(red - target[0], green - target[1], blue - target[2]);
  const proximity = tolerance === 0 ? 1 : Math.max(0, 1 - distance / tolerance);
  const rawPower = maximumPower * tone * proximity;
  if (rawPower < minimumPower) return 0;
  return Math.max(1, Math.round(rawPower));
}

function pathElement(id, xMm, yMm, widthMm, heightMm, pathData, powerPercent, layerId) {
  return {
    id,
    type: "path",
    xMm,
    yMm,
    widthMm,
    heightMm,
    pathData,
    powerPercent,
    layerId
  };
}

export function vectorizePixels(pixels, pixelWidth, pixelHeight, options) {
  if (!(pixels instanceof Uint8ClampedArray) && !(pixels instanceof Uint8Array)) {
    throw new TypeError("pixels must be an unsigned byte array");
  }
  if (!Number.isSafeInteger(pixelWidth) || !Number.isSafeInteger(pixelHeight) || pixelWidth < 1 || pixelHeight < 1) {
    throw new RangeError("pixel dimensions must be positive integers");
  }
  if (pixelWidth * pixelHeight > MAX_SAMPLES || pixels.length !== pixelWidth * pixelHeight * 4) {
    throw new RangeError(`image sampling is limited to ${MAX_SAMPLES} pixels`);
  }
  const widthMm = positiveFinite(options.widthMm, "widthMm");
  const heightMm = positiveFinite(options.heightMm, "heightMm");
  const pitchMm = positiveFinite(options.pitchMm, "pitchMm");
  const xMm = options.xMm;
  const yMm = options.yMm;
  if (![xMm, yMm].every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new TypeError("image position must contain finite millimetre values");
  }
  if (!["lines", "dots"].includes(options.mode)) throw new RangeError("mode must be lines or dots");
  const minimumPower = options.minimumPowerPercent;
  const maximumPower = options.maximumPowerPercent;
  if (![minimumPower, maximumPower].every((value) => typeof value === "number" && Number.isFinite(value))
    || minimumPower < 0 || maximumPower <= 0 || maximumPower > 100 || minimumPower > maximumPower) {
    throw new RangeError("power range must satisfy 0 <= minimum <= maximum <= 100");
  }
  const tolerance = options.colorTolerance;
  if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 441.7) {
    throw new RangeError("colorTolerance must be between 0 and 441.7");
  }
  const target = colorComponents(options.targetColor);
  const pitchX = widthMm / pixelWidth;
  const pitchY = heightMm / pixelHeight;
  const powers = new Uint8Array(pixelWidth * pixelHeight);
  const preview = new Uint8ClampedArray(pixelWidth * pixelHeight * 4);
  for (let index = 0; index < powers.length; index += 1) {
    const power = pixelPower(pixels, index * 4, target, tolerance, minimumPower, maximumPower);
    powers[index] = Math.round(power);
    const tone = Math.round(255 - power * 2.55);
    const previewOffset = index * 4;
    preview[previewOffset] = tone;
    preview[previewOffset + 1] = tone;
    preview[previewOffset + 2] = tone;
    preview[previewOffset + 3] = 255;
  }

  const layerId = String(options.layerId);
  const idPrefix = String(options.idPrefix ?? "vector-image");
  const elements = [];
  const pushPath = (element) => {
    if (elements.length >= MAX_PATHS) throw new RangeError(`image conversion creates more than ${MAX_PATHS} paths; increase spacing or use a simpler method`);
    elements.push(element);
  };
  if (options.mode === "lines") {
    const rowStep = Math.max(1, Math.round(pitchMm / pitchY));
    for (let row = 0; row < pixelHeight; row += rowStep) {
      const runs = [];
      let column = 0;
      while (column < pixelWidth) {
        const power = powers[row * pixelWidth + column];
        if (power === 0) {
          column += 1;
          continue;
        }
        const first = column;
        while (column < pixelWidth && powers[row * pixelWidth + column] === power) column += 1;
        runs.push({ first, end: column, power });
      }
      if (row / rowStep % 2 === 1) runs.reverse();
      for (const run of runs) {
        const segmentWidth = (run.end - run.first) * pitchX;
        const reverse = row / rowStep % 2 === 1;
        pushPath(pathElement(
          `${idPrefix}-${elements.length + 1}`,
          xMm + run.first * pitchX,
          yMm + row * pitchY,
          segmentWidth,
          0,
          reverse ? `M ${segmentWidth} 0 L 0 0` : `M 0 0 L ${segmentWidth} 0`,
          run.power,
          layerId
        ));
      }
    }
  } else {
    const radius = Math.min(pitchX, pitchY) * 0.22;
    for (let row = 0; row < pixelHeight; row += 1) {
      for (let column = 0; column < pixelWidth; column += 1) {
        const power = powers[row * pixelWidth + column];
        if (power === 0) continue;
        const points = Array.from({ length: 8 }, (_, index) => {
          const angle = Math.PI * 2 * index / 8;
          return [radius + radius * Math.cos(angle), radius + radius * Math.sin(angle)];
        });
        const pathData = points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ") + " Z";
        pushPath(pathElement(
          `${idPrefix}-${elements.length + 1}`,
          xMm + column * pitchX + (pitchX - radius * 2) / 2,
          yMm + row * pitchY + (pitchY - radius * 2) / 2,
          radius * 2,
          radius * 2,
          pathData,
          power,
          layerId
        ));
      }
    }
  }
  if (elements.length === 0) throw new RangeError("the selected intensity and color filters produced no engraving paths");
  return {
    elements,
    preview: { data: preview, width: pixelWidth, height: pixelHeight },
    stats: { pathCount: elements.length, pixelWidth, pixelHeight }
  };
}
