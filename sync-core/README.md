# sync-core

**Add durable, backend-agnostic synchronization to a Node application through one factory and two runtime methods.**

`sync-core` coordinates synchronization work, persists pending operations, retries retryable failures and absorbs bursts of repeated signals. Your application keeps ownership of its data. You provide a backend and the directory that contains that data, then call `sync()` whenever local work should reach the backend.

Git support is included through `sync-core/git`. Custom backends implement a two-method contract without exposing provider policy to the core.

## Quick start

```ts
import { createSyncRuntime } from "sync-core";
import { createGitBackend } from "sync-core/git";

const rootPath = "./data";

const remoteUrl = process.env.SYNC_REMOTE_URL;
if (!remoteUrl) {
  throw new Error("SYNC_REMOTE_URL is required");
}

const backend = createGitBackend({
  repoPath: rootPath,
  remoteUrl,
  branch: "main"
});

const runtime = await createSyncRuntime({
  backend,
  rootPath,
  excludePatterns: [".config/**"]
});

await runtime.sync({ domain: "documents", action: "save" });
console.log(runtime.getSyncStatus());
```

The developer supplies `backend`, `rootPath` and, when needed, exclusion or retry options. The runtime creates a missing `rootPath`, then handles coordination and operational persistence.

`sync()` starts that coordination. It does not receive, own or store your user data. The backend reads or writes data under `rootPath` according to its own provider protocol. The optional context only describes why synchronization was requested and is forwarded to the backend.

## How it works

Each `sync()` call becomes part of an operation with a stable `operationId`. The runtime persists pending state before backend work, calls `backend.synchronize()`, classifies failures and retries only those marked `retryable`.

```ts
await runtime.sync();
await runtime.sync({ domain: "documents", action: "save" });
runtime.getSyncStatus();
```

- `sync(context?)` starts or joins the operation that covers the call and resolves with its resulting state.
- `getSyncStatus()` returns the current in-memory state without starting backend work.
- The runtime keeps at most one active operation and one trailing coalesced operation.
- Successful work clears pending state. Terminal failures remain visible through runtime status and durable state.

## Runtime options

```ts
type SyncRuntimeOptions = {
  backend: SyncBackend;
  rootPath: string;
  excludePatterns?: string[];
  maxRetries?: number;
  retryDelayMs?: number;
  retryBackoffFactor?: number;
  maxRetryDelayMs?: number;
};
```

| Option               | Default | Purpose                                     |
| -------------------- | ------: | ------------------------------------------- |
| `excludePatterns`    |    `[]` | Files and directories the backend must skip |
| `maxRetries`         |     `3` | Retry attempts after the initial attempt    |
| `retryDelayMs`       |  `1000` | Initial retry delay                         |
| `retryBackoffFactor` |     `2` | Exponential delay multiplier                |
| `maxRetryDelayMs`    | `30000` | Cap for the calculated exponential delay    |

`rootPath` names the directory that contains your application data. The factory creates it recursively with restrictive permissions when it is missing, without changing permissions on an existing directory. It rejects a file or symbolic link at the final `rootPath`, then initializes `.sync-core` with its private-state guarantees. Creation, inspection or write failures stop startup with a clear error instead of falling back to memory.

The runtime protects the final `rootPath`, `.sync-core` and its state files. Parent directories are allowed to include platform-standard links, so the application must choose a path whose ancestors it trusts.

The factory also validates the backend contract and retry values. It automatically adds `.sync-core/**` to the exclusions passed to every backend.

## Automatic retry that survives restarts

Retryable failures use configurable exponential backoff. With the defaults, retries wait 1, 2 and 4 seconds. The initial backend call does not count as a retry.

When `classifyError()` returns `retryAfterMs`, that value becomes the minimum wait. It can exceed `maxRetryDelayMs` because provider guidance takes precedence over the calculated cap.

The runtime preserves the same `operationId` across every attempt and process restart. On startup, it rehydrates retryable pending work and resumes after the persisted backoff. A retry timer with waiting callers keeps the process alive. A timer restored without callers uses `unref()` so pending background work does not hold the process open by itself.

Non-retryable failures and exhausted retries remain pending in a terminal state. The core has no manual retry method or external scheduler contract.

## Repeated calls without lost mutations

`sync-core` coalesces coordination work rather than delaying calls through throttle or debounce windows.

- Calls grouped before the first operation starts in the same microtask share that operation and promise.
- Calls received while work or backoff is active join one trailing operation.
- Every caller waits for the operation that covers its call.
- A successful active operation starts the trailing operation next.
- A signal received during backoff preserves the wait and cannot cancel active backend work.
- A terminal active failure persists the trailing operation and resolves its callers with the terminal state.

This gives the application a direct rule: call `sync()` after a relevant local mutation. The core groups redundant coordination signals while preserving work that arrives during an active operation.

## Bring your own backend

A custom backend implements only `synchronize()` and `classifyError()`:

```ts
import type { SyncBackend } from "sync-core";

declare function synchronizeProviderData(input: {
  operationId: string;
  rootPath: string;
  excludePatterns: string[];
}): Promise<void>;
declare function isTemporaryProviderError(error: unknown): boolean;

const backend: SyncBackend = {
  async synchronize(request) {
    await synchronizeProviderData({
      operationId: request.operationId,
      rootPath: request.rootPath,
      excludePatterns: request.excludePatterns
    });
  },

  classifyError(error) {
    return isTemporaryProviderError(error)
      ? { kind: "network", retryable: true, safeMessage: "Provider unavailable" }
      : { kind: "unknown", retryable: false, safeMessage: "Synchronization failed" };
  }
};
```

The complete request contract is:

```ts
type SyncRequest = {
  operationId: string;
  rootPath: string;
  excludePatterns: string[];
  context: SyncMutationContext;
};

type SyncBackend = {
  synchronize(request: SyncRequest): Promise<void>;
  classifyError(error: unknown, request: SyncRequest): SyncFailure;
};

type SyncFailure = {
  kind: "network" | "auth" | "conflict" | "config" | "unknown";
  retryable: boolean;
  retryAfterMs?: number;
  safeMessage?: string;
};
```

Backends must treat repeated requests with the same `operationId` as idempotent. Keep `safeMessage` free of secrets and provider internals because it can reach user-visible status.

The core does not discover providers or data automatically. Your application selects and configures the backend.

## Durable internal state

The Node runtime stores private operational state at:

```text
<rootPath>/.sync-core/state.json
```

This state belongs exclusively to the runtime. It tracks coordination, pending work and retry recovery, not application data. `.sync-core/**` is always excluded from backend synchronization.

The state directory uses mode `0700`, and state or temporary files use `0600` where the host supports POSIX permissions. Persistence rejects symlinks, validates JSON, writes through a temporary file and atomic rename, and uses `fsync` where the platform supports it. Invalid or unwritable state fails clearly. The runtime never falls back silently to memory.

There is no public state-store type, factory, option or package subpath.

## Git backend

`createGitBackend()` keeps Git-specific configuration and behavior outside the common runtime contract:

```ts
type GitCliBackendOptions = {
  repoPath?: string | null;
  branch?: string;
  remote?: string;
  remoteUrl?: string | null;
  receiveRemote?: boolean;
  publishLocal?: boolean;
  describeChange?: (context: SyncMutationContext) => string | PromiseLike<string>;
};
```

Git defaults to `branch: "main"`, `remote: "origin"`, `remoteUrl: null`, `receiveRemote: true` and `publishLocal: true`. The type permits an omitted or null `repoPath` so setup flows can construct the backend before choosing a repository. Synchronization requires `repoPath` to be configured.

```ts
import { createGitBackend } from "sync-core/git";

const backend = createGitBackend({
  repoPath: "./sync-repository",
  remoteUrl: process.env.SYNC_REMOTE_URL ?? null,
  branch: "main",
  remote: "origin",
  receiveRemote: true,
  publishLocal: true,
  describeChange: (context) => `sync(${context.domain ?? "data"}): ${context.action ?? "save"} local data snapshot`
});
```

`receiveRemote` and `publishLocal` default to `true`. The backend handles repository initialization, commits, fetch, integration and push. `repoPath` can differ from the runtime `rootPath`. In that arrangement, the backend copies included data between both directories.

For a separate `repoPath`, an empty application root does not imply that every repository file was deleted. When the root has no synchronizable data and the repository already does, the first synchronization hydrates the root from the repository before any change calculation. This bootstrap preserves exclusions, ignores `.git` and symbolic links, and does not create a deletion commit or publish one. A root that already contains synchronizable data remains authoritative for normal local changes. Applications should call `inspectBootstrap()` before the first synchronization and stop for an explicit decision when both local data and remote history exist.

The Git backend also exposes `inspectBootstrap()` and `adoptRemote()` for explicit product setup flows. Runtime creation performs no automatic discovery or adoption.

## Node runtime and browser bundles

The runtime requires Node.js 20.11 or newer. Git usage also requires Git on `PATH`.

The UMD bundle can load through CommonJS, AMD or a browser global, and ESM and CommonJS Node entry points are built. Browser, AMD and global loading does not provide browser synchronization. Calling `createSyncRuntime()` outside Node rejects with:

```text
sync-core createSyncRuntime() supports Node.js only
```

There is no browser persistence implementation or in-memory fallback.

## Public API

The root `sync-core` export provides `createSyncRuntime` and its public types.

```ts
declare function createSyncRuntime(options: SyncRuntimeOptions): Promise<SyncRuntime>;

type SyncRuntime = {
  sync(context?: SyncMutationContext): Promise<NormalizedSyncState>;
  getSyncStatus(): NormalizedSyncState;
};
```

Public package entries:

- `sync-core`
- `sync-core/git`
- `sync-core/diagram`

No public state-store subpath exists.

## Operational limits

- Use one runtime owner per root and backend. Separate runtime instances do not coordinate through locks.
- Make backend processing idempotent for each stable `operationId`.
- Select and configure the backend explicitly. The core performs no provider or data discovery.
- Call `sync()` after relevant mutations. The core does not observe the filesystem or application state for changes.
- Run the synchronization runtime in Node. Browser bundles expose only the Node-only rejection boundary.

## Build from this workspace

```bash
cd sync-core
bun install
bun run build
```

The build produces UMD, ESM, CommonJS and TypeScript declaration artifacts under `dist/`. This repository does not confirm an npm publication workflow, so consumers should install or link the built local package according to their workspace setup.

## Development

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

Git is the only included backend.

## License

Apache-2.0
