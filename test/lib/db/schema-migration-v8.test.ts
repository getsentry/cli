/**
 * Tests for schema migration v7→v8.
 *
 * Verifies that the migration adds the org_id column to the org_regions
 * table for offline resolution of DSN-style numeric org IDs.
 */

import { describe, expect, test } from "bun:test";
import { getDatabase } from "../../../src/lib/db/index.js";
import { CURRENT_SCHEMA_VERSION } from "../../../src/lib/db/schema.js";
import { useTestConfigDir } from "../../helpers.js";

useTestConfigDir("schema-v8-migration-");

describe("schema migration v7→v8", () => {
  test("schema version is 8", () => {
    const db = getDatabase();
    const row = db.query("SELECT version FROM schema_version").get() as {
      version: number;
    };
    expect(row.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(row.version).toBe(8);
  });

  test("org_regions table has org_id column", () => {
    const db = getDatabase();
    const columns = db.query("PRAGMA table_info(org_regions)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    const orgIdCol = columns.find((c) => c.name === "org_id");

    expect(orgIdCol).toBeDefined();
    expect(orgIdCol?.type).toBe("TEXT");
    expect(orgIdCol?.notnull).toBe(0);
  });

  test("org_id column is nullable (insert without it)", () => {
    const db = getDatabase();
    db.query(
      "INSERT INTO org_regions (org_slug, region_url, updated_at) VALUES (?, ?, ?)"
    ).run("test-org", "https://us.sentry.io", Date.now());

    const row = db
      .query("SELECT org_id FROM org_regions WHERE org_slug = ?")
      .get("test-org") as { org_id: string | null };
    expect(row.org_id).toBeNull();
  });

  test("org_id column can store and retrieve values", () => {
    const db = getDatabase();
    db.query(
      "INSERT INTO org_regions (org_slug, org_id, region_url, updated_at) VALUES (?, ?, ?, ?)"
    ).run("id-org", "12345", "https://de.sentry.io", Date.now());

    const row = db
      .query("SELECT org_id FROM org_regions WHERE org_slug = ?")
      .get("id-org") as { org_id: string | null };
    expect(row.org_id).toBe("12345");
  });
});
