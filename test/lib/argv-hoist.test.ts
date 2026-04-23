/**
 * Unit tests for {@link hoistGlobalFlags}.
 *
 * Core invariants (token conservation, order preservation, idempotency) are
 * tested via property-based tests in argv-hoist.property.test.ts. These tests
 * focus on specific scenarios and edge cases.
 */

import { describe, expect, test } from "bun:test";
import { hoistGlobalFlags } from "../../src/lib/argv-hoist.js";

describe("hoistGlobalFlags", () => {
  // -------------------------------------------------------------------------
  // Passthrough (no hoistable flags)
  // -------------------------------------------------------------------------

  test("returns empty array for empty input", () => {
    expect(hoistGlobalFlags([])).toEqual([]);
  });

  test("returns argv unchanged when no global flags present", () => {
    expect(hoistGlobalFlags(["issue", "list", "--limit", "25"])).toEqual([
      "issue",
      "list",
      "--limit",
      "25",
    ]);
  });

  test("does not hoist unknown flags", () => {
    expect(hoistGlobalFlags(["--limit", "25", "issue", "list"])).toEqual([
      "--limit",
      "25",
      "issue",
      "list",
    ]);
  });

  // -------------------------------------------------------------------------
  // Boolean flag hoisting: --verbose
  // -------------------------------------------------------------------------

  test("hoists --verbose from before subcommand", () => {
    expect(hoistGlobalFlags(["--verbose", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--verbose",
    ]);
  });

  test("hoists --verbose from middle position", () => {
    expect(hoistGlobalFlags(["cli", "--verbose", "upgrade"])).toEqual([
      "cli",
      "upgrade",
      "--verbose",
    ]);
  });

  test("flag already at end stays at end", () => {
    expect(hoistGlobalFlags(["issue", "list", "--verbose"])).toEqual([
      "issue",
      "list",
      "--verbose",
    ]);
  });

  // -------------------------------------------------------------------------
  // Short alias: -v
  // -------------------------------------------------------------------------

  test("hoists -v from before subcommand", () => {
    expect(hoistGlobalFlags(["-v", "issue", "list"])).toEqual([
      "issue",
      "list",
      "-v",
    ]);
  });

  test("hoists -v from middle position", () => {
    expect(hoistGlobalFlags(["cli", "-v", "upgrade"])).toEqual([
      "cli",
      "upgrade",
      "-v",
    ]);
  });

  test("does not hoist unknown short flags", () => {
    expect(hoistGlobalFlags(["-x", "issue", "list"])).toEqual([
      "-x",
      "issue",
      "list",
    ]);
  });

  // -------------------------------------------------------------------------
  // Negation: --no-verbose, --no-json
  // -------------------------------------------------------------------------

  test("hoists --no-verbose", () => {
    expect(hoistGlobalFlags(["--no-verbose", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--no-verbose",
    ]);
  });

  test("hoists --no-json", () => {
    expect(hoistGlobalFlags(["--no-json", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--no-json",
    ]);
  });

  test("does not hoist --no-log-level (not negatable)", () => {
    expect(hoistGlobalFlags(["--no-log-level", "issue", "list"])).toEqual([
      "--no-log-level",
      "issue",
      "list",
    ]);
  });

  // -------------------------------------------------------------------------
  // Boolean flag: --json
  // -------------------------------------------------------------------------

  test("hoists --json from before subcommand", () => {
    expect(hoistGlobalFlags(["--json", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--json",
    ]);
  });

  // -------------------------------------------------------------------------
  // Value flag: --log-level (separate value)
  // -------------------------------------------------------------------------

  test("hoists --log-level with separate value", () => {
    expect(hoistGlobalFlags(["--log-level", "debug", "issue", "list"])).toEqual(
      ["issue", "list", "--log-level", "debug"]
    );
  });

  test("hoists --log-level=debug as single token", () => {
    expect(hoistGlobalFlags(["--log-level=debug", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--log-level=debug",
    ]);
  });

  test("hoists --log-level at end with no value", () => {
    expect(hoistGlobalFlags(["issue", "list", "--log-level"])).toEqual([
      "issue",
      "list",
      "--log-level",
    ]);
  });

  // -------------------------------------------------------------------------
  // Value flag: --fields
  // -------------------------------------------------------------------------

  test("hoists --fields with separate value", () => {
    expect(hoistGlobalFlags(["--fields", "id,title", "issue", "list"])).toEqual(
      ["issue", "list", "--fields", "id,title"]
    );
  });

  test("hoists --fields=id,title as single token", () => {
    expect(hoistGlobalFlags(["--fields=id,title", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--fields=id,title",
    ]);
  });

  // -------------------------------------------------------------------------
  // Multiple flags
  // -------------------------------------------------------------------------

  test("hoists multiple global flags preserving relative order", () => {
    expect(hoistGlobalFlags(["--verbose", "--json", "issue", "list"])).toEqual([
      "issue",
      "list",
      "--verbose",
      "--json",
    ]);
  });

  test("hoists flags from mixed positions", () => {
    expect(
      hoistGlobalFlags([
        "--verbose",
        "issue",
        "--json",
        "list",
        "--fields",
        "id",
      ])
    ).toEqual(["issue", "list", "--verbose", "--json", "--fields", "id"]);
  });

  // -------------------------------------------------------------------------
  // Repeated flags
  // -------------------------------------------------------------------------

  test("hoists duplicate --verbose flags", () => {
    expect(
      hoistGlobalFlags(["--verbose", "issue", "--verbose", "list"])
    ).toEqual(["issue", "list", "--verbose", "--verbose"]);
  });

  // -------------------------------------------------------------------------
  // -- separator
  // -------------------------------------------------------------------------

  test("does not hoist flags after -- separator", () => {
    expect(hoistGlobalFlags(["issue", "--", "--verbose", "list"])).toEqual([
      "issue",
      "--",
      "--verbose",
      "list",
    ]);
  });

  test("hoists flags before -- and places them before the separator", () => {
    expect(hoistGlobalFlags(["--verbose", "issue", "--", "--json"])).toEqual([
      "issue",
      "--verbose",
      "--",
      "--json",
    ]);
  });

  test("hoisted flags appear before -- not after it", () => {
    expect(
      hoistGlobalFlags(["--verbose", "issue", "--", "positional-arg"])
    ).toEqual(["issue", "--verbose", "--", "positional-arg"]);
  });

  // -------------------------------------------------------------------------
  // Real-world scenarios
  // -------------------------------------------------------------------------

  test("hoists from root level for deeply nested commands", () => {
    expect(hoistGlobalFlags(["--verbose", "--json", "cli", "upgrade"])).toEqual(
      ["cli", "upgrade", "--verbose", "--json"]
    );
  });

  test("hoists --verbose for api command", () => {
    expect(hoistGlobalFlags(["--verbose", "api", "/endpoint"])).toEqual([
      "api",
      "/endpoint",
      "--verbose",
    ]);
  });

  test("hoists -v with log-level from root", () => {
    expect(
      hoistGlobalFlags(["-v", "--log-level", "debug", "cli", "upgrade"])
    ).toEqual(["cli", "upgrade", "-v", "--log-level", "debug"]);
  });

  test("preserves non-global flags in original position", () => {
    expect(
      hoistGlobalFlags([
        "--verbose",
        "issue",
        "list",
        "my-org/",
        "--limit",
        "25",
        "--sort",
        "date",
      ])
    ).toEqual([
      "issue",
      "list",
      "my-org/",
      "--limit",
      "25",
      "--sort",
      "date",
      "--verbose",
    ]);
  });
});
