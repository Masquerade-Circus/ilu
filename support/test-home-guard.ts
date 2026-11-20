import path from "node:path";
import os from "node:os";
import { TEST_TMP_ROOT } from "./home-sandbox.ts";
import { ensureTestDirectory, openReusableTestDirectory } from "./reusable-test-directory.ts";

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
    ensureTestDirectory(directory);
  }
  const home = path.join(parent, name);
  // The preload owns this HOME for the entire life of the runner process.
  openReusableTestDirectory({ directory: home, markerName: ".ilu-test-home", owner: entrypoint });
  process.env.HOME = home;
}
