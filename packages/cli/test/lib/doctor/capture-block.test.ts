// test/lib/doctor/capture-block.test.ts
import { describe, expect, it } from "vitest";
import {
  captureBlock,
  extractKeys,
} from "../../../src/lib/doctor/capture-block.js";

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
});
