/**
 * Event View Command Tests
 *
 * Tests for positional argument parsing in src/commands/event/view.ts
 */

import { describe, expect, test } from "bun:test";
import { parsePositionalArgs } from "../../../src/commands/event/view.js";
import { ContextError } from "../../../src/lib/errors.js";

describe("parsePositionalArgs", () => {
  describe("single argument (event ID only)", () => {
    test("parses single arg as event ID", () => {
      const result = parsePositionalArgs(["abc123def456"]);
      expect(result.eventId).toBe("abc123def456");
      expect(result.targetArg).toBeUndefined();
    });

    test("parses UUID-like event ID", () => {
      const result = parsePositionalArgs([
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      ]);
      expect(result.eventId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      expect(result.targetArg).toBeUndefined();
    });

    test("parses short event ID", () => {
      const result = parsePositionalArgs(["abc"]);
      expect(result.eventId).toBe("abc");
      expect(result.targetArg).toBeUndefined();
    });
  });

  describe("two arguments (target + event ID)", () => {
    test("parses org/project target and event ID", () => {
      const result = parsePositionalArgs(["my-org/frontend", "abc123def456"]);
      expect(result.targetArg).toBe("my-org/frontend");
      expect(result.eventId).toBe("abc123def456");
    });

    test("parses project-only target and event ID", () => {
      const result = parsePositionalArgs(["frontend", "abc123def456"]);
      expect(result.targetArg).toBe("frontend");
      expect(result.eventId).toBe("abc123def456");
    });

    test("parses org/ target (all projects) and event ID", () => {
      const result = parsePositionalArgs(["my-org/", "abc123def456"]);
      expect(result.targetArg).toBe("my-org/");
      expect(result.eventId).toBe("abc123def456");
    });
  });

  describe("error cases", () => {
    test("throws ContextError for empty args", () => {
      expect(() => parsePositionalArgs([])).toThrow(ContextError);
    });

    test("throws ContextError with usage hint", () => {
      try {
        parsePositionalArgs([]);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        expect((error as ContextError).message).toContain("Event ID");
      }
    });
  });

  describe("edge cases", () => {
    test("handles more than two args (ignores extras)", () => {
      const result = parsePositionalArgs([
        "my-org/frontend",
        "abc123",
        "extra-arg",
      ]);
      expect(result.targetArg).toBe("my-org/frontend");
      expect(result.eventId).toBe("abc123");
    });

    test("handles empty string event ID in two-arg case", () => {
      const result = parsePositionalArgs(["my-org/frontend", ""]);
      expect(result.targetArg).toBe("my-org/frontend");
      expect(result.eventId).toBe("");
    });
  });
});
