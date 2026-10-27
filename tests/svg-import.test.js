import test from "node:test";
import assert from "node:assert/strict";
import { parseSync, stringify } from "svgson";
import { getSvgViewport, importSvgTree, sanitizeSvgForVisual, validateSvgSource } from "../src/core/svg-import.js";
import { renderSvg } from "../src/core/document.js";
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
  assert.match(renderSvg(imported), /font-size="8"[^>]*rotate\(90\)/);
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
