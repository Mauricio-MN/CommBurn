import { SVGPathData } from "../../node_modules/svg-pathdata/lib/SVGPathData.module.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export function normalizeEditablePath(pathData) {
  const parsed = new SVGPathData(pathData).toAbs().normalizeHVZ().normalizeST().qtToC().aToC();
  if (parsed.commands.length > 6000) throw new RangeError("O subeditor aceita até 6000 comandos por traçado.");
  return parsed.commands.map((command) => ({ ...command }));
}

export function encodeEditablePath(commands) {
  return SVGPathData.encode(commands);
}

export class PathEditor {
  constructor(dialog) {
    this.dialog = dialog;
    this.svg = dialog.querySelector("#path-editor-canvas");
    this.list = dialog.querySelector("#path-editor-nodes");
    this.commands = [];
    this.onSave = null;
    this.interaction = null;
    this.svg.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.svg.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.svg.addEventListener("pointerup", () => { this.interaction = null; });
    this.svg.addEventListener("pointercancel", () => { this.interaction = null; });
    this.list.addEventListener("change", (event) => this.onCoordinateChange(event));
    dialog.querySelector("[data-path-save]").addEventListener("click", () => this.save());
  }

  open(pathData, widthMm, heightMm, onSave) {
    this.commands = normalizeEditablePath(pathData);
    const bounds = new SVGPathData(encodeEditablePath(this.commands)).getBounds();
    const scaleX = bounds.maxX === bounds.minX ? 1 : widthMm / (bounds.maxX - bounds.minX);
    const scaleY = bounds.maxY === bounds.minY ? 1 : heightMm / (bounds.maxY - bounds.minY);
    for (const command of this.commands) {
      for (const [xKey, yKey] of [["x", "y"], ["x1", "y1"], ["x2", "y2"]]) {
        if (typeof command[xKey] === "number") command[xKey] = (command[xKey] - bounds.minX) * scaleX;
        if (typeof command[yKey] === "number") command[yKey] = (command[yKey] - bounds.minY) * scaleY;
      }
    }
    this.onSave = onSave;
    this.render();
    this.dialog.showModal();
  }

  save() {
    const source = new SVGPathData(encodeEditablePath(this.commands));
    const bounds = source.getBounds();
    if (this.onSave?.(source.encode(), bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) === false) return;
    this.dialog.close();
  }

  toPoint(event) {
    const point = this.svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = this.svg.getScreenCTM();
    if (!matrix) throw new Error("O subeditor SVG ainda não possui uma transformação visível.");
    const result = point.matrixTransform(matrix.inverse());
    return { x: result.x, y: result.y };
  }

  onPointerDown(event) {
    const handle = event.target.closest("[data-command-index][data-coordinate]");
    if (!handle || event.button !== 0) return;
    const commandIndex = Number(handle.dataset.commandIndex);
    const coordinate = handle.dataset.coordinate;
    this.interaction = {
      pointerId: event.pointerId,
      commandIndex,
      coordinate,
      fields: coordinate === "x" || coordinate === "y" ? ["x", "y"] : coordinate === "x1" || coordinate === "y1" ? ["x1", "y1"] : ["x2", "y2"]
    };
    this.svg.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  onPointerMove(event) {
    if (!this.interaction || event.pointerId !== this.interaction.pointerId) return;
    const point = this.toPoint(event);
    const command = this.commands[this.interaction.commandIndex];
    command[this.interaction.fields[0]] = point.x;
    command[this.interaction.fields[1]] = point.y;
    this.render();
  }

  onCoordinateChange(event) {
    const input = event.target.closest("[data-command-index][data-axis]");
    if (!input) return;
    const value = Number(input.value);
    if (!Number.isFinite(value)) {
      input.reportValidity();
      return;
    }
    const command = this.commands[Number(input.dataset.commandIndex)];
    command[input.dataset.axis] = value;
    this.render();
  }

  addHandle(commandIndex, coordinate, x, y, isControl = false) {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(x));
    circle.setAttribute("cy", String(y));
    circle.setAttribute("r", String(isControl ? this.handleRadius * 0.72 : this.handleRadius));
    circle.setAttribute("class", isControl ? "path-control-handle" : "path-anchor-handle");
    circle.setAttribute("tabindex", "0");
    circle.setAttribute("role", "button");
    circle.setAttribute("aria-label", isControl ? "Alça de curva; arraste para ajustar" : "Nó do traçado; arraste para mover");
    circle.dataset.commandIndex = String(commandIndex);
    circle.dataset.coordinate = coordinate;
    return circle;
  }

  render() {
    const encoded = encodeEditablePath(this.commands);
    const bounds = new SVGPathData(encoded).getBounds();
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);
    const margin = span * 0.12;
    this.handleRadius = span / 75;
    this.svg.setAttribute("viewBox", `${bounds.minX - margin} ${bounds.minY - margin} ${bounds.maxX - bounds.minX + margin * 2} ${bounds.maxY - bounds.minY + margin * 2}`);
    this.svg.replaceChildren();

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", encoded);
    path.setAttribute("class", "path-editor-shape");
    this.svg.append(path);

    let current = null;
    const listItems = [];
    this.commands.forEach((command, commandIndex) => {
      if (command.type === SVGPathData.MOVE_TO || command.type === SVGPathData.LINE_TO) {
        current = [command.x, command.y];
        this.svg.append(this.addHandle(commandIndex, "x", command.x, command.y));
        listItems.push({ commandIndex, type: command.type === SVGPathData.MOVE_TO ? "Início" : "Nó", x: command.x, y: command.y });
      } else if (command.type === SVGPathData.CURVE_TO) {
        const firstControl = document.createElementNS(SVG_NS, "line");
        firstControl.setAttribute("x1", String(current[0]));
        firstControl.setAttribute("y1", String(current[1]));
        firstControl.setAttribute("x2", String(command.x1));
        firstControl.setAttribute("y2", String(command.y1));
        firstControl.setAttribute("class", "path-control-line");
        const secondControl = document.createElementNS(SVG_NS, "line");
        secondControl.setAttribute("x1", String(command.x2));
        secondControl.setAttribute("y1", String(command.y2));
        secondControl.setAttribute("x2", String(command.x));
        secondControl.setAttribute("y2", String(command.y));
        secondControl.setAttribute("class", "path-control-line");
        this.svg.append(firstControl, secondControl);
        this.svg.append(
          this.addHandle(commandIndex, "x1", command.x1, command.y1, true),
          this.addHandle(commandIndex, "x2", command.x2, command.y2, true),
          this.addHandle(commandIndex, "x", command.x, command.y)
        );
        current = [command.x, command.y];
        listItems.push({ commandIndex, type: "Âncora de curva", x: command.x, y: command.y });
      }
    });
    this.list.replaceChildren(...listItems.map((item, index) => {
      const row = document.createElement("fieldset");
      row.className = "path-node-row";
      const legend = document.createElement("legend");
      legend.textContent = `${index + 1}. ${item.type}`;
      const xLabel = document.createElement("label");
      xLabel.textContent = "X local (mm)";
      const xInput = document.createElement("input");
      xInput.type = "number";
      xInput.step = "0.1";
      xInput.value = String(Number(item.x.toFixed(3)));
      xInput.dataset.commandIndex = String(item.commandIndex);
      xInput.dataset.axis = "x";
      const yLabel = document.createElement("label");
      yLabel.textContent = "Y local (mm)";
      const yInput = document.createElement("input");
      yInput.type = "number";
      yInput.step = "0.1";
      yInput.value = String(Number(item.y.toFixed(3)));
      yInput.dataset.commandIndex = String(item.commandIndex);
      yInput.dataset.axis = "y";
      xLabel.append(xInput);
      yLabel.append(yInput);
      row.append(legend, xLabel, yLabel);
      return row;
    }));
  }
}
