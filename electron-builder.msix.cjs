const { build } = require("./package.json");

const publishers = {
  store: build.appx.publisher,
  local: "CN=CMBRN - Software",
  unsigned: "CN=Unknown",
};
const channel = Object.hasOwn(publishers, process.env.MSIX_CHANNEL)
  ? process.env.MSIX_CHANNEL
  : "store";

module.exports = {
  ...build,
  appx: {
    ...build.appx,
    publisher: publishers[channel],
  },
  artifactName: `\${productName} \${version}-${channel}.\${ext}`,
  extraResources: [
    ...build.extraResources,
    {
      from: "plugins-proprietary/editor-theme",
      to: "bundled-plugins/editor-theme",
    },
  ],
};
