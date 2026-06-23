import type { Database, Statement } from "node:sqlite";

/**
 * A minimal, parameterized query builder.
 *
 * Historically several call sites built SQL by string concatenation, e.g.
 *
 *   db.exec(`SELECT * FROM users WHERE name = '${name}'`)
 *
 * which is vulnerable to SQL injection. This builder forces every dynamic
 * value through a bound parameter so user input can never alter the query
 * structure.
 */
export interface BoundQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** Identifiers (table/column names) cannot be parameterized, so they are
 * validated against a strict allow-list pattern instead. */
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertIdentifier(name: string): string {
  if (!IDENTIFIER_RE.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${JSON.stringify(name)}`);
  }
  return name;
}

export class QueryBuilder {
  #table: string;
  #wheres: { column: string; value: unknown }[] = [];
  #limit: number | null = null;

  constructor(table: string) {
    this.#table = assertIdentifier(table);
  }

  static from(table: string): QueryBuilder {
    return new QueryBuilder(table);
  }

  /** Add an equality predicate. The value is always bound, never inlined. */
  where(column: string, value: unknown): this {
    this.#wheres.push({ column: assertIdentifier(column), value });
    return this;
  }

  limit(n: number): this {
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`Invalid LIMIT: ${n}`);
    }
    this.#limit = n;
    return this;
  }

  build(): BoundQuery {
    const params: unknown[] = [];
    let sql = `SELECT * FROM ${this.#table}`;
    if (this.#wheres.length > 0) {
      const clauses = this.#wheres.map(({ column }) => {
        return `${column} = ?`;
      });
      sql += ` WHERE ${clauses.join(" AND ")}`;
      for (const { value } of this.#wheres) {
        params.push(value);
      }
    }
    if (this.#limit !== null) {
      sql += ` LIMIT ?`;
      params.push(this.#limit);
    }
    return { sql, params };
  }

  prepare(db: Database): Statement {
    return db.prepare(this.build().sql);
  }
}
