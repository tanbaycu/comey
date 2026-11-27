declare module 'node:path' {
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
}

declare module 'node:fs' {
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: 'utf8' | 'utf-8'): string;
  export function statSync(path: string): { isDirectory(): boolean };
}

declare module 'node:sqlite' {
  export type SQLInputValue = null | number | bigint | string | ArrayBufferView;
  export interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }
  export interface StatementSync {
    get(...params: SQLInputValue[]): Record<string, unknown> | undefined;
    all(...params: SQLInputValue[]): Record<string, unknown>[];
    run(...params: SQLInputValue[]): StatementResultingChanges;
  }
  export class DatabaseSync {
    constructor(location: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

interface ImportMeta {
  readonly dirname: string;
}
