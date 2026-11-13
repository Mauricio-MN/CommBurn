import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const www = join(root, "www");

// Same files the desktop server exposes, so the mobile build loads the editor unchanged.
const files = [
  "index.html",
  "commburn-icon.svg",
  "mouse-cursor-presentation.svg",
  ["node_modules/svgson/dist/svgson.umd.js", "vendor/svgson.js"],
  ["node_modules/opentype.js/dist/opentype.mjs", "node_modules/opentype.js/dist/opentype.mjs"],
  ["node_modules/@jodit/image-editor/dist/jodit-image-editor.js", "node_modules/@jodit/image-editor/dist/jodit-image-editor.js"],
  ["node_modules/imagetracerjs/imagetracer_v1.2.6.js", "node_modules/imagetracerjs/imagetracer_v1.2.6.js"]
];

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

for (const entry of files) {
  const [from, to = entry] = Array.isArray(entry) ? entry : [entry];
  const target = join(www, to);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(root, from), target);
}

cpSync(join(root, "src"), join(www, "src"), { recursive: true });

const pathdataDir = join(root, "node_modules/svg-pathdata/lib");
if (existsSync(pathdataDir)) {
  const target = join(www, "node_modules/svg-pathdata/lib");
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(pathdataDir).filter((file) => file.endsWith(".js"))) {
    cpSync(join(pathdataDir, name), join(target, name));
  }
}

console.log(`Built ${www}`);
