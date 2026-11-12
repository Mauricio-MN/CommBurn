export function getInspectorSections(element) {
  return {
    isText: element?.type === "text",
    isPath: element?.type === "path",
    isImage: element?.type === "image",
    isSvgImage: element?.type === "svg-image"
  };
}
