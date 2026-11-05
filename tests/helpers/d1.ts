import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

type Bound = { sql: string; params: unknown[] };

/** A real SQLite database behind the small part of the D1 API Scout uses, so SQL is tested rather than mocked. */
export function testD1() {
  const sqlite = new DatabaseSync(':memory:');
  const counter = { statements: 0 };
  const execute = ({ sql, params }: Bound) => {
    counter.statements += 1;
    const statement = sqlite.prepare(sql);
    const returnsRows = /^\s*(select|pragma|with)\b/i.test(sql) || /\breturning\b/i.test(sql);
    return returnsRows ? { results: statement.all(...(params as never[])) as Record<string, unknown>[], changes: 0 } : { results: [] as Record<string, unknown>[], changes: Number(statement.run(...(params as never[])).changes) };
  };
  const statement = (sql: string, params: unknown[] = []) => ({
    sql, params,
    bind: (...values: unknown[]) => statement(sql, values),
    first: async () => execute({ sql, params }).results[0] ?? null,
    all: async () => ({ results: execute({ sql, params }).results }),
    run: async () => { const result = execute({ sql, params }); return { meta: { changes: result.changes } }; },
  });
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (items: Bound[]) => {
      sqlite.exec('BEGIN');
      try {
        const results = items.map(execute);
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { db: db as unknown as D1Database, sqlite, counter };
}
