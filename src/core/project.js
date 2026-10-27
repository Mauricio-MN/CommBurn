import { createDocument } from "./document.js";

const MAX_PROJECT_BYTES = 50 * 1024 * 1024;

export function serializeProject(input) {
  const document = createDocument(input);
  const source = JSON.stringify({ format: "commburn-project", version: 1, document }, null, 2);
  if (new TextEncoder().encode(source).byteLength > MAX_PROJECT_BYTES) {
    throw new RangeError("The exported project exceeds the 50 MB limit");
  }
  return source;
}

export function parseProject(source) {
  if (typeof source !== "string") throw new TypeError("Project source must be a JSON string");
  let project;
  try {
    project = JSON.parse(source);
  } catch (error) {
    throw new TypeError("Project file does not contain valid JSON", { cause: error });
  }
  if (project?.format !== "commburn-project" || project.version !== 1 || !project.document) {
    throw new TypeError("Unknown CommBurn project format or unsupported version");
  }
  return createDocument(project.document);
}
