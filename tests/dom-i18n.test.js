import test from "node:test";
import assert from "node:assert/strict";
import { translateDom } from "../src/ui/dom-i18n.js";

test("DOM translation preserves child controls and updates accessible attributes", () => {
  const textNode = { nodeType: 3, nodeValue: " Adicionar ", trim() {} };
  const child = { nodeType: 1 };
  const button = {
    childNodes: [child, textNode],
    dataset: { i18n: "button.add" },
    attributes: { "data-i18n-title": "button.tooltip" },
    querySelectorAll: () => [],
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  const root = {
    querySelectorAll(selector) {
      if (selector === "[data-i18n]") return [button];
      if (selector === "[data-i18n-title]") return [button];
      return [];
    }
  };
  const i18n = { t: (key) => ({ "button.add": "Add", "button.tooltip": "Add item" })[key] };

  translateDom(root, i18n);

  assert.equal(textNode.nodeValue, " Add ");
  assert.equal(button.childNodes[0], child);
  assert.equal(button.attributes.title, "Add item");
});