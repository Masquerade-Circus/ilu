export type Awaitable<T> = T | PromiseLike<T>;

export type PublicSyncStatus =
  "healthy" | "pending_remote" | "degraded_network" | "degraded_auth" | "conflict" | "failed";

export type SyncStatus = PublicSyncStatus;

export type SyncMutationContext = {
  domain?: string;
  action?: string;
  reason?: string;
} & Record<string, unknown>;

export type SyncFailureKind = "network" | "auth" | "conflict" | "config" | "unknown";

export type SyncFailure = {
  kind: SyncFailureKind;
  retryable: boolean;
  retryAfterMs?: number;
  safeMessage?: string;
};

export type SyncRequest = {
  operationId: string;
  rootPath: string;
  excludePatterns: string[];
  context: SyncMutationContext;
};

export type SyncBackend = {
  synchronize(request: SyncRequest): Promise<void>;
  classifyError(error: unknown, request: SyncRequest): SyncFailure;
};

export type NormalizedSyncState = {
  status: PublicSyncStatus;
  hasPendingRemote: boolean;
  pendingOperationId: string | null;
  retryCount: number;
  backoffUntil: number | null;
  lastErrorKind: SyncFailureKind | null;
  lastErrorMessage: string | null;
  lastSyncReason: string | null;
  lastPhase: string | null;
  lastSnapshotId: string | null;
  lastSyncedSnapshotId: string | null;
};

export type SyncRuntimeOptions = {
  backend: SyncBackend;
  rootPath: string;
  excludePatterns?: string[];
  maxRetries?: number;
  retryDelayMs?: number;
  retryBackoffFactor?: number;
  maxRetryDelayMs?: number;
};

export type ResolvedSyncRuntimeOptions = Required<SyncRuntimeOptions>;

export type SyncRuntime = {
  sync(context?: SyncMutationContext): Promise<NormalizedSyncState>;
  getSyncStatus(): NormalizedSyncState;
};

export type PersistedSyncState = NormalizedSyncState & {
  retryable: boolean;
  pendingContext: SyncMutationContext;
};
