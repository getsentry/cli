import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { SENTRY_CLI_DSN } from "../../../src/lib/constants.js";
import { capture } from "../../../src/lib/doctor/capture.js";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "doctor-capture-"));
  await mkdir(join(root, "src"), { recursive: true });

  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      dependencies: { "@sentry/node": "^8.42.0" },
    })
  );
  await writeFile(
    join(root, "src", "instrument.ts"),
    [
      "import * as Sentry from '@sentry/node';",
      "",
      "Sentry.init({",
      "  dsn: 'https://abc123@o1.ingest.sentry.io/42',",
      "  environment: 'production',",
      "  tracesSampleRate: 1.0,",
      "});",
    ].join("\n")
  );
  await writeFile(
    join(root, "vite.config.ts"),
    [
      "import { sentryVitePlugin } from '@sentry/vite-plugin';",
      "export default {",
      "  plugins: [sentryVitePlugin({",
      "    org: 'acme',",
      "    project: 'web',",
      "    authToken: 'sntrys_supersecret',",
      "  })],",
      "};",
    ].join("\n")
  );
});

describe("capture", () => {
  it("finds the init site with its scalar keys", async () => {
    const result = await capture(root);
    const init = result.initSites.find((b) => b.kind === "init");

    expect(init?.file).toBe("src/instrument.ts");
    expect(init?.line).toBe(3);
    expect(init?.keys.environment).toEqual({
      value: "production",
      dynamic: false,
    });
    expect(init?.keys.tracesSampleRate).toEqual({
      value: "1.0",
      dynamic: false,
    });
  });

  it("finds the build config", async () => {
    const result = await capture(root);
    expect(result.buildConfigs.some((b) => b.file === "vite.config.ts")).toBe(
      true
    );
  });

  it("redacts secrets but keeps the DSN public key", async () => {
    const result = await capture(root);
    const all = [...result.initSites, ...result.buildConfigs]
      .map((b) => b.text)
      .join("\n");

    expect(all).not.toContain("sntrys_supersecret");
    expect(all).toContain("[REDACTED]");
    expect(all).toContain("abc123");
  });

  it("records ecosystems and Sentry dependencies", async () => {
    const result = await capture(root);
    expect(result.ecosystems).toContain("javascript");
    expect(result.manifests["package.json"]?.deps["@sentry/node"]).toBe(
      "^8.42.0"
    );
  });

  it("marks the capture incomplete when the budget is exhausted", async () => {
    const result = await capture(root, { timeBudgetMs: 0 });
    expect(result.incomplete).toBeTruthy();
  });

  it("drops the CLI telemetry DSN so probes do not go to the CLI project", async () => {
    await writeFile(
      join(root, "src", "telemetry.ts"),
      `export const DSN = "${SENTRY_CLI_DSN}";\n`
    );
    const result = await capture(root);
    expect(result.dsns.map((d) => d.raw)).not.toContain(SENTRY_CLI_DSN);
    expect(result.dsns.some((d) => d.publicKey === "abc123")).toBe(true);
  });

  it("skips NDK .cxx output and still captures an AndroidManifest auto-init", async () => {
    const androidRoot = await mkdtemp(join(tmpdir(), "doctor-android-"));
    await mkdir(join(androidRoot, ".cxx", "Debug"), { recursive: true });
    await mkdir(join(androidRoot, "src", "main", "java"), { recursive: true });

    for (let i = 0; i < 5; i++) {
      await writeFile(
        join(androidRoot, ".cxx", "Debug", `cmake-${i}.txt`),
        "sentry native cmake junk\n"
      );
    }
    await writeFile(
      join(androidRoot, "src", "main", "AndroidManifest.xml"),
      [
        "<manifest>",
        "  <application>",
        "    <meta-data",
        '      android:name="io.sentry.dsn"',
        '      android:value="https://abc123@o1.ingest.sentry.io/42" />',
        "    <meta-data",
        '      android:name="io.sentry.environment"',
        '      android:value="debug" />',
        "  </application>",
        "</manifest>",
      ].join("\n")
    );
    await writeFile(
      join(androidRoot, "src", "main", "java", "App.java"),
      "package io.sentry.samples;\nclass App {}\n"
    );

    const result = await capture(androidRoot, { maxFiles: 3 });

    expect(result.incomplete).toBeUndefined();
    expect(result.ecosystems).toContain("java");
    const manifest = result.initSites.find(
      (b) => b.kind === "android-manifest"
    );
    expect(manifest?.file).toBe("src/main/AndroidManifest.xml");
    expect(manifest?.keys.dsn).toEqual({
      value: "https://abc123@o1.ingest.sentry.io/42",
      dynamic: false,
    });
    expect(manifest?.keys.environment).toEqual({
      value: "debug",
      dynamic: false,
    });
  });

  it("resolves a unique Gradle manifest placeholder into the Android DSN", async () => {
    const androidRoot = await mkdtemp(join(tmpdir(), "doctor-ph-"));
    await mkdir(join(androidRoot, "src", "main"), { recursive: true });
    await writeFile(
      join(androidRoot, "src", "main", "AndroidManifest.xml"),
      [
        "<manifest>",
        "  <application>",
        "    <meta-data",
        '      android:name="io.sentry.dsn"',
        '      android:value="${sentryDsn}" />',
        "    <meta-data",
        '      android:name="io.sentry.environment"',
        '      android:value="${sentryEnvironment}" />',
        "  </application>",
        "</manifest>",
      ].join("\n")
    );
    await writeFile(
      join(androidRoot, "build.gradle.kts"),
      [
        "android {",
        "  buildTypes {",
        '    getByName("debug") {',
        '      addManifestPlaceholders(mapOf("sentryDsn" to "https://abc123@o1.ingest.sentry.io/42", "sentryEnvironment" to "debug"))',
        "    }",
        '    getByName("release") {',
        '      addManifestPlaceholders(mapOf("sentryEnvironment" to "release"))',
        "    }",
        "  }",
        "}",
      ].join("\n")
    );

    const result = await capture(androidRoot);

    const manifest = result.initSites.find(
      (b) => b.kind === "android-manifest"
    );
    expect(manifest?.keys.dsn).toEqual({
      value: "https://abc123@o1.ingest.sentry.io/42",
      dynamic: false,
    });
    // debug vs release disagree — leave it as the Gradle placeholder.
    expect(manifest?.keys.environment).toEqual({
      value: "${sentryEnvironment}",
      dynamic: true,
    });
  });

  it("reads a gitignored AndroidManifest and SentryAndroid.init", async () => {
    const androidRoot = await mkdtemp(join(tmpdir(), "doctor-gi-"));
    await mkdir(join(androidRoot, "app", "src", "main", "java"), {
      recursive: true,
    });
    await writeFile(
      join(androidRoot, ".gitignore"),
      "app/src/main/AndroidManifest.xml\n"
    );
    await writeFile(
      join(androidRoot, "app", "src", "main", "AndroidManifest.xml"),
      [
        "<manifest>",
        "  <application>",
        "    <meta-data",
        '      android:name="io.sentry.dsn"',
        '      android:value="https://abc123@o1.ingest.sentry.io/42" />',
        "  </application>",
        "</manifest>",
      ].join("\n")
    );
    await writeFile(
      join(androidRoot, "app", "src", "main", "java", "MyApplication.java"),
      "SentryAndroid.init(this, options -> {\n});\n"
    );

    const result = await capture(androidRoot);

    expect(result.initSites.some((b) => b.kind === "android-manifest")).toBe(
      true
    );
    expect(result.initSites.some((b) => b.kind === "init")).toBe(true);
    expect(result.dsns.some((d) => d.publicKey === "abc123")).toBe(true);
  });

  it("still respects gitignore for ordinary source", async () => {
    const giRoot = await mkdtemp(join(tmpdir(), "doctor-gi-src-"));
    await mkdir(join(giRoot, "src"), { recursive: true });
    await writeFile(join(giRoot, ".gitignore"), "src/secret.ts\n");
    await writeFile(
      join(giRoot, "src", "secret.ts"),
      "Sentry.init({ dsn: 'https://secret@o1.ingest.sentry.io/1' });\n"
    );

    const result = await capture(giRoot);

    expect(result.initSites).toEqual([]);
    expect(result.dsns).toEqual([]);
  });
});
