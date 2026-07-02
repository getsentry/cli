/**
 * Help Output Tests
 *
 * Tests for the branded CLI help output including the ASCII banner,
 * command generation from routes, and contextual examples.
 */

import { describe, expect, test } from "vitest";
import { formatBanner } from "../../src/lib/banner.js";
import { introspectAllCommands, printCustomHelp } from "../../src/lib/help.js";
import { useTestConfigDir } from "../helpers.js";

/** Strip ANSI escape sequences for content assertions */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes use control chars by definition
const ANSI_RE = /\u001B\[[0-9;]*m/g;
function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "");
}

describe("formatBanner", () => {
  test("returns 8 rows matching the SENTRY ASCII art", () => {
    const banner = formatBanner();
    const rows = banner.split("\n");
    expect(rows).toHaveLength(8);
  });

  test("contains the SENTRY block characters", () => {
    const banner = stripAnsi(formatBanner());
    // The ASCII art spells out SENTRY using box-drawing chars
    expect(banner).toContain("███████");
  });

  test("is deterministic across calls", () => {
    expect(formatBanner()).toBe(formatBanner());
  });
});

describe("printCustomHelp", () => {
  useTestConfigDir("help-test-");

  test("returns non-empty string", async () => {
    const output = printCustomHelp();
    expect(output.length).toBeGreaterThan(0);
  });

  test("output contains the tagline", async () => {
    const output = stripAnsi(printCustomHelp());
    expect(output).toContain("The command-line interface for Sentry");
  });

  test("output contains registered commands", async () => {
    const output = stripAnsi(printCustomHelp());

    // Should include at least some core commands from routes
    expect(output).toContain("sentry");
    // Route map command (exercises isRouteMap branch)
    expect(output).toContain("auth");
    // Direct command with tuple positional (exercises isCommand + getPositionalPlaceholder)
    expect(output).toContain("init");
  });

  test("output contains docs URL", async () => {
    const output = stripAnsi(printCustomHelp());
    expect(output).toContain("cli.sentry.dev");
  });

  test("shows login example when not authenticated", async () => {
    // useTestConfigDir provides a clean env with no auth token
    const output = stripAnsi(printCustomHelp());
    expect(output).toContain("sentry auth login");
  });

  test("includes an Environment Variables section with top-level vars", () => {
    const output = stripAnsi(printCustomHelp());
    expect(output).toContain("Environment Variables:");
    // Highest-signal vars from the feedback issue must be surfaced.
    expect(output).toContain("SENTRY_AUTH_TOKEN");
    expect(output).toContain("SENTRY_FORCE_ENV_TOKEN");
    expect(output).toContain("SENTRY_ORG");
    expect(output).toContain("SENTRY_PROJECT");
    expect(output).toContain("SENTRY_DSN");
    expect(output).toContain("SENTRY_HOST");
    expect(output).toContain("SENTRY_LOG_LEVEL");
    expect(output).toContain("NO_COLOR");
  });

  test("includes a Flags section with common flags", () => {
    const output = stripAnsi(printCustomHelp());
    expect(output).toContain("Flags:");
    expect(output).toContain("--json");
    expect(output).toContain("--fresh");
    expect(output).toContain("-f");
    expect(output).toContain("--verbose");
    expect(output).toContain("-v");
    expect(output).toContain("--help");
    expect(output).toContain("--version");
  });

  test("Flags section appears before Environment Variables section", () => {
    const output = stripAnsi(printCustomHelp());
    const flagsIndex = output.indexOf("Flags:");
    const envVarsIndex = output.indexOf("Environment Variables:");
    expect(flagsIndex).toBeGreaterThan(-1);
    expect(envVarsIndex).toBeGreaterThan(-1);
    expect(flagsIndex).toBeLessThan(envVarsIndex);
  });
});

describe("introspectAllCommands", () => {
  useTestConfigDir("help-introspect-");

  test("includes an envVars array with the top-level env vars", () => {
    const result = introspectAllCommands();
    expect(Array.isArray(result.envVars)).toBe(true);
    const names = result.envVars.map((v) => v.name);
    expect(names).toContain("SENTRY_AUTH_TOKEN");
    expect(names).toContain("SENTRY_FORCE_ENV_TOKEN");
    expect(names).toContain("SENTRY_ORG");
    expect(names).toContain("SENTRY_PROJECT");
    expect(names).toContain("SENTRY_DSN");
    expect(names).toContain("SENTRY_HOST");
    expect(names).toContain("SENTRY_LOG_LEVEL");
    expect(names).toContain("NO_COLOR");
  });

  test("each envVars entry has a brief and description", () => {
    const { envVars } = introspectAllCommands();
    for (const v of envVars) {
      expect(typeof v.name).toBe("string");
      expect(v.name.length).toBeGreaterThan(0);
      expect(typeof v.brief).toBe("string");
      expect(v.brief.length).toBeGreaterThan(0);
      expect(typeof v.description).toBe("string");
      expect(v.description.length).toBeGreaterThan(0);
    }
  });

  test("includes a flags array with common flags", () => {
    const result = introspectAllCommands();
    expect(Array.isArray(result.flags)).toBe(true);
    const longs = result.flags.map((f) => f.long);
    expect(longs).toContain("--json");
    expect(longs).toContain("--fresh");
    expect(longs).toContain("--verbose");
    expect(longs).toContain("--help");
    expect(longs).toContain("--version");
  });

  test("each flags entry has long and description", () => {
    const { flags } = introspectAllCommands();
    for (const f of flags) {
      expect(typeof f.long).toBe("string");
      expect(f.long.startsWith("--")).toBe(true);
      expect(typeof f.description).toBe("string");
      expect(f.description.length).toBeGreaterThan(0);
    }
  });

  test("flags with short aliases have the correct format", () => {
    const { flags } = introspectAllCommands();
    const fresh = flags.find((f) => f.long === "--fresh");
    expect(fresh).toBeDefined();
    expect(fresh?.short).toBe("-f");
    const verbose = flags.find((f) => f.long === "--verbose");
    expect(verbose).toBeDefined();
    expect(verbose?.short).toBe("-v");
  });
});
