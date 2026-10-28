import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const directory = path.resolve(path.dirname(require.resolve("@valyrianjs/terminal")), "..");
const metadata = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
if (metadata.version !== "0.2.15") {
  throw new Error("The terminal cursor fix requires @valyrianjs/terminal 0.2.15. Review the fix before upgrading.");
}

// A containing border can put the focus span's end before the cursor marker.
// Always consume the marker once, so its replacement cannot grow the physical row.
const original = "const end = terminalCellToStringIndex(line)[surface.x2 - 1 - rightInset] ?? line.length;";
const corrected =
  "const end = Math.max(offset + 1, terminalCellToStringIndex(line)[surface.x2 - 1 - rightInset] ?? line.length);";
const edits = [
  { original, corrected },
  {
    original:
      'if (span.y === cursor.y && span.x1 <= cursor.x && span.x2 > cursor.x && typeof span.style?.border === "object") {',
    corrected:
      'if (span.y === cursor.y && span.x1 <= cursor.x && span.x2 > cursor.x && typeof span.style?.border === "object" && spans.some((control) => control.kind === baseKind && control.y === cursor.y && control.x1 === span.x1 && control.x2 === span.x2)) {'
  }
];
const files = ["src/ansi.ts", "dist/ansi.js"].map((relative) => {
  const file = path.join(directory, relative);
  let content = fs.readFileSync(file, "utf8");
  let changed = false;
  for (const edit of edits) {
    if (content.split(edit.original).length === 2 && !content.includes(edit.corrected)) {
      content = content.replace(edit.original, edit.corrected);
      changed = true;
    } else if (content.split(edit.corrected).length !== 2 || content.includes(edit.original)) {
      throw new Error(
        `Cannot safely apply the terminal cursor fix to ${relative}. The expected implementation differs.`
      );
    }
  }
  return { file, relative, content, changed };
});

// Validate both inputs before writing either file. Unknown versions or local
// implementations fail explicitly rather than being silently replaced.
for (const file of files) {
  if (file.changed) {
    fs.writeFileSync(file.file, file.content);
  }
  console.log(`Terminal 0.2.15 cursor fix: ${file.relative} ${file.changed ? "applied" : "already applied"}`);
}
