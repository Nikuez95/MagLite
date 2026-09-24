const fs = require("fs");
const path = require("path");

const files = [
  "frontend/src/pages/desktop/Customers.jsx",
  "frontend/src/pages/desktop/Inbound.jsx",
  "frontend/src/pages/desktop/Locations.jsx",
  "frontend/src/pages/desktop/Outbound.jsx",
  "frontend/src/pages/desktop/Products.jsx",
  "frontend/src/pages/desktop/Users.jsx",
  "frontend/src/zebra/Handling.jsx"
];

for (const file of files) {
  let content = fs.readFileSync(file, "utf8");
  if (!content.includes("appAlert")) continue;
  if (!content.includes("import { appAlert")) {
    let relativePath = path.relative(path.dirname(file), path.join("./frontend/src", "utils", "alerts.js")).replace(/\\/g, "/");
    if (!relativePath.startsWith(".")) relativePath = "./" + relativePath;
    let importStatement = `import { appAlert, appConfirm, appPrompt } from "` + relativePath + `";\n`;
    content = importStatement + content;
    fs.writeFileSync(file, content, "utf8");
    console.log("Added import to", file);
  }
}

