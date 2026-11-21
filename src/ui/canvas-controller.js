function toCanvasPoint(svg, event) {
  const screenPoint = svg.createSVGPoint();
  screenPoint.x = event.clientX;
  screenPoint.y = event.clientY;
  return screenPoint.matrixTransform(svg.getScreenCTM().inverse());
}

function getCenter(element) {
  if (element.type === "text") return { xMm: element.xMm, yMm: element.yMm };
  return { xMm: element.xMm + element.widthMm / 2, yMm: element.yMm + element.heightMm / 2 };
}

function getSelectionBounds(elements) {
  const bounds = elements.map((element) => {
    const widthMm = element.widthMm ?? element.fontSizeMm;
    const heightMm = element.heightMm ?? element.fontSizeMm;
    return {
      left: element.xMm,
      top: element.yMm - (element.type === "text" ? element.fontSizeMm : 0),
      right: element.xMm + widthMm,
      bottom: element.yMm - (element.type === "text" ? element.fontSizeMm : 0) + heightMm
    };
  });
  return {
    left: Math.min(...bounds.map((bound) => bound.left)),
    top: Math.min(...bounds.map((bound) => bound.top)),
    right: Math.max(...bounds.map((bound) => bound.right)),
    bottom: Math.max(...bounds.map((bound) => bound.bottom))
  };
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
    svg.addEventListener("contextmenu", (event) => this.onContextMenu(event));
  }

  onContextMenu(event) {
    const node = event.target.closest("[data-id]");
    if (!node) return;
    event.preventDefault();
    this.callbacks.contextMenu?.({ id: node.dataset.id, clientX: event.clientX, clientY: event.clientY });
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    const node = event.target.closest("[data-id]");
    const tool = this.callbacks.getTool();
    if (!node) {
      if (["select", "edit"].includes(tool)) {
        this.interaction = {
          type: "marquee",
          pointerId: event.pointerId,
          startPoint: toCanvasPoint(this.svg, event),
          startClientX: event.clientX,
          startClientY: event.clientY,
          additive: event.shiftKey,
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
      additive: event.shiftKey,
      toggle: event.shiftKey,
      keepExisting: currentIds.includes(id) && !event.shiftKey
    });
    if (tool === "edit") this.callbacks.revealInspector?.();
    if (["select", "edit"].includes(tool)) return;
    const selectedIds = this.callbacks.getSelectedIds();
    if (!selectedIds.includes(id)) return;
    const selected = document.elements.filter((candidate) => selectedIds.includes(candidate.id));
    if (!["move", "size"].includes(tool) && selected.length > 1) {
      this.callbacks.notify("Rotação e distorção de vários objetos ainda não estão disponíveis.");
      return;
    }
    if (selected.some((candidate) => document.layers.find((layer) => layer.id === candidate.layerId)?.locked)) {
      this.callbacks.notify("Desbloqueie todas as camadas selecionadas antes de transformar os objetos.");
      return;
    }

    const point = toCanvasPoint(this.svg, event);
    const bounds = getSelectionBounds(selected);
    const center = tool === "size"
      ? { xMm: (bounds.left + bounds.right) / 2, yMm: (bounds.top + bounds.bottom) / 2 }
      : getCenter(element);
    const startDistance = Math.hypot(point.x - center.xMm, point.y - center.yMm);
    this.interaction = {
      type: "transform",
      pointerId: event.pointerId,
      id,
      selected,
      tool,
      startPoint: point,
      center,
      startDistance,
      scaleReference: Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top, 0.1),
      startX: element.xMm,
      startY: element.yMm,
      startRotation: element.rotationDeg,
      startSkewX: element.skewXDeg,
      startSkewY: element.skewYDeg,
      startAngle: angleBetween(center, point),
      scaleMm: Math.max(element.widthMm ?? element.fontSizeMm, element.heightMm ?? element.fontSizeMm, 1)
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
          xMm: element.xMm + deltaX,
          yMm: element.yMm + deltaY
        }
      })), false);
    } else if (action.tool === "size") {
      const currentDistance = Math.hypot(point.x - action.center.xMm, point.y - action.center.yMm);
      const scale = Math.max(0.01, 1 + (currentDistance - action.startDistance) / action.scaleReference);
      this.callbacks.updateMany(action.selected.map((element) => {
        const patch = {
          xMm: action.center.xMm + (element.xMm - action.center.xMm) * scale,
          yMm: action.center.yMm + (element.yMm - action.center.yMm) * scale
        };
        if (element.type === "text") {
          patch.fontSizeMm = element.fontSizeMm * scale;
        } else {
          patch.widthMm = element.widthMm * scale;
          patch.heightMm = element.heightMm * scale;
        }
        return { id: element.id, patch };
      }), false);
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
