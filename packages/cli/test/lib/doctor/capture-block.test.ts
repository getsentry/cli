// test/lib/doctor/capture-block.test.ts
import { describe, expect, it } from "vitest";
import {
  captureBlock,
  extractKeys,
  gradlePlaceholderValues,
} from "../../../src/lib/doctor/capture-block.js";
import {
  INIT_MARKERS,
  markersForFile,
} from "../../../src/lib/doctor/markers.js";

describe("captureBlock", () => {
  it("captures a paren block and reports its 1-based line", () => {
    const src = [
      "import * as Sentry from '@sentry/node';",
      "",
      "Sentry.init({",
      "  dsn: 'https://k@o1.ingest.sentry.io/1',",
      "  tracesSampleRate: 1.0,",
      "});",
    ].join("\n");

    const block = captureBlock(src, /Sentry\.init\s*\(/, "paren");

    expect(block?.line).toBe(3);
    expect(block?.text).toContain("tracesSampleRate");
    expect(block?.text.endsWith(")")).toBe(true);
  });

  it("ignores delimiters inside string literals and comments", () => {
    const src = [
      "Sentry.init({",
      "  dsn: 'https://k@h/1', // a ) and a } in a comment",
      "  release: 'v)1',",
      "});",
    ].join("\n");

    const block = captureBlock(src, /Sentry\.init\s*\(/, "paren");

    expect(block?.text).toContain("release");
  });

  it("captures a brace block (Gradle)", () => {
    const src = ["sentry {", "  includeSourceContext = true", "}"].join("\n");
    const block = captureBlock(src, /\bsentry\s*\{/, "brace");
    expect(block?.text).toContain("includeSourceContext");
  });

  it("captures a Ruby do…end block", () => {
    const src = [
      "Sentry.init do |config|",
      "  config.dsn = 'https://k@h/1'",
      "  config.traces_sample_rate = 0.5",
      "end",
    ].join("\n");

    const block = captureBlock(src, /Sentry\.init\b/, "ruby");

    expect(block?.text).toContain("traces_sample_rate");
    expect(block?.text.trimEnd().endsWith("end")).toBe(true);
  });

  it("returns null when the block never closes", () => {
    expect(
      captureBlock("Sentry.init({ dsn: 'x'", /Sentry\.init\s*\(/, "paren")
    ).toBeNull();
    expect(
      captureBlock("Sentry.init do |c|", /Sentry\.init\b/, "ruby")
    ).toBeNull();
  });

  it("returns null when the marker is absent", () => {
    expect(
      captureBlock("const x = 1;", /Sentry\.init\s*\(/, "paren")
    ).toBeNull();
  });

  it("captures AndroidManifest meta-data without requiring paren delimiters", () => {
    const src = [
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
    ].join("\n");

    const block = captureBlock(src, /android:name="io\.sentry\./, "none");

    expect(block).not.toBeNull();
    expect(block?.text).toContain("io.sentry.dsn");
    const keys = extractKeys(block?.text ?? "");
    expect(keys.dsn).toEqual({
      value: "https://abc123@o1.ingest.sentry.io/42",
      dynamic: false,
    });
    expect(keys.environment).toEqual({ value: "debug", dynamic: false });
  });

  it("does not start the Android block at a package-prefixed action name", () => {
    const src = [
      "<manifest>",
      "  <application>",
      "    <receiver>",
      "      <intent-filter>",
      '        <action android:name="io.sentry.samples.android.TEST_BROADCAST" />',
      "      </intent-filter>",
      "    </receiver>",
      "    <meta-data",
      '      android:name="io.sentry.dsn"',
      '      android:value="https://abc123@o1.ingest.sentry.io/42" />',
      "  </application>",
      "</manifest>",
    ].join("\n");

    const rule = markersForFile(INIT_MARKERS, "AndroidManifest.xml")[0];
    const block = captureBlock(src, rule!.marker, rule!.delims);

    expect(block?.line).toBe(9);
    expect(block?.text).toContain('android:name="io.sentry.dsn"');
    expect(extractKeys(block?.text ?? "").dsn).toEqual({
      value: "https://abc123@o1.ingest.sentry.io/42",
      dynamic: false,
    });
  });
});

describe("extractKeys", () => {
  it("classifies literals as static and expressions as dynamic", () => {
    const keys = extractKeys(
      [
        "{",
        "  dsn: process.env.SENTRY_DSN,",
        "  environment: 'production',",
        "  debug: true,",
        "  tracesSampleRate: 0.25,",
        "}",
      ].join("\n")
    );

    expect(keys.dsn).toEqual({ dynamic: true });
    expect(keys.environment).toEqual({ value: "production", dynamic: false });
    expect(keys.debug).toEqual({ value: "true", dynamic: false });
    expect(keys.tracesSampleRate).toEqual({ value: "0.25", dynamic: false });
  });

  it("normalizes dotted assignment targets to their last segment", () => {
    const keys = extractKeys("config.traces_sample_rate = 0.5");
    expect(keys.traces_sample_rate).toEqual({ value: "0.5", dynamic: false });
  });

  it("does not bind a later android:value to a non-meta-data io.sentry name", () => {
    const keys = extractKeys(
      [
        '<action android:name="io.sentry.samples.android.TEST_BROADCAST" />',
        "<meta-data",
        '  android:name="io.sentry.dsn"',
        '  android:value="https://k@h/1" />',
      ].join("\n")
    );
    expect(keys.dsn).toEqual({ value: "https://k@h/1", dynamic: false });
    expect(keys.TEST_BROADCAST).toBeUndefined();
  });

  it("extracts PHP => and JSON quoted keys", () => {
    const php = extractKeys(
      "return [\n  'dsn' => env('SENTRY_DSN'),\n  'traces_sample_rate' => 1.0,\n];"
    );
    expect(php.traces_sample_rate).toEqual({ value: "1.0", dynamic: false });
    expect(php.dsn).toEqual({ dynamic: true });

    const json = extractKeys(
      '{ "Sentry": { "Dsn": "https://k@h/1", "TracesSampleRate": 1.0 } }'
    );
    expect(json.TracesSampleRate).toEqual({ value: "1.0", dynamic: false });
    expect(json.dsn).toEqual({ value: "https://k@h/1", dynamic: false });
  });

  it("extracts hyphenated keys from sentry.properties", () => {
    const keys = extractKeys(
      "dsn=https://k@h/1\ntraces-sample-rate=1.0\nenvironment=production\n"
    );
    expect(keys["traces-sample-rate"]).toEqual({
      value: "1.0",
      dynamic: false,
    });
    expect(keys.dsn).toEqual({ value: "https://k@h/1", dynamic: false });
    expect(keys.environment).toEqual({
      value: "production",
      dynamic: false,
    });
  });

  it("ignores locals and callbacks in a Java init block", () => {
    const keys = extractKeys(
      [
        "SentryAndroid.init(this, options -> {",
        "  PackageInfo pInfo = this.getPackageManager().getPackageInfo(name, 0);",
        "  String version = pInfo.versionName;",
        "  String SE = BuildConfig.SE;",
        "  options.setBeforeSend((event, hint) -> {",
        "    List<SentryException> exceptions = event.getExceptions();",
        "    SentryException exception = exceptions.get(0);",
        "    User user = event.getUser();",
        "    return event;",
        "  });",
        "  options.getSessionReplay().setSessionSampleRate(1.0);",
        "});",
      ].join("\n")
    );
    expect(keys.pInfo).toBeUndefined();
    expect(keys.version).toBeUndefined();
    expect(keys.SE).toBeUndefined();
    expect(keys.exceptions).toBeUndefined();
    expect(keys.exception).toBeUndefined();
    expect(keys.user).toBeUndefined();
    expect(keys.sessionSampleRate).toEqual({ value: "1.0", dynamic: false });
  });

  it("stores Go/.NET capitalized option names in lowercase", () => {
    const keys = extractKeys(
      'sentry.Init(sentry.ClientOptions{\n  Dsn: "https://k@h/1",\n  Environment: "prod",\n  Debug: true,\n})'
    );
    expect(keys.dsn).toEqual({ value: "https://k@h/1", dynamic: false });
    expect(keys.environment).toEqual({ value: "prod", dynamic: false });
    expect(keys.debug).toEqual({ value: "true", dynamic: false });
  });

  it("extracts Java setDsn / setEnvironment / setDebug", () => {
    const keys = extractKeys(
      'SentryAndroid.init(this, options -> {\n  options.setDsn("https://k@h/1");\n  options.setEnvironment("debug");\n  options.setDebug(true);\n});'
    );
    expect(keys.dsn).toEqual({ value: "https://k@h/1", dynamic: false });
    expect(keys.environment).toEqual({ value: "debug", dynamic: false });
    expect(keys.debug).toEqual({ value: "true", dynamic: false });
  });

  it("extracts Java setter sample rates", () => {
    const keys = extractKeys(
      [
        "SentryAndroid.init(this, options -> {",
        "  options.getSessionReplay().setOnErrorSampleRate(1.0);",
        "  options.getSessionReplay().setSessionSampleRate(1.0);",
        "});",
      ].join("\n")
    );
    expect(keys.sessionSampleRate).toEqual({ value: "1.0", dynamic: false });
    expect(keys.onErrorSampleRate).toEqual({ value: "1.0", dynamic: false });
  });

  it("keeps the full Android traces.sample-rate name", () => {
    const keys = extractKeys(
      [
        "<meta-data",
        '  android:name="io.sentry.traces.sample-rate"',
        '  android:value="1.0" />',
      ].join("\n")
    );
    expect(keys["traces.sample-rate"]).toEqual({
      value: "1.0",
      dynamic: false,
    });
    expect(keys["sample-rate"]).toBeUndefined();
  });

  it("treats a Gradle ${placeholder} android:value as dynamic", () => {
    const keys = extractKeys(
      [
        "<meta-data",
        '  android:name="io.sentry.dsn"',
        '  android:value="${sentryDsn}" />',
      ].join("\n")
    );
    expect(keys.dsn).toEqual({ value: "${sentryDsn}", dynamic: true });
  });

  it("pulls unique Gradle placeholder assignments and ignores conflicting ones", () => {
    const table = gradlePlaceholderValues(
      [
        'addManifestPlaceholders(mapOf("sentryDsn" to "https://k@h/1", "sentryDebug" to true))',
        'addManifestPlaceholders(mapOf("sentryEnvironment" to "debug"))',
        'addManifestPlaceholders(mapOf("sentryEnvironment" to "release"))',
        'manifestPlaceholders = [sentryRelease: "1.0"]',
      ].join("\n"),
      ["sentryDsn", "sentryDebug", "sentryEnvironment", "sentryRelease"]
    );
    expect([...(table.get("sentryDsn") ?? [])]).toEqual(["https://k@h/1"]);
    expect([...(table.get("sentryDebug") ?? [])]).toEqual(["true"]);
    expect(new Set(table.get("sentryEnvironment"))).toEqual(
      new Set(["debug", "release"])
    );
    expect([...(table.get("sentryRelease") ?? [])]).toEqual(["1.0"]);
  });
});
