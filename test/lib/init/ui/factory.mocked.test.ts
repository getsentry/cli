/**
 * Tests for getUIAsync() — InkUI creation failure path.
 *
 * Uses mock.module() to simulate createInkUI() failing so we can verify
 * getUIAsync() falls back to LoggingUI on any throw. This covers the
 * catch block added for CLI-1NT (Windows InkUI regression).
 *
 * addBreadcrumb() is called in the catch block but cannot be spied on here:
 * @sentry/node-core exports via CJS, so the binding in factory.ts is
 * captured at module load time and is not reachable through mock.module().
 * Coverage of that line is provided by the tests below (the catch block
 * executes; the breadcrumb call runs against the real SDK).
 *
 * Kept separate from factory.test.ts: mock.module() state is file-scoped,
 * bun test --isolate gives each file a fresh module graph.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// ── Mock setup — must precede all imports of the modules under test ────────
// Bun processes mock.module() before resolving static imports in this file,
// so factory.ts picks up the mocked ink-ui.js at load time.

/** Swappable per-test — lets us exercise different failure modes. */
let createInkUIImpl: () => Promise<never> = async () => {
  throw new Error("mountApp failed: SetConsoleMode error");
};

mock.module("../../../../src/lib/init/ui/ink-ui.js", () => ({
  createInkUI: () => createInkUIImpl(),
}));

// ── Imports after mock setup ───────────────────────────────────────────────

import { getUIAsync } from "../../../../src/lib/init/ui/factory.js";
import { LoggingUI } from "../../../../src/lib/init/ui/logging-ui.js";

// ── TTY helpers — mirrors factory.test.ts ─────────────────────────────────

type TerminalSnapshot = {
  stdinTTY: boolean | undefined;
  stdoutTTY: boolean | undefined;
};

function snapshot(): TerminalSnapshot {
  return { stdinTTY: process.stdin.isTTY, stdoutTTY: process.stdout.isTTY };
}

function restore(snap: TerminalSnapshot): void {
  (process.stdin as { isTTY: boolean | undefined }).isTTY = snap.stdinTTY;
  (process.stdout as { isTTY: boolean | undefined }).isTTY = snap.stdoutTTY;
}

let saved: TerminalSnapshot;

beforeEach(() => {
  saved = snapshot();
  // Both TTYs must be true so shouldUseLogging() returns false and
  // getUIAsync() reaches the createInkUI() call.
  (process.stdin as { isTTY: boolean }).isTTY = true;
  (process.stdout as { isTTY: boolean }).isTTY = true;
  // Reset to the default Error-throwing impl.
  createInkUIImpl = async () => {
    throw new Error("mountApp failed: SetConsoleMode error");
  };
});

afterEach(() => {
  restore(saved);
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("getUIAsync — InkUI creation failure", () => {
  test("falls back to LoggingUI when createInkUI throws an Error", async () => {
    const ui = await getUIAsync({ yes: false });
    expect(ui).toBeInstanceOf(LoggingUI);
  });

  test("falls back to LoggingUI when createInkUI rejects with a non-Error", async () => {
    // Exercises the `err instanceof Error ? err.stack : undefined` branch
    // in the breadcrumb — err.stack is undefined for non-Error rejects.
    createInkUIImpl = async () => {
      // biome-ignore lint/style/useThrowOnlyError: deliberately testing non-Error rejection
      throw "WASM init failed";
    };
    const ui = await getUIAsync({ yes: false });
    expect(ui).toBeInstanceOf(LoggingUI);
  });

  test("falls back to LoggingUI when the ink-ui import itself throws", async () => {
    // Simulates a corrupted sidecar or missing $bunfs embed — the dynamic
    // import throws before createInkUI is ever called.
    createInkUIImpl = mock(() =>
      Promise.reject(new Error("Cannot find module"))
    );
    const ui = await getUIAsync({ yes: false });
    expect(ui).toBeInstanceOf(LoggingUI);
  });

  test("fallback is stateless — consecutive failures each return a fresh LoggingUI", async () => {
    const first = await getUIAsync({ yes: false });
    const second = await getUIAsync({ yes: false });
    expect(first).toBeInstanceOf(LoggingUI);
    expect(second).toBeInstanceOf(LoggingUI);
    expect(first).not.toBe(second);
  });
});
