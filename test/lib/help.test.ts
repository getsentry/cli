/**
 * Help Output Tests
 *
 * Tests for the branded CLI help output including the ASCII banner,
 * command generation from routes, and contextual examples.
 */

import { describe, expect, test } from "bun:test";
import { formatBanner } from "../../src/lib/banner.js";
import { printCustomHelp } from "../../src/lib/help.js";
import { useTestConfigDir } from "../helpers.js";

/** Strip ANSI escape sequences for content assertions */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes use control chars by definition
const ANSI_RE = /\u001B\[[0-9;]*m/g;
function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "");
}

describe("formatBanner", () => {
  test("returns 6 rows matching the SENTRY ASCII art", () => {
    const banner = formatBanner();
    const rows = banner.split("\n");
    expect(rows).toHaveLength(6);
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
    const output = await printCustomHelp();
    expect(output.length).toBeGreaterThan(0);
  });

  test("output contains the tagline", async () => {
    const output = stripAnsi(await printCustomHelp());
    expect(output).toContain("The command-line interface for Sentry");
  });

  test("output contains registered commands", async () => {
    const output = stripAnsi(await printCustomHelp());

    // Should include at least some core commands from routes
    expect(output).toContain("sentry");
    // Route map command (exercises isRouteMap branch)
    expect(output).toContain("auth");
    // Direct command with tuple positional (exercises isCommand + getPositionalPlaceholder)
    expect(output).toContain("init");
  });

  test("output contains docs URL", async () => {
    const output = stripAnsi(await printCustomHelp());
    expect(output).toContain("cli.sentry.dev");
  });

  test("shows login example when not authenticated", async () => {
    // useTestConfigDir provides a clean env with no auth token
    const output = stripAnsi(await printCustomHelp());
    expect(output).toContain("sentry auth login");
  });
});
