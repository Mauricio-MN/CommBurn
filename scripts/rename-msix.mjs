import { readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

const outputDirectory = "dist";
const appxFiles = (await readdir(outputDirectory))
  .filter((file) => file.endsWith(".appx"));

if (appxFiles.length !== 1) {
  throw new Error(
    `Expected exactly one AppX package in ${outputDirectory}, found ${appxFiles.length}`,
  );
}

const appxFile = appxFiles[0];
const msixPath = join(
  outputDirectory,
  appxFile.replace(/\.appx$/, ".msix"),
);
await rm(msixPath, { force: true });
await rename(
  join(outputDirectory, appxFile),
  msixPath,
);
