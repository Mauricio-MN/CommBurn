import { CommBurnTypeError } from "./i18n.js";

export const PROJECT_FORMAT = "commburn-project";
export const CURRENT_PROJECT_VERSION = 2;

const CONVERSIONS = new Map([
  [1, (project) => ({
    ...project,
    version: 2,
    units: "mm"
  })]
]);

function unsupportedProject(project) {
  return new CommBurnTypeError(
    "project.unsupportedFormat",
    { version: project?.version },
    { message: "Unknown CommBurn project format or unsupported version" }
  );
}

export function convertProjectEnvelope(project) {
  if (project?.format !== PROJECT_FORMAT || !project.document
    || !Number.isInteger(project.version) || project.version < 1
    || project.version > CURRENT_PROJECT_VERSION) {
    throw unsupportedProject(project);
  }

  let converted = project;
  while (converted.version < CURRENT_PROJECT_VERSION) {
    const conversion = CONVERSIONS.get(converted.version);
    if (!conversion) throw unsupportedProject(converted);
    const next = conversion(converted);
    if (next.version !== converted.version + 1) throw unsupportedProject(converted);
    converted = next;
  }

  if (converted.version === CURRENT_PROJECT_VERSION && converted.units !== "mm") {
    throw unsupportedProject(converted);
  }
  return converted;
}
