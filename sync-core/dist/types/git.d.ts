import type { Awaitable, SyncBackend, SyncFailure, SyncMutationContext, SyncRequest } from "./index.js";
type GitCliBackendOptions = {
    repoPath?: string | null;
    branch?: string;
    remote?: string;
    remoteUrl?: string | null;
    receiveRemote?: boolean;
    publishLocal?: boolean;
    describeChange?: (context: SyncMutationContext) => Awaitable<string>;
};
type InspectBootstrapOptions = {
    rootPath: string;
    excludePatterns?: string[];
};
type GitBackend = SyncBackend & {
    adoptRemote(): void;
    inspectBootstrap(options: InspectBootstrapOptions): {
        localHasData: boolean;
        remoteHasHistory: boolean;
    };
};
declare function classifyError(error: unknown, request: SyncRequest): SyncFailure;
declare function createGitBackend({ repoPath, branch, remote, remoteUrl, receiveRemote, publishLocal, describeChange }?: GitCliBackendOptions): GitBackend;
export { createGitBackend, classifyError };
export type { GitBackend, GitCliBackendOptions };
