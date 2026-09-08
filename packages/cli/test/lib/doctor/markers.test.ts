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
      java: {
        file: "AndroidManifest.xml",
        source:
          '<application>\n  <meta-data android:name="io.sentry.dsn" android:value="https://k@h/1" />\n</application>',
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

  it("captures SentrySDK.start with a trailing closure", () => {
    const rule = markersForFile(INIT_MARKERS, "AppDelegate.swift").find(
      (r) => r.delims === "brace"
    );
    expect(rule).toBeDefined();
    const block = captureBlock(
      'SentrySDK.start { options in\n  options.dsn = "x"\n}',
      rule!.marker,
      rule!.delims
    );
    expect(block).not.toBeNull();
    expect(block?.text).toContain("options.dsn");
  });

  it("captures SentryAndroid.init in Java", () => {
    const rule = markersForFile(INIT_MARKERS, "MyApplication.java").find(
      (r) => r.kind === "init"
    );
    expect(rule).toBeDefined();
    const block = captureBlock(
      'SentryAndroid.init(this, options -> {\n  options.setDsn("x");\n});',
      rule!.marker,
      rule!.delims
    );
    expect(block).not.toBeNull();
  });

  it("recognizes build configs", () => {
    expect(markersForFile(BUILD_MARKERS, "vite.config.ts")).not.toEqual([]);
    expect(markersForFile(BUILD_MARKERS, "build.gradle.kts")).not.toEqual([]);
  });

  it("captures Spring application.properties without paren delimiters", () => {
    const rule = markersForFile(INIT_MARKERS, "application.properties").find(
      (r) => r.kind === "spring-config"
    );
    expect(rule?.delims).toBe("none");
    const block = captureBlock(
      "sentry.dsn=https://k@h/1\nsentry.traces-sample-rate=0.5\n",
      rule!.marker,
      rule!.delims
    );
    expect(block).not.toBeNull();
    expect(block?.text).toContain("sentry.dsn");
  });

  it("captures Laravel sentry.php as the rest of the file", () => {
    const rule = markersForFile(INIT_MARKERS, "sentry.php").find(
      (r) => r.kind === "laravel-config"
    );
    expect(rule?.delims).toBe("none");
    const block = captureBlock(
      "<?php\nreturn [\n  'dsn' => env('SENTRY_DSN'),\n];\n",
      rule!.marker,
      rule!.delims
    );
    expect(block).not.toBeNull();
    expect(block?.text).toContain("'dsn'");
  });

  it("captures a Fastfile sentry_upload_dsym call", () => {
    const rule = markersForFile(BUILD_MARKERS, "Fastfile")[0];
    expect(rule).toBeDefined();
    const block = captureBlock(
      'lane :release do\n  sentry_upload_dsym(\n    auth_token: ENV["SENTRY_AUTH_TOKEN"],\n  )\nend\n',
      rule!.marker,
      rule!.delims
    );
    expect(block).not.toBeNull();
    expect(block?.text).toContain("sentry_upload_dsym");
  });
});
