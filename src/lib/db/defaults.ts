/**
 * Default organization/project storage (single-row table pattern).
 */

import { getDatabase } from "./index.js";

type DefaultsRow = {
  organization: string | null;
  project: string | null;
  updated_at: number;
};

export async function getDefaultOrganization(): Promise<string | undefined> {
  const db = getDatabase();
  const row = db
    .query("SELECT organization FROM defaults WHERE id = 1")
    .get() as Pick<DefaultsRow, "organization"> | undefined;

  return row?.organization ?? undefined;
}

export async function getDefaultProject(): Promise<string | undefined> {
  const db = getDatabase();
  const row = db.query("SELECT project FROM defaults WHERE id = 1").get() as
    | Pick<DefaultsRow, "project">
    | undefined;

  return row?.project ?? undefined;
}

export async function setDefaults(
  organization?: string,
  project?: string
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  const current = db
    .query("SELECT organization, project FROM defaults WHERE id = 1")
    .get() as Pick<DefaultsRow, "organization" | "project"> | undefined;

  const newOrg = organization ?? current?.organization ?? null;
  const newProject = project ?? current?.project ?? null;

  db.query(`
    INSERT INTO defaults (id, organization, project, updated_at)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      organization = excluded.organization,
      project = excluded.project,
      updated_at = excluded.updated_at
  `).run(newOrg, newProject, now);
}
