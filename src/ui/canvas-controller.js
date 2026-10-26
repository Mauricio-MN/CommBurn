import { mapDocumentPoint } from "../core/document.js";

function toCanvasPoint(svg, event) {
  const screenPoint = svg.createSVGPoint();
  screenPoint.x = event.clientX;
  screenPoint.y = event.clientY;
  return screenPoint.matrixTransform(svg.getScreenCTM().inverse());
}

function getCenter(document, element) {
  const start = mapDocumentPoint(document, element.xMm, element.yMm);
  if (element.type === "text") return { xMm: start.xMm, yMm: start.yMm };
  if (element.type === "line") {
    const end = mapDocumentPoint(document, element.xMm + element.widthMm, element.yMm + element.heightMm);
    return { xMm: (start.xMm + end.xMm) / 2, yMm: (start.yMm + end.yMm) / 2 };
  }
  const xMm = start.flipX ? start.xMm - element.widthMm : start.xMm;
  const yMm = start.flipY ? start.yMm - element.heightMm : start.yMm;
  return { xMm: xMm + element.widthMm / 2, yMm: yMm + element.heightMm / 2 };
}

function angleBetween(center, point) {
  return Math.atan2(point.y - center.yMm, point.x - center.xMm) * 180 / Math.PI;
}

function clampWarp(angle) {
  return Math.max(-79, Math.min(79, angle));
}

export class CanvasController {
  constructor(svg, callbacks) {
    this.svg = svg;
    this.callbacks = callbacks;
    this.interaction = null;
    svg.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    svg.addEventListener("pointermove", (event) => this.onPointerMove(event));
    svg.addEventListener("pointerup", (event) => this.onPointerUp(event));
    svg.addEventListener("pointercancel", (event) => this.onPointerUp(event));
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    const node = event.target.closest("[data-id]");
    if (!node) {
      this.callbacks.deselect();
      return;
    }
    const id = node.dataset.id;
    const document = this.callbacks.getDocument();
    const element = document.elements.find((candidate) => candidate.id === id);
    if (!element) return;
    this.callbacks.select(id);
    const tool = this.callbacks.getTool();
    if (tool === "select" || tool === "edit") return;

    const point = toCanvasPoint(this.svg, event);
    const center = getCenter(document, element);
    this.interaction = {
      pointerId: event.pointerId,
      id,
      tool,
      startPoint: point,
      center,
      startX: element.xMm,
      startY: element.yMm,
      startRotation: element.rotationDeg,
      startSkewX: element.skewXDeg,
      startSkewY: element.skewYDeg,
      startAngle: angleBetween(center, point),
      scaleMm: Math.max(element.widthMm ?? element.fontSizeMm, element.heightMm ?? element.fontSizeMm, 1),
      flipX: mapDocumentPoint(document, element.xMm, element.yMm).flipX,
      flipY: mapDocumentPoint(document, element.xMm, element.yMm).flipY
    };
    this.svg.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  onPointerMove(event) {
    const action = this.interaction;
    if (!action || event.pointerId !== action.pointerId) return;
    const point = toCanvasPoint(this.svg, event);
    const deltaX = point.x - action.startPoint.x;
    const deltaY = point.y - action.startPoint.y;

    if (action.tool === "move") {
      this.callbacks.update(action.id, {
        xMm: action.startX + deltaX * (action.flipX ? -1 : 1),
        yMm: action.startY + deltaY * (action.flipY ? -1 : 1)
      });
    } else if (action.tool === "rotate") {
      const angleDelta = angleBetween(action.center, point) - action.startAngle;
      const normalizedDelta = ((angleDelta + 180) % 360 + 360) % 360 - 180;
      this.callbacks.update(action.id, { rotationDeg: action.startRotation + normalizedDelta });
    } else if (action.tool === "warp") {
      this.callbacks.update(action.id, {
        skewXDeg: clampWarp(action.startSkewX + deltaX / action.scaleMm * 30),
        skewYDeg: clampWarp(action.startSkewY + deltaY / action.scaleMm * 30)
      });
    }
  }

  onPointerUp(event) {
    if (!this.interaction || event.pointerId !== this.interaction.pointerId) return;
    this.interaction = null;
    this.callbacks.commit();
  }
}
