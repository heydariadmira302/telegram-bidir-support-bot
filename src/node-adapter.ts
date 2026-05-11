import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

type BindValue = string | number | boolean | null | undefined;

type SqliteDatabase = ReturnType<typeof Database>;

export interface NodeRuntimeBindings {
  DB: D1Database;
  KV: KVNamespace;
}

export function createNodeBindings(options: { databasePath: string; migrationsDir: string }): NodeRuntimeBindings {
  fs.mkdirSync(path.dirname(options.databasePath), { recursive: true });
  const sqlite = new Database(options.databasePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite, options.migrationsDir);
  return {
    DB: new D1SqliteDatabase(sqlite) as unknown as D1Database,
    KV: new MemoryKvNamespace() as unknown as KVNamespace,
  };
}

function applyMigrations(db: SqliteDatabase, migrationsDir: string): void {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const files = fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort();
  const insert = db.prepare('INSERT OR IGNORE INTO _migrations (name) VALUES (?)');
  const seen = db.prepare('SELECT 1 FROM _migrations WHERE name = ?').pluck();

  for (const file of files) {
    if (seen.get(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      insert.run(file);
    })();
  }
}

class D1SqliteDatabase {
  constructor(private readonly db: SqliteDatabase) {}

  prepare(query: string): D1PreparedStatement {
    return new D1SqliteStatement(this.db, query) as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const run = this.db.transaction(() => statements.map((stmt) => {
      const internal = stmt as unknown as D1SqliteStatement;
      return internal.execute<T>();
    }));
    return run();
  }

  async exec(query: string): Promise<D1ExecResult> {
    this.db.exec(query);
    return { count: 0, duration: 0 } as D1ExecResult;
  }
}

class D1SqliteStatement {
  private values: BindValue[] = [];

  constructor(private readonly db: SqliteDatabase, private readonly query: string) {}

  bind(...values: BindValue[]): D1PreparedStatement {
    this.values = values;
    return this as unknown as D1PreparedStatement;
  }

  async first<T = unknown>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.query).get(...normalizeValues(this.values)) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  execute<T = unknown>(): D1Result<T> {
    const stmt = this.db.prepare(this.query);
    const params = normalizeValues(this.values);
    if (stmt.reader) {
      const rows = stmt.all(...params) as T[];
      return { results: rows, success: true, meta: {} } as D1Result<T>;
    }
    const info = stmt.run(...params);
    return {
      results: [],
      success: true,
      meta: {
        changes: info.changes,
        last_row_id: Number(info.lastInsertRowid),
        duration: 0,
        size_after: 0,
        rows_read: 0,
        rows_written: info.changes,
        changed_db: info.changes > 0,
      },
    } as unknown as D1Result<T>;
  }
}

function normalizeValues(values: BindValue[]): unknown[] {
  return values.map((value) => {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  });
}

class MemoryKvNamespace {
  private readonly store = new Map<string, { value: string; expiresAt?: number }>();

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt && item.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}
