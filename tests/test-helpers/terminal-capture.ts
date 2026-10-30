import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export async function captureTranslationScenario(options) {
  if (
    !["translationCli", "translationHttpRecovery", "translationValidation", "translationMalformedResults"].includes(
      options.scenario
    )
  ) {
    throw new Error("Unsupported isolated translation scenario");
  }
  return captureIluScenario(options);
}

export async function captureIluScenario(options) {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const artifacts = path.join(root, "tmp", "terminal-captures");
  if (typeof options.testName !== "string") {
    throw new Error("Physical capture requires its test name");
  }
  const artifactStem = options.testName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (artifactStem.length === 0 || artifactStem.length > 180) {
    throw new Error("Physical capture requires a test name with 1–180 filename characters");
  }
  const scratch = path.join(root, "tmp", "terminal-capture-workspaces");
  for (const parent of [path.join(root, "tmp"), artifacts, scratch]) {
    const existing = fs.lstatSync(parent, { throwIfNoEntry: false });
    if (typeof existing === "object" && !existing.isDirectory()) {
      throw new Error("Capture workspace parents must be directories, not symbolic links");
    }
    if (typeof existing !== "object") {
      fs.mkdirSync(parent, { mode: 0o700 });
    }
  }
  const directory = path.join(scratch, artifactStem);
  const marker = path.join(directory, ".ilu-capture-workspace");
  const active = path.join(directory, ".active");
  const existing = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (typeof existing === "object") {
    if (!existing.isDirectory() || !fs.lstatSync(marker).isFile() || fs.readFileSync(marker, "utf8") !== artifactStem) {
      throw new Error("Refusing to reset a workspace not owned by this test");
    }
  } else {
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.writeFileSync(marker, artifactStem, { mode: 0o600, flag: "wx" });
  }
  fs.writeFileSync(active, "active", { mode: 0o600, flag: "wx" });
  let code;
  const response = path.join(directory, "response.json");
  try {
    for (const name of fs.readdirSync(directory)) {
      if (name !== ".ilu-capture-workspace" && name !== ".active") {
        fs.rmSync(path.join(directory, name), { recursive: true, force: true });
      }
    }
    const home = path.join(directory, "controller-home");
    fs.mkdirSync(home, { mode: 0o700 });
    const request = path.join(directory, "request.json");
    fs.writeFileSync(request, JSON.stringify({ ...options, artifactStem }), { mode: 0o600 });
    const stdout = fs.openSync(path.join(directory, "controller.stdout.log"), "w", 0o600);
    const stderr = fs.openSync(path.join(directory, "controller.stderr.log"), "w", 0o600);
    let child;
    try {
      child = spawn("bun", [path.join(import.meta.dirname, "terminal-capture-worker.ts"), request, response], {
        cwd: root,
        env: { PATH: process.env.PATH ?? "", LANG: "C.UTF-8", HOME: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
        stdio: ["ignore", stdout, stderr]
      });
    } finally {
      fs.closeSync(stdout);
      fs.closeSync(stderr);
    }
    // The external controller is outside the cleanup permission. Await its own
    // finally/normal exit rather than adding a timeout that kills the process.
    code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
  } finally {
    fs.unlinkSync(active);
  }
  const hasResponse = fs.existsSync(response);
  // Publish only files owned by this invocation. rename replaces old bytes and
  // symlinks rather than following a destination into an unrelated file.
  for (const name of ["request.json", "response.json", "controller.stdout.log", "controller.stderr.log"]) {
    const file = path.join(directory, name);
    if (fs.existsSync(file)) {
      fs.renameSync(file, path.join(artifacts, `${artifactStem}.${name}`));
    }
  }
  const publishedResponse = path.join(artifacts, `${artifactStem}.response.json`);
  if (!hasResponse) {
    throw new Error(`Capture controller exited (${code}) without a result. Diagnostics: ${artifacts}/${artifactStem}`);
  }
  const result = JSON.parse(fs.readFileSync(publishedResponse, "utf8"));
  if (code !== 0 || result.ok !== true) {
    throw new Error(`Physical capture failed. Diagnostics: ${artifacts}/${artifactStem}\n${result.error}`);
  }
  return { ...result.value, workspaceRoot: directory, home: path.join(directory, "capture", "home") };
}
