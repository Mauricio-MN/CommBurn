---
name: laser-job-authoring
description: "Create or edit CommBurn laser jobs, vector objects, embedded images, dimensions, text, coordinate origins, or axis directions using metric values."
---

# Laser job authoring

Use this workflow when implementing or authoring a laser document.

1. Read the project guide and the current document-core API before changing behavior.
2. Keep all dimensions, positions, and text sizes in millimetres from input through SVG export.
3. Validate finite, positive document dimensions and finite object coordinates; report invalid input instead of silently substituting values.
4. Reuse the object geometry and transforms in `src/core/document.js`; supported types are text, rect, ellipse, line, editable SVG paths, embedded PNG/JPEG/WebP images, and sanitized static SVG visual objects. Store dimensions in millimetres and transforms in degrees.
5. Model operation as a validated layer (`engrave`, `cut`, or `fill`) with per-layer feed, power, pass count, fill spacing/algorithm, object order, visibility, and enabled state.
6. Keep editor rendering and pointer-to-millimetre conversion in the UI modules; do not reproduce geometry rules there.
7. Reject output to an exporter or machine adapter that cannot preserve the requested shape, layer operation, or transform; raster images and full SVG visual objects are not supported by the GRBL adapter. Generate previews and G-code from the same core job plan; rapid travel must keep the laser off.
8. Treat origin corner and X/Y axis inversions as explicit user-selected settings. Do not read sensors or guess machine orientation.
9. Keep object geometry and coordinate mapping in the shared core so browser, CLI, AI, and plugin workflows agree.
10. Add focused tests for geometry, layer validation, coordinate mapping, transforms, and serialized output.
11. When importing SVG, use `src/core/svg-import.js`; keep its explicit element/attribute allowlist, reject active or external content and unsupported transforms, allow only embedded raster images, and never silently discard geometry.
12. Raster images are edited with the locally installed MIT `@jodit/image-editor`; never load editor code remotely. Use ImageTracerJS in a local worker for color contours and `src/core/image-vectorize.js` for tonal line/stipple engraving. Keep conversion geometry and metric limits in the shared core, validate path power, and show a preview before replacing the source image.
13. Edit SVG path anchors and controls through the dedicated path editor; keep `pathData` valid and preserve its metric bounds when saving.

## References

- [Project guide](../../../docs/PROJECT_GUIDE.md)
- [Document core](../../../src/core/document.js)
- [UI architecture](../../../docs/UI_ARCHITECTURE.md)
