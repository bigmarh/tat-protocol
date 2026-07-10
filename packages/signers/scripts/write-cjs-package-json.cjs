const fs = require("fs");
const path = require("path");

const outDir = path.join(__dirname, "..", "dist-cjs");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
  "utf8",
);
