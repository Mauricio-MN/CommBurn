importScripts("/node_modules/imagetracerjs/imagetracer_v1.2.6.js");

self.addEventListener("message", ({ data }) => {
  try {
    if (!globalThis.ImageTracer?.imagedataToSVG) {
      throw new Error("The local ImageTracer library did not load");
    }
    const svg = ImageTracer.imagedataToSVG({
      data: new Uint8ClampedArray(data.pixels),
      width: data.width,
      height: data.height
    }, data.options);
    self.postMessage({ svg });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
});
