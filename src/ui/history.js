export class DocumentHistory {
  #snapshots = [];
  #index = -1;
  #savedSnapshot = null;
  #fileTarget = null;

  constructor(initialDocument) {
    this.push(initialDocument);
  }

  get fileTarget() {
    return this.#fileTarget;
  }

  markSaved(fileTarget = this.#fileTarget) {
    this.#savedSnapshot = this.#snapshots[this.#index];
    this.#fileTarget = fileTarget;
  }

  markUnsaved() {
    this.#savedSnapshot = null;
    this.#fileTarget = null;
  }

  isDirty() {
    return this.#snapshots[this.#index] !== this.#savedSnapshot;
  }

  push(document) {
    const snapshot = JSON.stringify(document);
    if (this.#snapshots[this.#index] === snapshot) return false;
    this.#snapshots = this.#snapshots.slice(0, this.#index + 1);
    this.#snapshots.push(snapshot);
    this.#index = this.#snapshots.length - 1;
    return true;
  }

  reset(document) {
    this.#snapshots = [JSON.stringify(document)];
    this.#index = 0;
    this.markUnsaved();
  }

  undo() {
    if (this.#index <= 0) return null;
    this.#index -= 1;
    return JSON.parse(this.#snapshots[this.#index]);
  }

  redo() {
    if (this.#index >= this.#snapshots.length - 1) return null;
    this.#index += 1;
    return JSON.parse(this.#snapshots[this.#index]);
  }
}
