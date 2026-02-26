/**
 * Sentry URL Parser Tests
 *
 * Unit tests for parseSentryUrl() and applySentryUrlContext().
 * Uses fictional domains (sentry.example.com, sentry.acme.internal)
 * — never real customer data.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  applySentryUrlContext,
  parseSentryUrl,
} from "../../src/lib/sentry-url-parser.js";

describe("parseSentryUrl", () => {
  describe("non-URL inputs return null", () => {
    test("plain text", () => {
      expect(parseSentryUrl("sentry/cli-G")).toBeNull();
    });

    test("numeric ID", () => {
      expect(parseSentryUrl("12345")).toBeNull();
    });

    test("short ID", () => {
      expect(parseSentryUrl("CLI-4Y")).toBeNull();
    });

    test("org/project format", () => {
      expect(parseSentryUrl("my-org/my-project")).toBeNull();
    });

    test("empty string", () => {
      expect(parseSentryUrl("")).toBeNull();
    });

    test("malformed URL", () => {
      expect(parseSentryUrl("http://")).toBeNull();
    });
  });

  describe("organization URLs", () => {
    test("SaaS /organizations/{org}/", () => {
      const result = parseSentryUrl("https://sentry.io/organizations/my-org/");
      expect(result).toEqual({
        baseUrl: "https://sentry.io",
        org: "my-org",
      });
    });

    test("self-hosted /organizations/{org}/", () => {
      const result = parseSentryUrl(
        "https://sentry.example.com/organizations/acme-corp/"
      );
      expect(result).toEqual({
        baseUrl: "https://sentry.example.com",
        org: "acme-corp",
      });
    });

    test("strips trailing path segments after org", () => {
      // /organizations/{org}/ with no further recognized segments → org only
      const result = parseSentryUrl("https://sentry.io/organizations/my-org/");
      expect(result?.org).toBe("my-org");
      expect(result?.issueId).toBeUndefined();
    });
  });

  describe("issue URLs", () => {
    test("/organizations/{org}/issues/{numericId}/", () => {
      const result = parseSentryUrl(
        "https://sentry.io/organizations/my-org/issues/32886/"
      );
      expect(result).toEqual({
        baseUrl: "https://sentry.io",
        org: "my-org",
        issueId: "32886",
      });
    });

    test("/organizations/{org}/issues/{shortId}/", () => {
      const result = parseSentryUrl(
        "https://sentry.io/organizations/my-org/issues/CLI-G/"
      );
      expect(result).toEqual({
        baseUrl: "https://sentry.io",
        org: "my-org",
        issueId: "CLI-G",
      });
    });

    test("self-hosted issue URL with query params", () => {
      const result = parseSentryUrl(
        "https://sentry.example.com/organizations/acme-corp/issues/32886/?project=2"
      );
      expect(result).toEqual({
        baseUrl: "https://sentry.example.com",
        org: "acme-corp",
        issueId: "32886",
      });
    });

    test("self-hosted issue URL with port", () => {
      const result = parseSentryUrl(
        "https://sentry.acme.internal:9000/organizations/devops/issues/100/"
      );
      expect(result).toEqual({
        baseUrl: "https://sentry.acme.internal:9000",
        org: "devops",
        issueId: "100",
      });
    });

    test("HTTP (non-HTTPS) self-hosted URL", () => {
      const result = parseSentryUrl(
        "http://sentry.local:8080/organizations/dev/issues/42/"
      );
      expect(result).toEqual({
        baseUrl: "http://sentry.local:8080",
        org: "dev",
        issueId: "42",
      });
    });
  });

  describe("event URLs", () => {
    test("/organizations/{org}/issues/{id}/events/{eventId}/", () => {
      const result = parseSentryUrl(
        "https://sentry.io/organizations/my-org/issues/32886/events/abc123def456/"
      );
      expect(result).toEqual({
        baseUrl: "https://sentry.io",
        org: "my-org",
        issueId: "32886",
        eventId: "abc123def456",
      });
    });

    test("self-hosted event URL", () => {
      const result = parseSentryUrl(
        "https://sentry.example.com/organizations/acme/issues/999/events/deadbeef/"
      );
      expect(result).toEqual({
        baseUrl: "https://sentry.example.com",
        org: "acme",
        issueId: "999",
        eventId: "deadbeef",
      });
    });

    test("event URL without trailing slash", () => {
      const result = parseSentryUrl(
        "https://sentry.io/organizations/my-org/issues/1/events/evt001"
      );
      expect(result).toEqual({
        baseUrl: "https://sentry.io",
        org: "my-org",
        issueId: "1",
        eventId: "evt001",
      });
    });
  });

  describe("trace URLs", () => {
    test("/organizations/{org}/traces/{traceId}/", () => {
      const result = parseSentryUrl(
        "https://sentry.io/organizations/my-org/traces/a4d1aae7216b47ff8117cf4e09ce9d0a/"
      );
      expect(result).toEqual({
        baseUrl: "https://sentry.io",
        org: "my-org",
        traceId: "a4d1aae7216b47ff8117cf4e09ce9d0a",
      });
    });

    test("self-hosted trace URL", () => {
      const result = parseSentryUrl(
        "https://sentry.example.com/organizations/devops/traces/00112233445566778899aabbccddeeff/"
      );
      expect(result).toEqual({
        baseUrl: "https://sentry.example.com",
        org: "devops",
        traceId: "00112233445566778899aabbccddeeff",
      });
    });
  });

  describe("project settings URLs", () => {
    test("/settings/{org}/projects/{project}/", () => {
      const result = parseSentryUrl(
        "https://sentry.io/settings/my-org/projects/backend/"
      );
      expect(result).toEqual({
        baseUrl: "https://sentry.io",
        org: "my-org",
        project: "backend",
      });
    });

    test("self-hosted project settings URL", () => {
      const result = parseSentryUrl(
        "https://sentry.example.com/settings/acme/projects/web-frontend/"
      );
      expect(result).toEqual({
        baseUrl: "https://sentry.example.com",
        org: "acme",
        project: "web-frontend",
      });
    });
  });

  describe("SaaS subdomain-style URLs (org in hostname)", () => {
    test("issue URL extracts org from subdomain", () => {
      const result = parseSentryUrl(
        "https://my-org.sentry.io/issues/99124558/"
      );
      expect(result).toEqual({
        baseUrl: "https://my-org.sentry.io",
        org: "my-org",
        issueId: "99124558",
      });
    });

    test("issue URL with event ID", () => {
      const result = parseSentryUrl(
        "https://my-org.sentry.io/issues/99124558/events/abc123/"
      );
      expect(result).toEqual({
        baseUrl: "https://my-org.sentry.io",
        org: "my-org",
        issueId: "99124558",
        eventId: "abc123",
      });
    });

    test("trace URL extracts org from subdomain", () => {
      const result = parseSentryUrl(
        "https://my-org.sentry.io/traces/a4d1aae7216b47ff8117cf4e09ce9d0a/"
      );
      expect(result).toEqual({
        baseUrl: "https://my-org.sentry.io",
        org: "my-org",
        traceId: "a4d1aae7216b47ff8117cf4e09ce9d0a",
      });
    });

    test("bare org subdomain returns org only", () => {
      const result = parseSentryUrl("https://my-org.sentry.io/");
      expect(result).toEqual({
        baseUrl: "https://my-org.sentry.io",
        org: "my-org",
      });
    });

    test("hyphenated org slug", () => {
      const result = parseSentryUrl(
        "https://acme-corp.sentry.io/issues/12345/"
      );
      expect(result).toEqual({
        baseUrl: "https://acme-corp.sentry.io",
        org: "acme-corp",
        issueId: "12345",
      });
    });

    test("region subdomains are ignored (us.sentry.io)", () => {
      // Region hosts don't have org in subdomain — return null for unknown paths
      expect(parseSentryUrl("https://us.sentry.io/issues/123/")).toBeNull();
    });

    test("region subdomains are ignored (de.sentry.io)", () => {
      expect(parseSentryUrl("https://de.sentry.io/issues/123/")).toBeNull();
    });

    test("unknown subdomain path returns null", () => {
      expect(parseSentryUrl("https://my-org.sentry.io/auth/login/")).toBeNull();
    });

    test("self-hosted URLs are not matched as subdomain orgs", () => {
      // Self-hosted hostname doesn't end with .sentry.io — subdomain extraction must not apply.
      // The path /issues/123/ has no /organizations/ prefix, so no matcher handles it.
      expect(
        parseSentryUrl("https://sentry.example.com/issues/123/")
      ).toBeNull();
      expect(
        parseSentryUrl("https://sentry.acme.internal:9000/issues/456/")
      ).toBeNull();
    });
  });

  describe("unrecognized paths return null", () => {
    test("root URL", () => {
      expect(parseSentryUrl("https://sentry.io/")).toBeNull();
    });

    test("unknown path", () => {
      expect(parseSentryUrl("https://sentry.io/auth/login/")).toBeNull();
    });

    test("/settings without project segment", () => {
      expect(parseSentryUrl("https://sentry.io/settings/my-org/")).toBeNull();
    });

    test("/settings/{org}/projects/ without project slug", () => {
      expect(
        parseSentryUrl("https://sentry.io/settings/my-org/projects/")
      ).toBeNull();
    });
  });
});

describe("applySentryUrlContext", () => {
  let originalSentryUrl: string | undefined;

  beforeEach(() => {
    originalSentryUrl = process.env.SENTRY_URL;
    delete process.env.SENTRY_URL;
  });

  afterEach(() => {
    if (originalSentryUrl !== undefined) {
      process.env.SENTRY_URL = originalSentryUrl;
    } else {
      delete process.env.SENTRY_URL;
    }
  });

  test("sets SENTRY_URL for self-hosted instance", () => {
    applySentryUrlContext("https://sentry.example.com");
    expect(process.env.SENTRY_URL).toBe("https://sentry.example.com");
  });

  test("does not set SENTRY_URL for SaaS (sentry.io)", () => {
    applySentryUrlContext("https://sentry.io");
    expect(process.env.SENTRY_URL).toBeUndefined();
  });

  test("does not set SENTRY_URL for SaaS subdomain (us.sentry.io)", () => {
    applySentryUrlContext("https://us.sentry.io");
    expect(process.env.SENTRY_URL).toBeUndefined();
  });

  test("overrides existing SENTRY_URL (parsed URL takes precedence)", () => {
    process.env.SENTRY_URL = "https://existing.example.com";
    applySentryUrlContext("https://sentry.other.com");
    expect(process.env.SENTRY_URL).toBe("https://sentry.other.com");
  });

  test("sets SENTRY_URL for self-hosted with port", () => {
    applySentryUrlContext("https://sentry.acme.internal:9000");
    expect(process.env.SENTRY_URL).toBe("https://sentry.acme.internal:9000");
  });

  test("clears existing SENTRY_URL when SaaS URL is detected", () => {
    process.env.SENTRY_URL = "https://sentry.example.com";
    applySentryUrlContext("https://sentry.io");
    expect(process.env.SENTRY_URL).toBeUndefined();
  });

  test("clears existing SENTRY_URL when SaaS subdomain is detected", () => {
    process.env.SENTRY_URL = "https://sentry.example.com";
    applySentryUrlContext("https://us.sentry.io");
    expect(process.env.SENTRY_URL).toBeUndefined();
  });
});
