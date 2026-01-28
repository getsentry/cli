/**
 * One-time migration from config.json to SQLite.
 */

import type { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "./index.js";

const OLD_CONFIG_FILENAME = "config.json";

function oldConfigExists(): boolean {
  const configPath = join(getConfigDir(), OLD_CONFIG_FILENAME);
  const { existsSync } = require("node:fs");
  return existsSync(configPath);
}

function readOldConfig(): OldConfig | null {
  const configPath = join(getConfigDir(), OLD_CONFIG_FILENAME);
  try {
    const { readFileSync } = require("node:fs");
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function deleteOldConfig(): void {
  const configPath = join(getConfigDir(), OLD_CONFIG_FILENAME);
  try {
    rmSync(configPath);
  } catch {
    // File may already be deleted
  }
}

type OldConfig = {
  auth?: {
    token?: string;
    refreshToken?: string;
    expiresAt?: number;
    issuedAt?: number;
  };
  defaults?: {
    organization?: string;
    project?: string;
  };
  projectCache?: Record<
    string,
    {
      orgSlug: string;
      orgName: string;
      projectSlug: string;
      projectName: string;
      cachedAt: number;
    }
  >;
  dsnCache?: Record<
    string,
    {
      dsn: string;
      projectId: string;
      orgId?: string;
      source: string;
      sourcePath?: string;
      resolved?: {
        orgSlug: string;
        orgName: string;
        projectSlug: string;
        projectName: string;
      };
      cachedAt: number;
    }
  >;
  projectAliases?: {
    aliases: Record<string, { orgSlug: string; projectSlug: string }>;
    cachedAt: number;
    dsnFingerprint?: string;
  };
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one-time migration
export function migrateFromJson(db: Database): void {
  if (!oldConfigExists()) {
    return;
  }

  const oldConfig = readOldConfig();
  if (!oldConfig) {
    return;
  }

  console.error("Migrating config to SQLite...");

  db.exec("BEGIN TRANSACTION");

  try {
    if (oldConfig.auth?.token) {
      db.query(`
        INSERT OR REPLACE INTO auth (id, token, refresh_token, expires_at, issued_at, updated_at)
        VALUES (1, ?, ?, ?, ?, ?)
      `).run(
        oldConfig.auth.token,
        oldConfig.auth.refreshToken ?? null,
        oldConfig.auth.expiresAt ?? null,
        oldConfig.auth.issuedAt ?? null,
        Date.now()
      );
    }

    if (oldConfig.defaults?.organization || oldConfig.defaults?.project) {
      db.query(`
        INSERT OR REPLACE INTO defaults (id, organization, project, updated_at)
        VALUES (1, ?, ?, ?)
      `).run(
        oldConfig.defaults.organization ?? null,
        oldConfig.defaults.project ?? null,
        Date.now()
      );
    }

    if (oldConfig.projectCache) {
      const insertStmt = db.query(`
        INSERT OR REPLACE INTO project_cache 
        (cache_key, org_slug, org_name, project_slug, project_name, cached_at, last_accessed)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const [key, entry] of Object.entries(oldConfig.projectCache)) {
        insertStmt.run(
          key,
          entry.orgSlug,
          entry.orgName,
          entry.projectSlug,
          entry.projectName,
          entry.cachedAt,
          entry.cachedAt // last_accessed = cachedAt for migrated entries
        );
      }
    }

    if (oldConfig.dsnCache) {
      const insertStmt = db.query(`
        INSERT OR REPLACE INTO dsn_cache 
        (directory, dsn, project_id, org_id, source, source_path,
         resolved_org_slug, resolved_org_name, resolved_project_slug, resolved_project_name,
         cached_at, last_accessed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const [directory, entry] of Object.entries(oldConfig.dsnCache)) {
        insertStmt.run(
          directory,
          entry.dsn,
          entry.projectId,
          entry.orgId ?? null,
          entry.source,
          entry.sourcePath ?? null,
          entry.resolved?.orgSlug ?? null,
          entry.resolved?.orgName ?? null,
          entry.resolved?.projectSlug ?? null,
          entry.resolved?.projectName ?? null,
          entry.cachedAt,
          entry.cachedAt
        );
      }
    }

    if (oldConfig.projectAliases?.aliases) {
      const insertStmt = db.query(`
        INSERT OR REPLACE INTO project_aliases 
        (alias, org_slug, project_slug, dsn_fingerprint, cached_at, last_accessed)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const fingerprint = oldConfig.projectAliases.dsnFingerprint ?? null;
      const cachedAt = oldConfig.projectAliases.cachedAt;

      for (const [alias, entry] of Object.entries(
        oldConfig.projectAliases.aliases
      )) {
        insertStmt.run(
          alias.toLowerCase(),
          entry.orgSlug,
          entry.projectSlug,
          fingerprint,
          cachedAt,
          cachedAt
        );
      }
    }

    db.exec("COMMIT");
    deleteOldConfig();
    console.error("Migration complete.");
  } catch (error) {
    db.exec("ROLLBACK");
    console.error("Migration failed, keeping config.json:", error);
    throw error;
  }
}
