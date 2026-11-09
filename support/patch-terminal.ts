import fs from "node:fs";
import { fileURLToPath } from "node:url";

const entry = import.meta.resolve("@valyrianjs/terminal");
const manifest = JSON.parse(fs.readFileSync(new URL("../package.json", entry), "utf8"));
if (manifest.version !== "0.2.17") {
  throw new Error("Review the terminal SPACE patch before changing @valyrianjs/terminal@0.2.17");
}

// Preserve text insertion while normalizing the physical key for existing bindings.
const anchor = 'const names = [[4, "CTRL"],';
const changes = [
  { relative: "../src/events.ts", indent: "  " },
  { relative: "../dist/events.js", indent: "    " }
].map(({ relative, indent }) => {
  const file = fileURLToPath(new URL(relative, entry));
  const original = fs.readFileSync(file, "utf8");
  const replacement = `if (key === " ") {\n${indent}  key = "SPACE";\n${indent}}\n${indent}${anchor}`;
  if (original.split(anchor).length !== 2) {
    throw new Error(`Unexpected terminal parser layout: ${relative}`);
  }
  return {
    file,
    original,
    patched: original.includes(replacement) ? original : original.replace(anchor, replacement)
  };
});

for (const { file, original, patched } of changes) {
  if (original !== patched) {
    fs.writeFileSync(file, patched);
  }
}
console.log("@valyrianjs/terminal@0.2.17 SPACE patch applied");
