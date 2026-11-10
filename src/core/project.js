import { createDocument } from "./document.js";
import { CommBurnRangeError, CommBurnTypeError } from "./i18n.js";

const MAX_PROJECT_BYTES = 50 * 1024 * 1024;

export function serializeProject(input) {
  const document = createDocument(input);
  const source = JSON.stringify({ format: "commburn-project", version: 1, document }, null, 2);
  if (new TextEncoder().encode(source).byteLength > MAX_PROJECT_BYTES) {
    throw new CommBurnRangeError("project.tooLarge", { maxBytes: MAX_PROJECT_BYTES }, { message: "The exported project exceeds the 50 MB limit" });
  }
  return source;
}

export function parseProject(source) {
  if (typeof source !== "string") {
    throw new CommBurnTypeError("project.invalidSource", {}, { message: "Project source must be a JSON string" });
  }
  let project;
  try {
    project = JSON.parse(source);
  } catch (error) {
    throw new CommBurnTypeError("project.invalidJson", {}, { message: "Project file does not contain valid JSON", cause: error });
  }
  if (project?.format !== "commburn-project" || project.version !== 1 || !project.document) {
    throw new CommBurnTypeError("project.unsupportedFormat", { version: project?.version }, { message: "Unknown CommBurn project format or unsupported version" });
  }
  return createDocument(project.document);
}
