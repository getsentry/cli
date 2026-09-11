/**
 * Tests for `debug-files prepare` human output.
 *
 * These assert the rendered strings only. Split/stamp behaviour is covered by
 * test/lib/wasm/prepare.test.ts.
 *
 * Vitest runs without a TTY, so `isPlainOutput()` is true and color tags are
 * stripped. That makes the expected strings stable and also proves plain mode
 * emits no stray tag markup.
 */

import chalk from "chalk";
import { describe, expect, test } from "vitest";
import {
  formatPrepareModuleBlock,
  formatPrepareResult,
  lacksDwarf,
} from "../../../src/commands/debug-files/prepare.js";
import { COLORS } from "../../../src/lib/formatters/colors.js";
import type { PrepareResult } from "../../../src/lib/wasm/prepare.js";

/** Indent the formatter applies to detail lines. */
const INDENT = "    ";

/** A split module with every optional field populated. */
const splitModule: PrepareResult = {
  path: "web/assets/maze.wasm",
  action: "split",
  quality: "dwarf",
  buildId: "d5bcf04a000040008000000000000000",
  companion: "web/assets/maze.debug.wasm",
};

/** A skipped module carrying a warning. */
const skippedModule: PrepareResult = {
  path: "web/assets/maze.nosym.wasm",
  action: "skipped",
  quality: "none",
  buildId: "00000000000040008000000000000000",
  warning: "already stripped (build_id present, no debug sections)",
};

describe("formatPrepareModuleBlock", () => {
  test("renders a header plus indented details", () => {
    const block = formatPrepareModuleBlock(splitModule);

    expect(block.split("\n")).toEqual([
      "> Split web/assets/maze.wasm",
      `${INDENT}Debug quality: dwarf`,
      `${INDENT}Build ID: d5bcf04a000040008000000000000000`,
      `${INDENT}Companion: web/assets/maze.debug.wasm`,
    ]);
  });

  test("labels a skip with the legacy verb and a Warning line", () => {
    const block = formatPrepareModuleBlock(skippedModule);

    expect(block.split("\n")).toEqual([
      "> Skipping web/assets/maze.nosym.wasm",
      `${INDENT}Debug quality: none`,
      `${INDENT}Build ID: 00000000000040008000000000000000`,
      `${INDENT}Warning: already stripped (build_id present, no debug sections)`,
    ]);
  });

  test("appends a Recommendation line when one is present", () => {
    const block = formatPrepareModuleBlock({
      path: "app.wasm",
      action: "skipped",
      quality: "symtab",
      warning: "no line-level symbolication (name/symtab only)",
      recommendation: "verify build flags emit DWARF",
    });

    expect(block.split("\n").at(-1)).toBe(
      `${INDENT}Recommendation: verify build flags emit DWARF`
    );
  });

  test("colors the skip verb red in terminal output", () => {
    process.env.SENTRY_PLAIN_OUTPUT = "0";
    const level = chalk.level;
    chalk.level = 3;
    try {
      const header = formatPrepareModuleBlock(skippedModule).split("\n")[0];

      expect(header).toContain(chalk.hex(COLORS.red)("Skipping"));
    } finally {
      chalk.level = level;
      delete process.env.SENTRY_PLAIN_OUTPUT;
    }
  });

  test("uses the legacy verb for each action", () => {
    const verb = (action: PrepareResult["action"]) =>
      formatPrepareModuleBlock({ ...splitModule, action }).split("\n")[0];

    expect(verb("split")).toContain("> Split ");
    expect(verb("would-split")).toContain("> Would split ");
    expect(verb("already-prepared")).toContain("> Already prepared ");
    expect(verb("skipped")).toContain("> Skipping ");
  });

  test("prints quality in the legacy snake_case spelling", () => {
    const block = formatPrepareModuleBlock({
      ...splitModule,
      quality: "external-debug-info",
    });

    expect(block).toContain(`${INDENT}Debug quality: external_debug_info`);
  });

  test("omits Build ID and Companion when absent", () => {
    const block = formatPrepareModuleBlock({
      path: "app.wasm",
      action: "skipped",
      quality: "symtab",
    });

    expect(block.split("\n")).toEqual([
      "> Skipping app.wasm",
      `${INDENT}Debug quality: symtab`,
    ]);
  });

  test("keeps the full path, not just the basename", () => {
    const block = formatPrepareModuleBlock({
      ...splitModule,
      path: "/build/out/nested/app.wasm",
      companion: "/symbols/app.debug.wasm",
    });

    expect(block).toContain("> Split /build/out/nested/app.wasm");
    expect(block).toContain(`${INDENT}Companion: /symbols/app.debug.wasm`);
  });

  test("does not let markdown in a path alter the output", () => {
    // Underscores are emphasis markers in markdown; a real filename keeps them.
    const block = formatPrepareModuleBlock({
      ...splitModule,
      path: "build/_my_module_.wasm",
      companion: undefined,
    });

    expect(block).toContain("> Split build/_my_module_.wasm");
  });
});

describe("formatPrepareResult", () => {
  test("separates module blocks with a blank line", () => {
    const output = formatPrepareResult({
      uploaded: false,
      modules: [splitModule, skippedModule],
      filesUploaded: 0,
    });

    expect(output).toContain(
      "    Companion: web/assets/maze.debug.wasm\n\n> Skipping web/assets/maze.nosym.wasm"
    );
  });

  test("opens with the scanned count and pluralizes it", () => {
    const one = formatPrepareResult({
      uploaded: false,
      modules: [splitModule],
      filesUploaded: 0,
    });
    const two = formatPrepareResult({
      uploaded: false,
      modules: [splitModule, skippedModule],
      filesUploaded: 0,
    });

    expect(one.split("\n")[0]).toBe("> Found 1 wasm file");
    expect(two.split("\n")[0]).toBe("> Found 2 wasm files");
  });

  test("reports the upload target only after an upload", () => {
    const uploaded = formatPrepareResult({
      org: "my-org",
      project: "my-project",
      uploaded: true,
      modules: [splitModule],
      filesUploaded: 1,
    });

    expect(uploaded).toContain("> Uploaded 1 companion to my-org/my-project");
  });

  test("omits the upload line when nothing was uploaded", () => {
    const output = formatPrepareResult({
      uploaded: false,
      modules: [splitModule],
      filesUploaded: 0,
    });

    expect(output).not.toContain("Uploaded");
  });

  test("renders a summary alone when no modules were found", () => {
    const output = formatPrepareResult({
      uploaded: false,
      modules: [],
      filesUploaded: 0,
    });

    expect(output).toBe("> Found 0 wasm files");
  });

  test("leaves no color tag markup in plain mode", () => {
    const output = formatPrepareResult({
      org: "my-org",
      project: "my-project",
      uploaded: true,
      modules: [splitModule, skippedModule],
      filesUploaded: 1,
    });

    expect(output).not.toMatch(/<\/?(muted|yellow)>/);
  });
});

describe("lacksDwarf", () => {
  const skipped = (quality: PrepareResult["quality"]): PrepareResult => ({
    path: "app.wasm",
    action: "skipped",
    quality,
  });

  test("fails a dangling external_debug_info pointer", () => {
    // The companion could not be resolved — a resolved one would have been
    // reported as already-prepared — so nothing reachable was uploaded.
    expect(lacksDwarf(skipped("external-debug-info"))).toBe(true);
  });

  test("fails a module with no usable debug info", () => {
    expect(lacksDwarf(skipped("symtab"))).toBe(true);
    expect(lacksDwarf(skipped("none"))).toBe(true);
  });

  test("passes a companion named directly on the command line", () => {
    expect(lacksDwarf(skipped("dwarf"))).toBe(false);
  });

  test("passes every module that produced a debug file", () => {
    expect(lacksDwarf(splitModule)).toBe(false);
    expect(lacksDwarf({ ...splitModule, action: "already-prepared" })).toBe(
      false
    );
    expect(lacksDwarf({ ...splitModule, action: "would-split" })).toBe(false);
  });
});
