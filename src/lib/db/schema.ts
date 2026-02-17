/**
 * Database schema DDL and version management.
 *
 * This module defines the canonical schema for the CLI's SQLite database,
 * handles migrations between versions, and provides repair utilities for
 * fixing schema inconsistencies.
 *
 * Schema is defined once in TABLE_SCHEMAS and used to generate:
 * - DDL statements for table creation
 * - Column lists for schema repair
 * - Migration checks
 */

import type { Database } from "bun:sqlite";

export const CURRENT_SCHEMA_VERSION = 6;

/** Environment variable to disable auto-repair */
const NO_AUTO_REPAIR_ENV = "SENTRY_CLI_NO_AUTO_REPAIR";

type SqliteType = "TEXT" | "INTEGER";

export type ColumnDef = {
  type: SqliteType;
  primaryKey?: boolean;
  notNull?: boolean;
  default?: string;
  check?: string;
  /** Schema version when this column was added (for repair tracking) */
  addedInVersion?: number;
};

export type TableSchema = {
  columns: Record<string, ColumnDef>;
  /**
   * Composite primary key columns. When set, the DDL generator emits a
   * table-level `PRIMARY KEY (col1, col2, ...)` constraint instead of
   * per-column `PRIMARY KEY` attributes. Individual columns listed here
   * should NOT also set `primaryKey: true`.
   */
  compositePrimaryKey?: string[];
};

/**
 * Canonical schema definitions for all tables.
 * DDL and repair info are generated from this single source of truth.
 */
export const TABLE_SCHEMAS: Record<string, TableSchema> = {
  schema_version: {
    columns: {
      version: { type: "INTEGER", primaryKey: true },
    },
  },
  auth: {
    columns: {
      id: { type: "INTEGER", primaryKey: true, check: "id = 1" },
      token: { type: "TEXT" },
      refresh_token: { type: "TEXT" },
      expires_at: { type: "INTEGER" },
      issued_at: { type: "INTEGER" },
      updated_at: {
        type: "INTEGER",
        notNull: true,
        default: "(unixepoch() * 1000)",
      },
    },
  },
  defaults: {
    columns: {
      id: { type: "INTEGER", primaryKey: true, check: "id = 1" },
      organization: { type: "TEXT" },
      project: { type: "TEXT" },
      updated_at: {
        type: "INTEGER",
        notNull: true,
        default: "(unixepoch() * 1000)",
      },
    },
  },
  project_cache: {
    columns: {
      cache_key: { type: "TEXT", primaryKey: true },
      org_slug: { type: "TEXT", notNull: true },
      org_name: { type: "TEXT", notNull: true },
      project_slug: { type: "TEXT", notNull: true },
      project_name: { type: "TEXT", notNull: true },
      cached_at: {
        type: "INTEGER",
        notNull: true,
        default: "(unixepoch() * 1000)",
      },
      last_accessed: {
        type: "INTEGER",
        notNull: true,
        default: "(unixepoch() * 1000)",
      },
    },
  },
  dsn_cache: {
    columns: {
      directory: { type: "TEXT", primaryKey: true },
      dsn: { type: "TEXT", notNull: true },
      project_id: { type: "TEXT", notNull: true },
      org_id: { type: "TEXT" },
      source: { type: "TEXT", notNull: true },
      source_path: { type: "TEXT" },
      resolved_org_slug: { type: "TEXT" },
      resolved_org_name: { type: "TEXT" },
      resolved_project_slug: { type: "TEXT" },
      resolved_project_name: { type: "TEXT" },
      fingerprint: { type: "TEXT", addedInVersion: 4 },
      all_dsns_json: { type: "TEXT", addedInVersion: 4 },
      source_mtimes_json: { type: "TEXT", addedInVersion: 4 },
      dir_mtimes_json: { type: "TEXT", addedInVersion: 4 },
      root_dir_mtime: { type: "INTEGER", addedInVersion: 4 },
      ttl_expires_at: { type: "INTEGER", addedInVersion: 4 },
      cached_at: {
        type: "INTEGER",
        notNull: true,
        default: "(unixepoch() * 1000)",
      },
      last_accessed: {
        type: "INTEGER",
        notNull: true,
        default: "(unixepoch() * 1000)",
      },
    },
  },
  project_aliases: {
    columns: {
      alias: { type: "TEXT", primaryKey: true },
      org_slug: { type: "TEXT", notNull: true },
      project_slug: { type: "TEXT", notNull: true },
      dsn_fingerprint: { type: "TEXT" },
      cached_at: {
        type: "INTEGER",
        notNull: true,
        default: "(unixepoch() * 1000)",
      },
      last_accessed: {
        type: "INTEGER",
        notNull: true,
        default: "(unixepoch() * 1000)",
      },
    },
  },
  pagination_cursors: {
    columns: {
      command_key: { type: "TEXT", notNull: true },
      context: { type: "TEXT", notNull: true },
      cursor: { type: "TEXT", notNull: true },
      expires_at: { type: "INTEGER", notNull: true },
    },
    compositePrimaryKey: ["command_key", "context"],
  },
  metadata: {
    columns: {
      key: { type: "TEXT", primaryKey: true },
      value: { type: "TEXT", notNull: true },
    },
  },
  org_regions: {
    columns: {
      org_slug: { type: "TEXT", primaryKey: true },
      region_url: { type: "TEXT", notNull: true },
      updated_at: {
        type: "INTEGER",
        notNull: true,
        default: "(unixepoch() * 1000)",
      },
    },
  },
  user_info: {
    columns: {
      id: { type: "INTEGER", primaryKey: true, check: "id = 1" },
      user_id: { type: "TEXT", notNull: true },
      email: { type: "TEXT" },
      username: { type: "TEXT" },
      name: { type: "TEXT", addedInVersion: 3 },
      updated_at: {
        type: "INTEGER",
        notNull: true,
        default: "(unixepoch() * 1000)",
      },
    },
  },
  instance_info: {
    columns: {
      id: { type: "INTEGER", primaryKey: true, check: "id = 1" },
      instance_id: { type: "TEXT", notNull: true },
      created_at: {
        type: "INTEGER",
        notNull: true,
        default: "(unixepoch() * 1000)",
      },
    },
  },
  project_root_cache: {
    columns: {
      cwd: { type: "TEXT", primaryKey: true },
      project_root: { type: "TEXT", notNull: true },
      reason: { type: "TEXT", notNull: true },
      cwd_mtime: { type: "INTEGER", notNull: true },
      cached_at: {
        type: "INTEGER",
        notNull: true,
        default: "(unixepoch() * 1000)",
      },
      ttl_expires_at: { type: "INTEGER", notNull: true },
    },
  },
  transaction_aliases: {
    columns: {
      idx: { type: "INTEGER", notNull: true },
      alias: { type: "TEXT", notNull: true },
      transaction_name: { type: "TEXT", notNull: true },
      org_slug: { type: "TEXT", notNull: true },
      project_slug: { type: "TEXT", notNull: true },
      fingerprint: { type: "TEXT", notNull: true },
      cached_at: {
        type: "INTEGER",
        notNull: true,
        default: "(unixepoch() * 1000)",
      },
    },
    compositePrimaryKey: ["fingerprint", "idx"],
  },
};

/** Generate CREATE TABLE DDL from column definitions */
function columnDefsToDDL(
  tableName: string,
  columns: [string, ColumnDef][],
  compositePrimaryKey?: string[]
): string {
  const columnDefs = columns.map(([name, col]) => {
    const parts = [name, col.type];
    if (col.primaryKey) {
      parts.push("PRIMARY KEY");
    }
    if (col.check) {
      parts.push(`CHECK (${col.check})`);
    }
    if (col.notNull) {
      parts.push("NOT NULL");
    }
    if (col.default) {
      parts.push(`DEFAULT ${col.default}`);
    }
    return parts.join(" ");
  });

  if (compositePrimaryKey && compositePrimaryKey.length > 0) {
    columnDefs.push(`PRIMARY KEY (${compositePrimaryKey.join(", ")})`);
  }

  return `CREATE TABLE IF NOT EXISTS ${tableName} (\n    ${columnDefs.join(",\n    ")}\n  )`;
}

/** Generate CREATE TABLE DDL from a table schema */
export function generateTableDDL(
  tableName: string,
  schema: TableSchema
): string {
  return columnDefsToDDL(
    tableName,
    Object.entries(schema.columns),
    schema.compositePrimaryKey
  );
}

/**
 * Generate CREATE TABLE DDL excluding columns added in migrations.
 * Useful for testing schema repair by creating "pre-migration" tables.
 *
 * @throws Error if table has no base columns (all columns were added in migrations)
 */
export function generatePreMigrationTableDDL(tableName: string): string {
  const schema = TABLE_SCHEMAS[tableName];
  if (!schema) {
    throw new Error(`Unknown table: ${tableName}`);
  }

  const baseColumns = Object.entries(schema.columns).filter(
    ([, col]) => col.addedInVersion === undefined
  );

  if (baseColumns.length === 0) {
    throw new Error(
      `Table ${tableName} has no base columns (all columns were added in migrations)`
    );
  }

  return columnDefsToDDL(tableName, baseColumns, schema.compositePrimaryKey);
}

/** Generated DDL statements for all tables (used for repair and init) */
export const EXPECTED_TABLES: Record<string, string> = Object.fromEntries(
  Object.entries(TABLE_SCHEMAS).map(([name, schema]) => [
    name,
    generateTableDDL(name, schema),
  ])
);

/** Column info for repair operations */
type RepairColumnDef = { name: string; type: SqliteType };

/**
 * Columns that may need repair (added in migrations).
 * Generated from TABLE_SCHEMAS where addedInVersion is set.
 */
export const EXPECTED_COLUMNS: Record<string, RepairColumnDef[]> =
  Object.fromEntries(
    Object.entries(TABLE_SCHEMAS)
      .map(([tableName, schema]) => {
        const migratedColumns = Object.entries(schema.columns)
          .filter(([, col]) => col.addedInVersion !== undefined)
          .map(([name, col]) => ({ name, type: col.type }));
        return [tableName, migratedColumns] as const;
      })
      .filter(([, cols]) => cols.length > 0)
  );

/** Check if a table exists in the database */
export function tableExists(db: Database, table: string): boolean {
  const result = db
    .query(
      "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name=?"
    )
    .get(table) as { count: number };
  return result.count > 0;
}

/** Check if a column exists in a table */
export function hasColumn(
  db: Database,
  table: string,
  column: string
): boolean {
  const result = db
    .query(
      `SELECT COUNT(*) as count FROM pragma_table_info('${table}') WHERE name='${column}'`
    )
    .get() as { count: number };
  return result.count > 0;
}

/** Add a column to a table if it doesn't exist */
function addColumnIfMissing(
  db: Database,
  table: string,
  column: string,
  type: string
): void {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/** Schema issue types for diagnostics */
export type SchemaIssue =
  | { type: "missing_table"; table: string }
  | { type: "missing_column"; table: string; column: string };

/**
 * Check schema and return list of issues.
 * Used for diagnostics and dry-run mode in `sentry cli fix`.
 */
export function getSchemaIssues(db: Database): SchemaIssue[] {
  const issues: SchemaIssue[] = [];

  for (const tableName of Object.keys(EXPECTED_TABLES)) {
    if (!tableExists(db, tableName)) {
      issues.push({ type: "missing_table", table: tableName });
      continue;
    }

    const columns = EXPECTED_COLUMNS[tableName];
    if (columns) {
      for (const col of columns) {
        if (!hasColumn(db, tableName, col.name)) {
          issues.push({
            type: "missing_column",
            table: tableName,
            column: col.name,
          });
        }
      }
    }
  }

  return issues;
}

/** Result of a schema repair operation */
export type RepairResult = {
  fixed: string[];
  failed: string[];
};

function repairMissingTables(db: Database, result: RepairResult): void {
  for (const [tableName, ddl] of Object.entries(EXPECTED_TABLES)) {
    if (tableExists(db, tableName)) {
      continue;
    }
    try {
      db.exec(ddl);
      // Create associated indexes for tables that need them
      if (tableName === "transaction_aliases") {
        db.exec(TRANSACTION_ALIASES_INDEX);
      }
      result.fixed.push(`Created table ${tableName}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.failed.push(`Failed to create table ${tableName}: ${msg}`);
    }
  }
}

function repairMissingColumns(db: Database, result: RepairResult): void {
  for (const [tableName, columns] of Object.entries(EXPECTED_COLUMNS)) {
    if (!tableExists(db, tableName)) {
      continue;
    }
    for (const col of columns) {
      if (hasColumn(db, tableName, col.name)) {
        continue;
      }
      try {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.type}`);
        result.fixed.push(`Added column ${tableName}.${col.name}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.failed.push(
          `Failed to add column ${tableName}.${col.name}: ${msg}`
        );
      }
    }
  }
}

/**
 * Repair schema issues by creating missing tables and adding missing columns.
 * This is a non-destructive operation that only adds missing schema elements.
 *
 * @param db - The raw database connection (not the traced wrapper)
 * @returns Lists of fixed and failed repairs
 */
export function repairSchema(db: Database): RepairResult {
  const result: RepairResult = { fixed: [], failed: [] };

  repairMissingTables(db, result);
  repairMissingColumns(db, result);

  if (result.fixed.length > 0) {
    try {
      db.query("UPDATE schema_version SET version = ?").run(
        CURRENT_SCHEMA_VERSION
      );
    } catch {
      // Ignore version update failures - schema is still fixed
    }
  }

  return result;
}

/** Track if we're currently repairing to prevent infinite loops */
let isRepairing = false;

/**
 * Check if an error is a schema-related SQLite error that can be auto-repaired.
 */
function isSchemaError(error: unknown): boolean {
  if (error instanceof Error && error.name === "SQLiteError") {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("no such column") ||
      msg.includes("no such table") ||
      msg.includes("has no column named")
    );
  }
  return false;
}

/**
 * Check if an error is a SQLite "readonly database" error.
 *
 * This happens when the CLI's local database file or its containing directory
 * lacks write permissions (e.g., installed globally in a protected path,
 * read-only filesystem, or changed permissions).
 */
export function isReadonlyError(error: unknown): boolean {
  if (error instanceof Error && error.name === "SQLiteError") {
    return error.message
      .toLowerCase()
      .includes("attempt to write a readonly database");
  }
  return false;
}

/** Result of a repair attempt */
export type RepairAttemptResult<T> =
  | { attempted: false }
  | { attempted: true; result: T };

/**
 * Attempt to repair the database schema and retry a failed operation.
 *
 * This function is the core of the auto-repair system. When a database operation
 * fails due to a schema error (missing table/column), this function:
 * 1. Checks if auto-repair is enabled and applicable
 * 2. Runs repairSchema() to fix missing tables/columns
 * 3. Retries the original operation
 *
 * @param operation - The failed operation to retry after repair
 * @param error - The error that triggered the repair attempt
 * @returns An object indicating whether repair was attempted and the result.
 *          When `attempted` is false, the caller should re-throw the original error.
 *          When `attempted` is true, use `result` (which may be undefined for queries
 *          like stmt.get() that legitimately return undefined).
 */
export function tryRepairAndRetry<T>(
  operation: () => T,
  error: unknown
): RepairAttemptResult<T> {
  // Skip repair if disabled via environment variable
  if (process.env[NO_AUTO_REPAIR_ENV] === "1") {
    return { attempted: false };
  }

  // Only repair schema-related errors
  if (!isSchemaError(error)) {
    return { attempted: false };
  }

  // Prevent infinite loops if repair itself causes errors
  if (isRepairing) {
    return { attempted: false };
  }

  isRepairing = true;
  let repairSucceeded = false;
  try {
    // Dynamic imports to avoid circular dependencies with db/index.js
    const { getRawDatabase } = require("./index.js") as {
      getRawDatabase: () => Database;
    };

    const rawDb = getRawDatabase();
    const { fixed } = repairSchema(rawDb);

    if (fixed.length > 0) {
      console.error(`Auto-repaired database: ${fixed.join(", ")}`);
      repairSucceeded = true;
    }
  } catch {
    // Repair failed - caller will re-throw original error
  } finally {
    isRepairing = false;
  }

  // Retry operation AFTER try-catch so any new error from operation() propagates
  // instead of being swallowed and replaced with the original error
  if (repairSucceeded) {
    return { attempted: true, result: operation() };
  }

  return { attempted: false };
}

/** Index for efficient alias lookups by alias string + fingerprint */
const TRANSACTION_ALIASES_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_txn_alias_lookup 
  ON transaction_aliases(alias, fingerprint)
`;

export function initSchema(db: Database): void {
  const ddlStatements = Object.values(EXPECTED_TABLES).join(";\n\n");
  db.exec(ddlStatements);
  db.exec(TRANSACTION_ALIASES_INDEX);

  const versionRow = db
    .query("SELECT version FROM schema_version LIMIT 1")
    .get() as { version: number } | null;

  if (!versionRow) {
    db.query("INSERT OR IGNORE INTO schema_version (version) VALUES (?)").run(
      CURRENT_SCHEMA_VERSION
    );
  }
}

function getSchemaVersion(db: Database): number {
  const row = db.query("SELECT version FROM schema_version LIMIT 1").get() as {
    version: number;
  } | null;
  return row?.version ?? 0;
}

/**
 * Run migrations for schema changes between versions.
 *
 * Note: Auto-repair handles missing tables/columns as a safety net, but explicit
 * migrations are still needed for:
 * - Data transformations (e.g., splitting a column)
 * - Column renames (requires data copy in SQLite)
 * - Complex constraints
 */
export function runMigrations(db: Database): void {
  const currentVersion = getSchemaVersion(db);

  // Migration 1 -> 2: Add org_regions, user_info, and instance_info tables
  if (currentVersion < 2) {
    db.exec(`
      ${EXPECTED_TABLES.org_regions};
      ${EXPECTED_TABLES.user_info};
      ${EXPECTED_TABLES.instance_info};
    `);
  }

  // Migration 2 -> 3: Add name column to user_info table
  if (currentVersion < 3) {
    addColumnIfMissing(db, "user_info", "name", "TEXT");
  }

  // Migration 3 -> 4: Add detection caching columns to dsn_cache and project_root_cache table
  if (currentVersion < 4) {
    addColumnIfMissing(db, "dsn_cache", "fingerprint", "TEXT");
    addColumnIfMissing(db, "dsn_cache", "all_dsns_json", "TEXT");
    addColumnIfMissing(db, "dsn_cache", "source_mtimes_json", "TEXT");
    addColumnIfMissing(db, "dsn_cache", "dir_mtimes_json", "TEXT");
    addColumnIfMissing(db, "dsn_cache", "root_dir_mtime", "INTEGER");
    addColumnIfMissing(db, "dsn_cache", "ttl_expires_at", "INTEGER");

    db.exec(EXPECTED_TABLES.project_root_cache as string);
  }

  // Migration 4 -> 5: Add pagination_cursors table
  if (currentVersion < 5) {
    db.exec(EXPECTED_TABLES.pagination_cursors as string);
  }

  // Migration 5 -> 6: Add transaction_aliases table
  if (currentVersion < 6) {
    db.exec(EXPECTED_TABLES.transaction_aliases as string);
    db.exec(TRANSACTION_ALIASES_INDEX);
  }

  if (currentVersion < CURRENT_SCHEMA_VERSION) {
    db.query("UPDATE schema_version SET version = ?").run(
      CURRENT_SCHEMA_VERSION
    );
  }
}
