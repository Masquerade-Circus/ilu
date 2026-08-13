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
