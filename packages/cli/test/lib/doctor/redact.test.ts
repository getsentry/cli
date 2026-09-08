import { describe, expect, it } from "vitest";
import {
  redactConfigText,
  safeFilePath,
} from "../../../src/lib/doctor/redact.js";

describe("redactConfigText", () => {
  it("redacts secret-ish assignments across syntaxes", () => {
    expect(redactConfigText('authToken: "abc123"')).toBe(
      'authToken: "[REDACTED]"'
    );
    expect(redactConfigText("SENTRY_AUTH_TOKEN=sntrys_xyz")).toContain(
      "[REDACTED]"
    );
    expect(redactConfigText("api_key = 'sk-live-1'")).toBe(
      "api_key = '[REDACTED]'"
    );
  });

  it("leaves ordinary scalar config alone", () => {
    expect(redactConfigText("debug=true")).toBe("debug=true");
    expect(redactConfigText("tracesSampleRate: 1.0")).toBe(
      "tracesSampleRate: 1.0"
    );
    expect(redactConfigText("environment: 'production'")).toBe(
      "environment: 'production'"
    );
  });

  it("keeps the DSN public key — it is not a secret", () => {
    const dsn = "https://abc123def@o1.ingest.sentry.io/42";
    expect(redactConfigText(`dsn: "${dsn}"`)).toContain("abc123def");
  });

  it("still redacts URI userinfo passwords", () => {
    expect(redactConfigText("postgres://user:hunter2@db/app")).toBe(
      "postgres://[REDACTED]@db/app"
    );
  });
});

describe("allowlist validators", () => {
  it("accepts ordinary relative paths", () => {
    expect(safeFilePath("src/instrument.ts")).toBe("src/instrument.ts");
    expect(safeFilePath("app/build.gradle.kts")).toBe("app/build.gradle.kts");
  });

  it("rejects traversal, absolute paths, and shell metacharacters", () => {
    expect(safeFilePath("../../etc/passwd")).toBeNull();
    expect(safeFilePath("/etc/passwd")).toBeNull();
    expect(safeFilePath("src/a.ts; rm -rf /")).toBeNull();
    expect(safeFilePath("src/$(whoami).ts")).toBeNull();
  });
});
