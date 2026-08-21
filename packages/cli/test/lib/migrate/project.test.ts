/**
 * Project-level behaviour: the setup gate, the migration's fit check, the
 * `package.json` surface, and the generated report.
 *
 * These run against a real temporary directory rather than mocks, because the
 * things worth testing here are the ones a mock would paper over: whether the
 * walker reaches the file, whether a manifest round-trips without gratuitous
 * reformatting, and whether the report's overwrite guard holds.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyMigration,
  CHECKLIST_FILE,
  GENERATED_MARKER,
  isAlreadyOnV11,
  NoMigrationError,
  type ProjectProbe,
  planMigration,
  sentryJavascriptV11,
} from "../../../src/lib/migrate/index.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "sentry-migrate-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * A `ProjectProbe` serving one in-memory `package.json`.
 *
 * Fully constructed rather than cast, so a `detect` that starts reading
 * something else fails here instead of silently seeing `undefined`.
 */
function probeFor(pkg: Record<string, unknown>): ProjectProbe {
  const is = (file: string) => file === "package.json";
  return {
    cwd: "/tmp/probe",
    read: async (file) => (is(file) ? JSON.stringify(pkg) : null),
    json: async (file) => (is(file) ? pkg : null),
    exists: async (file) => is(file),
  };
}

async function write(relative: string, content: string): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf-8");
}

/** A minimal but plausible v10 project. */
async function scaffold(extra: Record<string, string> = {}): Promise<void> {
  await write(
    "package.json",
    JSON.stringify(
      {
        scripts: { start: "node --require ./instrument.js app.js" },
        dependencies: { "@sentry/node": "^10.63.0" },
      },
      null,
      2
    )
  );
  for (const [file, content] of Object.entries(extra)) {
    await write(file, content);
  }
}

describe("migration selection", () => {
  it("refuses a project no migration recognises", async () => {
    // A Python or Go project reaches here. Refusing is not enough: the hint has
    // to name what the available migrations look for, or the answer is a dead
    // end for exactly the user who most needs to know why.
    const error = await planMigration({ root }).catch((thrown) => thrown);
    expect(error).toBeInstanceOf(NoMigrationError);
    expect(error.message).toMatch(/no Sentry SDK migration applies/);
    expect(error.hint).toMatch(/sentry-javascript-v11/);
    expect(error.hint).toMatch(/package\.json/);
  });

  it("refuses a project with no Sentry dependency", async () => {
    await write(
      "package.json",
      JSON.stringify({ dependencies: { next: "1" } })
    );
    await expect(planMigration({ root })).rejects.toThrow(/@sentry/);
  });

  it("accepts a project that depends on a Sentry SDK", async () => {
    await scaffold();
    await expect(planMigration({ root })).resolves.toBeDefined();
  });
});

describe("migration fit", () => {
  it("refuses a project that has not reached v10 yet", async () => {
    // Skipping a major is not a smaller migration. Without this gate the v11
    // tasks rewrite v9-era code, jump the manifest two lines at once, and exit
    // 0. That is the worst available outcome, because it reads as success.
    const fit = await sentryJavascriptV11.detect(
      probeFor({ dependencies: { "@sentry/node": "^9.12.0" } })
    );
    expect(fit.fit).toBe("blocked");
    if (fit.fit === "blocked") {
      expect(fit.because).toContain("^9.12.0");
      expect(fit.hint).toContain("v9-to-v10");
    }
  });

  it("names the next major, not v11, for a project several majors behind", async () => {
    const fit = await sentryJavascriptV11.detect(
      probeFor({ dependencies: { "@sentry/browser": "^7.100.0" } })
    );
    expect(fit.fit).toBe("blocked");
    if (fit.fit === "blocked") {
      expect(fit.hint).toContain("v7-to-v8");
    }
  });

  it("links the index rather than a constructed URL below v6", async () => {
    // `v4-to-v5_v6` breaks the `vN-to-vN+1` naming, so anything built from the
    // major would 404, which is worse than sending the reader to the list.
    const fit = await sentryJavascriptV11.detect(
      probeFor({ dependencies: { "@sentry/browser": "^5.30.0" } })
    );
    expect(fit.fit).toBe("blocked");
    if (fit.fit === "blocked") {
      expect(fit.hint).toBe(
        "Migrate to 6.x first, one major at a time: " +
          "https://docs.sentry.io/platforms/javascript/migration/. " +
          "Re-run `sentry migrate` once the project is on 10.x."
      );
    }
  });

  it("blocks on the oldest SDK package when majors are mixed", async () => {
    const fit = await sentryJavascriptV11.detect(
      probeFor({
        dependencies: { "@sentry/react": "^10.1.0", "@sentry/node": "^9.0.0" },
      })
    );
    expect(fit.fit).toBe("blocked");
    if (fit.fit === "blocked") {
      expect(fit.because).toContain("@sentry/node");
    }
  });

  it("does not read a rangeless specifier as pre-v10", async () => {
    // `workspace:*` and friends prove nothing about the version. Refusing on
    // them would block monorepos that are on v10 perfectly well.
    for (const range of ["workspace:*", "latest", "*"]) {
      const fit = await sentryJavascriptV11.detect(
        probeFor({ dependencies: { "@sentry/node": range } })
      );
      expect(fit.fit, range).toBe("yes");
    }
  });

  it("ignores @sentry/cli's own version line when gating on v10", async () => {
    // `@sentry/cli` is at v2 on a perfectly current project; reading it as the
    // SDK version would refuse every project that declares it.
    const fit = await sentryJavascriptV11.detect(
      probeFor({
        dependencies: { "@sentry/node": "^10.63.0" },
        devDependencies: { "@sentry/cli": "^2.42.0" },
      })
    );
    expect(fit.fit).toBe("yes");
  });
});

describe("check tasks", () => {
  /** A v10 project that also declares `extra` dependencies. */
  async function withDependencies(
    extra: Record<string, string>,
    files: Record<string, string> = {}
  ): Promise<string | null> {
    await write(
      "package.json",
      JSON.stringify(
        { dependencies: { "@sentry/node": "^10.63.0", ...extra } },
        null,
        2
      )
    );
    for (const [file, content] of Object.entries(files)) {
      await write(file, content);
    }
    const { report } = await planMigration({ root });
    return report;
  }

  it("reports a dependency still below its new floor", async () => {
    const report = await withDependencies({ next: "^13.4.0" });
    expect(report).toContain("Next.js 14 is the new minimum");
    expect(report).toContain("`next` is declared at `^13.4.0`");
  });

  it("stays quiet when the dependency already clears the floor", async () => {
    // The old framework-keyed version of this told every Next.js project to
    // upgrade Next.js, including the ones already on 15.
    const report = await withDependencies({ next: "^15.0.0" });
    expect(report ?? "").not.toContain("Next.js 14 is the new minimum");
  });

  it("does not read a rangeless specifier as below the floor", async () => {
    const report = await withDependencies({ next: "workspace:*" });
    expect(report ?? "").not.toContain("Next.js 14 is the new minimum");
  });

  it("holds a gated check until the project shows it applies", async () => {
    // `formData.` appears in any app with a form; only a Remix project is
    // affected by the span-attribute rename.
    const report = await withDependencies(
      {},
      { "route.ts": "export const x = formData.get('a');\n" }
    );
    expect(report ?? "").not.toContain("Remix action span attributes");
  });

  it("reports a gated check once the evidence is there", async () => {
    const report = await withDependencies(
      { "@sentry/remix": "^10.0.0" },
      { "route.ts": "export const x = formData.get('a');\n" }
    );
    expect(report).toContain("Renamed Remix action span attributes");
    expect(report).toContain("`route.ts:1`");
  });

  it("quotes the text that matched, not the pattern that found it", async () => {
    const report = await withDependencies(
      {},
      { "wrangler.toml": 'compatibility_date = "2024-01-01"\n' }
    );
    expect(report).toContain("matches `compatibility_date`");
  });
});

describe("isAlreadyOnV11", () => {
  it("does not call a project migrated while a bundler plugin is still on v10", () => {
    // The bundler plugins ship on the SDK version line since v10, so an SDK
    // already on v11 is not the whole answer. If this set ever drifts from the
    // one the `package-json` task bumps against, a project reports itself
    // finished while that task still has a change to make.
    expect(
      isAlreadyOnV11({
        dependencies: { "@sentry/node": "^11.2.0" },
        devDependencies: { "@sentry/vite-plugin": "^10.5.0" },
      })
    ).toBe(false);
  });

  it("reads a project with every SDK package on v11 as migrated", () => {
    expect(
      isAlreadyOnV11({
        dependencies: { "@sentry/node": "^11.2.0" },
        devDependencies: { "@sentry/cli": "^2.42.0" },
      })
    ).toBe(true);
  });

  it("does not read a rangeless specifier as migrated", () => {
    // `workspace:*` says nothing about the version, so it cannot be evidence
    // that the project is finished.
    expect(
      isAlreadyOnV11({ dependencies: { "@sentry/node": "workspace:*" } })
    ).toBe(false);
  });

  it("does not call a project with no SDK package migrated", () => {
    expect(isAlreadyOnV11({ dependencies: { react: "^18.0.0" } })).toBe(false);
    expect(isAlreadyOnV11(null)).toBe(false);
  });
});

describe("package.json surface", () => {
  it("moves SDK packages to v11 but leaves independently versioned ones", async () => {
    await write(
      "package.json",
      JSON.stringify(
        {
          dependencies: { "@sentry/node": "^10.63.0", express: "^4.0.0" },
          devDependencies: {
            "@sentry/vite-plugin": "^10.5.0",
            "@sentry/cli": "^2.42.0",
          },
        },
        null,
        2
      )
    );

    const result = await planMigration({ root });
    const manifest = result.changes.find((c) => c.file === "package.json");
    const parsed = JSON.parse(manifest?.after ?? "{}");

    expect(parsed.dependencies["@sentry/node"]).toBe("^11.0.0");
    // The bundler plugins have shipped on the SDK's version line since v10, so
    // they move with it.
    expect(parsed.devDependencies["@sentry/vite-plugin"]).toBe("^11.0.0");
    // `@sentry/cli` still has its own line; bumping it to 11 would pin a
    // version that does not exist.
    expect(parsed.devDependencies["@sentry/cli"]).toBe("^2.42.0");
    expect(parsed.dependencies.express).toBe("^4.0.0");
  });

  it("removes packages that no longer exist", async () => {
    await write(
      "package.json",
      JSON.stringify({
        dependencies: {
          "@sentry/types": "^10.0.0",
          "@sentry/node-core": "^10.0.0",
        },
      })
    );
    const result = await planMigration({ root });
    const parsed = JSON.parse(
      result.changes.find((c) => c.file === "package.json")?.after ?? "{}"
    );
    expect(parsed.dependencies["@sentry/types"]).toBeUndefined();
    expect(parsed.dependencies["@sentry/node-core"]).toBeUndefined();
  });

  it("preserves tab indentation rather than imposing its own", async () => {
    await write(
      "package.json",
      '{\n\t"dependencies": {\n\t\t"@sentry/node": "^10.0.0"\n\t}\n}\n'
    );
    const result = await planMigration({ root });
    const after =
      result.changes.find((c) => c.file === "package.json")?.after ?? "";
    expect(after).toContain('\t"dependencies"');
    expect(after.endsWith("\n")).toBe(true);
  });

  it("leaves a manifest with nothing to change alone", async () => {
    await write(
      "package.json",
      JSON.stringify({ dependencies: { "@sentry/node": "^11.0.0" } }, null, 2)
    );
    const result = await planMigration({ root });
    expect(result.changes.some((c) => c.file === "package.json")).toBe(false);
  });
});

describe("planMigration", () => {
  it("finds and rewrites across all three surfaces", async () => {
    await scaffold({
      "instrument.ts":
        'import * as Sentry from "@sentry/node";\nSentry.init({ enableLogs: true });\n',
      Dockerfile: 'CMD ["node", "--require", "./instrument.js", "app.js"]\n',
    });

    const result = await planMigration({ root });
    const changed = result.changes.map((change) => change.file).sort();

    expect(changed).toEqual(["Dockerfile", "instrument.ts", "package.json"]);
  });

  it("writes nothing until applyMigration is called", async () => {
    const before =
      'import * as Sentry from "@sentry/node";\nSentry.init({ enableLogs: true });\n';
    await scaffold({ "instrument.ts": before });

    const result = await planMigration({ root });
    // The dry-run guarantee: planning must not touch the disk, or `--dry-run`
    // and the real run would be different code paths.
    expect(await readFile(path.join(root, "instrument.ts"), "utf-8")).toBe(
      before
    );

    await applyMigration(root, result);
    expect(
      await readFile(path.join(root, "instrument.ts"), "utf-8")
    ).not.toContain("enableLogs");
  });

  it("honours --only", async () => {
    await scaffold({
      "instrument.ts":
        'import * as Sentry from "@sentry/node";\nSentry.init({ enableLogs: true, ignoreTransactions: ["a"] });\n',
    });
    const result = await planMigration({ root, only: ["enable-logs"] });
    const after = result.changes.find((c) => c.file === "instrument.ts")?.after;
    expect(after).not.toContain("enableLogs");
    expect(after).toContain("ignoreTransactions");
  });

  it("is idempotent across a full project run", async () => {
    await scaffold({
      "instrument.ts":
        'import * as Sentry from "@sentry/node";\nSentry.init({ enableLogs: true, beforeSendTransaction: (e) => e });\n',
    });
    await applyMigration(root, await planMigration({ root }));
    const second = await planMigration({ root });
    expect(second.changes).toEqual([]);
  });
});

describe("report", () => {
  it("points at exact lines for changes a detector located", async () => {
    await scaffold({
      "instrument.ts":
        'import * as Sentry from "@sentry/node";\nSentry.init({\n  beforeSendTransaction: (e) => e,\n});\n',
    });
    const { report } = await planMigration({ root });

    expect(report).toContain("#### Found here");
    expect(report).toContain("`instrument.ts:3`");
    expect(report).toContain(GENERATED_MARKER);
  });

  it("locates changes only a check task's patterns can find", async () => {
    await scaffold({
      "worker.ts":
        "const x = { childProcessIntegration: true };\nexport { x };\n",
    });
    const { report } = await planMigration({ root });

    // No task can migrate this, and no detector can parse a meaning out of it,
    // but a check task can still point at the line.
    expect(report).toContain("`childProcessIntegration` split in two");
    expect(report).toContain("`worker.ts:1`");
  });

  it("gives an entry the guidance from the task that found it", async () => {
    await scaffold({
      "worker.ts":
        "const x = { childProcessIntegration: true };\nexport { x };\n",
    });
    const { report } = await planMigration({ root });

    // Without this the entry says where to look and not what to do.
    expect(report).toContain("worker-thread behavior moving to");
  });

  it("omits tasks that found nothing", async () => {
    await scaffold({
      "instrument.ts":
        'import * as Sentry from "@sentry/node";\nSentry.init({ beforeSendTransaction: (e) => e });\n',
    });
    const { report } = await planMigration({ root });

    // The report is what this project needs, not a copy of the guide.
    expect(report).not.toContain("Hono");
    expect(report).not.toContain("Ember");
  });

  it("refuses to overwrite a report it did not generate", async () => {
    await scaffold({
      "instrument.ts":
        'import * as Sentry from "@sentry/node";\nSentry.init({ beforeSendTransaction: (e) => e });\n',
    });
    await write(CHECKLIST_FILE, "# my own notes\n");

    const result = await planMigration({ root });
    await expect(applyMigration(root, result)).rejects.toThrow(
      /was not generated/
    );
    // The user's file survives.
    expect(await readFile(path.join(root, CHECKLIST_FILE), "utf-8")).toBe(
      "# my own notes\n"
    );
  });

  it("overwrites its own previous report", async () => {
    await scaffold({
      "instrument.ts":
        'import * as Sentry from "@sentry/node";\nSentry.init({ beforeSendTransaction: (e) => e });\n',
    });
    await applyMigration(root, await planMigration({ root }));
    await expect(
      applyMigration(root, await planMigration({ root }))
    ).resolves.toBeUndefined();
  });
});
