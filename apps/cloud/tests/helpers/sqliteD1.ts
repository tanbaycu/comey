import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

function normalizeParams(params: unknown[]): SQLInputValue[] {
  return params.map((p) => (p === undefined ? null : (p as SQLInputValue)));
}

class SqlitePreparedStatement {
  private readonly params: SQLInputValue[] = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    boundParams: unknown[] = []
  ) {
    this.params = normalizeParams(boundParams);
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqlitePreparedStatement(
      this.db,
      this.sql,
      values
    ) as unknown as D1PreparedStatement;
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (colName) {
      return (row[colName] as T) ?? null;
    }
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const stmt = this.db.prepare(this.sql);
    const rows = stmt.all(...this.params) as T[];
    return {
      results: rows,
      success: true,
      meta: {
        duration: 0,
        size_after: 0,
        rows_read: rows.length,
        rows_written: 0,
        last_row_id: 0,
        changed_db: false,
        changes: 0,
      },
    };
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const stmt = this.db.prepare(this.sql);
    const info = stmt.run(...this.params);
    return {
      results: [] as T[],
      success: true,
      meta: {
        duration: 0,
        size_after: 0,
        rows_read: 0,
        rows_written: Number(info.changes ?? 0),
        last_row_id: Number(info.lastInsertRowid ?? 0),
        changed_db: Number(info.changes ?? 0) > 0,
        changes: Number(info.changes ?? 0),
      },
    };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const rows = await this.all<Record<string, unknown>>();
    return rows.results.map((r) => Object.values(r)) as T[];
  }
}

export function createTestD1Database(migrationPathOrDir: string): {
  d1: D1Database;
  rawDb: DatabaseSync;
} {
  const db = new DatabaseSync(':memory:');
  const stat = statSync(migrationPathOrDir);
  if (stat.isDirectory()) {
    const files = readdirSync(migrationPathOrDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      db.exec(readFileSync(join(migrationPathOrDir, file), 'utf8'));
    }
  } else {
    db.exec(readFileSync(migrationPathOrDir, 'utf8'));
  }

  const d1: D1Database = {
    prepare(query: string): D1PreparedStatement {
      return new SqlitePreparedStatement(db, query) as unknown as D1PreparedStatement;
    },
    async batch<T = unknown>(
      statements: D1PreparedStatement[]
    ): Promise<D1Result<T>[]> {
      db.exec('BEGIN');
      try {
        const results: D1Result<T>[] = [];
        for (const stmt of statements) {
          results.push(await stmt.run<T>());
        }
        db.exec('COMMIT');
        return results;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    async exec(query: string): Promise<D1ExecResult> {
      db.exec(query);
      return { count: 1, duration: 0 };
    },
    async dump(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0);
    },
    withSession(): D1DatabaseSession {
      return d1 as unknown as D1DatabaseSession;
    },
  };

  return { d1, rawDb: db };
}
