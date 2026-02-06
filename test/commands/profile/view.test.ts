/**
 * Profile View Command Tests
 *
 * Tests for positional argument parsing in src/commands/profile/view.ts
 */

import { describe, expect, test } from "bun:test";
import { parsePositionalArgs } from "../../../src/commands/profile/view.js";
import { ContextError } from "../../../src/lib/errors.js";

describe("parsePositionalArgs", () => {
  describe("single argument (transaction only)", () => {
    test("parses single arg as transaction name", () => {
      const result = parsePositionalArgs(["/api/users"]);
      expect(result.transactionRef).toBe("/api/users");
      expect(result.targetArg).toBeUndefined();
    });

    test("parses transaction index", () => {
      const result = parsePositionalArgs(["1"]);
      expect(result.transactionRef).toBe("1");
      expect(result.targetArg).toBeUndefined();
    });

    test("parses transaction alias", () => {
      const result = parsePositionalArgs(["a"]);
      expect(result.transactionRef).toBe("a");
      expect(result.targetArg).toBeUndefined();
    });

    test("parses complex transaction name", () => {
      const result = parsePositionalArgs(["POST /api/v2/users/:id/settings"]);
      expect(result.transactionRef).toBe("POST /api/v2/users/:id/settings");
      expect(result.targetArg).toBeUndefined();
    });
  });

  describe("two arguments (target + transaction)", () => {
    test("parses org/project target and transaction name", () => {
      const result = parsePositionalArgs(["my-org/backend", "/api/users"]);
      expect(result.targetArg).toBe("my-org/backend");
      expect(result.transactionRef).toBe("/api/users");
    });

    test("parses project-only target and transaction", () => {
      const result = parsePositionalArgs(["backend", "/api/users"]);
      expect(result.targetArg).toBe("backend");
      expect(result.transactionRef).toBe("/api/users");
    });

    test("parses org/ target (all projects) and transaction", () => {
      const result = parsePositionalArgs(["my-org/", "/api/users"]);
      expect(result.targetArg).toBe("my-org/");
      expect(result.transactionRef).toBe("/api/users");
    });

    test("parses target and transaction index", () => {
      const result = parsePositionalArgs(["my-org/backend", "1"]);
      expect(result.targetArg).toBe("my-org/backend");
      expect(result.transactionRef).toBe("1");
    });

    test("parses target and transaction alias", () => {
      const result = parsePositionalArgs(["my-org/backend", "a"]);
      expect(result.targetArg).toBe("my-org/backend");
      expect(result.transactionRef).toBe("a");
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
        expect((error as ContextError).message).toContain("Transaction");
      }
    });
  });

  describe("edge cases", () => {
    test("handles more than two args (ignores extras)", () => {
      const result = parsePositionalArgs([
        "my-org/backend",
        "/api/users",
        "extra-arg",
      ]);
      expect(result.targetArg).toBe("my-org/backend");
      expect(result.transactionRef).toBe("/api/users");
    });

    test("handles empty string transaction in two-arg case", () => {
      const result = parsePositionalArgs(["my-org/backend", ""]);
      expect(result.targetArg).toBe("my-org/backend");
      expect(result.transactionRef).toBe("");
    });
  });
});
