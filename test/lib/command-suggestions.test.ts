/**
 * Unit tests for the command synonym suggestion registry.
 *
 * Core invariants (case-insensitivity, lookup consistency) could be
 * property-tested, but the map is small and static — unit tests are
 * sufficient here. These verify each telemetry-driven pattern category.
 */

import { describe, expect, test } from "bun:test";
import {
  getCommandSuggestion,
  ROUTES_WITH_DEFAULT_VIEW,
} from "../../src/lib/command-suggestions.js";

describe("getCommandSuggestion", () => {
  // --- Pattern 1: issue events (most common) ---
  test("suggests issue view for 'issue/events'", () => {
    const s = getCommandSuggestion("issue", "events");
    expect(s).toBeDefined();
    expect(s!.command).toContain("issue view");
    expect(s!.explanation).toBeDefined();
  });

  // --- Pattern 2: view synonyms ---
  test("suggests issue view for 'issue/get'", () => {
    const s = getCommandSuggestion("issue", "get");
    expect(s).toBeDefined();
    expect(s!.command).toContain("issue view");
  });

  test("suggests issue view for 'issue/details'", () => {
    expect(getCommandSuggestion("issue", "details")?.command).toContain(
      "issue view"
    );
  });

  test("suggests issue view for 'issue/info'", () => {
    expect(getCommandSuggestion("issue", "info")?.command).toContain(
      "issue view"
    );
  });

  // --- Pattern 3: mutation commands ---
  test("suggests sentry api for 'issue/resolve'", () => {
    const s = getCommandSuggestion("issue", "resolve");
    expect(s).toBeDefined();
    expect(s!.command).toContain("sentry api");
    expect(s!.command).toContain("resolved");
  });

  test("suggests sentry api for 'issue/update'", () => {
    const s = getCommandSuggestion("issue", "update");
    expect(s).toBeDefined();
    expect(s!.command).toContain("sentry api");
  });

  test("suggests sentry api for 'issue/assign'", () => {
    const s = getCommandSuggestion("issue", "assign");
    expect(s).toBeDefined();
    expect(s!.command).toContain("assignedTo");
  });

  // --- Pattern 4: event list ---
  test("suggests issue view for 'event/list'", () => {
    const s = getCommandSuggestion("event", "list");
    expect(s).toBeDefined();
    expect(s!.command).toContain("issue view");
    expect(s!.explanation).toContain("scoped to issues");
  });

  // --- Pattern 5: old sentry-cli commands ---
  test("suggests auth status for 'cli/info'", () => {
    expect(getCommandSuggestion("cli", "info")?.command).toContain(
      "auth status"
    );
  });

  test("suggests issue list for 'cli/issues'", () => {
    expect(getCommandSuggestion("cli", "issues")?.command).toContain(
      "issue list"
    );
  });

  test("suggests log list for 'cli/logs'", () => {
    expect(getCommandSuggestion("cli", "logs")?.command).toContain("log list");
  });

  test("suggests api for 'cli/send-event'", () => {
    expect(getCommandSuggestion("cli", "send-event")?.command).toContain(
      "sentry api"
    );
  });

  // --- Pattern 6: dashboard synonyms ---
  test("suggests dashboard list for 'dashboard/default-overview'", () => {
    expect(
      getCommandSuggestion("dashboard", "default-overview")?.command
    ).toContain("dashboard list");
  });

  // --- Case insensitivity ---
  test("is case-insensitive on the unknown token", () => {
    expect(getCommandSuggestion("issue", "Events")).toBeDefined();
    expect(getCommandSuggestion("issue", "RESOLVE")).toBeDefined();
    expect(getCommandSuggestion("cli", "INFO")).toBeDefined();
  });

  // --- No match ---
  test("returns undefined for unrecognized token", () => {
    expect(getCommandSuggestion("issue", "foobar")).toBeUndefined();
  });

  test("returns undefined for empty route context with unknown token", () => {
    expect(getCommandSuggestion("", "foobar")).toBeUndefined();
  });

  test("returns undefined for unknown route context", () => {
    expect(getCommandSuggestion("nonexistent", "events")).toBeUndefined();
  });
});

describe("ROUTES_WITH_DEFAULT_VIEW", () => {
  test("contains all 8 route groups with defaultCommand: view", () => {
    const expected = [
      "issue",
      "event",
      "org",
      "project",
      "dashboard",
      "trace",
      "span",
      "log",
    ];
    for (const route of expected) {
      expect(ROUTES_WITH_DEFAULT_VIEW.has(route)).toBe(true);
    }
  });

  test("does not contain route groups without defaultCommand", () => {
    expect(ROUTES_WITH_DEFAULT_VIEW.has("auth")).toBe(false);
    expect(ROUTES_WITH_DEFAULT_VIEW.has("cli")).toBe(false);
    expect(ROUTES_WITH_DEFAULT_VIEW.has("sourcemap")).toBe(false);
    expect(ROUTES_WITH_DEFAULT_VIEW.has("repo")).toBe(false);
    expect(ROUTES_WITH_DEFAULT_VIEW.has("team")).toBe(false);
  });
});
