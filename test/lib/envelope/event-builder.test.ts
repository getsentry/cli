/**
 * Tests for buildEventFromFlags — converts CLI flags to a Sentry Event.
 *
 * Note: Core invariants (tag/extra parsing, user field routing) are property-
 * tested below. Unit tests here focus on specific edge cases and output shape.
 */

import { describe, expect, test } from "vitest";
import type { SendEventFlags } from "../../../src/lib/envelope/event-builder.js";
import {
  buildEventFromFlags,
  parseKeyValue,
  parseUserFields,
} from "../../../src/lib/envelope/event-builder.js";
import { ValidationError } from "../../../src/lib/errors.js";

// ── parseKeyValue ──────────────────────────────────────────────────

describe("parseKeyValue", () => {
  test("splits on first colon", () => {
    expect(parseKeyValue("key:value")).toEqual(["key", "value"]);
  });

  test("value may contain colons", () => {
    expect(parseKeyValue("url:https://example.com")).toEqual([
      "url",
      "https://example.com",
    ]);
  });

  test("no colon → throws ValidationError", () => {
    expect(() => parseKeyValue("nocohere")).toThrow(ValidationError);
  });

  test("empty key → throws ValidationError", () => {
    expect(() => parseKeyValue(":value")).toThrow(ValidationError);
  });
});

// ── parseUserFields ───────────────────────────────────────────────

describe("parseUserFields", () => {
  test("id maps to user.id", () => {
    expect(parseUserFields(["id:42"])).toMatchObject({ id: "42" });
  });

  test("email maps to user.email", () => {
    expect(parseUserFields(["email:alice@example.com"])).toMatchObject({
      email: "alice@example.com",
    });
  });

  test("ip_address maps to user.ip_address", () => {
    expect(parseUserFields(["ip_address:1.2.3.4"])).toMatchObject({
      ip_address: "1.2.3.4",
    });
  });

  test("username maps to user.username", () => {
    expect(parseUserFields(["username:alice"])).toMatchObject({
      username: "alice",
    });
  });

  test("unknown keys go into user.data", () => {
    expect(parseUserFields(["role:admin"])).toMatchObject({
      data: { role: "admin" },
    });
  });

  test("multiple pairs merged", () => {
    const result = parseUserFields(["id:1", "email:a@b.com", "role:admin"]);
    expect(result).toMatchObject({
      id: "1",
      email: "a@b.com",
      data: { role: "admin" },
    });
  });
});

// ── buildEventFromFlags ───────────────────────────────────────────

describe("buildEventFromFlags", () => {
  function flags(overrides: Partial<SendEventFlags> = {}): SendEventFlags {
    return { "no-environ": true, ...overrides };
  }

  test("defaults: level=error, platform=other", () => {
    const event = buildEventFromFlags(flags());
    expect(event.level).toBe("error");
    expect(event.platform).toBe("other");
  });

  test("event_id is always a 32-char hex string", () => {
    const event = buildEventFromFlags(flags());
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
  });

  test("timestamp is a Unix float", () => {
    const event = buildEventFromFlags(flags());
    expect(typeof event.timestamp).toBe("number");
    expect(event.timestamp).toBeGreaterThan(0);
  });

  test("--level sets level", () => {
    expect(buildEventFromFlags(flags({ level: "warning" })).level).toBe(
      "warning"
    );
  });

  test("--message joined with newline", () => {
    const event = buildEventFromFlags(flags({ message: ["hello", "world"] }));
    expect(event.logentry?.message).toBe("hello\nworld");
  });

  test("--message-arg sets params", () => {
    const event = buildEventFromFlags(
      flags({ message: ["hello %s"], "message-arg": ["world"] })
    );
    expect(event.logentry?.params).toEqual(["world"]);
  });

  test("--tag parses into tags object", () => {
    const event = buildEventFromFlags(flags({ tag: ["env:prod", "ver:1.0"] }));
    expect(event.tags).toEqual({ env: "prod", ver: "1.0" });
  });

  test("--extra parses into extra object", () => {
    const event = buildEventFromFlags(flags({ extra: ["foo:bar"] }));
    expect((event.extra as Record<string, string>).foo).toBe("bar");
  });

  test("--no-environ omits process.env from extra", () => {
    const event = buildEventFromFlags(flags({ "no-environ": true }));
    expect((event.extra as Record<string, unknown>)?.environ).toBeUndefined();
  });

  test("environ included when --no-environ not set", () => {
    const event = buildEventFromFlags(flags({ "no-environ": false }));
    expect((event.extra as Record<string, unknown>)?.environ).toBeDefined();
  });

  test("--user routes known fields correctly", () => {
    const event = buildEventFromFlags(
      flags({ user: ["id:99", "email:a@b.com"] })
    );
    expect(event.user?.id).toBe("99");
    expect(event.user?.email).toBe("a@b.com");
  });

  test("--fingerprint sets fingerprint array", () => {
    const event = buildEventFromFlags(
      flags({ fingerprint: ["my-error", "{{ default }}"] })
    );
    expect(event.fingerprint).toEqual(["my-error", "{{ default }}"]);
  });

  test("--release sets release", () => {
    expect(buildEventFromFlags(flags({ release: "1.2.3" })).release).toBe(
      "1.2.3"
    );
  });

  test("--env sets environment", () => {
    expect(buildEventFromFlags(flags({ env: "staging" })).environment).toBe(
      "staging"
    );
  });

  test("--platform sets platform", () => {
    expect(buildEventFromFlags(flags({ platform: "python" })).platform).toBe(
      "python"
    );
  });

  test("--dist sets dist", () => {
    expect(buildEventFromFlags(flags({ dist: "x86" })).dist).toBe("x86");
  });

  test("each call produces a unique event_id", () => {
    const a = buildEventFromFlags(flags());
    const b = buildEventFromFlags(flags());
    expect(a.event_id).not.toBe(b.event_id);
  });
});
