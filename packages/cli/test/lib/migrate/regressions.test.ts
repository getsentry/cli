/**
 * Regressions for defects found by review.
 *
 * Every case here is input that reached the wrong outcome silently: output
 * that no longer parsed, a task that aborted the whole workspace, a dependency
 * that vanished, a rename that reached into unrelated code. Fixture tests
 * catch the shapes someone thought to write down. These are the shapes nobody
 * did: a list without a trailing comma, a barrel re-export, a second run.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectTasks,
  createApi,
  createWorkspace,
  type Finding,
  finalizeWorkspace,
  parseSource,
  planMigration,
  sentryJavascriptV11,
} from "../../../src/lib/migrate/index.js";

const REPORTER = "report";

type Outcome = {
  output: string;
  findings: Finding[];
  errors: string[];
  pkg: string | null;
};

/** Run the full task set over an in-memory project. */
function migrate(files: Record<string, string>): Outcome {
  const workspace = createWorkspace("/", new Map(Object.entries(files)));
  const findings: Finding[] = [];
  const errors: string[] = [];

  for (const task of collectTasks(sentryJavascriptV11)) {
    if (task.id === REPORTER) {
      continue;
    }
    const api = createApi(workspace, { id: task.id }, findings);
    try {
      task.run({ api, cwd: "/" });
    } catch (error) {
      errors.push(
        `${task.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  finalizeWorkspace(workspace);
  const [first] = Object.keys(files);
  return {
    output: workspace.files.get(first ?? "") ?? "",
    findings,
    errors,
    pkg: workspace.files.get("package.json") ?? null,
  };
}

/**
 * Whether a migrated file is still valid syntax.
 *
 * Output that no longer parses is the worst failure this codemod has: every
 * later task silently skips an unparseable file, so the damage is invisible.
 */
function parses(file: string, source: string): boolean {
  return parseSource(file, source) !== null;
}

function claimsFix(findings: Finding[], needle: string): boolean {
  return findings.some(
    (finding) => finding.kind === "fixed" && finding.message.includes(needle)
  );
}

describe("adjacent removals", () => {
  // Each removed entry of a comma-separated list claims a separator, so two
  // adjacent removals used to claim the same comma and abort the task.
  it("drops two trailing import specifiers without conflicting", () => {
    const result = migrate({
      "a.ts": [
        'import { getClient, instrumentOpenAiClient, instrumentStateGraph } from "@sentry/core";',
        "",
        "export { getClient, instrumentOpenAiClient, instrumentStateGraph };",
      ].join("\n"),
    });

    expect(result.errors).toEqual([]);
    expect(parses("a.ts", result.output), result.output).toBe(true);
    expect(result.output).toContain('from "@sentry/server-utils"');
    expect(result.output).toContain("import { getClient }");
    expect(result.output).not.toContain(
      'instrumentOpenAiClient } from "@sentry/core"'
    );
  });

  it("drops two adjacent init options written inline", () => {
    const result = migrate({
      "a.ts": [
        'import * as Sentry from "@sentry/node";',
        "",
        "Sentry.init({",
        '  dsn: "x",',
        "  _experiments: { enableTruncation: true, streamGenAiSpans: false },",
        "});",
      ].join("\n"),
    });

    expect(result.errors).toEqual([]);
    expect(parses("a.ts", result.output), result.output).toBe(true);
    expect(result.output).not.toContain("enableTruncation");
    expect(result.output).not.toContain("streamGenAiSpans");
    // Emptying `_experiments` takes the husk with it.
    expect(result.output).not.toContain("_experiments");
    expect(result.output).toContain('dsn: "x"');
  });

  it("drops both standalone web-vital options from one inline object", () => {
    const result = migrate({
      "a.ts": [
        'import { browserTracingIntegration } from "@sentry/browser";',
        "",
        "const integration = browserTracingIntegration({ enableStandaloneClsSpans: true, enableStandaloneLcpSpans: true });",
      ].join("\n"),
    });

    expect(result.errors).toEqual([]);
    expect(parses("a.ts", result.output), result.output).toBe(true);
    expect(result.output).toContain("browserTracingIntegration({})");
  });
});

describe("shorthand nodes", () => {
  // Babel reports the shorthand `{ x }` and `export { x }` as two identifiers
  // over one range; renaming used to emit two edits for the same bytes.
  it("renames a re-exported integration without conflicting", () => {
    const result = migrate({
      "a.ts": [
        'import { inboundFiltersIntegration } from "@sentry/browser";',
        "",
        "export { inboundFiltersIntegration };",
      ].join("\n"),
    });

    expect(result.errors).toEqual([]);
    expect(parses("a.ts", result.output), result.output).toBe(true);
    expect(result.output).toContain(
      'import { eventFiltersIntegration } from "@sentry/browser"'
    );
    expect(result.output).toContain("export { eventFiltersIntegration };");
    expect(result.output).not.toContain("inboundFilters");
  });

  it("renames a shorthand object entry once", () => {
    const result = migrate({
      "a.ts": [
        'import { inboundFiltersIntegration } from "@sentry/browser";',
        "",
        "const integrations = { inboundFiltersIntegration };",
      ].join("\n"),
    });

    expect(result.errors).toEqual([]);
    expect(parses("a.ts", result.output), result.output).toBe(true);
    expect(result.output).toContain("{ eventFiltersIntegration }");
  });

  it("leaves an aliased re-export's public name alone", () => {
    const result = migrate({
      "a.ts": [
        'import { inboundFiltersIntegration } from "@sentry/browser";',
        "",
        "export { inboundFiltersIntegration as inboundFiltersIntegration2 };",
      ].join("\n"),
    });

    expect(result.errors).toEqual([]);
    expect(parses("a.ts", result.output), result.output).toBe(true);
    expect(result.output).toContain(
      "export { eventFiltersIntegration as inboundFiltersIntegration2 }"
    );
  });
});

describe("renames stay inside Sentry code", () => {
  it("leaves an unrelated object's key and member access alone", () => {
    const source = [
      "const registry = { inboundFiltersIntegration: makeCustomFilter };",
      'const found = registry["inboundFiltersIntegration"];',
      "myPlugins.inboundFiltersIntegration();",
      "myPlugins.instrumentLangGraph();",
    ].join("\n");

    const result = migrate({ "a.ts": source });

    expect(result.errors).toEqual([]);
    // Nothing in this file came from Sentry, so nothing may change: renaming
    // the key but not the string lookup would break it at runtime.
    expect(result.output).toBe(source);
  });

  it("still renames a Sentry namespace access", () => {
    const result = migrate({
      "a.ts": [
        'import * as Sentry from "@sentry/browser";',
        "",
        "Sentry.inboundFiltersIntegration();",
      ].join("\n"),
    });

    expect(result.errors).toEqual([]);
    expect(result.output).toContain("Sentry.eventFiltersIntegration()");
  });
});

describe("callback options", () => {
  it("hoists beforeSendMetric written as a method shorthand", () => {
    // `beforeSendMetric(metric) {}` and `beforeSendMetric: (metric) => {}` are
    // both ordinary ways to write this. Seeing only the second left the
    // callback stranded under `_experiments`, where v11 ignores it, while
    // `enableMetrics` was removed. That silently ends the user's scrubbing.
    const result = migrate({
      "a.ts": [
        'import * as Sentry from "@sentry/node";',
        "",
        "Sentry.init({",
        '  dsn: "x",',
        "  _experiments: {",
        "    enableMetrics: true,",
        "    beforeSendMetric(metric) {",
        '      return metric.name.startsWith("card") ? null : metric;',
        "    },",
        "  },",
        "});",
      ].join("\n"),
    });

    expect(result.errors).toEqual([]);
    expect(parses("a.ts", result.output), result.output).toBe(true);
    expect(result.output).not.toContain("_experiments");
    expect(result.output).not.toContain("enableMetrics");
    // Still present, and now at the top level where v11 reads it.
    expect(result.output).toContain("beforeSendMetric(metric)");
    expect(claimsFix(result.findings, "moved `beforeSendMetric`")).toBe(true);
  });
});

describe("source map options", () => {
  it("removes an empty option without leaving a stray comma", () => {
    const result = migrate({
      "a.ts": [
        'import { sentrySvelteKit } from "@sentry/sveltekit";',
        "",
        "sentrySvelteKit({ sourceMapsUploadOptions: {}, debug: true });",
      ].join("\n"),
    });

    expect(result.errors).toEqual([]);
    expect(parses("a.ts", result.output), result.output).toBe(true);
    expect(result.output).toContain("sentrySvelteKit({ debug: true })");
  });

  it("removes an `enabled: true`-only option without leaving a stray comma", () => {
    const result = migrate({
      "a.ts": [
        'import { sentrySvelteKit } from "@sentry/sveltekit";',
        "",
        "sentrySvelteKit({ sourceMapsUploadOptions: { enabled: true }, debug: true });",
      ].join("\n"),
    });

    expect(result.errors).toEqual([]);
    expect(parses("a.ts", result.output), result.output).toBe(true);
    expect(result.output).toContain("sentrySvelteKit({ debug: true })");
  });
});

describe("dependency rewrites", () => {
  it("adds the replacement package when renaming one", () => {
    const result = migrate({
      "package.json": JSON.stringify(
        { dependencies: { "@sentry/tanstackstart": "^10.0.0", zod: "^3.0.0" } },
        null,
        2
      ),
    });

    const pkg = JSON.parse(result.pkg ?? "{}") as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@sentry/tanstackstart-react"]).toBe("^11.0.0");
    expect(pkg.dependencies["@sentry/tanstackstart"]).toBeUndefined();
    // The replacement keeps the original key's position, so the diff is a line.
    expect(Object.keys(pkg.dependencies)).toEqual([
      "@sentry/tanstackstart-react",
      "zod",
    ]);
    expect(claimsFix(result.findings, "@sentry/tanstackstart-react")).toBe(
      true
    );
  });

  it("does not downgrade a range already past the v11 floor", () => {
    const result = migrate({
      "package.json": JSON.stringify(
        { dependencies: { "@sentry/node": "^11.5.0" } },
        null,
        2
      ),
    });

    const pkg = JSON.parse(result.pkg ?? "{}") as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@sentry/node"]).toBe("^11.5.0");
    expect(result.findings.filter((f) => f.kind === "fixed")).toEqual([]);
  });
});

describe("failure containment", () => {
  it("does not report a fix for a file it could not write", () => {
    // A task that throws mid-visit must give its findings back: a summary
    // claiming a change that was never written is worse than silence.
    const workspace = createWorkspace(
      "/",
      new Map([["a.ts", "const x = 1;\n"]])
    );
    const findings: Finding[] = [];
    const api = createApi(workspace, { id: "boom" }, findings);

    expect(() =>
      api.script(({ file }) => {
        api.fixed("claimed a change", { file, line: 1 });
        // Two conflicting edits over the same bytes.
        return [
          { start: 0, end: 5, text: "let" },
          { start: 0, end: 5, text: "var" },
        ];
      })
    ).toThrow();

    expect(findings).toEqual([]);
    expect(workspace.files.get("a.ts")).toBe("const x = 1;\n");
  });

  it("migrates the rest of the workspace when one file fails", () => {
    const workspace = createWorkspace(
      "/",
      new Map([
        ["a.ts", "const bad = 1;\n"],
        ["z.ts", "const good = 1;\n"],
      ])
    );
    const findings: Finding[] = [];
    const api = createApi(workspace, { id: "boom" }, findings);

    expect(() =>
      api.script(({ file }) =>
        file === "a.ts"
          ? [
              { start: 0, end: 5, text: "let" },
              { start: 0, end: 5, text: "var" },
            ]
          : [{ start: 0, end: 5, text: "let" }]
      )
    ).toThrow();

    // The failing file is untouched; the unrelated one is still migrated.
    expect(workspace.files.get("a.ts")).toBe("const bad = 1;\n");
    expect(workspace.files.get("z.ts")).toBe("let good = 1;\n");
  });
});

describe("re-running a migrated project", () => {
  it("reports nothing left to do", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sentry-migrate-"));
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify(
        {
          name: "done",
          dependencies: { "@sentry/node": "^11.5.0" },
          engines: { node: ">=20.19.0" },
        },
        null,
        2
      )
    );
    await writeFile(
      path.join(root, "instrument.ts"),
      [
        'import * as Sentry from "@sentry/node";',
        "",
        "Sentry.init({",
        '  dsn: "x",',
        "  dataCollection: { cookies: false },",
        "});",
      ].join("\n")
    );

    const result = await planMigration({ root });

    expect(result.changes).toEqual([]);
    expect(result.report).toBeNull();
  });
});

describe("task selection", () => {
  it("skipping the reporter suppresses the report", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sentry-migrate-"));
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify(
        { name: "app", dependencies: { "@sentry/node": "^10.0.0" } },
        null,
        2
      )
    );

    const withReport = await planMigration({ root });
    expect(withReport.report).not.toBeNull();

    const skipped = await planMigration({ root, skip: [REPORTER] });
    expect(skipped.report).toBeNull();

    const only = await planMigration({ root, only: ["enable-logs"] });
    expect(only.report).toBeNull();
  });
});
