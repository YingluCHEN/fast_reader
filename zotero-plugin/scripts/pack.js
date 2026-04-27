#!/usr/bin/env node
// Packages the plugin into a .xpi file (which is just a zip)
const archiver = require("archiver");
const fs = require("fs");
const path = require("path");

const output = fs.createWriteStream(path.join(__dirname, "../ai-bilingual-reader.xpi"));
const archive = archiver("zip", { zlib: { level: 9 } });

output.on("close", () => {
  console.log(`✓ Packed: ai-bilingual-reader.xpi (${archive.pointer()} bytes)`);
});
archive.on("error", err => { throw err; });

archive.pipe(output);

const root = path.join(__dirname, "..");

// Include plugin files (exclude src/, scripts/, node_modules/, package files)
const exclude = ["src", "scripts", "node_modules", "*.xpi", "package*.json", "tsconfig.json", ".git"];

archive.glob("**/*", {
  cwd: root,
  ignore: [
    "src/**",
    "scripts/**",
    "node_modules/**",
    "*.xpi",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    ".git/**",
  ],
});

archive.finalize();
