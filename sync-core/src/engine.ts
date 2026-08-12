import { createSyncRuntimeFromResolvedOptions } from "./runtime.js";
import { normalizeRuntimeOptions } from "./runtime-options.js";
import type { SyncRuntime, SyncRuntimeOptions } from "./types.js";

async function createSyncRuntime(options: SyncRuntimeOptions): Promise<SyncRuntime> {
  return createSyncRuntimeFromResolvedOptions(normalizeRuntimeOptions(options));
}

export { createSyncRuntime };
export default { createSyncRuntime };
