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
    this.marquee = svg.querySelector("#selection-marquee");
    svg.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    svg.addEventListener("pointermove", (event) => this.onPointerMove(event));
    svg.addEventListener("pointerup", (event) => this.onPointerUp(event));
    svg.addEventListener("pointercancel", (event) => this.onPointerUp(event));
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    const node = event.target.closest("[data-id]");
    const tool = this.callbacks.getTool();
    if (!node) {
      if (["select", "multi-select", "edit"].includes(tool)) {
        this.interaction = {
          type: "marquee",
          pointerId: event.pointerId,
          startPoint: toCanvasPoint(this.svg, event),
          startClientX: event.clientX,
          startClientY: event.clientY,
          additive: event.shiftKey || tool === "multi-select",
          moved: false
        };
        this.svg.setPointerCapture(event.pointerId);
        event.preventDefault();
      } else {
        this.callbacks.deselect();
      }
      return;
    }
    const id = node.dataset.id;
    const document = this.callbacks.getDocument();
    const element = document.elements.find((candidate) => candidate.id === id);
    if (!element) return;
    const currentIds = this.callbacks.getSelectedIds();
    this.callbacks.select(id, {
      additive: event.shiftKey || tool === "multi-select",
      toggle: event.shiftKey,
      keepExisting: currentIds.includes(id) && !event.shiftKey
    });
    if (["select", "multi-select", "edit"].includes(tool)) return;
    const selectedIds = this.callbacks.getSelectedIds();
    if (!selectedIds.includes(id)) return;
    const selected = document.elements.filter((candidate) => selectedIds.includes(candidate.id));
    if (tool !== "move" && selected.length > 1) {
      this.callbacks.notify("Rotação e distorção de vários objetos ainda não estão disponíveis.");
      return;
    }
    if (selected.some((candidate) => document.layers.find((layer) => layer.id === candidate.layerId)?.locked)) {
      this.callbacks.notify("Desbloqueie todas as camadas selecionadas antes de transformar os objetos.");
      return;
    }

    const point = toCanvasPoint(this.svg, event);
    const center = getCenter(document, element);
    this.interaction = {
      type: "transform",
      pointerId: event.pointerId,
      id,
      selected,
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

    if (action.type === "marquee") {
      const clientDeltaX = event.clientX - action.startClientX;
      const clientDeltaY = event.clientY - action.startClientY;
      action.moved = Math.abs(clientDeltaX) > 4 && Math.abs(clientDeltaY) > 4;
      if (action.moved) {
        this.marquee.setAttribute("x", Math.min(action.startPoint.x, point.x));
        this.marquee.setAttribute("y", Math.min(action.startPoint.y, point.y));
        this.marquee.setAttribute("width", Math.abs(deltaX));
        this.marquee.setAttribute("height", Math.abs(deltaY));
        this.marquee.setAttribute("visibility", "visible");
      }
      event.preventDefault();
      return;
    }

    if (action.tool === "move") {
      this.callbacks.updateMany(action.selected.map((element) => ({
        id: element.id,
        patch: {
          xMm: element.xMm + deltaX * (action.flipX ? -1 : 1),
          yMm: element.yMm + deltaY * (action.flipY ? -1 : 1)
        }
      })));
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
    const action = this.interaction;
    this.interaction = null;
    if (action.type === "marquee") {
      this.marquee.setAttribute("visibility", "hidden");
      if (action.moved) {
        const bounds = this.marquee.getBoundingClientRect();
        const ids = Array.from(this.svg.querySelectorAll("[data-id]"))
          .filter((node) => {
            const box = node.getBoundingClientRect();
            return box.left < bounds.right && box.right > bounds.left
              && box.top < bounds.bottom && box.bottom > bounds.top;
          })
          .map((node) => node.dataset.id);
        this.callbacks.selectMany(ids, { additive: action.additive });
      } else if (!action.additive) {
        this.callbacks.deselect();
      }
      return;
    }
    this.callbacks.commit();
  }
}
