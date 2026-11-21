import { cp, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Copies bundled plugins into the user's plugin directory on every launch, replacing
// installed copies whose files differ, so upgraded builds never keep stale plugin code.
export async function syncBundledPlugins(bundledDirectory, pluginDirectory) {
  let entries;
  try {
    entries = await readdir(bundledDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  await mkdir(pluginDirectory, { recursive: true });
  const updated = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const source = join(bundledDirectory, entry.name);
    const target = join(pluginDirectory, entry.name);
    if (await sameFiles(source, target)) continue;
    await cp(source, target, { recursive: true, force: true });
    updated.push(entry.name);
  }
  return updated;
}

async function sameFiles(source, target) {
  for (const relativePath of await listFiles(source)) {
    const [sourceBytes, targetBytes] = await Promise.all([
      readFile(join(source, relativePath)),
      readFile(join(target, relativePath)).catch(() => null)
    ]);
    if (!targetBytes || !sourceBytes.equals(targetBytes)) return false;
  }
  return true;
}

async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const relativePath = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(directory, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}
