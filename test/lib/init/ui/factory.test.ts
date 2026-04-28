/**
 * Tests for getUI() — verifies the runtime-detection rules pick the
 * right WizardUI implementation.
 *
 * The factory's selection logic depends on three signals:
 *   - `SENTRY_INIT_TUI` env var
 *   - `--yes` flag (passed in via opts)
 *   - stdin/stdout TTY state
 *
 * We patch the env and `process.stdin.isTTY` / `process.stdout.isTTY`
 * around each test so the assertions are deterministic.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ClackUI } from "../../../../src/lib/init/ui/clack-ui.js";
import {
  getUI,
  isInteractiveTerminal,
} from "../../../../src/lib/init/ui/factory.js";
import { LoggingUI } from "../../../../src/lib/init/ui/logging-ui.js";

/**
 * Snapshot of the process state we mutate per test. Restored in
 * afterEach so the test runner's own TTY/env is left untouched.
 */
type TerminalSnapshot = {
  stdinTTY: boolean | undefined;
  stdoutTTY: boolean | undefined;
  envValue: string | undefined;
};

const ENV_KEY = "SENTRY_INIT_TUI";

function snapshot(): TerminalSnapshot {
  return {
    stdinTTY: process.stdin.isTTY,
    stdoutTTY: process.stdout.isTTY,
    envValue: process.env[ENV_KEY],
  };
}

function restore(snap: TerminalSnapshot): void {
  // Direct property writes match how Node exposes these flags.
  (process.stdin as { isTTY: boolean | undefined }).isTTY = snap.stdinTTY;
  (process.stdout as { isTTY: boolean | undefined }).isTTY = snap.stdoutTTY;
  if (snap.envValue === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = snap.envValue;
  }
}

function setInteractive(interactive: boolean): void {
  (process.stdin as { isTTY: boolean }).isTTY = interactive;
  (process.stdout as { isTTY: boolean }).isTTY = interactive;
}

let saved: TerminalSnapshot;

beforeEach(() => {
  saved = snapshot();
  delete process.env[ENV_KEY];
});

afterEach(() => {
  restore(saved);
});

describe("isInteractiveTerminal", () => {
  test("returns true when both stdin and stdout are TTYs", () => {
    setInteractive(true);
    expect(isInteractiveTerminal()).toBe(true);
  });

  test("returns false when stdin is not a TTY", () => {
    (process.stdin as { isTTY: boolean }).isTTY = false;
    (process.stdout as { isTTY: boolean }).isTTY = true;
    expect(isInteractiveTerminal()).toBe(false);
  });

  test("returns false when stdout is not a TTY", () => {
    (process.stdin as { isTTY: boolean }).isTTY = true;
    (process.stdout as { isTTY: boolean }).isTTY = false;
    expect(isInteractiveTerminal()).toBe(false);
  });
});

describe("getUI selection", () => {
  test("returns LoggingUI when --yes is set, even on a TTY", () => {
    setInteractive(true);
    const ui = getUI({ yes: true });
    expect(ui).toBeInstanceOf(LoggingUI);
  });

  test("returns LoggingUI when stdin is not a TTY", () => {
    (process.stdin as { isTTY: boolean }).isTTY = false;
    (process.stdout as { isTTY: boolean }).isTTY = true;
    const ui = getUI({ yes: false });
    expect(ui).toBeInstanceOf(LoggingUI);
  });

  test("returns LoggingUI when stdout is not a TTY", () => {
    (process.stdin as { isTTY: boolean }).isTTY = true;
    (process.stdout as { isTTY: boolean }).isTTY = false;
    const ui = getUI({ yes: false });
    expect(ui).toBeInstanceOf(LoggingUI);
  });

  test("returns LoggingUI when SENTRY_INIT_TUI=0 even on interactive TTY", () => {
    setInteractive(true);
    process.env[ENV_KEY] = "0";
    const ui = getUI({ yes: false });
    expect(ui).toBeInstanceOf(LoggingUI);
  });

  test("returns ClackUI on interactive TTY without --yes", () => {
    setInteractive(true);
    const ui = getUI({ yes: false });
    expect(ui).toBeInstanceOf(ClackUI);
  });

  test("returns ClackUI when forceLegacy is set on interactive TTY", () => {
    setInteractive(true);
    const ui = getUI({ yes: false, forceLegacy: true });
    expect(ui).toBeInstanceOf(ClackUI);
  });

  test("forceLegacy does not override the non-interactive guard", () => {
    // Even with forceLegacy, a non-TTY context must use LoggingUI —
    // ClackUI would attempt to read stdin and hang.
    (process.stdin as { isTTY: boolean }).isTTY = false;
    (process.stdout as { isTTY: boolean }).isTTY = false;
    const ui = getUI({ yes: false, forceLegacy: true });
    expect(ui).toBeInstanceOf(LoggingUI);
  });
});
