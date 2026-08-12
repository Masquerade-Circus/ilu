import fs from "node:fs";
import path from "node:path";
import type { ResolvedSyncRuntimeOptions, SyncBackend, SyncRuntimeOptions } from "./types.js";

const PRIVATE_EXCLUSION = ".sync-core/**";

function hasMethod<T extends string>(value: unknown, method: T): value is Record<T, (...args: never[]) => unknown> {
  return (
    value !== null && typeof value === "object" && typeof (value as Record<string, unknown>)[method] === "function"
  );
}

function finiteInteger(name: string, value: unknown, defaultValue: number) {
  const normalized = value === void 0 ? defaultValue : value;
  if (
    typeof normalized !== "number" ||
    !Number.isFinite(normalized) ||
    !Number.isInteger(normalized) ||
    normalized < 0
  ) {
    throw new Error(`Sync runtime ${name} must be a finite integer greater than or equal to 0`);
  }
  return normalized;
}

function normalizeRuntimeOptions(options: SyncRuntimeOptions): ResolvedSyncRuntimeOptions {
  if (options === null || typeof options !== "object") {
    throw new Error("Sync runtime requires options");
  }
  if (typeof options.rootPath !== "string" || options.rootPath.trim().length === 0) {
    throw new Error("Sync runtime rootPath must be a non-empty string");
  }

  const rootPath = path.resolve(options.rootPath);
  let rootStat: fs.Stats | null = null;
  try {
    rootStat = fs.lstatSync(rootPath);
  } catch (error) {
    const code = error !== null && typeof error === "object" ? (error as NodeJS.ErrnoException).code : null;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      throw new Error(`Sync runtime cannot inspect rootPath: ${rootPath}`, { cause: error });
    }

    try {
      fs.mkdirSync(rootPath, { recursive: true, mode: 0o700 });
      rootStat = fs.lstatSync(rootPath);
    } catch (mkdirError) {
      throw new Error(`Sync runtime cannot create rootPath: ${rootPath}`, { cause: mkdirError });
    }
  }
  if (rootStat.isSymbolicLink()) {
    throw new Error(`Sync runtime refuses a symbolic link at rootPath: ${rootPath}`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`Sync runtime rootPath is not a directory: ${rootPath}`);
  }
  if (!hasMethod(options.backend, "synchronize") || !hasMethod(options.backend, "classifyError")) {
    throw new Error("Sync runtime requires a backend with synchronize() and classifyError()");
  }
  if (
    options.excludePatterns !== void 0 &&
    (!Array.isArray(options.excludePatterns) || options.excludePatterns.some((item) => typeof item !== "string"))
  ) {
    throw new Error("Sync runtime excludePatterns must be an array of strings");
  }

  const maxRetries = finiteInteger("maxRetries", options.maxRetries, 3);
  const retryDelayMs = finiteInteger("retryDelayMs", options.retryDelayMs, 1000);
  const maxRetryDelayMs = finiteInteger("maxRetryDelayMs", options.maxRetryDelayMs, 30000);
  const retryBackoffFactor = options.retryBackoffFactor ?? 2;
  if (typeof retryBackoffFactor !== "number" || !Number.isFinite(retryBackoffFactor) || retryBackoffFactor < 1) {
    throw new Error("Sync runtime retryBackoffFactor must be finite and greater than or equal to 1");
  }
  if (maxRetryDelayMs < retryDelayMs) {
    throw new Error("Sync runtime maxRetryDelayMs must be greater than or equal to retryDelayMs");
  }

  const exclusions = (options.excludePatterns ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
  if (!exclusions.includes(PRIVATE_EXCLUSION)) {
    exclusions.push(PRIVATE_EXCLUSION);
  }

  return {
    backend: options.backend as SyncBackend,
    rootPath,
    excludePatterns: [...new Set(exclusions)],
    maxRetries,
    retryDelayMs,
    retryBackoffFactor,
    maxRetryDelayMs
  };
}

export { normalizeRuntimeOptions, PRIVATE_EXCLUSION };
