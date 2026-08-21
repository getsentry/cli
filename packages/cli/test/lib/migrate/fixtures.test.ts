/**
 * Transform fixtures.
 *
 * Each directory under `fixtures/` holds an `input.ts` of v10-era code and the
 * `expected.ts` the full task set should produce. Fixtures run the whole
 * migration rather than a single task, because tasks compose. A package
 * redirect changes what a symbol task sees, so testing them in isolation would
 * miss exactly the interactions that break.
 *
 * Two of the fixtures assert that nothing happens. `unrelated` contains
 * variables named after removed Sentry options in a file with no Sentry
 * import; `already-v11` is code the migration has already been run against. A
 * codemod that damages untouched files is worse than one that misses changes,
 * so those cases carry as much weight as the transforms.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectTasks,
  createApi,
  createWorkspace,
  type Finding,
  finalizeWorkspace,
  sentryJavascriptV11,
} from "../../../src/lib/migrate/index.js";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

/** Fixtures the task set must leave byte-for-byte identical. */
const UNCHANGED = new Set(["unrelated", "already-v11"]);

/**
 * The report writer needs the whole project and writes a separate file, so it
 * is excluded here; `project.test.ts` covers it.
 */
const REPORTER = "report";

const names = (await readdir(FIXTURES, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/** Run the full task set over a single in-memory file. */
function migrate(file: string, source: string): string {
  const workspace = createWorkspace("/", new Map([[file, source]]));
  const findings: Finding[] = [];

  for (const task of collectTasks(sentryJavascriptV11)) {
    if (task.id === REPORTER) {
      continue;
    }
    const api = createApi(workspace, { id: task.id }, findings);
    task.run({
      api,
      cwd: "/",
      detection: {
        framework: null,
        features: new Set(),
        packages: new Set(),
        evidence: [],
        hasManifest: false,
      },
    });
  }

  finalizeWorkspace(workspace);
  return workspace.files.get(file) ?? source;
}

async function fixture(name: string) {
  const [input, expected] = await Promise.all([
    readFile(path.join(FIXTURES, name, "input.ts"), "utf-8"),
    readFile(path.join(FIXTURES, name, "expected.ts"), "utf-8"),
  ]);
  return { input, expected };
}

describe("migration fixtures", () => {
  it("has fixtures to run", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it.each(names)("%s produces the expected output", async (name) => {
    const { input, expected } = await fixture(name);
    expect(migrate("input.ts", input)).toBe(expected);
  });

  it.each(names)("%s is idempotent", async (name) => {
    const { expected } = await fixture(name);
    // Re-running must be a no-op. `sentry migrate` is safe to run more than
    // once, and a user who runs it twice should get an unchanged tree, which
    // means marker comments in particular must not stack.
    expect(migrate("expected.ts", expected)).toBe(expected);
  });

  it.each([...UNCHANGED])("%s is left untouched", async (name) => {
    const { input, expected } = await fixture(name);
    expect(expected).toBe(input);
  });
});

describe("task robustness", () => {
  it("skips files it cannot parse instead of throwing", () => {
    expect(migrate("broken.ts", "const = = = ;")).toBe("const = = = ;");
  });

  it("leaves an empty file alone", () => {
    expect(migrate("empty.ts", "")).toBe("");
  });

  it("does not touch a non-Sentry `init` call", () => {
    const source =
      'import { init } from "some-lib";\ninit({ enableLogs: true });\n';
    expect(migrate("a.ts", source)).toBe(source);
  });
});
