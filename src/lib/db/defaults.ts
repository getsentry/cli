/**
 * Default organization/project storage (single-row table pattern).
 */

import { getDatabase } from "./index.js";
import { upsert } from "./utils.js";

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

/**
 * Set default organization and/or project.
 *
 * @param organization - undefined = keep existing, null = clear, string = set new value
 * @param project - undefined = keep existing, null = clear, string = set new value
 */
export async function setDefaults(
  organization?: string | null,
  project?: string | null
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  const current = db
    .query("SELECT organization, project FROM defaults WHERE id = 1")
    .get() as Pick<DefaultsRow, "organization" | "project"> | undefined;

  // undefined = keep existing value, null = explicitly clear, string = set new value
  const newOrg =
    organization === undefined ? (current?.organization ?? null) : organization;
  const newProject =
    project === undefined ? (current?.project ?? null) : project;

  const { sql, values } = upsert(
    "defaults",
    { id: 1, organization: newOrg, project: newProject, updated_at: now },
    ["id"]
  );
  db.query(sql).run(...values);
}
