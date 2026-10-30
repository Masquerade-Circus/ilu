import fs from "node:fs";
import path from "node:path";
import { assertRepoTempHome } from "../../support/home-sandbox.ts";

// External clipboard executable for the private capture, never the desktop clipboard.
assertRepoTempHome(process.env.HOME, "Clipboard capture HOME");
const configPath = process.env.ILU_CAPTURE_HTTP_CONFIG;
if (typeof configPath !== "string") {
  throw new Error("Clipboard capture requires an isolation configuration");
}
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const executable = path.basename(process.argv[2]);
fs.appendFileSync(config.clipboardRequestsPath, JSON.stringify({ executable, args: process.argv.slice(3) }) + "\n");
if (config.systemClipboardAvailable === false) {
  process.exitCode = 1;
} else if (executable === "wl-copy" || process.argv.includes("--input") || process.argv.includes("-in")) {
  const text = fs.readFileSync(0, "utf8");
  fs.writeFileSync(config.clipboardPath, text, { mode: 0o600 });
  fs.appendFileSync(config.clipboardWritesPath, `${JSON.stringify(text)}\n`);
} else if (executable === "wl-paste" || process.argv.includes("--output") || process.argv.includes("-out")) {
  process.stdout.write(fs.readFileSync(config.clipboardPath));
} else {
  throw new Error("Unsupported private clipboard operation");
}
