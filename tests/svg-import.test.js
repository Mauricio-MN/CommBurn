import test from "node:test";
import assert from "node:assert/strict";
import { parseSync, stringify } from "svgson";
import { getSvgViewport, importSvgTree, sanitizeSvgForVisual, validateSvgSource } from "../src/core/svg-import.js";
import { jobReferencePoints, planGrblJob, renderSvg } from "../src/core/document.js";
import { DEFAULT_LAYER } from "../src/core/layers.js";

const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/6ioAAAAASUVORK5CYII=";

function importSvg(source, options) {
  return importSvgTree(parseSync(validateSvgSource(source)), options);
}

test("SVG import converts viewBox coordinates and editable primitives to millimetres", () => {
  const imported = importSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 200 100">
      <rect x="20" y="10" width="40" height="20"/>
      <circle cx="100" cy="50" r="10"/>
      <text x="10" y="80" font-size="8">Laser</text>
      <path d="M 120 10 C 140 10 140 30 120 30 Z"/>
    </svg>`, { layerId: "layer-cut", idPrefix: "input" });

  assert.equal(imported.widthMm, 100);
  assert.equal(imported.heightMm, 50);
  assert.deepEqual(imported.elements.map(({ type }) => type), ["rect", "ellipse", "text", "path"]);
  assert.deepEqual(
    (({ xMm, yMm, widthMm, heightMm }) => ({ xMm, yMm, widthMm, heightMm }))(imported.elements[0]),
    { xMm: 10, yMm: 5, widthMm: 20, heightMm: 10 }
  );
  assert.equal(imported.elements[0].layerId, "layer-cut");
  assert.equal(imported.elements[2].fontSizeMm, 4);
  assert.match(renderSvg({ ...imported, layers: [{ ...DEFAULT_LAYER, id: "layer-cut" }] }), /<path id="input-4"/);
});

test("SVG import preserves the default viewBox aspect ratio and converts physical units", () => {
  const imported = importSvg('<svg width="10cm" height="100mm" viewBox="10 20 200 100"><rect x="10" y="20" width="20" height="10"/></svg>');
  assert.equal(imported.widthMm, 100);
  assert.equal(imported.heightMm, 100);
  assert.equal(imported.elements[0].xMm, 0);
  assert.equal(imported.elements[0].yMm, 25);
  assert.equal(imported.elements[0].widthMm, 10);
  assert.equal(imported.elements[0].heightMm, 5);
});

test("CommBurn SVG round-trip restores layer colors, operations, parameters, and embedded images", () => {
  const source = renderSvg({
    widthMm: 50,
    heightMm: 40,
    layers: [
      {
        id: "cut-blue", name: "Corte azul", operation: "cut", color: "#123abc",
        feedMmPerMinute: 120, passes: 2, fillAlgorithm: "crosshatch", objectOrder: "nearest"
      },
      { id: "photo-layer", name: "Imagem", operation: "engrave", color: "#ef7800" }
    ],
    elements: [
      { id: "outline", type: "rect", xMm: 1, yMm: 2, widthMm: 10, heightMm: 8, layerId: "cut-blue" },
      {
        id: "photo", type: "image", xMm: 5, yMm: 6, widthMm: 20, heightMm: 10,
        imageDataUri: onePixelPng, layerId: "photo-layer"
      },
      {
        id: "tone-path", type: "path", xMm: 25, yMm: 15, widthMm: 5, heightMm: 5,
        pathData: "M 0 0 L 5 5", powerPercent: 42, layerId: "cut-blue"
      }
    ]
  });
  const imported = importSvg(source, { layerId: "active", idPrefix: "restored" });
  const cutLayer = imported.layers.find((layer) => layer.name === "Corte azul");
  const imageLayer = imported.layers.find((layer) => layer.name === "Imagem");

  assert.equal(cutLayer.color, "#123abc");
  assert.equal(cutLayer.operation, "cut");
  assert.equal(cutLayer.feedMmPerMinute, 120);
  assert.equal(cutLayer.passes, 2);
  assert.equal(cutLayer.fillAlgorithm, "crosshatch");
  assert.equal(cutLayer.objectOrder, "nearest");
  assert.equal(imported.elements.find((element) => element.id === "restored-1").layerId, cutLayer.id);
  assert.equal(imported.elements.find((element) => element.id === "restored-3").layerId, imageLayer.id);
  assert.equal(imported.elements.find((element) => element.type === "image").imageDataUri, onePixelPng);
  assert.equal(imported.elements.find((element) => element.id === "restored-2").powerPercent, 42);
  assert.match(renderSvg(imported), /data-color="#123abc"/);
});

test("SVG can be imported entirely into the explicitly selected active layer", () => {
  const source = renderSvg({
    widthMm: 50,
    heightMm: 40,
    layers: [
      { id: "blue", name: "Blue", operation: "engrave", color: "#123abc" },
      { id: "orange", name: "Orange", operation: "cut", color: "#ef7800" }
    ],
    elements: [
      { id: "first", type: "rect", xMm: 1, yMm: 1, widthMm: 4, heightMm: 4, layerId: "blue" },
      { id: "second", type: "rect", xMm: 8, yMm: 1, widthMm: 4, heightMm: 4, layerId: "orange" }
    ]
  });
  const imported = importSvg(source, {
    layerId: "selected-layer",
    forceLayerId: "selected-layer",
    idPrefix: "merged"
  });

  assert.equal(imported.layers.length, 1);
  assert.equal(imported.layers[0].id, "selected-layer");
  assert.deepEqual(imported.elements.map((element) => element.layerId), ["selected-layer", "selected-layer"]);
});

test("active-layer SVG import can split an SVG into one object per closed subpath without duplicating geometry", () => {
  const source = '<svg width="10mm" height="10mm"><path d="M1 1 L3 1 L3 3 Z M5 5 L8 5 L8 8 Z" style="fill:#ff0000; stroke:#0000ff; stroke-width:2px"/></svg>';
  const options = { layerId: "selected", forceLayerId: "selected", fallbackLayer: { id: "selected", color: "#267b62", operation: "engrave" } };

  const kept = importSvg(source, options);
  assert.equal(kept.elements.length, 2);

  const split = importSvg(source, { ...options, splitShapes: true });
  assert.equal(split.elements.length, 4);
  assert.ok(split.elements.every((element) => element.layerId === "selected" && element.type === "path"));
  assert.equal(new Set(split.elements.map((element) => element.id)).size, 4);
  assert.deepEqual(split.elements.map((element) => `${element.fillColorMode}/${element.strokeColorMode}`),
    ["layer/none", "layer/none", "layer/none", "layer/none"]);
  assert.ok(split.elements[2].xMm > split.elements[0].xMm);
});

test("the layer operation changes only how objects look and are machined, never the objects", () => {
  const imported = importSvg(
    '<svg width="10mm" height="10mm"><path d="M3 3 L6 3 L6 6 Z" style="fill:#ff0000; stroke:#0000ff; stroke-width:2"/></svg>',
    { layerId: "selected", forceLayerId: "selected", fallbackLayer: { id: "selected", color: "#267b62", operation: "engrave" } }
  );
  assert.equal(imported.elements.length, 2);
  const asLayer = (operation) => ({ ...imported, layers: [{ ...DEFAULT_LAYER, id: "selected", color: "#267b62", operation }] });
  const engrave = renderSvg(asLayer("engrave"));
  assert.match(engrave, /<path id="svg-1"[^>]*fill="none" stroke="#267b62" stroke-width="0.2"/);
  assert.match(engrave, /<path id="svg-2"[^>]*fill="none" stroke="#267b62" stroke-width="0.2"/);
  assert.notEqual(imported.elements[0].pathData, imported.elements[1].pathData);
  assert.equal(imported.elements[1].pathData.match(/M/g).length, 2);
  const fill = renderSvg(asLayer("fill"));
  assert.match(fill, /<path id="svg-1"[^>]*fill="#267b62" stroke="none"/);
  assert.match(fill, /<path id="svg-2"[^>]*fill="#267b62" stroke="none"/);
  const worked = (operation) => new Set(planGrblJob(asLayer(operation), { maxSpindleSpeed: 1000 }).paths
    .filter(({ kind }) => kind === "work").map(({ elementId }) => elementId));
  assert.deepEqual([...worked("engrave")], ["svg-1", "svg-2"]);
  assert.deepEqual([...worked("fill")], ["svg-1", "svg-2"]);
});

test("active-layer SVG import preserves the layer color even when path styles specify different paints", () => {
  const imported = importSvg(
    '<svg width="10mm" height="10mm"><path d="M1 1 L5 5" style="fill:#ff0000; stroke:#0000ff; stroke-width:2px"/></svg>',
    {
      layerId: "selected",
      forceLayerId: "selected",
      fallbackLayer: { id: "selected", color: "#267b62", operation: "engrave" }
    }
  );
  const [element, strokePart] = imported.elements;
  const rendered = renderSvg({
    ...imported,
    layers: [{ ...DEFAULT_LAYER, id: "selected", color: "#267b62", operation: "engrave" }]
  });

  assert.equal(element.layerId, "selected");
  assert.equal(element.color, undefined);
  assert.deepEqual([element.fillColorMode, element.strokeColorMode], ["layer", "none"]);
  assert.deepEqual([strokePart.fillColorMode, strokePart.strokeColorMode], ["layer", "none"]);
  assert.match(rendered, /data-color="#267b62"/);
  assert.doesNotMatch(rendered, /#ff0000|#0000ff/);
});

test("SVG editable import can group geometry into layers by source color", () => {
  const imported = importSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="10mm" viewBox="0 0 20 10">
      <rect x="1" y="1" width="4" height="4" fill="#ff0000"/>
      <rect x="8" y="1" width="4" height="4" fill="#0000ff"/>
    </svg>`, { layerId: "active", idPrefix: "colors" });
  const redLayer = imported.layers.find((layer) => layer.color === "#ff0000");
  const blueLayer = imported.layers.find((layer) => layer.color === "#0000ff");

  assert.ok(redLayer);
  assert.ok(blueLayer);
  assert.equal(redLayer.operation, "engrave");
  assert.equal(blueLayer.operation, "engrave");
  assert.deepEqual(imported.elements.map((element) => element.layerId), [redLayer.id, blueLayer.id]);
});

test("SVG paths with different fill and stroke colors import as separate layer paths", () => {
  const imported = importSvg(`
    <svg width="20mm" height="10mm" viewBox="0 0 20 10">
      <path d="M3 3 L7 3 L7 7 Z" style="fill:#ff0000; stroke:#0000ff; stroke-width:1.5"/>
    </svg>`, { layerId: "active", idPrefix: "split" });
  const [fillPath, strokePath] = imported.elements;
  const fillLayer = imported.layers.find(({ id }) => id === fillPath.layerId);
  const strokeLayer = imported.layers.find(({ id }) => id === strokePath.layerId);
  const rendered = renderSvg(imported);
  const plan = planGrblJob(imported, { maxSpindleSpeed: 1000 });

  assert.equal(fillPath.type, "path");
  assert.equal(strokePath.type, "path");
  assert.notEqual(fillPath.id, strokePath.id);
  assert.notEqual(fillPath.pathData, strokePath.pathData);
  assert.equal(strokePath.pathData.match(/M/g).length, 2);
  assert.equal(strokePath.strokeWidthMm, undefined);
  assert.deepEqual([fillLayer.operation, fillLayer.color], ["engrave", "#ff0000"]);
  assert.deepEqual([strokeLayer.operation, strokeLayer.color], ["engrave", "#0000ff"]);
  assert.deepEqual([fillPath.fillColorMode, fillPath.strokeColorMode], ["layer", "none"]);
  assert.deepEqual([strokePath.fillColorMode, strokePath.strokeColorMode], ["layer", "none"]);
  assert.match(rendered, /fill="none" stroke="#ff0000" stroke-width="0.2"/);
  assert.match(rendered, /fill="none" stroke="#0000ff" stroke-width="0.2"/);
  assert.ok(plan.paths.some(({ elementId, operation }) => elementId === fillPath.id && operation === "engrave"));
  assert.ok(plan.paths.some(({ elementId, operation }) => elementId === strokePath.id && operation === "engrave"));
});

test("SVG path stroke width inherits and scales into millimetres", () => {
  const imported = importSvg(`
    <svg width="20mm" height="10mm" viewBox="0 0 20 10">
      <g stroke-width="2">
        <path d="M1 1 L5 5" transform="scale(2)" fill="none" stroke="#0000ff"/>
      </g>
    </svg>`);
  const [path] = imported.elements;

  assert.equal(path.strokeWidthMm, 4);
  assert.match(renderSvg(imported), /stroke-width="0.2"/);
});

test("editable SVG geometry stays native through GRBL planning and uses the selected layer", () => {
  const source = `
    <svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="10mm" viewBox="0 0 20 10">
      <rect x="1" y="1" width="4" height="4" fill="#ff0000"/>
      <path d="M 8 1 L 12 5" fill="none" stroke="#0000ff"/>
    </svg>`;
  const byColor = importSvg(source, { layerId: "active", idPrefix: "native" });
  const plan = planGrblJob(byColor, { maxSpindleSpeed: 1000 });

  assert.deepEqual(byColor.elements.map(({ type }) => type), ["rect", "path"]);
  assert.ok(plan.paths.some(({ kind, elementId }) => kind === "work" && elementId === "native-1"));
  assert.ok(plan.paths.some(({ kind, elementId }) => kind === "work" && elementId === "native-2"));

test("SVG path imports safe inline fill and stroke styles", () => {
  const filled = importSvg('<svg width="10mm" height="10mm"><path d="M1 1 L5 1 L5 5 Z" style="fill:#ff0000; stroke:none"/></svg>');
  const stroked = importSvg('<svg width="10mm" height="10mm"><path d="M1 1 L5 5" style="fill:none; stroke:#123456; stroke-width:1.5"/></svg>');
  const filledElement = filled.elements[0];
  const strokedElement = stroked.elements[0];
  const filledLayer = filled.layers.find(({ id }) => id === filledElement.layerId);
  const strokedLayer = stroked.layers.find(({ id }) => id === strokedElement.layerId);

  assert.equal(filledLayer.operation, "engrave");
  assert.equal(filledLayer.color, "#ff0000");
  assert.equal(filledElement.fillColorMode, "layer");
  assert.equal(filledElement.strokeColorMode, "none");
  assert.match(renderSvg(filled), /fill="none" stroke="#ff0000"/);
  assert.equal(strokedLayer.operation, "engrave");
  assert.equal(strokedLayer.color, "#123456");
  assert.equal(strokedElement.fillColorMode, "none");
  assert.equal(strokedElement.strokeColorMode, "layer");
  assert.equal(strokedElement.type, "path");
  assert.throws(
    () => importSvg('<svg width="10mm" height="10mm"><path d="M1 1 L5 5" style="fill:url(https://example.invalid/a.svg#paint)"/></svg>'),
    /external or unsupported content/
  );
  assert.throws(
    () => importSvg('<svg width="10mm" height="10mm"><path d="M1 1 L5 5" style="opacity:0.5"/></svg>'),
    /unsupported <path> style property "opacity"/
  );
  assert.throws(
    () => importSvg('<svg width="10mm" height="10mm"><path d="M1 1 L5 5" style="stroke-width:-1"/></svg>'),
    /stroke-width must be a non-negative finite SVG length/
  );
});
  assert.ok(byColor.elements.every(({ type }) => type !== "image" && type !== "svg-image"));

  const inCurrentLayer = importSvg(source, {
    layerId: "selected",
    forceLayerId: "selected",
    fallbackLayer: { id: "selected", color: "#267b62", operation: "engrave" },
    idPrefix: "current"
  });
  const currentLayerSvg = renderSvg({
    ...inCurrentLayer,
    layers: [{ ...DEFAULT_LAYER, id: "selected", color: "#267b62", operation: "engrave" }]
  });

  assert.equal(inCurrentLayer.layers.length, 1);
  assert.ok(inCurrentLayer.elements.every(({ layerId }) => layerId === "selected"));
  assert.match(currentLayerSvg, /data-color="#267b62"/);
  assert.doesNotMatch(currentLayerSvg, /data-color="#ff0000"|data-color="#0000ff"/);
});

test("SVG import strips external doctypes without fetching them and decodes standard XML references", () => {
  const source = `<?xml version="1.0"?>
    <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "https://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
    <svg width="30mm" height="20mm"><text x="1" y="5">A &amp; B &#169;</text></svg>`;
  const sanitized = validateSvgSource(source);
  const imported = importSvg(source);

  assert.doesNotMatch(sanitized, /<!DOCTYPE/i);
  assert.equal(imported.elements[0].text, "A & B ©");
  assert.throws(() => importSvg('<!DOCTYPE svg SYSTEM "https://example.invalid/svg.dtd"><svg width="10mm" height="10mm"><text>&external;</text></svg>'), /undeclared XML entity/);
});

test("SVG import expands bounded internal text entities without resolving external entities", () => {
  const source = `<!DOCTYPE svg [
    <!ELEMENT svg ANY>
    <!ENTITY brand "CommBurn">
    <!ENTITY copyright "&#169;">
  ]><svg width="20mm" height="10mm"><text x="1" y="5">&brand; &copyright;</text></svg>`;
  const imported = importSvg(source);

  assert.equal(imported.elements[0].text, "CommBurn ©");
  assert.throws(() => validateSvgSource('<!DOCTYPE svg [<!ENTITY x SYSTEM "https://example.invalid/x">]><svg/>'), /only internal text entity declarations/);
  assert.throws(() => validateSvgSource('<!DOCTYPE svg [<!ENTITY x "&x;">]><svg>&x;</svg>'), /recursive XML entity/);
  assert.throws(() => validateSvgSource('<!DOCTYPE svg [<!ATTLIST svg fill CDATA "#fff">]><svg/>'), /ATTLIST default attributes/);
  assert.equal(importSvg('<svg width="20mm" height="10mm"><text x="1" y="5"><![CDATA[A &amp; B]]></text></svg>').elements[0].text, "A &amp; B");
});

test("visual SVG sanitization preserves static effects and removes active content", () => {
  const source = `<!DOCTYPE svg SYSTEM "https://example.invalid/svg.dtd">
    <svg xmlns="http://www.w3.org/2000/svg" width="30mm" height="20mm" viewBox="0 0 30 20">
      <defs>
        <linearGradient id="paint"><stop offset="0%" stop-color="#f00"/><stop offset="100%" stop-color="#00f"/></linearGradient>
        <filter id="blur"><feGaussianBlur stdDeviation="1"/></filter>
      </defs>
      <style>.shape { fill: url(#paint); filter: url(#blur); }</style>
      <rect class="shape" width="20" height="10" onload="run()"/>
      <script>alert(1)</script><animate attributeName="x" to="20"/>
    </svg>`;
  const tree = parseSync(validateSvgSource(source));
  const sanitized = sanitizeSvgForVisual(tree, { parseSync, stringify });
  const viewport = getSvgViewport(tree);

  assert.deepEqual(viewport, { widthMm: 30, heightMm: 20 });
  assert.match(sanitized.source, /linearGradient/);
  assert.match(sanitized.source, /feGaussianBlur/);
  assert.match(sanitized.source, /url\(#paint\)/);
  assert.doesNotMatch(sanitized.source, /<script|onload=/i);
  assert.match(sanitized.source, /<animate\b/i);
  assert.equal(sanitized.removedActiveContent, true);
  const percentageViewport = parseSync('<svg width="100%" height="100%" viewBox="0 0 400 200"><circle cx="1" cy="1" r="1"/></svg>');
  assert.deepEqual(getSvgViewport(percentageViewport), {
    widthMm: 400 * 25.4 / 96,
    heightMm: 200 * 25.4 / 96
  });
  assert.match(sanitizeSvgForVisual(percentageViewport, { parseSync, stringify }).source, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  const nestedSvg = Buffer.from('<svg width="2mm" height="2mm"><script>alert(1)</script><circle cx="1" cy="1" r="1"/></svg>').toString("base64");
  const nestedSource = `<svg width="10mm" height="10mm"><image href="data:image/svg+xml;base64,${nestedSvg}" width="2" height="2"/></svg>`;
  const nestedTree = parseSync(validateSvgSource(nestedSource));
  const sanitizedNested = sanitizeSvgForVisual(nestedTree, { parseSync, stringify });
  const nestedHref = parseSync(sanitizedNested.source).children[0].attributes.href;
  const nestedContent = Buffer.from(nestedHref.split(",")[1], "base64").toString("utf8");
  assert.doesNotMatch(nestedContent, /<script/i);
  assert.equal(sanitizedNested.removedActiveContent, true);
  assert.throws(() => sanitizeSvgForVisual(
    parseSync('<svg><style>.x { fill: url(https://example.invalid/a.svg#paint) }</style></svg>'),
    { parseSync, stringify }
  ), /external or unsupported content/);
  const escapedExternalUrl = String.raw`<svg><style>.x { fill: u\72l(https://example.invalid/a.svg#paint) }</style></svg>`;
  assert.throws(() => sanitizeSvgForVisual(
    parseSync(escapedExternalUrl),
    { parseSync, stringify }
  ), /external or unsupported content/);
});

test("SVG text imports uniform scale, translation, and rotation transforms", () => {
  const imported = importSvg(`
    <svg width="100mm" height="50mm" viewBox="0 0 200 100">
      <text x="10" y="20" font-size="8" transform="translate(5,3) scale(2) rotate(90)">Laser</text>
    </svg>`);
  const [text] = imported.elements;
  assert.equal(text.xMm, -17.5);
  assert.ok(Math.abs(text.yMm - 11.5) < 1e-9);
  assert.equal(text.fontSizeMm, 8);
  assert.equal(text.rotationDeg, 90);
  assert.match(renderSvg(imported), /<text id="svg-1"[^>]*rotate\(90\)[^>]*>/);
});

test("SVG text preserves external font families and refuses unavailable GRBL outlines", () => {
  const imported = importSvg(`
    <svg width="100mm" height="50mm" viewBox="0 0 100 50">
      <text x="5" y="12" font-size="8" font-family="Example Display">Laser</text>
    </svg>`);

  assert.equal(imported.elements[0].fontFamily, "Example Display");
  assert.match(renderSvg(imported), /font-family="Example Display"/);
  assert.throws(
    () => planGrblJob(imported, { maxSpindleSpeed: 1000 }),
    { code: "grbl.unsupportedTextFont" }
  );
});

test("SVG group and geometry transforms are composed and converted to metric geometry", () => {
  const imported = importSvg(`
    <svg width="100mm" height="100mm" viewBox="0 0 100 100">
      <g transform="translate(10 5)">
        <g transform="scale(2)">
          <rect x="1" y="2" width="3" height="4"/>
        </g>
      </g>
      <g transform="translate(20 0) rotate(90)">
        <rect x="1" y="2" width="3" height="4"/>
      </g>
      <g transform="translate(10 5) rotate(90)">
        <text x="2" y="3" font-size="2">Group text</text>
      </g>
      <path d="M 1 1 L 3 1" transform="translate(5 4) scale(2)"/>
      <g transform="translate(20 30) rotate(90)">
        <image x="1" y="2" width="4" height="6" href="${onePixelPng}"/>
      </g>
    </svg>`);
  const [scaled, rotated, text, transformedPath, image] = imported.elements;

  assert.deepEqual(
    (({ type, xMm, yMm, widthMm, heightMm }) => ({ type, xMm, yMm, widthMm, heightMm }))(scaled),
    { type: "rect", xMm: 12, yMm: 9, widthMm: 6, heightMm: 8 }
  );
  assert.equal(rotated.type, "path");
  assert.ok(Math.abs(rotated.xMm - 14) < 1e-9);
  assert.ok(Math.abs(rotated.yMm - 1) < 1e-9);
  assert.ok(Math.abs(rotated.widthMm - 4) < 1e-9);
  assert.ok(Math.abs(rotated.heightMm - 3) < 1e-9);
  assert.equal(text.type, "text");
  assert.deepEqual([text.xMm, text.yMm, text.fontSizeMm, text.rotationDeg], [7, 7, 2, 90]);
  assert.equal(transformedPath.type, "path");
  assert.deepEqual([transformedPath.xMm, transformedPath.yMm, transformedPath.widthMm, transformedPath.heightMm], [7, 6, 4, 0]);
  assert.equal(image.type, "image");
  assert.ok(Math.abs(image.xMm - 13) < 1e-9);
  assert.ok(Math.abs(image.yMm - 30) < 1e-9);
  assert.equal(image.widthMm, 4);
  assert.equal(image.heightMm, 6);
  assert.equal(image.rotationDeg, 90);
});

test("SVG import rejects active content, unsupported geometry, and unsafe attributes", () => {
  assert.throws(() => validateSvgSource('<!DOCTYPE svg [<!ENTITY % x SYSTEM "https://example.invalid/x">]><svg/>'), /only internal text entity declarations/);
  assert.throws(() => importSvg('<svg width="10mm" height="10mm"><script>alert(1)</script></svg>'), /unsupported element <script>/);
  assert.throws(() => importSvg('<svg width="10mm" height="10mm"><rect x="0" y="0" width="2" height="2" onclick="alert(1)"/></svg>'), /unsupported <rect> attribute "onclick"/);
  assert.throws(() => importSvg('<svg width="10mm" height="10mm"><image href="https://example.invalid/a.png"/></svg>'), /external image references are not loaded/);
  assert.throws(() => importSvg('<svg width="10mm" height="10mm"><text x="1" y="2" transform="scale(2 1)">No</text></svg>'), /non-uniform scale/);
  assert.throws(() => importSvg('<svg width="10mm" height="10mm"><rect x="0" y="0" width="2" height="2" style="fill:url(x)"/></svg>'), /unsupported <rect> attribute "style"/);
});

test("SVG import enforces finite dimensions, non-empty geometry, and supported text", () => {
  assert.throws(() => importSvg('<svg width="Infinity" height="10mm"><rect width="2" height="2"/></svg>'), /width must use/);
  assert.throws(() => importSvg('<svg width="10mm" height="10mm"><rect width="-1" height="2"/></svg>'), /rect width and height/);
  assert.throws(() => importSvg('<svg width="10mm" height="10mm"><text><tspan>unsafe nested text</tspan></text></svg>'), /nested markup inside <text>/);
  const withMetadata = importSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="10mm">
      <title>Laser project</title>
      <desc>Metadata does not create visible geometry</desc>
      <metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
        <rdf:Description><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Artwork</dc:title></rdf:Description>
      </rdf:RDF></metadata>
      <rect x="1" y="1" width="5" height="4"/>
    </svg>`);
  assert.equal(withMetadata.elements.length, 1);
  assert.equal(withMetadata.elements[0].type, "rect");
});

test("editor preview matches the machine plan: engrave shows outlines, fill layers show fill, nothing becomes invisible", () => {
  for (const operation of ["engrave", "cut", "fill"]) {
    const layer = { ...DEFAULT_LAYER, color: "#123456", operation };
    const elements = [
      { id: "p", type: "path", xMm: 1, yMm: 1, widthMm: 8, heightMm: 8, pathData: "M0 0L8 0L8 8Z", layerId: layer.id, layerId: layer.id },
      { id: "t", type: "text", text: "A", fontFamily: "sans-serif", xMm: 2, yMm: 15, fontSizeMm: 5, layerId: layer.id }
    ];
    const svg = renderSvg({ widthMm: 20, heightMm: 20, layers: [layer], elements });
    const expected = operation === "fill" ? /fill="#123456"/ : /fill="none" stroke="#123456"/;
    assert.equal(svg.match(new RegExp(expected.source, "g")).length, 2, operation);
  }
});

test("split import separates subpaths in both import modes with unique ids", () => {
  const source = `<svg width="40mm" height="20mm" viewBox="0 0 40 20"><path d="M1 1L9 1L9 9Z M20 1L30 1L30 9Z" fill="#f00" stroke="#00f"/></svg>`;
  for (const options of [{ layerId: "a", forceLayerId: "a", idPrefix: "s" }, { layerId: "a", idPrefix: "s" }]) {
    const { elements } = importSvg(source, { ...options, splitShapes: true });
    assert.ok(elements.length >= 2);
    assert.equal(new Set(elements.map(({ id }) => id)).size, elements.length);
    assert.ok(new Set(elements.map(({ xMm }) => xMm)).size >= 2);
  }
});

test("mouse-cursor-presentation.svg is a single closed shape: fill and stroke objects on the active layer, fill and stroke layers by color", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../mouse-cursor-presentation.svg", import.meta.url), "utf8");
  const fallbackLayer = { ...DEFAULT_LAYER, id: "a", color: "#000000" };
  const base = { layerId: "a", fallbackLayer, idPrefix: "s", splitShapes: true };
  assert.equal(importSvg(source, { ...base, forceLayerId: "a" }).elements.length, 2);
  assert.equal(importSvg(source, base).elements.length, 2);
});

test("imports larger than the table are scaled down uniformly to fit, and the scale is reported", async () => {
  const { fitImportedToTable } = await import("../src/core/svg-import.js");
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../mouse-cursor-presentation.svg", import.meta.url), "utf8");
  const imported = importSvg(source, { layerId: "a", forceLayerId: "a", fallbackLayer: { ...DEFAULT_LAYER, id: "a", color: "#000000" }, splitShapes: true });
  const fitted = fitImportedToTable(imported, 180, 120);
  assert.ok(fitted.scale < 1);
  assert.ok(fitted.widthMm <= 180 + 1e-9 && fitted.heightMm <= 120 + 1e-9);
  assert.ok(fitted.elements.every(({ xMm, yMm, widthMm, heightMm }) => xMm >= 0 && yMm >= 0 && xMm + widthMm <= 180 + 1e-9 && yMm + heightMm <= 120 + 1e-9));
  assert.equal(fitImportedToTable(imported, 1000, 1000).scale, 1);
});

test("STAGE preview: every vector type looks the same way per operation (fill solid, engrave outline, cut dashed outline)", () => {
  const base = { xMm: 1, yMm: 1, widthMm: 8, heightMm: 8, layerId: DEFAULT_LAYER.id };
  const elements = [
    { ...base, id: "r", type: "rect" },
    { ...base, id: "e", type: "ellipse" },
    { ...base, id: "p", type: "path", pathData: "M0 0L8 0L8 8Z" },
    { ...base, id: "pc", type: "path", pathData: "M0 0L8 0L8 8Z", fillColorMode: "layer", strokeColorMode: "layer", strokeWidthMm: 1 },
    { id: "t", type: "text", text: "A", fontFamily: "sans-serif", xMm: 2, yMm: 15, fontSizeMm: 5, layerId: DEFAULT_LAYER.id }
  ];
  const render = (operation) => renderSvg({ widthMm: 20, heightMm: 20, layers: [{ ...DEFAULT_LAYER, color: "#123456", operation }], elements });
  const tagOf = (svg, id) => svg.match(new RegExp(`<[a-z]+ id="${id}"[^>]*>`))[0];
  for (const { id } of elements) {
    assert.match(tagOf(render("fill"), id), /fill="#123456" stroke="none"/, `fill ${id}`);
    assert.match(tagOf(render("engrave"), id), /fill="none" stroke="#123456"/, `engrave ${id}`);
    assert.doesNotMatch(tagOf(render("engrave"), id), /stroke-dasharray/, `engrave ${id}`);
    assert.match(tagOf(render("cut"), id), /fill="none" stroke="#123456"[^>]*stroke-dasharray/, `cut ${id}`);
  }
});

test("diagonal and vertical-unidirectional fills stay inside the shape and follow the right direction", () => {
  const element = { id: "tri", type: "path", xMm: 2, yMm: 2, widthMm: 10, heightMm: 10, pathData: "M0 0L10 0L10 10Z", layerId: "f" };
  const rect = { id: "box", type: "rect", xMm: 2, yMm: 2, widthMm: 10, heightMm: 10, layerId: "f" };
  const run = (algorithm, el) => planGrblJob({
    widthMm: 20, heightMm: 20,
    layers: [{ ...DEFAULT_LAYER, id: "f", operation: "fill", fillAlgorithm: algorithm, fillSpacingMm: 1 }],
    elements: [el]
  }, { maxSpindleSpeed: 1000 }).paths.filter(({ kind }) => kind === "work");
  for (const el of [element, rect]) {
    for (const algorithm of ["diagonal-serpentine", "diagonal-crosshatch"]) {
      const paths = run(algorithm, el);
      assert.ok(paths.length > 5, `${algorithm} ${el.id}`);
      for (const { points } of paths) for (const { xMm, yMm } of points) {
        assert.ok(xMm >= 1.99 && xMm <= 12.01 && yMm >= 1.99 && yMm <= 12.01, `${algorithm} ${el.id} stays inside`);
      }
      const [{ points: [first, second] }] = paths;
      assert.ok(Math.abs(Math.abs(second.xMm - first.xMm) - Math.abs(second.yMm - first.yMm)) < 1e-6, "45 degrees");
    }
  }
  const vertical = run("vertical-unidirectional", rect);
  assert.ok(vertical.every(({ points: [a, b] }) => b.yMm !== a.yMm && a.xMm === b.xMm));
  assert.equal(new Set(vertical.map(({ points: [a, b] }) => Math.sign(b.yMm - a.yMm))).size, 1);
});

test("starting from the objects shifts the job so the chosen anchor becomes X0 Y0 for every origin", () => {
  const document = (origin) => ({
    widthMm: 100, heightMm: 80, origin,
    layers: [{ ...DEFAULT_LAYER, id: "l", operation: "engrave" }],
    elements: [{ id: "r", type: "rect", xMm: 30, yMm: 20, widthMm: 10, heightMm: 6, layerId: "l" }]
  });
  const bounds = (job) => {
    const points = job.paths.filter(({ kind }) => kind === "work").flatMap(({ points: list }) => list);
    return [Math.min(...points.map((p) => p.xMm)), Math.min(...points.map((p) => p.yMm)),
      Math.max(...points.map((p) => p.xMm)), Math.max(...points.map((p) => p.yMm))];
  };
  const settings = (extra) => ({ maxSpindleSpeed: 1000, ...extra });
  for (const origin of [{}, { corner: "bottom-right" }, { flipX: true }, { corner: "bottom-left", flipY: true }]) {
    const absolute = planGrblJob(document(origin), settings());
    assert.ok(bounds(absolute)[0] >= 20, "absolute keeps table coordinates");
    const left = bounds(planGrblJob(document(origin), settings({ startFrom: "objects", startAnchor: "top-left" })));
    const right = bounds(planGrblJob(document(origin), settings({ startFrom: "objects", startAnchor: "bottom-right" })));
    const flipX = (origin.corner?.endsWith("right") ?? false) !== (origin.flipX ?? false);
    const flipY = (origin.corner?.startsWith("bottom") ?? false) !== (origin.flipY ?? false);
    // The anchor point lands on 0 and the rest of the drawing extends away from it in machine axes.
    assert.deepEqual([left[flipX ? 2 : 0], left[flipY ? 3 : 1]], [0, 0]);
    assert.deepEqual([right[flipX ? 0 : 2], right[flipY ? 1 : 3]], [0, 0]);
    assert.ok(Math.abs(left[2] - left[0] - 10) < 1e-9 && Math.abs(left[3] - left[1] - 6) < 1e-9);
  }
  const centered = planGrblJob(document({}), settings({ startFrom: "objects", startAnchor: "center" }));
  assert.deepEqual(centered.stats.startOffsetMm, { xMm: 35, yMm: 23 });
  assert.match(planGrblJob(document({}), settings({ workCoordinateSystem: "G55" })).gcode, /^G21\nG55\nG90/);
  assert.throws(() => planGrblJob(document({}), settings({ startFrom: "nowhere" })), /start mode/);
});

test("job reference points follow origin, axis inversion and start mode in document coordinates", () => {
  const base = {
    widthMm: 100, heightMm: 80,
    layers: [{ ...DEFAULT_LAYER, id: "l" }],
    elements: [{ id: "r", type: "rect", xMm: 30, yMm: 20, widthMm: 10, heightMm: 6, layerId: "l" }]
  };
  const settings = { maxSpindleSpeed: 1000 };
  const top = jobReferencePoints(base, settings);
  assert.deepEqual([top.origin, top.xDirection, top.yDirection], [{ xMm: 0, yMm: 0 }, 1, 1]);
  assert.deepEqual(top.start, { xMm: 30, yMm: 20 });
  const bottomRight = jobReferencePoints({ ...base, origin: { corner: "bottom-right" } }, settings);
  assert.deepEqual([bottomRight.origin, bottomRight.xDirection, bottomRight.yDirection], [{ xMm: 100, yMm: 80 }, -1, -1]);
  assert.deepEqual(bottomRight.start, { xMm: 30, yMm: 20 });
  const onObjects = jobReferencePoints(base, { ...settings, startFrom: "objects", startAnchor: "bottom-right" });
  assert.deepEqual(onObjects.origin, { xMm: 40, yMm: 26 });
});

test("job reference bounds cover every work point in document coordinates for any origin", () => {
  const base = {
    widthMm: 100, heightMm: 80,
    layers: [{ ...DEFAULT_LAYER, id: "l" }],
    elements: [
      { id: "a", type: "rect", xMm: 30, yMm: 20, widthMm: 10, heightMm: 6, layerId: "l" },
      { id: "b", type: "rect", xMm: 60, yMm: 50, widthMm: 10, heightMm: 6, layerId: "l" }
    ]
  };
  const expected = { minXMm: 30, minYMm: 20, maxXMm: 70, maxYMm: 56 };
  for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
    assert.deepEqual(jobReferencePoints({ ...base, origin: { corner } }, { maxSpindleSpeed: 1000 }).bounds, expected);
  }
  const shifted = jobReferencePoints(base, { maxSpindleSpeed: 1000, startFrom: "objects", startAnchor: "bottom-right" });
  assert.deepEqual(shifted.bounds, expected);
  assert.deepEqual(shifted.end, { xMm: 60, yMm: 50 });
});

test("job reference points are unavailable for rotated objects instead of guessing", () => {
  const rotated = {
    widthMm: 100, heightMm: 80,
    layers: [{ ...DEFAULT_LAYER, id: "l" }],
    elements: [{ id: "a", type: "rect", xMm: 30, yMm: 20, widthMm: 10, heightMm: 6, rotationDeg: 30, layerId: "l" }]
  };
  assert.throws(() => jobReferencePoints(rotated, { maxSpindleSpeed: 1000 }), /transform/i);
});
