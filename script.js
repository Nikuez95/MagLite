const fs = require("fs");
const path = require("path");

const walkSync = (dir, filelist = []) => {
  fs.readdirSync(dir).forEach(file => {
    const dirFile = path.join(dir, file);
    if (fs.statSync(dirFile).isDirectory()) {
      filelist = walkSync(dirFile, filelist);
    } else if (dirFile.endsWith(".jsx")) {
      filelist.push(dirFile);
    }
  });
  return filelist;
};

const files = walkSync("./frontend/src");

for (const file of files) {
  let content = fs.readFileSync(file, "utf8");

  const needsImport = /alert\(|confirm\(|prompt\(/.test(content) && !content.includes("appAlert");
  if (needsImport) {
    let relativePath = path.relative(path.dirname(file), path.join("./frontend/src", "utils", "alerts.js")).replace(/\\/g, "/");
    if (!relativePath.startsWith(".")) relativePath = "./" + relativePath;
    
    let importStatement = `import { appAlert, appConfirm, appPrompt } from "` + relativePath + `";\n`;
    
    if (content.includes("import React")) {
        content = content.replace(/(import React.*?;\n)/, "$1" + importStatement);
    } else {
        content = importStatement + content;
    }

    content = content.replace(/\bwindow\.alert\(/g, "appAlert(");
    content = content.replace(/(?<!app)alert\(/g, "appAlert(");

    content = content.replace(/\bwindow\.confirm\(/g, "await appConfirm(");
    content = content.replace(/(?<!app)confirm\(/g, "await appConfirm(");

    content = content.replace(/\bwindow\.prompt\(/g, "await appPrompt(");
    content = content.replace(/(?<!app)prompt\(/g, "await appPrompt(");
    
    fs.writeFileSync(file, content, "utf8");
    console.log("Updated", file);
  }
}
