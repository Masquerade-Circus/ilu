interface String {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  gray: string;
  grey: string;
  bold: string;
  dim: string;
  italic: string;
  underline: string;
  inverse: string;
  hidden: string;
  strikethrough: string;
}

interface Error { code?: string | number; }

declare module 'lodash/isUndefined.js' {
  const isUndefined: (value: unknown) => value is undefined;
  export default isUndefined;
}

declare module 'lodash/find.js' {
  const find: <T>(collection: T[], predicate?: ((value: T) => boolean) | Partial<T>) => T;
  export default find;
}

declare module 'lodash/includes.js' {
  const includes: (collection: unknown[] | string | Record<string, unknown>, value: unknown) => boolean;
  export default includes;
}

declare module 'lodash/isEmpty.js' {
  const isEmpty: (value: unknown) => boolean;
  export default isEmpty;
}

declare module 'cli-table' {
  class Table {
    constructor(options?: unknown);
    push(...rows: unknown[]): number;
    toString(): string;
  }
  export default Table;
}

declare module 'iludb' {
  type IluCollection = {
    get: (...args: unknown[]) => unknown;
    find: (...args: unknown[]) => unknown[];
    findOne: (...args: unknown[]) => unknown;
    add: (...args: unknown[]) => unknown;
    update: (...args: unknown[]) => unknown;
    remove: (...args: unknown[]) => void;
    count: () => number;
  };
  type IluDatabase = { getCollection: (name: string) => IluCollection };
  type IluDbFactory = {
    (filePath: string): IluDatabase;
    use: (plugin: unknown) => void;
  };
  const iluDb: IluDbFactory;
  export default iluDb;
}

declare module 'iludb/plugins/iludb-node-json-plugin.js' {
  const plugin: unknown;
  export default plugin;
}

declare module 'x-robot' {
  type XRobotStatus = 'disabled' | 'misconfigured' | 'healthy' | 'pending_remote' | 'syncing' | 'route_after_sync' | 'degraded_network' | 'degraded_auth' | 'conflict' | 'failed';
  type XRobotContext = {
    enabled: boolean;
    status: XRobotStatus;
    hasPendingRemote: boolean;
    retryCount: number;
    backoffUntil: number | null;
    lastErrorKind: string | null;
    lastErrorMessage: string | null;
    lastSyncReason: string | null;
    lastPhase: string | null;
    lastSnapshotId: string | null;
    lastSyncedSnapshotId: string | null;
    [key: string]: unknown;
  };
  type XRobotMachine = {
    current: XRobotStatus;
    context: XRobotContext;
  };
  export const machine: (...args: unknown[]) => XRobotMachine;
  export const init: (...args: unknown[]) => unknown;
  export const initial: (...args: unknown[]) => unknown;
  export const context: (...args: unknown[]) => unknown;
  export const state: (...args: unknown[]) => unknown;
  export const transition: (...args: unknown[]) => unknown;
  export const entry: (...args: unknown[]) => unknown;
  export const exit: (...args: unknown[]) => unknown;
  export const immediate: (...args: unknown[]) => unknown;
  export const guard: (...args: unknown[]) => unknown;
  export const invoke: (...args: unknown[]) => unknown;
}

declare module 'x-robot/validate' {
  export const validate: (...args: unknown[]) => unknown;
}

declare module 'x-robot/documentate' {
  export const documentate: (...args: unknown[]) => Promise<{ svg?: string; mermaid?: string }>;
}
