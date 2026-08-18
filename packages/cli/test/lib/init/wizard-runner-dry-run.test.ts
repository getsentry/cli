import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(
  new URL("../../../src/lib/init/wizard-runner.ts", import.meta.url)
);

/**
 * `handleFinalResult` runs post-init verification, which spawns the user's dev
 * server -- the largest side effect the wizard has. A `--dry-run` promised no
 * side effects, so `runWizard` must withhold the directory that gates it.
 *
 * The guard lives at a call site inside `runWizard`, not in the exported
 * `handleFinalResult` itself, so a behavioural test would have to drive an
 * entire wizard run (workflow client, UI, spinner) just to observe one
 * argument. This asserts on the source instead: narrower, and it fails for
 * exactly the change we care about.
 */
describe("wizard dry-run", () => {
  it("passes undefined as the verification cwd under --dry-run", async () => {
    const source = await readFile(SRC, "utf-8");
    // Drop whitespace entirely so the assertion holds however biome wraps the
    // call, and extract just the call so a failure diffs one line rather than
    // the whole file.
    const normalized = source.replace(/\s+/g, "");
    const call = normalized.match(/awaithandleFinalResult\([^)]*\)/)?.[0];
    expect(call).toBe(
      "awaithandleFinalResult(result,spin,spinState,ui,dryRun?undefined:directory,sentryProjectRef.current)"
    );
  });
});
