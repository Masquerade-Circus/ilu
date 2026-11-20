import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function ensureTestDirectory(directory: string) {
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
  if (!fs.lstatSync(directory).isDirectory()) {
    throw new Error(`Expected a test directory, not a symbolic link: ${directory}`);
  }
}

export function openReusableTestDirectory({ directory, markerName, owner }: {
  directory: string;
  markerName: string;
  owner: string;
}) {
  // Keep the lock inode outside the directory being reset. Never unlink it.
  const lockPath = `${directory}.lock`;
  const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
  try {
    if (!fs.fstatSync(fd).isFile()) {
      throw new Error(`Expected a regular test lock file: ${lockPath}`);
    }
    // flock acquires the lock on our inherited open file description. The OS
    // releases it when the last copy closes, even if JS cleanup never runs.
    const lock = spawnSync("flock", ["-n", "-E", "99", "3"], { stdio: ["ignore", "ignore", "pipe", fd] });
    if (lock.status === 99) {
      throw new Error(`Test directory already in use by ${owner}: ${directory}`);
    }
    if (lock.status !== 0) {
      throw new Error(`Cannot acquire test directory lock for ${owner}: ${lock.stderr ?? ""}`, { cause: lock.error });
    }

    const marker = path.join(directory, markerName);
    const existing = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (existing) {
      if (!existing.isDirectory() || !fs.lstatSync(marker, { throwIfNoEntry: false })?.isFile() ||
          fs.readFileSync(marker, "utf8") !== owner) {
        throw new Error(`Refusing to reset a test directory not owned by ${owner}: ${directory}`);
      }
    } else {
      fs.mkdirSync(directory, { mode: 0o700 });
      fs.writeFileSync(marker, owner, { mode: 0o600, flag: "wx" });
    }
    for (const name of fs.readdirSync(directory)) {
      if (name !== markerName) {
        fs.rmSync(path.join(directory, name), { recursive: true, force: true });
      }
    }
    return fd;
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}
