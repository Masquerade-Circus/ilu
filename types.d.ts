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
  const find: (...args: any[]) => any;
  export default find;
}

declare module 'lodash/includes.js' {
  const includes: (...args: any[]) => boolean;
  export default includes;
}

declare module 'lodash/isEmpty.js' {
  const isEmpty: (...args: any[]) => boolean;
  export default isEmpty;
}

declare module 'cli-table' {
  const Table: any;
  export default Table;
}

declare module 'iludb' {
  const iluDb: any;
  export default iluDb;
}

declare module 'iludb/plugins/iludb-node-json-plugin.js' {
  const plugin: any;
  export default plugin;
}

declare module 'x-robot' {
  export const machine: any;
  export const init: any;
  export const initial: any;
  export const context: any;
  export const state: any;
  export const transition: any;
  export const entry: any;
  export const exit: any;
  export const immediate: any;
  export const guard: any;
  export const invoke: any;
}

declare module 'x-robot/validate' {
  export const validate: any;
}

declare module 'x-robot/documentate' {
  export const documentate: any;
}
