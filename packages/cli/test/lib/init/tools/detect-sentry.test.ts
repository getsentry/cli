import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires module namespaces
import * as dsnIndex from "../../../../src/lib/dsn/index.js";
import { detectSentry } from "../../../../src/lib/init/tools/detect-sentry.js";

let testDir: string;
let codeDsnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join("/tmp", "detect-sentry-"));
  codeDsnSpy = vi
    .spyOn(dsnIndex, "scanCodeForFirstDsn")
    .mockResolvedValue(null);
  vi.spyOn(dsnIndex, "detectFromEnvFiles").mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("detectSentry", () => {
  test("returns none when the project has no Sentry evidence", async () => {
    fs.writeFileSync(path.join(testDir, "package.json"), '{"dependencies":{}}');

    await expect(detectSentry(testDir)).resolves.toEqual({
      ok: true,
      data: { cwd: testDir, status: "none", signals: [] },
    });
  });

  test("returns partial for an SDK dependency without runtime setup", async () => {
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      '{"dependencies":{"@sentry/nextjs":"^10.0.0"}}'
    );

    const result = await detectSentry(testDir);

    expect(result.data).toEqual({
      cwd: testDir,
      status: "partial",
      signals: ["sdk: package.json"],
    });
  });

  test("does not mistake Sentry build tooling for a runtime installation", async () => {
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      '{"devDependencies":{"@sentry/cli":"^3.0.0","@sentry/wizard":"^6.0.0","@sentry/vite-plugin":"^4.0.0"}}'
    );
    fs.writeFileSync(path.join(testDir, ".sentryclirc"), "[defaults]\n");

    const result = await detectSentry(testDir);

    expect(result.data).toEqual({ cwd: testDir, status: "none", signals: [] });
  });

  test("returns partial for a config artifact without SDK or init evidence", async () => {
    fs.writeFileSync(
      path.join(testDir, "sentry.client.config.ts"),
      "export {};\n"
    );

    const result = await detectSentry(testDir);

    expect(result.data).toEqual({
      cwd: testDir,
      status: "partial",
      signals: ["config: sentry.client.config.ts"],
    });
  });

  test("does not treat build-only sentry.properties as runtime setup", async () => {
    fs.writeFileSync(
      path.join(testDir, "sentry.properties"),
      "defaults.org=example\ndefaults.project=mobile\n"
    );

    const result = await detectSentry(testDir);

    expect(result.data).toEqual({ cwd: testDir, status: "none", signals: [] });
  });

  test("returns installed when SDK and config evidence are both present", async () => {
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      '{"dependencies":{"@sentry/react":"^10.0.0"}}'
    );
    fs.writeFileSync(
      path.join(testDir, "sentry.client.config.ts"),
      "export {};\n"
    );

    const result = await detectSentry(testDir);

    expect(result.data).toEqual({
      cwd: testDir,
      status: "installed",
      signals: ["sdk: package.json", "config: sentry.client.config.ts"],
    });
  });

  test("returns installed for an SDK init call even without a literal DSN", async () => {
    fs.mkdirSync(path.join(testDir, "src"));
    fs.writeFileSync(
      path.join(testDir, "src", "instrumentation.ts"),
      "Sentry.init({ dsn: process.env.SENTRY_DSN });\n"
    );

    const result = await detectSentry(testDir);

    expect(result.data).toEqual({
      cwd: testDir,
      status: "installed",
      signals: ["init: src/instrumentation.ts:1"],
    });
  });

  test("recognizes non-JavaScript SDK manifests and init calls", async () => {
    fs.writeFileSync(
      path.join(testDir, "go.mod"),
      "module example.com/app\n\nrequire github.com/getsentry/sentry-go v0.36.0\n"
    );
    fs.writeFileSync(
      path.join(testDir, "main.go"),
      "package main\n\nfunc main() { sentry.Init(sentry.ClientOptions{}) }\n"
    );

    const result = await detectSentry(testDir);

    expect(result.data).toEqual({
      cwd: testDir,
      status: "installed",
      signals: ["sdk: go.mod", "init: main.go:3"],
    });
  });

  test("returns installed for a DSN from code or an env file", async () => {
    codeDsnSpy.mockResolvedValue({
      publicKey: "abc",
      protocol: "https",
      host: "o1.ingest.sentry.io",
      projectId: "42",
      raw: "https://abc@o1.ingest.sentry.io/42",
      source: "env_file",
      sourcePath: ".env",
    });

    const result = await detectSentry(testDir);

    expect(result.data).toEqual({
      cwd: testDir,
      status: "installed",
      signals: ["dsn: env_file (.env)"],
      dsn: "https://abc@o1.ingest.sentry.io/42",
    });
  });

  test("does not treat test fixtures as an existing installation", async () => {
    fs.mkdirSync(path.join(testDir, "tests"));
    fs.writeFileSync(
      path.join(testDir, "tests", "fixture.ts"),
      "Sentry.init({ dsn: 'fixture' });\n"
    );

    const result = await detectSentry(testDir);

    expect(result.data).toEqual({ cwd: testDir, status: "none", signals: [] });
  });

  test("keeps detection scoped to the selected monorepo app", async () => {
    const webDir = path.join(testDir, "apps", "web");
    const apiDir = path.join(testDir, "apps", "api");
    fs.mkdirSync(webDir, { recursive: true });
    fs.mkdirSync(apiDir, { recursive: true });
    fs.writeFileSync(path.join(webDir, "app.ts"), "export {};\n");
    fs.writeFileSync(path.join(apiDir, "app.ts"), "Sentry.init({});\n");

    const result = await detectSentry(webDir);

    expect(result.data).toEqual({ cwd: webDir, status: "none", signals: [] });
  });

  test("ignores an ambient DSN that is not owned by the selected project", async () => {
    vi.stubEnv("SENTRY_DSN", "https://ambient@o1.ingest.sentry.io/999999");
    fs.writeFileSync(path.join(testDir, "package.json"), '{"dependencies":{}}');

    const result = await detectSentry(testDir);

    expect(result.data).toEqual({ cwd: testDir, status: "none", signals: [] });
  });

  test("ignores commented-out init calls", async () => {
    fs.writeFileSync(
      path.join(testDir, "instrumentation.ts"),
      "// Sentry.init({ dsn: process.env.SENTRY_DSN });\n"
    );

    const result = await detectSentry(testDir);

    expect(result.data).toEqual({ cwd: testDir, status: "none", signals: [] });
  });

  test.each([
    ["config.exs", 'config :sentry, dsn: System.get_env("SENTRY_DSN")'],
    ["Program.cs", "builder.WebHost.UseSentry();"],
    [
      "AppDelegate.m",
      "[SentrySDK startWithConfigureOptions:^(SentryOptions *options) {}];",
    ],
    [
      "AndroidManifest.xml",
      '<meta-data android:name="io.sentry.auto-init" android:value="true" />',
    ],
  ])("recognizes an automatic runtime init in %s", async (file, contents) => {
    fs.writeFileSync(path.join(testDir, file), `${contents}\n`);

    const result = await detectSentry(testDir);

    expect(result.data).toEqual({
      cwd: testDir,
      status: "installed",
      signals: [`init: ${file}:1`],
    });
  });

  test("recognizes a Laravel runtime package and config", async () => {
    fs.mkdirSync(path.join(testDir, "config"));
    fs.writeFileSync(
      path.join(testDir, "composer.json"),
      '{"require":{"sentry/sentry-laravel":"^4.0"}}'
    );
    fs.writeFileSync(
      path.join(testDir, "config", "sentry.php"),
      "<?php return [];\n"
    );

    const result = await detectSentry(testDir);

    expect(result.data).toEqual({
      cwd: testDir,
      status: "installed",
      signals: ["sdk: composer.json", "config: config/sentry.php"],
    });
  });

  test("recognizes Sentry from a Gradle version catalog", async () => {
    fs.writeFileSync(
      path.join(testDir, "libs.versions.toml"),
      '[libraries]\nsentry = { module = "io.sentry:sentry-android", version = "8.0.0" }\n'
    );
    fs.writeFileSync(
      path.join(testDir, "AndroidManifest.xml"),
      '<meta-data android:name="io.sentry.dsn" android:value="$' +
        '{SENTRY_DSN}" />\n'
    );

    const result = await detectSentry(testDir);

    expect(result.data).toEqual({
      cwd: testDir,
      status: "installed",
      signals: ["sdk: libs.versions.toml", "init: AndroidManifest.xml:1"],
    });
  });
});
