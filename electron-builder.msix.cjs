const { build } = require("./package.json");

const channel = process.env.MSIX_CHANNEL === "local" ? "local" : "store";
const storePublisher = build.appx.publisher;
const localPublisher = "CN=CMBRN - Software";

module.exports = {
  ...build,
  appx: {
    ...build.appx,
    publisher: channel === "local" ? localPublisher : storePublisher,
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
