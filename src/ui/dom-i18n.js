function replaceTextNode(element, translated) {
  const textNode = Array.from(element.childNodes).find((node) => node.nodeType === 3 && node.nodeValue.trim());
  if (!textNode) return;
  const leading = textNode.nodeValue.match(/^\s*/)?.[0] ?? "";
  const trailing = textNode.nodeValue.match(/\s*$/)?.[0] ?? "";
  textNode.nodeValue = `${leading}${translated}${trailing}`;
}

export function translateDom(root, i18n) {
  for (const element of root.querySelectorAll("[data-i18n]")) {
    replaceTextNode(element, i18n.t(element.dataset.i18n));
  }
  for (const attribute of ["placeholder", "title", "aria-label", "aria-description"]) {
    const dataKey = `data-i18n-${attribute}`;
    for (const element of root.querySelectorAll(`[${dataKey}]`)) {
      element.setAttribute(attribute, i18n.t(element.getAttribute(dataKey)));
    }
  }
}