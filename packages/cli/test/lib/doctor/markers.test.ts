import { describe, expect, it } from "vitest";
import { captureBlock } from "../../../src/lib/doctor/capture-block.js";
import {
  BUILD_MARKERS,
  INIT_MARKERS,
  markersForFile,
} from "../../../src/lib/doctor/markers.js";

describe("marker tables", () => {
  it("selects rules by basename", () => {
    expect(
      markersForFile(INIT_MARKERS, "instrument.ts").map((r) => r.ecosystem)
    ).toContain("javascript");
    expect(
      markersForFile(INIT_MARKERS, "app.py").map((r) => r.ecosystem)
    ).toContain("python");
    expect(markersForFile(INIT_MARKERS, "README.md")).toEqual([]);
  });

  it("marks manifest-driven platforms as autoInit", () => {
    const android = markersForFile(INIT_MARKERS, "AndroidManifest.xml");
    expect(android[0]?.autoInit).toBe(true);

    const spring = markersForFile(INIT_MARKERS, "application.properties");
    expect(spring[0]?.autoInit).toBe(true);
  });

  it("every init rule actually captures its own example", () => {
    const samples: Record<string, { file: string; source: string }> = {
      javascript: {
        file: "instrument.ts",
        source: "Sentry.init({\n  dsn: 'https://k@h/1',\n});",
      },
      python: {
        file: "app.py",
        source: "sentry_sdk.init(\n    dsn='https://k@h/1',\n)",
      },
      ruby: {
        file: "sentry.rb",
        source: "Sentry.init do |config|\n  config.dsn = 'x'\nend",
      },
      go: {
        file: "main.go",
        source: 'sentry.Init(sentry.ClientOptions{\n  Dsn: "x",\n})',
      },
    };

    for (const [ecosystem, sample] of Object.entries(samples)) {
      const rule = markersForFile(INIT_MARKERS, sample.file).find(
        (r) => r.ecosystem === ecosystem
      );
      expect(rule, `no rule for ${ecosystem}`).toBeDefined();
      const block = captureBlock(sample.source, rule!.marker, rule!.delims);
      expect(block, `${ecosystem} did not capture`).not.toBeNull();
    }
  });

  it("recognizes build configs", () => {
    expect(markersForFile(BUILD_MARKERS, "vite.config.ts")).not.toEqual([]);
    expect(markersForFile(BUILD_MARKERS, "build.gradle.kts")).not.toEqual([]);
  });
});
