/**
 * Unit tests for the central error reporting helper.
 *
 * Covers:
 * - Silencing rules (OutputError / expected AuthError / 401–499 ApiError)
 * - Grouping tag extraction (extractResourceKind)
 * - Tag enrichment in beforeSend (enrichEventWithGroupingTags)
 * - End-to-end behavior of reportCliError (metric emission + capture)
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as Sentry from "@sentry/node-core/light";
import {
  classifySilenced,
  enrichEventWithGroupingTags,
  extractResourceKind,
  reportCliError,
} from "../../src/lib/error-reporting.js";
import {
  ApiError,
  AuthError,
  ConfigError,
  ContextError,
  OutputError,
  ResolutionError,
  SeerError,
  ValidationError,
} from "../../src/lib/errors.js";

// ---------------------------------------------------------------------------
// extractResourceKind
// ---------------------------------------------------------------------------

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

  test("handles empty input", () => {
    expect(extractResourceKind("")).toBe("");
  });

  test("collapses whitespace introduced by strips", () => {
    expect(extractResourceKind("Issue    suffix    'X'")).toBe("Issue suffix");
  });
});

// ---------------------------------------------------------------------------
// classifySilenced
// ---------------------------------------------------------------------------

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

  test("does NOT silence AuthError(invalid)", () => {
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

// ---------------------------------------------------------------------------
// enrichEventWithGroupingTags
// ---------------------------------------------------------------------------

describe("enrichEventWithGroupingTags", () => {
  function makeEvent(
    type: string,
    tags?: Record<string, string>
  ): Sentry.ErrorEvent {
    return {
      exception: { values: [{ type, value: "msg" }] },
      ...(tags && { tags }),
    } as Sentry.ErrorEvent;
  }

  test("sets cli_error.class from exception type", () => {
    const event = makeEvent("ContextError");
    const result = enrichEventWithGroupingTags(event);
    expect(result.tags?.["cli_error.class"]).toBe("ContextError");
  });

  test("skips events that already have cli_error.class", () => {
    const event = makeEvent("ContextError", {
      "cli_error.class": "ContextError",
      "cli_error.kind": "Organization",
    });
    const result = enrichEventWithGroupingTags(event);
    expect(result.tags?.["cli_error.kind"]).toBe("Organization");
  });

  test("skips events without exception", () => {
    const event = {} as Sentry.ErrorEvent;
    const result = enrichEventWithGroupingTags(event);
    expect(result.tags).toBeUndefined();
  });

  test("skips events without exception type", () => {
    const event = {
      exception: { values: [{ value: "msg" }] },
    } as Sentry.ErrorEvent;
    const result = enrichEventWithGroupingTags(event);
    expect(result.tags).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// reportCliError integration
// ---------------------------------------------------------------------------

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

  test("captures ContextError with scope (tags applied)", () => {
    const err = new ContextError("Organization", "sentry org view <slug>");
    reportCliError(err);
    expect(captureSpy).toHaveBeenCalledWith(err);
    expect(withScopeSpy).toHaveBeenCalled();
    expect(metricSpy).not.toHaveBeenCalled();
  });

  test("captures ResolutionError", () => {
    const err = new ResolutionError(
      "Project 'x'",
      "not found",
      "sentry issue list <org>/x"
    );
    reportCliError(err);
    expect(captureSpy).toHaveBeenCalledWith(err);
  });

  test("captures SeerError (marketing dashboard)", () => {
    reportCliError(new SeerError("not_enabled", "my-org"));
    expect(captureSpy).toHaveBeenCalled();
    expect(metricSpy).not.toHaveBeenCalled();
  });

  test("captures AuthError(invalid)", () => {
    reportCliError(new AuthError("invalid"));
    expect(captureSpy).toHaveBeenCalled();
  });

  test("captures ApiError(400)", () => {
    reportCliError(new ApiError("failed", 400, undefined, "/api/0/foo/"));
    expect(captureSpy).toHaveBeenCalled();
  });

  test.each([
    401, 403, 404, 429,
  ])("SILENCES ApiError(%i) and emits metric", (status) => {
    reportCliError(new ApiError("user err", status, "detail", "/api/0/foo/"));
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
        attributes: expect.objectContaining({ reason: "output_error" }),
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

  test("captures ApiError(500) without silencing metric", () => {
    reportCliError(new ApiError("server fail", 500));
    expect(captureSpy).toHaveBeenCalled();
    expect(metricSpy).not.toHaveBeenCalled();
  });
});
