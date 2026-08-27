const fs = require("fs");
const path = require("path");

const src = require.resolve("sql.js/dist/sql-wasm.wasm");
const destDir = path.join(__dirname, "..", "media");
const dest = path.join(destDir, "sql-wasm.wasm");
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
