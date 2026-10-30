import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { assertRepoTempHome } from "../../support/home-sandbox.ts";

assertRepoTempHome(process.env.HOME, "CLI sequence HOME");
const configPath = process.env.ILU_CAPTURE_HTTP_CONFIG;
if (typeof configPath !== "string") {
  throw new Error("CLI sequence requires private configuration");
}
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
for (const [index, command] of config.commands.entries()) {
  process.stdout.write("\x1b[2J\x1b[H");
  const result = spawnSync(command[0], ["--import", "tsx", "--import", path.join(import.meta.dirname, "terminal-capture-http.ts"), ...command.slice(1)], {
    env: { ...process.env, ILU_CAPTURE_HTTP_INDEX: String(index) },
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (!Number.isInteger(result.status)) {
    throw new Error("The real CLI sequence did not exit normally");
  }
  const outcome = path.join(config.sequenceDirectory, `invocation-${index}.json`);
  fs.writeFileSync(outcome, JSON.stringify({ exitCode: result.status }), { mode: 0o600 });
  while (!fs.existsSync(path.join(config.sequenceDirectory, `continue-${index}`))) {
    await delay(20);
  }
}
