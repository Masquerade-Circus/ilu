import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TEST_TMP_ROOT } from "./home-sandbox.ts";

const realHome = path.resolve(os.userInfo().homedir);
const currentHome = process.env.HOME;

if (typeof currentHome !== "string" || currentHome.trim() === "" || path.resolve(currentHome) === realHome) {
  const root = path.dirname(TEST_TMP_ROOT);
  const entrypoint = typeof process.argv[1] === "string" ? path.resolve(process.argv[1]) : "node-eval";
  const name = path
    .relative(root, entrypoint)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (name.length === 0 || name.length > 180) {
    throw new Error("Test HOME requires an entrypoint with a stable directory name");
  }
  const parent = path.join(TEST_TMP_ROOT, "test-runner-homes");
  for (const directory of [TEST_TMP_ROOT, parent]) {
    const existing = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (typeof existing === "object" && !existing.isDirectory()) {
      throw new Error("Test HOME parents must be directories, not symbolic links");
    }
    if (typeof existing !== "object") {
      fs.mkdirSync(directory, { mode: 0o700 });
    }
  }
  const home = path.join(parent, name);
  const marker = path.join(home, ".ilu-test-home");
  const active = path.join(home, ".active");
  const existing = fs.lstatSync(home, { throwIfNoEntry: false });
  if (typeof existing === "object") {
    if (!existing.isDirectory() || !fs.lstatSync(marker).isFile() || fs.readFileSync(marker, "utf8") !== entrypoint) {
      throw new Error("Refusing to reset a test HOME not owned by this entrypoint");
    }
  } else {
    fs.mkdirSync(home, { mode: 0o700 });
    fs.writeFileSync(marker, entrypoint, { mode: 0o600, flag: "wx" });
  }
  fs.writeFileSync(active, "active", { mode: 0o600, flag: "wx" });
  try {
    for (const name of fs.readdirSync(home)) {
      if (name !== ".ilu-test-home" && name !== ".active") {
        fs.rmSync(path.join(home, name), { recursive: true, force: true });
      }
    }
    process.env.HOME = home;
    process.once("exit", () => fs.unlinkSync(active));
  } catch (error) {
    fs.unlinkSync(active);
    throw error;
  }
}
