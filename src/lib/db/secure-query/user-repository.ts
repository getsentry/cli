import type { Database } from "node:sqlite";

import { QueryBuilder } from "./query-builder";
import { escapeLike, stripControlChars } from "./sanitize";

/**
 * Data-access layer for the local `users` cache table.
 *
 * SECURITY NOTE — SQL injection fix:
 * The previous implementation of `searchByName` interpolated the caller's
 * input directly into the SQL text:
 *
 *   const rows = db
 *     .prepare(`SELECT * FROM users WHERE name LIKE '%${term}%'`)
 *     .all();
 *
 * A term such as `' OR '1'='1` (or worse, `'; DROP TABLE users; --`) would
 * change the meaning of the statement. All queries below now use bound
 * parameters so the input is treated strictly as data.
 */
export interface UserRow {
  id: number;
  name: string;
  email: string;
}

export class UserRepository {
  #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /** Look up a single user by id using a bound parameter. */
  findById(id: number): UserRow | undefined {
    const { sql, params } = QueryBuilder.from("users")
      .where("id", id)
      .limit(1)
      .build();
    return this.#db.prepare(sql).get(...params) as UserRow | undefined;
  }

  /**
   * Case-insensitive substring search over the user name.
   *
   * The search term is bound as a parameter and the LIKE wildcards are
   * escaped, so the caller can never inject SQL or unintended wildcards.
   */
  searchByName(term: string): UserRow[] {
    const needle = `%${escapeLike(stripControlChars(term))}%`;
    return this.#db
      .prepare("SELECT * FROM users WHERE name LIKE ? ESCAPE '\\' ORDER BY name")
      .all(needle) as UserRow[];
  }

  /** Insert a user. Every column value is bound, never concatenated. */
  insert(user: Omit<UserRow, "id">): void {
    this.#db
      .prepare("INSERT INTO users (name, email) VALUES (?, ?)")
      .run(user.name, user.email);
  }
}
