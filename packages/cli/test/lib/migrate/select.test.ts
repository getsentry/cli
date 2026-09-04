/**
 * Choosing a migration.
 *
 * This CLI is one binary for every language Sentry ships an SDK for, so most
 * projects `sentry migrate` runs in have no applicable migration at all. These
 * cover that path, refusing and saying something useful while refusing,
 * alongside the two ways selection can be ambiguous.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  describeMigrations,
  MIGRATIONS,
  type Migration,
  NoMigrationError,
  selectMigration,
  sentryJavascriptV11,
} from "../../../src/lib/migrate/index.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "sentry-select-"));
});

const write = (file: string, body: string) =>
  writeFile(path.join(root, file), body);

/** A stand-in for the second migration this registry is built to accept. */
function fakeMigration(id: string, fit: () => Promise<unknown>): Migration {
  return {
    ...sentryJavascriptV11,
    id,
    description: `${id} description`,
    requires: `${id} evidence`,
    detect: fit as Migration["detect"],
  };
}

const alwaysApplies = (id: string) =>
  fakeMigration(id, async () => ({ fit: "yes", because: `${id} matched` }));

/** What the caller gets back, or the error if it refused. */
const attempt = (id?: string, migrations?: Migration[]) =>
  selectMigration(root, id, migrations).catch((error: unknown) => error);

describe("no migration applies", () => {
  it("names what the available migrations look for", async () => {
    // The common case for a Python, Ruby, Go or PHP project.
    await write("requirements.txt", "sentry-sdk==2.0.0\n");

    const error = await attempt();

    expect(error).toBeInstanceOf(NoMigrationError);
    expect((error as NoMigrationError).message).toBe(
      "no Sentry SDK migration applies to this project"
    );
    expect((error as NoMigrationError).hint).toContain("sentry-javascript-v11");
    expect((error as NoMigrationError).hint).toContain("--cwd");
  });

  it("prefers a recognising migration's own reason over the generic one", async () => {
    // A JavaScript project with no Sentry in it is not "unrecognised". The
    // JavaScript migration knows exactly what is wrong, and that beats a list.
    await write(
      "package.json",
      JSON.stringify({ dependencies: { next: "1" } })
    );

    const error = await attempt();

    expect((error as NoMigrationError).message).toContain("no @sentry/*");
    expect((error as NoMigrationError).hint).toContain("sentry init");
  });
});

describe("one migration applies", () => {
  it("selects it and reports the evidence", async () => {
    await write(
      "package.json",
      JSON.stringify({ dependencies: { "@sentry/node": "^10.0.0" } })
    );

    const choice = await selectMigration(root);

    expect(choice.migration.id).toBe("sentry-javascript-v11");
    // The evidence is shown to the user, so it has to name what was found
    // rather than merely assert a conclusion.
    expect(choice.because).toContain("@sentry/node");
  });
});

describe("more than one migration applies", () => {
  it("refuses rather than guessing", async () => {
    const error = await attempt(undefined, [
      alwaysApplies("first"),
      alwaysApplies("second"),
    ]);

    expect(error).toBeInstanceOf(NoMigrationError);
    expect((error as NoMigrationError).message).toContain("first, second");
    expect((error as NoMigrationError).hint).toContain("--migration");
  });
});

describe("--migration", () => {
  it("rejects an id no migration answers to", async () => {
    const error = await attempt("sentry-python-v3");

    expect((error as NoMigrationError).message).toBe(
      "unknown migration: sentry-python-v3"
    );
    expect((error as NoMigrationError).hint).toContain("sentry-javascript-v11");
  });

  it("still gates a migration named explicitly", async () => {
    // Naming one skips detection, not its gate: running the JavaScript
    // migration over a Python project would rewrite nothing and report
    // success, which is worse than refusing.
    await write("requirements.txt", "sentry-sdk==2.0.0\n");

    const error = await attempt("sentry-javascript-v11");

    expect(error).toBeInstanceOf(NoMigrationError);
    expect((error as NoMigrationError).message).toContain("does not apply");
    expect((error as NoMigrationError).hint).toContain("package.json");
  });

  it("selects a blocked migration's own reason when named", async () => {
    await write("package.json", JSON.stringify({ dependencies: {} }));

    const error = await attempt("sentry-javascript-v11");

    expect((error as NoMigrationError).message).toContain("no @sentry/*");
  });
});

describe("describeMigrations", () => {
  it("gives every registered migration a line the user can act on", () => {
    const described = describeMigrations();

    for (const migration of MIGRATIONS) {
      expect(described).toContain(migration.id);
      expect(described).toContain(migration.requires);
    }
  });
});
