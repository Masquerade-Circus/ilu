import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Metadata only: never collect terminal contents, argv, environment or process memory.
export function createCaptureDiagnostics({ directory }) {
  const capture = path.join(directory, "capture");
  const destination = path.join(directory, "capture-diagnostics.json");
  const diagnostic = {
    startedAt: new Date().toISOString(),
    sender: { observable: false, reason: "not observable with the current capture API" },
    receiver: { source: "capture/terminal-output.bin", samples: [], omittedSamples: 0 },
    stages: [],
    beforeClose: null,
    errors: []
  };
  const recordError = ({ operation, error }) => {
    if (diagnostic.errors.length < 32) {
      diagnostic.errors.push({ operation, code: typeof error.code === "string" ? error.code : "UNAVAILABLE" });
    }
  };
  const sample = () => {
    try {
      const status = fs.existsSync(path.join(capture, "application.json"))
        ? JSON.parse(fs.readFileSync(path.join(capture, "application.json"), "utf8"))
        : {};
      const output = fs.statSync(path.join(capture, "terminal-output.bin"), { throwIfNoEntry: false });
      const application = {};
      if (["ready", "running", "exited"].includes(status.state)) {
        application.state = status.state;
      }
      for (const key of ["pid", "hostPid", "cols", "rows", "exitCode"]) {
        if (Number.isSafeInteger(status[key]) && status[key] >= 0) {
          application[key] = status[key];
        }
      }
      const observation = {
        at: new Date().toISOString(),
        application,
        receivedBytes: typeof output === "object" ? output.size : null
      };
      diagnostic.receiver.samples.push(observation);
      if (diagnostic.receiver.samples.length > 256) {
        diagnostic.receiver.samples.splice(32, 1);
        diagnostic.receiver.omittedSamples++;
      }
      return observation;
    } catch (error) {
      recordError({ operation: "sample-receiver", error });
      return null;
    }
  };
  const persist = () => {
    const temporary = `${destination}.next`;
    let owned = false;
    try {
      const fd = fs.openSync(temporary, "wx", 0o600);
      owned = true;
      try {
        fs.writeFileSync(fd, JSON.stringify(diagnostic, null, 2));
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temporary, destination);
    } catch (error) {
      recordError({ operation: "persist-diagnostics", error });
      try {
        fs.writeSync(2, "Capture diagnostics could not be persisted. Original capture result is unchanged.\n");
      } catch (reportError) {
        recordError({ operation: "report-diagnostic-failure", error: reportError });
      }
      if (owned) {
        try {
          fs.unlinkSync(temporary);
        } catch (cleanupError) {
          recordError({ operation: "remove-diagnostic-temporary", error: cleanupError });
        }
      }
    }
  };
  const interval = setInterval(sample, 250);
  return {
    stage(name) {
      diagnostic.stages.push({ name, at: new Date().toISOString() });
      sample();
      persist();
    },
    beforeClose() {
      clearInterval(interval);
      const observation = sample();
      diagnostic.beforeClose = { at: new Date().toISOString(), observation, processes: [], processError: null };
      try {
        const table = execFileSync("ps", ["-eo", "pid=,ppid=,pgid=,stat=,wchan:32="], { encoding: "utf8" });
        const processes = table
          .trim()
          .split("\n")
          .map((line) => {
            const [pid, ppid, pgid, state, waitChannel] = line.trim().split(/\s+/);
            return { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), state, waitChannel };
          });
        const owned = new Set([process.pid]);
        for (const key of ["pid", "hostPid"]) {
          const pid = observation?.application[key];
          if (Number.isSafeInteger(pid) && pid > 0) {
            owned.add(pid);
          }
        }
        let previousSize = -1;
        while (previousSize !== owned.size) {
          previousSize = owned.size;
          for (const entry of processes) {
            if (owned.has(entry.ppid)) {
              owned.add(entry.pid);
            }
          }
        }
        diagnostic.beforeClose.processes = processes.filter((entry) => owned.has(entry.pid));
      } catch (error) {
        diagnostic.beforeClose.processError = typeof error.code === "string" ? error.code : "UNAVAILABLE";
      }
      diagnostic.stages.push({ name: "before-public-close", at: diagnostic.beforeClose.at });
      persist();
    },
    stop() {
      clearInterval(interval);
    }
  };
}
