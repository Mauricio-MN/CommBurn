const { build } = require("./package.json");

module.exports = {
  ...build,
  extraResources: [
    ...build.extraResources,
    {
      from: "plugins-proprietary/editor-theme",
      to: "bundled-plugins/editor-theme",
    },
  ],
};
