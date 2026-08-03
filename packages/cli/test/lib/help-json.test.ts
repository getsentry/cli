/**
 * Unit tests for {@link renderJsonHelp}, the pluggable help renderer wired into
 * Stricli's `documentation.renderHelp` hook (see `app.ts`).
 *
 * End-to-end behavior through the real `app` (routing + the patch) lives in
 * `scanner-flags.integration.test.ts`. These tests pin the pure input→output
 * contract of the renderer: which top-level-flag combinations produce JSON,
 * how the route prefix maps to introspection, and `--fields` narrowing.
 */

import { describe, expect, test } from "vitest";
import {
  renderJsonHelp,
  rewriteHelpJsonToHelpCommand,
} from "../../src/lib/help.js";

const APP = "sentry";

describe("renderJsonHelp", () => {
  test("returns undefined without --json so text help is used", () => {
    expect(renderJsonHelp([APP], [])).toBeUndefined();
    expect(renderJsonHelp([APP, "issue", "list"], [])).toBeUndefined();
  });

  test("bare app prefix + --json emits the full command tree", () => {
    const out = renderJsonHelp([APP], ["--json"]);
    expect(out).toBeDefined();
    const parsed = JSON.parse(out as string);
    expect(parsed).toHaveProperty("routes");
    expect(parsed).toHaveProperty("flags");
    expect(Array.isArray(parsed.routes)).toBe(true);
  });

  test("a command prefix + --json emits that command's metadata", () => {
    const out = renderJsonHelp([APP, "issue", "list"], ["--json"]);
    const parsed = JSON.parse(out as string);
    expect(parsed).toHaveProperty("path");
    expect(parsed.path).toContain("issue list");
  });

  test("output is pretty-printed JSON with a trailing newline", () => {
    const out = renderJsonHelp([APP, "issue", "list"], ["--json"]) as string;
    expect(out.endsWith("\n")).toBe(true);
    // Pretty-printed (2-space indent) — the wrapper uses JSON.stringify(_, null, 2).
    expect(out).toContain("\n  ");
  });

  test("--fields (spaced) narrows the JSON output", () => {
    const out = renderJsonHelp(
      [APP, "issue", "list"],
      ["--json", "--fields", "path"]
    );
    const parsed = JSON.parse(out as string);
    expect(Object.keys(parsed)).toEqual(["path"]);
  });

  test("--fields=<value> inline form narrows the JSON output", () => {
    const out = renderJsonHelp(
      [APP, "issue", "list"],
      ["--json", "--fields=path"]
    );
    const parsed = JSON.parse(out as string);
    expect(Object.keys(parsed)).toEqual(["path"]);
  });

  test("--fields accepts a comma-separated list", () => {
    const out = renderJsonHelp(
      [APP, "issue", "list"],
      ["--json", "--fields", "path,brief"]
    );
    const parsed = JSON.parse(out as string);
    expect(Object.keys(parsed).sort()).toEqual(["brief", "path"]);
  });

  test("a --json after a -- escape is ignored (wrapped command's flag)", () => {
    expect(
      renderJsonHelp([APP, "monitor", "run"], ["--", "tool", "--json"])
    ).toBeUndefined();
  });

  test("an unknown command path yields a JSON error object", () => {
    const out = renderJsonHelp([APP, "nope"], ["--json"]);
    const parsed = JSON.parse(out as string);
    expect(parsed).toHaveProperty("error");
  });

  test("an unknown token forwarded in unprocessedInputs yields a JSON error", () => {
    // `sentry issue nope --help --json`: the scanner forwards `nope` to the
    // `issue` group's default command, so it arrives in unprocessedInputs
    // rather than the prefix. It must still produce an error, not the group.
    const out = renderJsonHelp([APP, "issue"], ["nope", "--json"]);
    const parsed = JSON.parse(out as string);
    expect(parsed).toHaveProperty("error");
    expect(parsed.error).toContain("nope");
  });

  test("a top-level unknown token yields a JSON error", () => {
    const out = renderJsonHelp([APP], ["nope", "--json"]);
    const parsed = JSON.parse(out as string);
    expect(parsed).toHaveProperty("error");
  });
});

describe("rewriteHelpJsonToHelpCommand", () => {
  test("returns undefined when not a --help --json request", () => {
    expect(rewriteHelpJsonToHelpCommand(["cli", "nope"])).toBeUndefined();
    expect(
      rewriteHelpJsonToHelpCommand(["cli", "nope", "--help"])
    ).toBeUndefined();
    expect(
      rewriteHelpJsonToHelpCommand(["cli", "nope", "--json"])
    ).toBeUndefined();
  });

  test("rewrites an unknown-command --help --json to the help command", () => {
    expect(
      rewriteHelpJsonToHelpCommand(["cli", "nope", "--help", "--json"])
    ).toEqual(["help", "--json", "cli", "nope"]);
  });

  test("recognizes the -h alias and is order-insensitive", () => {
    expect(rewriteHelpJsonToHelpCommand(["--json", "cli", "-h"])).toEqual([
      "help",
      "--json",
      "cli",
    ]);
  });

  test("carries --fields through", () => {
    expect(
      rewriteHelpJsonToHelpCommand([
        "issue",
        "list",
        "--help",
        "--json",
        "--fields",
        "path",
      ])
    ).toEqual(["help", "--json", "issue", "list", "--fields", "path"]);
  });

  test("ignores --help/--json after a -- escape", () => {
    expect(
      rewriteHelpJsonToHelpCommand([
        "monitor",
        "run",
        "--",
        "tool",
        "--help",
        "--json",
      ])
    ).toBeUndefined();
  });
});
