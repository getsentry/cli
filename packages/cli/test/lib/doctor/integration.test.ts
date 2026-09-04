import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { capture } from "../../../src/lib/doctor/capture.js";
import { REGISTRY } from "../../../src/lib/doctor/checks/index.js";
import {
  buildReport,
  formatDoctorReport,
  renderHuman,
} from "../../../src/lib/doctor/render.js";
import type { ServerFacts } from "../../../src/lib/doctor/types.js";
import { runChecks } from "../../../src/lib/doctor/types.js";

const TEMPLATE = "express-app";
const TEMPLATE_DIR = join(
  import.meta.dirname,
  "../../init-eval/templates",
  TEMPLATE
);

/** Local checks only — the server is unreachable in tests by construction. */
const OFFLINE: ServerFacts = {
  reachable: false,
  unreachableReason: "No network in tests.",
};

/**
 * Prepare a temp copy of the template with Sentry instrumentation added.
 *
 * The express-app template ships without Sentry, so we add:
 *   - `@sentry/node` to package.json dependencies
 *   - a `src/instrument.ts` with a realistic `Sentry.init` call
 *
 * This gives the capture pipeline real project structure to walk, which is
 * exactly what the false-positive assertion needs.
 */
async function prepareInstrumentedCopy(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "doctor-int-"));
  await cp(TEMPLATE_DIR, dir, { recursive: true });

  // Add @sentry/node to the manifest so `manifests` and `dsns` capture it.
  const pkgPath = join(dir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  pkg.dependencies = {
    ...pkg.dependencies,
    "@sentry/node": "^8.42.0",
  };
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2));

  // Add a realistic Sentry.init call so the pipeline finds an init site.
  await writeFile(
    join(dir, "src", "instrument.ts"),
    [
      "import * as Sentry from '@sentry/node';",
      "",
      "Sentry.init({",
      "  dsn: 'https://abc123@o1.ingest.sentry.io/42',",
      "  environment: 'production',",
      "  tracesSampleRate: 0.2,",
      "});",
    ].join("\n")
  );

  return dir;
}

describe("doctor against a real template", () => {
  it("captures the template's real structure", async () => {
    const dir = await prepareInstrumentedCopy();
    const result = await capture(dir);

    expect(result.ecosystems.length).toBeGreaterThan(0);
    expect(Object.keys(result.manifests).length).toBeGreaterThan(0);
  });

  it("reports no local failure on a correctly instrumented project", async () => {
    const dir = await prepareInstrumentedCopy();
    const captured = await capture(dir);
    const results = runChecks(REGISTRY, { capture: captured, server: OFFLINE });

    // The false-positive test. If this fails, a marker table is wrong —
    // fix the table, do not relax the assertion.
    const localFailures = results.filter(
      (r) => r.status === "fail" && !r.id.startsWith("project.")
    );
    expect(
      localFailures.map((f) => `${f.id}: ${f.detail}`),
      "doctor must not fail a healthy project"
    ).toEqual([]);
  });

  it("degrades every server check to skip with a reason, offline", async () => {
    const dir = await prepareInstrumentedCopy();
    const captured = await capture(dir);
    const results = runChecks(REGISTRY, { capture: captured, server: OFFLINE });

    for (const r of results.filter((x) => x.id.startsWith("project."))) {
      expect(r.status, r.id).toBe("skip");
      expect(r.detail, `${r.id} must explain its skip`).not.toBe("");
    }
  });

  it("renders without throwing and never leaks a secret", async () => {
    const dir = await prepareInstrumentedCopy();
    const captured = await capture(dir);
    const results = runChecks(REGISTRY, { capture: captured, server: OFFLINE });

    // Test renderHuman directly.
    const text = renderHuman({ results, elapsedMs: 1, plain: true });
    expect(text).toContain("Sentry Doctor");

    // Also test the full formatDoctorReport path (the output.human formatter).
    const report = buildReport({
      capture: captured,
      server: OFFLINE,
      results,
      cliVersion: "0.0.0-test",
      timestamp: new Date().toISOString(),
      elapsedMs: 1,
    });
    const formatted = formatDoctorReport(report);
    expect(formatted).toContain("Sentry Doctor");

    // Redaction happens at the capture boundary; this asserts it held all the
    // way through the capture object and both rendered outputs.
    const serialized = JSON.stringify(captured) + text + formatted;
    expect(serialized).not.toMatch(/sntrys_[\w-]+/);
    expect(serialized).not.toMatch(/auth[_-]?token["'\s:=]+[\w-]{10,}/i);
  });

  it("finishes within the time budget on a real tree", async () => {
    const dir = await prepareInstrumentedCopy();

    const started = Date.now();
    await capture(dir);
    // Generous versus the 1500ms budget — this catches a runaway walk, not
    // a slow CI machine.
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
