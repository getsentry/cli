/**
 * Unit tests for the central error reporting helper.
 *
 * Covers:
 * - Fingerprint computation per error class
 * - Structured `cli_error` context generation
 * - Silencing rules (OutputError / expected AuthError / 401–499 ApiError)
 * - Fallback fingerprint extraction from serialized event payloads
 * - End-to-end behavior of `reportCliError` (metric emission + capture)
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as Sentry from "@sentry/node-core/light";
import {
  buildCliErrorContext,
  classifySilenced,
  computeFingerprint,
  extractMessagePrefix,
  extractResourceKind,
  fingerprintFromEventPayload,
  normalizeEndpoint,
  normalizeErrorMessage,
  reportCliError,
} from "../../src/lib/error-reporting.js";
import {
  ApiError,
  AuthError,
  CliError,
  ConfigError,
  ContextError,
  DeviceFlowError,
  OutputError,
  ResolutionError,
  SeerError,
  TimeoutError,
  UpgradeError,
  ValidationError,
  WizardError,
} from "../../src/lib/errors.js";

describe("normalizeEndpoint", () => {
  test("returns empty string for undefined/empty", () => {
    expect(normalizeEndpoint(undefined)).toBe("");
    expect(normalizeEndpoint("")).toBe("");
  });

  test("normalizes organization slug", () => {
    expect(normalizeEndpoint("/api/0/organizations/my-org/issues/")).toBe(
      "/api/0/organizations/{slug}/issues/"
    );
  });

  test("normalizes project slug pair", () => {
    expect(normalizeEndpoint("/api/0/projects/my-org/my-project/events/")).toBe(
      "/api/0/projects/{slug}/{slug}/events/"
    );
  });

  test("normalizes team slug pair", () => {
    expect(normalizeEndpoint("/api/0/teams/my-org/my-team/")).toBe(
      "/api/0/teams/{slug}/{slug}/"
    );
  });

  test("normalizes numeric issue ID", () => {
    expect(
      normalizeEndpoint("/api/0/organizations/my-org/issues/123456789/")
    ).toBe("/api/0/organizations/{slug}/issues/{id}/");
  });

  test("normalizes hex event ID", () => {
    expect(
      normalizeEndpoint(
        "/api/0/projects/org/proj/events/abcdef0123456789abcdef0123456789/"
      )
    ).toBe("/api/0/projects/{slug}/{slug}/events/{hex_id}/");
  });

  test("strips query string before normalizing", () => {
    expect(
      normalizeEndpoint("/api/0/organizations/my-org/issues/?cursor=abc")
    ).toBe("/api/0/organizations/{slug}/issues/");
  });

  test("normalizes release version", () => {
    expect(
      normalizeEndpoint("/api/0/organizations/my-org/releases/v1.2.3/")
    ).toBe("/api/0/organizations/{slug}/releases/{version}/");
  });

  test("is idempotent on already-normalized input", () => {
    const normalized = "/api/0/organizations/{slug}/issues/{id}/";
    expect(normalizeEndpoint(normalized)).toBe(normalized);
  });
});

describe("extractResourceKind", () => {
  test("strips single-quoted user data", () => {
    expect(
      extractResourceKind("Project 'api-track' not found in organization 'foo'")
    ).toBe("Project not found in organization");
  });

  test("strips double-quoted user data", () => {
    expect(extractResourceKind('Event "abc123" not found in org "foo"')).toBe(
      "Event not found in org"
    );
  });

  test("strips long hex IDs", () => {
    expect(
      extractResourceKind("Trace abcdef0123456789abcdef0123456789 not found")
    ).toBe("Trace not found");
  });

  test("strips long numeric IDs", () => {
    expect(extractResourceKind("Issue 7420431306 not found.")).toBe(
      "Issue not found."
    );
  });

  test("replaces trailing org/project slug pair with placeholder", () => {
    expect(extractResourceKind("Event not found in mamiteam/okhome-api.")).toBe(
      "Event not found in {slug}/{slug}."
    );
  });

  test("handles empty input", () => {
    expect(extractResourceKind("")).toBe("");
  });

  test("collapses whitespace introduced by strips", () => {
    expect(extractResourceKind("Issue    suffix    'X'")).toBe("Issue suffix");
  });
});

describe("extractMessagePrefix", () => {
  test("returns first N words with user data replaced", () => {
    expect(
      extractMessagePrefix(
        'Invalid trace ID "d2ad4a2d947b5983". Expected a 32-character hex'
      )
    ).toBe("Invalid trace ID <value>. Expected a");
  });

  test("stops at newline boundary", () => {
    expect(extractMessagePrefix("First line.\nSecond line.", 10)).toBe(
      "First line."
    );
  });

  test("handles empty input", () => {
    expect(extractMessagePrefix("")).toBe("");
  });

  test("respects maxWords limit", () => {
    expect(
      extractMessagePrefix("one two three four five six seven eight", 3)
    ).toBe("one two three");
  });
});

describe("normalizeErrorMessage", () => {
  test("normalizes macOS user path", () => {
    expect(
      normalizeErrorMessage(
        "EPERM: operation not permitted, open '/Users/desert/.local/share/zsh/site-functions/_sentry'"
      )
    ).toContain("/Users/<user>");
  });

  test("normalizes Linux user path", () => {
    expect(
      normalizeErrorMessage("Cannot read /home/alice/config.json")
    ).toContain("/home/<user>");
  });

  test("normalizes Windows user path", () => {
    expect(
      normalizeErrorMessage("Cannot find C:\\Users\\DUANBA~1\\AppData\\")
    ).toContain("C:\\Users\\<user>\\");
  });

  test("normalizes /tmp paths", () => {
    expect(normalizeErrorMessage("Wrote /tmp/abc123/")).toContain(
      "/tmp/<tempfile>"
    );
  });

  test("normalizes hex addresses", () => {
    expect(normalizeErrorMessage("Segfault at 0xdeadbeef")).toContain(
      "0x<addr>"
    );
  });

  test("leaves messages without paths untouched", () => {
    const msg = "API request failed: 400 Bad Request";
    expect(normalizeErrorMessage(msg)).toBe(msg);
  });
});

describe("computeFingerprint — structured CliError classes", () => {
  test("ContextError uses resource as grouping key", () => {
    const err = new ContextError(
      "Organization and project",
      "sentry issue view <org>/<project>/<id>"
    );
    expect(computeFingerprint(err)).toEqual([
      "ContextError",
      "Organization and project",
    ]);
  });

  test("different ContextError messages with same resource collapse", () => {
    const err1 = new ContextError("Organization", "sentry org view <org>");
    const err2 = new ContextError("Organization", "sentry project list <org>/");
    expect(computeFingerprint(err1)).toEqual(computeFingerprint(err2));
  });

  test("ResolutionError collapses on resource+headline kind", () => {
    const err1 = new ResolutionError(
      "Project 'api-track'",
      "not found",
      "sentry issue list <org>/api-track"
    );
    const err2 = new ResolutionError(
      "Project 'ocean'",
      "not found",
      "sentry issue list <org>/ocean"
    );
    expect(computeFingerprint(err1)).toEqual(computeFingerprint(err2));
    expect(computeFingerprint(err1)).toEqual([
      "ResolutionError",
      "Project",
      "not found",
    ]);
  });

  test("ResolutionError keeps distinct headlines as separate issues", () => {
    const notFound = new ResolutionError(
      "Project 'cli'",
      "not found",
      "sentry issue list <org>/cli"
    );
    const ambiguous = new ResolutionError(
      "Project 'cli'",
      "is ambiguous",
      "use <org>/cli explicitly"
    );
    expect(computeFingerprint(notFound)).not.toEqual(
      computeFingerprint(ambiguous)
    );
  });

  test("ValidationError with field uses field as grouping key", () => {
    const err = new ValidationError(
      "Invalid trace ID 'abc'. Expected 32-character hex.",
      "trace_id"
    );
    expect(computeFingerprint(err)).toEqual(["ValidationError", "trace_id"]);
  });

  test("ValidationError without field falls back to message prefix", () => {
    const err1 = new ValidationError('Invalid trace ID "abc".');
    const err2 = new ValidationError('Invalid trace ID "xyz".');
    expect(computeFingerprint(err1)).toEqual(computeFingerprint(err2));
  });

  test("ApiError groups on status + endpoint template", () => {
    const err1 = new ApiError(
      "API request failed",
      400,
      undefined,
      "/api/0/organizations/foo/"
    );
    const err2 = new ApiError(
      "API request failed",
      400,
      undefined,
      "/api/0/organizations/bar/"
    );
    expect(computeFingerprint(err1)).toEqual(computeFingerprint(err2));
    expect(computeFingerprint(err1)).toEqual([
      "ApiError",
      "400",
      "/api/0/organizations/{slug}/",
    ]);
  });

  test("ApiError differentiates by status", () => {
    const err400 = new ApiError("x", 400, undefined, "/api/0/foo/");
    const err500 = new ApiError("x", 500, undefined, "/api/0/foo/");
    expect(computeFingerprint(err400)).not.toEqual(computeFingerprint(err500));
  });
});

describe("computeFingerprint — enum-keyed CliError classes", () => {
  test("SeerError groups by reason", () => {
    const err = new SeerError("not_enabled");
    expect(computeFingerprint(err)).toEqual(["SeerError", "not_enabled"]);
  });

  test("SeerError different reasons stay distinct", () => {
    expect(computeFingerprint(new SeerError("not_enabled"))).not.toEqual(
      computeFingerprint(new SeerError("no_budget"))
    );
  });

  test("AuthError(invalid) groups by reason", () => {
    const err = new AuthError("invalid");
    expect(computeFingerprint(err)).toEqual(["AuthError", "invalid"]);
  });

  test("UpgradeError groups by reason", () => {
    const err = new UpgradeError("version_not_found", "custom msg");
    expect(computeFingerprint(err)).toEqual([
      "UpgradeError",
      "version_not_found",
    ]);
  });

  test("DeviceFlowError groups by code", () => {
    const err = new DeviceFlowError("slow_down");
    expect(computeFingerprint(err)).toEqual(["DeviceFlowError", "slow_down"]);
  });

  test("TimeoutError has constant fingerprint", () => {
    expect(computeFingerprint(new TimeoutError("A"))).toEqual(["TimeoutError"]);
    expect(computeFingerprint(new TimeoutError("B"))).toEqual(["TimeoutError"]);
  });
});

describe("computeFingerprint — generic CliError fallback", () => {
  test("ConfigError uses class name + message prefix", () => {
    const err = new ConfigError("Invalid channel: stable-override");
    const fp = computeFingerprint(err);
    expect(fp?.[0]).toBe("ConfigError");
  });

  test("WizardError uses class name + message prefix", () => {
    const err = new WizardError("Missing required instrumentation file", {
      rendered: false,
    });
    const fp = computeFingerprint(err);
    expect(fp?.[0]).toBe("WizardError");
  });

  test("bare CliError uses class name + message prefix", () => {
    const err = new CliError("Failed to create project 'foo' in 'bar'.");
    const fp = computeFingerprint(err);
    expect(fp?.[0]).toBe("CliError");
  });
});

describe("computeFingerprint — generic Error", () => {
  test("returns null for plain error without path data", () => {
    expect(computeFingerprint(new Error("API request failed"))).toBeNull();
  });

  test("returns fingerprint for EPERM with user path", () => {
    const err = new Error(
      "EPERM: operation not permitted, open '/Users/desert/.local/share/zsh/site-functions/_sentry'"
    );
    const fp = computeFingerprint(err);
    expect(fp).not.toBeNull();
    expect(fp?.[0]).toBe("Error");
  });

  test("collapses EPERM for different users", () => {
    const e1 = new Error("EPERM: open '/Users/alice/.config'");
    const e2 = new Error("EPERM: open '/Users/bob/.config'");
    expect(computeFingerprint(e1)).toEqual(computeFingerprint(e2));
  });

  test("returns null for non-Error values", () => {
    expect(computeFingerprint(null)).toBeNull();
    expect(computeFingerprint(undefined)).toBeNull();
    expect(computeFingerprint("string error")).toBeNull();
    expect(computeFingerprint({ code: 500 })).toBeNull();
  });
});

describe("buildCliErrorContext", () => {
  test("returns ApiError details", () => {
    const err = new ApiError("failed", 404, "Not found", "/api/0/foo/");
    const ctx = buildCliErrorContext(err);
    expect(ctx).toMatchObject({
      kind: "ApiError",
      status: 404,
      endpoint: "/api/0/foo/",
      detail: "Not found",
    });
  });

  test("returns ContextError structured fields", () => {
    const err = new ContextError(
      "Organization and project",
      "sentry issue list <org>/<project>"
    );
    expect(buildCliErrorContext(err)).toMatchObject({
      kind: "ContextError",
      resource: "Organization and project",
      resource_kind: "Organization and project",
    });
  });

  test("returns ResolutionError structured fields", () => {
    const err = new ResolutionError(
      "Project 'foo'",
      "not found",
      "sentry issue list <org>/foo"
    );
    expect(buildCliErrorContext(err)).toMatchObject({
      kind: "ResolutionError",
      resource: "Project 'foo'",
      resource_kind: "Project",
      headline: "not found",
    });
  });

  test("returns SeerError reason + org slug", () => {
    const err = new SeerError("not_enabled", "my-org");
    expect(buildCliErrorContext(err)).toEqual({
      kind: "SeerError",
      reason: "not_enabled",
      org_slug: "my-org",
    });
  });

  test("returns null for non-CliError", () => {
    expect(buildCliErrorContext(new Error("boom"))).toBeNull();
    expect(buildCliErrorContext(null)).toBeNull();
  });
});

describe("classifySilenced", () => {
  test("silences OutputError", () => {
    expect(classifySilenced(new OutputError(null))).toBe("output_error");
  });

  test("silences AuthError(not_authenticated)", () => {
    expect(classifySilenced(new AuthError("not_authenticated"))).toBe(
      "auth_expected"
    );
  });

  test("silences AuthError(expired)", () => {
    expect(classifySilenced(new AuthError("expired"))).toBe("auth_expected");
  });

  test("does NOT silence AuthError(invalid) — kept for UX signal", () => {
    expect(classifySilenced(new AuthError("invalid"))).toBeNull();
  });

  test.each([
    401, 403, 404, 429, 418,
  ])("silences ApiError with status %i", (status) => {
    expect(classifySilenced(new ApiError("x", status))).toBe("api_user_error");
  });

  test("does NOT silence ApiError 400 (CLI bug)", () => {
    expect(classifySilenced(new ApiError("bad", 400))).toBeNull();
  });

  test.each([
    500, 502, 503,
  ])("does NOT silence ApiError with 5xx status %i", (status) => {
    expect(classifySilenced(new ApiError("x", status))).toBeNull();
  });

  test.each([
    ["ContextError", new ContextError("Organization", "sentry org view <x>")],
    [
      "ResolutionError",
      new ResolutionError("Project 'x'", "not found", "sentry issue list"),
    ],
    ["ValidationError", new ValidationError("bad")],
    ["SeerError", new SeerError("not_enabled")],
    ["ConfigError", new ConfigError("bad")],
    ["generic Error", new Error("boom")],
  ])("does NOT silence %s", (_label, err) => {
    expect(classifySilenced(err)).toBeNull();
  });
});

describe("fingerprintFromEventPayload", () => {
  function makeEvent(type: string, value: string): Sentry.ErrorEvent {
    return {
      exception: { values: [{ type, value }] },
    } as Sentry.ErrorEvent;
  }

  test("returns null for empty event", () => {
    expect(fingerprintFromEventPayload({} as Sentry.ErrorEvent)).toBeNull();
  });

  test("fingerprints ContextError via resource kind from message", () => {
    const event = makeEvent(
      "ContextError",
      "Organization and project are required.\n\nSpecify them using:\n  sentry issue view <org>/<project>/<id>"
    );
    expect(fingerprintFromEventPayload(event)).toEqual([
      "ContextError",
      "Organization and project are required.",
    ]);
  });

  test("fingerprints ResolutionError via resource kind", () => {
    const event = makeEvent(
      "ResolutionError",
      "Project 'api-track' not found.\n\nTry:\n  sentry ..."
    );
    expect(fingerprintFromEventPayload(event)?.[0]).toBe("ResolutionError");
  });

  test("fingerprints path-embedded generic Error", () => {
    const event = makeEvent(
      "Error",
      "EPERM: open '/Users/alice/.config/something'"
    );
    const fp = fingerprintFromEventPayload(event);
    expect(fp).not.toBeNull();
    expect(fp?.[0]).toBe("Error");
  });

  test("returns null for generic Error without path data", () => {
    const event = makeEvent("TypeError", "fetch failed");
    expect(fingerprintFromEventPayload(event)).toBeNull();
  });

  test("uses prefix fingerprint for ValidationError", () => {
    const event = makeEvent(
      "ValidationError",
      'Invalid trace ID "d2ad4a2d947b5983". Expected a 32-character hex'
    );
    expect(fingerprintFromEventPayload(event)?.[0]).toBe("ValidationError");
  });
});

describe("reportCliError integration", () => {
  let captureSpy: ReturnType<typeof spyOn>;
  let metricSpy: ReturnType<typeof spyOn>;
  let withScopeSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    captureSpy = spyOn(Sentry, "captureException");
    metricSpy = spyOn(Sentry.metrics, "distribution");
    withScopeSpy = spyOn(Sentry, "withScope");
  });

  afterEach(() => {
    captureSpy.mockRestore();
    metricSpy.mockRestore();
    withScopeSpy.mockRestore();
  });

  test("captures and fingerprints ContextError", () => {
    const err = new ContextError("Organization", "sentry org view <slug>");
    reportCliError(err);
    expect(captureSpy).toHaveBeenCalledWith(err);
    expect(withScopeSpy).toHaveBeenCalled();
    expect(metricSpy).not.toHaveBeenCalled();
  });

  test("captures and fingerprints ResolutionError", () => {
    const err = new ResolutionError(
      "Project 'x'",
      "not found",
      "sentry issue list <org>/x"
    );
    reportCliError(err);
    expect(captureSpy).toHaveBeenCalledWith(err);
  });

  test("captures SeerError (marketing dashboard relies on this)", () => {
    const err = new SeerError("not_enabled", "my-org");
    reportCliError(err);
    expect(captureSpy).toHaveBeenCalledWith(err);
    expect(metricSpy).not.toHaveBeenCalled();
  });

  test("captures AuthError(invalid) — kept for UX signal", () => {
    const err = new AuthError("invalid");
    reportCliError(err);
    expect(captureSpy).toHaveBeenCalledWith(err);
  });

  test("captures ApiError(400)", () => {
    const err = new ApiError(
      "failed",
      400,
      undefined,
      "/api/0/organizations/foo/"
    );
    reportCliError(err);
    expect(captureSpy).toHaveBeenCalledWith(err);
  });

  test.each([
    401, 403, 404, 429,
  ])("SILENCES ApiError(%i) and emits metric", (status) => {
    const err = new ApiError(
      "user err",
      status,
      "detail",
      "/api/0/organizations/foo/"
    );
    reportCliError(err);
    expect(captureSpy).not.toHaveBeenCalled();
    expect(metricSpy).toHaveBeenCalledWith(
      "cli.error.silenced",
      1,
      expect.objectContaining({
        attributes: expect.objectContaining({
          error_class: "ApiError",
          reason: "api_user_error",
          api_status: status,
        }),
      })
    );
  });

  test("silences OutputError and emits metric", () => {
    reportCliError(new OutputError(null));
    expect(captureSpy).not.toHaveBeenCalled();
    expect(metricSpy).toHaveBeenCalledWith(
      "cli.error.silenced",
      1,
      expect.objectContaining({
        attributes: expect.objectContaining({
          reason: "output_error",
        }),
      })
    );
  });

  test.each([
    "not_authenticated",
    "expired",
  ] as const)("silences AuthError(%s) and emits metric", (reason) => {
    reportCliError(new AuthError(reason));
    expect(captureSpy).not.toHaveBeenCalled();
    expect(metricSpy).toHaveBeenCalledWith(
      "cli.error.silenced",
      1,
      expect.objectContaining({
        attributes: expect.objectContaining({
          reason: "auth_expected",
          auth_reason: reason,
        }),
      })
    );
  });

  test("captures ApiError(500) and does not emit silencing metric", () => {
    reportCliError(new ApiError("server fail", 500));
    expect(captureSpy).toHaveBeenCalled();
    expect(metricSpy).not.toHaveBeenCalled();
  });
});
