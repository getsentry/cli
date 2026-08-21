/**
 * Which migration, if any, applies to this project.
 *
 * This CLI is one binary for every language Sentry has an SDK for, so
 * `sentry migrate` gets run from Python, Ruby, Go and PHP projects too.
 * Picking a migration is a detection problem rather than a default. The
 * command asks every registered migration about the project and acts on the
 * answers, instead of assuming the only one that exists today.
 *
 * The failure messages carry most of the value. "No migration applies" on its
 * own is a dead end. The same answer plus what each migration looks for tells
 * a Python user in one line that nothing is broken, their project is just not
 * one of these.
 */

import type { Migration, MigrationFit, ProjectProbe } from "./framework.js";
import { createProbe } from "./probe.js";

/**
 * Every migration this CLI ships, in the order they are offered.
 *
 * Empty until a migration registers itself here. The registry exists so that
 * adding one is a line in this array rather than a rewrite of the runner and
 * the command.
 */
export const MIGRATIONS: Migration[] = [];

export type MigrationChoice = {
  migration: Migration;
  /** Why it was chosen, shown back to the user so the inference is checkable. */
  because: string;
};

/**
 * Why no migration ran.
 *
 * `error` is the headline and `hint` is what to do about it, the shape the
 * command already uses for every other refusal.
 */
export class NoMigrationError extends Error {
  readonly hint: string;

  constructor(message: string, hint: string) {
    super(message);
    this.name = "NoMigrationError";
    this.hint = hint;
  }
}

/** One line per migration: id, what it does, what it looks for. */
export function describeMigrations(migrations = MIGRATIONS): string {
  return migrations
    .map(
      (migration) =>
        `${migration.id} — ${migration.description}, needs ${migration.requires}`
    )
    .join("; ");
}

/** Ask every migration about the project, in registry order. */
async function fits(
  probe: ProjectProbe,
  migrations: Migration[]
): Promise<Array<{ migration: Migration; fit: MigrationFit }>> {
  const answers: Array<{ migration: Migration; fit: MigrationFit }> = [];
  for (const migration of migrations) {
    answers.push({ migration, fit: await migration.detect(probe) });
  }
  return answers;
}

/**
 * Resolve a migration the user named explicitly.
 *
 * Naming one skips detection but not the gate. A migration that cannot run
 * still cannot run, and saying why beats running it anyway.
 */
async function useNamedMigration(
  probe: ProjectProbe,
  id: string,
  migrations: Migration[]
): Promise<MigrationChoice> {
  const named = migrations.find((migration) => migration.id === id);
  if (!named) {
    throw new NoMigrationError(
      `unknown migration: ${id}`,
      `Available migrations: ${describeMigrations(migrations)}.`
    );
  }

  const fit = await named.detect(probe);
  if (fit.fit === "yes") {
    return { migration: named, because: fit.because };
  }
  if (fit.fit === "blocked") {
    throw new NoMigrationError(
      fit.because,
      fit.hint ?? `${named.id} needs ${named.requires}.`
    );
  }
  throw new NoMigrationError(
    `${named.id} does not apply to this project`,
    `${named.id} needs ${named.requires}. ` +
      "Point at a different directory with --cwd <path>."
  );
}

/** Nothing can run. Say the most specific true thing available. */
function nothingApplies(
  answers: Array<{ migration: Migration; fit: MigrationFit }>,
  migrations: Migration[]
): never {
  // A migration that recognised the project but is blocked knows more about it
  // than the registry does, so its reason wins over the generic answer.
  for (const { migration, fit } of answers) {
    if (fit.fit === "blocked") {
      throw new NoMigrationError(
        fit.because,
        fit.hint ?? `${migration.id} needs ${migration.requires}.`
      );
    }
  }

  throw new NoMigrationError(
    "no Sentry SDK migration applies to this project",
    `\`sentry migrate\` currently ships: ${describeMigrations(migrations)}. ` +
      "Point at a different directory with --cwd <path>."
  );
}

/**
 * Pick the migration for a project.
 *
 * @param id force a specific migration instead of detecting one.
 * @throws {NoMigrationError} when nothing applies, when the named id is
 * unknown, or when the choice is genuinely ambiguous.
 */
export async function selectMigration(
  root: string,
  id?: string,
  migrations: Migration[] = MIGRATIONS
): Promise<MigrationChoice> {
  const probe = createProbe(root);

  if (id) {
    return useNamedMigration(probe, id, migrations);
  }

  const answers = await fits(probe, migrations);
  const applicable = answers.flatMap(({ migration, fit }) =>
    fit.fit === "yes" ? [{ migration, because: fit.because }] : []
  );

  const [first, ...rest] = applicable;
  if (!first) {
    nothingApplies(answers, migrations);
  }

  if (rest.length > 0) {
    throw new NoMigrationError(
      `more than one migration applies: ${applicable
        .map((choice) => choice.migration.id)
        .join(", ")}`,
      "Pick one with --migration <id>."
    );
  }

  return first;
}
