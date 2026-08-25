/**
 * Regression guard for the npm bundle after the Bun → Node migration.
 *
 * Bun was fully removed from the CLI, so the old `script/node-polyfills.ts`
 * shim and its esbuild `inject` entries are dead weight. These tests keep
 * them from creeping back:
 * - the polyfill script must not exist,
 * - `bundle.ts` must not inject it into either the CJS or ESM build,
 * - `src/` must not gain an unbound `Bun` value reference that would need
 *   the polyfill to resolve (comments mentioning Bun are fine).
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = new URL("../../", import.meta.url);
const resolve = (rel: string) => fileURLToPath(new URL(rel, root));

describe("npm bundle has no leftover Bun polyfills", () => {
  test("the node-polyfills script is gone", () => {
    expect(existsSync(resolve("script/node-polyfills.ts"))).toBe(false);
  });

  test("bundle.ts does not inject node-polyfills", async () => {
    const src = await readFile(resolve("script/bundle.ts"), "utf-8");
    expect(src).not.toContain("node-polyfills");
  });

  test("src has no unbound Bun value references", () => {
    // Grep the source for a `Bun.` member access that is NOT inside a line
    // comment. Comments referencing Bun (historical context) are allowed;
    // an actual `Bun.foo` call would need the removed polyfill to resolve.
    const cliRoot = resolve(".");
    let matches = "";
    try {
      matches = execSync(
        String.raw`grep -rnE '\bBun\.' src --include='*.ts' --include='*.js'`,
        { cwd: cliRoot, encoding: "utf-8" }
      );
    } catch {
      // grep exits 1 when there are no matches at all — that's the pass case.
      matches = "";
    }

    const codeHits = matches
      .split("\n")
      .filter((line) => line.trim() !== "")
      .filter((line) => {
        // Drop the `file:line:` prefix, then check the code content.
        const content = line.replace(/^[^:]+:\d+:/, "").trim();
        return !(content.startsWith("*") || content.startsWith("//"));
      });

    expect(codeHits).toEqual([]);
  });
});
