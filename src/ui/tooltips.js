export function installTooltips(root = document) {
  for (const element of root.querySelectorAll("button, input, textarea, select, summary, [role='button']")) {
    const explicit = element.dataset.tooltip?.trim();
    const directLabel = [...(element.closest("label")?.childNodes ?? [])]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent.trim())
        .filter(Boolean)
        .join(" ");
    const label = element.getAttribute("aria-label") || directLabel || element.textContent.trim();
    const description = explicit || (label ? `Controle: ${label}.` : "");
    if (!description) continue;
    element.title = description;
    element.setAttribute("aria-description", description);
  }
}
