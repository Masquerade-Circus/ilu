import type { SyncRuntime, SyncRuntimeOptions } from "./types.js";

async function createSyncRuntime(options: SyncRuntimeOptions): Promise<SyncRuntime> {
  void options;
  throw new Error("sync-core createSyncRuntime() supports Node.js only");
}

export { createSyncRuntime };
