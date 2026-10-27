export class DocumentHistory {
  #snapshots = [];
  #index = -1;

  constructor(initialDocument) {
    this.push(initialDocument);
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
