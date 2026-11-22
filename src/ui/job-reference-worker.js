import { jobReferencePoints } from "../core/document.js";

self.addEventListener("message", ({ data }) => {
  try {
    const reference = jobReferencePoints(data.documentModel, data.settings);
    self.postMessage({ id: data.id, reference });
  } catch (error) {
    self.postMessage({ id: data.id, error: error?.message ?? String(error) });
  }
});
