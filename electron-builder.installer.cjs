const { build } = require("./package.json");
const bundledTheme = require("./electron-builder.theme.cjs");

module.exports = {
  ...build,
  extraResources: [...build.extraResources, bundledTheme],
};
