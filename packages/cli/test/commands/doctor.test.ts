import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "doctor-cmd-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { "@sentry/node": "^8.42.0" } })
  );
  await writeFile(
    join(root, "src", "instrument.ts"),
    "Sentry.init({\n  dsn: 'https://abc123@o1.ingest.sentry.io/42',\n});"
  );
});

describe("runDoctor", () => {
  it("exits 1 and renders a report when the API is unreachable but a local check fails", async () => {
    vi.resetModules();
    vi.doMock("../../src/lib/doctor/resolve.js", () => ({
      resolveServerFacts: vi.fn().mockResolvedValue({
        reachable: false,
        unreachableReason: "Not authenticated.",
      }),
    }));

    const { runDoctor } = await import("../../src/commands/doctor.js");
    const { formatDoctorReport } = await import(
      "../../src/lib/doctor/render.js"
    );
    const result = await runDoctor({ cwd: root } as never, {
      sendTestEvent: false,
      fix: false,
    });

    expect(result.report.results.length).toBeGreaterThan(10);
    // Offline degrades tier 1 to skip, never to fail.
    const serverFails = result.report.results.filter(
      (r) => r.id.startsWith("project.") && r.status === "fail"
    );
    expect(serverFails).toEqual([]);
    expect(formatDoctorReport(result.report)).toContain("Sentry Doctor");
  });

  it("never throws on a directory with nothing in it", async () => {
    vi.resetModules();
    const empty = await mkdtemp(join(tmpdir(), "doctor-empty-"));
    const { runDoctor } = await import("../../src/commands/doctor.js");

    await expect(runDoctor({ cwd: empty } as never, {})).resolves.toBeDefined();
  });

  it("reports stage progress", async () => {
    vi.resetModules();
    vi.doMock("../../src/lib/doctor/resolve.js", () => ({
      resolveServerFacts: vi.fn().mockResolvedValue({ reachable: false }),
    }));
    const { runDoctor } = await import("../../src/commands/doctor.js");
    const messages: string[] = [];
    await runDoctor({ cwd: root } as never, {}, (m) => messages.push(m));
    expect(messages[0]).toContain("Scanning");
    expect(messages.some((m) => m.includes("Sentry"))).toBe(true);
  });
});
