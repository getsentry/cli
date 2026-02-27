/**
 * Isolated tests for init wizard interactive prompts.
 *
 * Uses mock.module() to stub @clack/prompts — kept isolated so the
 * module-level mock does not leak into other test files.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WizardOptions } from "../../src/lib/init/types.js";

// Controllable mock implementations — reset per test via beforeEach
let selectImpl: ReturnType<typeof mock>;
let multiselectImpl: ReturnType<typeof mock>;
let confirmImpl: ReturnType<typeof mock>;
const logMock = { info: mock(), error: mock(), warn: mock() };
const cancelMock = mock();

mock.module("@clack/prompts", () => ({
  select: (...args: unknown[]) => selectImpl(...args),
  multiselect: (...args: unknown[]) => multiselectImpl(...args),
  confirm: (...args: unknown[]) => confirmImpl(...args),
  log: logMock,
  cancel: (...args: unknown[]) => cancelMock(...args),
  isCancel: (v: unknown) => v === Symbol.for("cancel"),
  note: mock(),
  outro: mock(),
  intro: mock(),
  spinner: () => ({ start: mock(), stop: mock(), message: mock() }),
}));

const { handleInteractive } = await import("../../src/lib/init/interactive.js");

function makeOptions(overrides?: Partial<WizardOptions>): WizardOptions {
  return {
    directory: "/tmp/test",
    force: false,
    yes: false,
    dryRun: false,
    stdout: { write: () => true },
    stderr: { write: () => true },
    stdin: process.stdin,
    ...overrides,
  };
}

beforeEach(() => {
  selectImpl = mock(() => Promise.resolve("default"));
  multiselectImpl = mock(() => Promise.resolve([]));
  confirmImpl = mock(() => Promise.resolve(true));
  logMock.info.mockClear();
  logMock.error.mockClear();
  logMock.warn.mockClear();
  cancelMock.mockClear();
});

describe("handleInteractive dispatcher", () => {
  test("returns cancelled for unknown kind", async () => {
    const result = await handleInteractive(
      { type: "interactive", prompt: "test", kind: "unknown" as "select" },
      makeOptions()
    );
    expect(result).toEqual({ cancelled: true });
  });
});

describe("handleSelect", () => {
  test("auto-selects single option with --yes", async () => {
    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Choose app",
        kind: "select",
        options: ["my-app"],
      },
      makeOptions({ yes: true })
    );

    expect(result).toEqual({ selectedApp: "my-app" });
    expect(logMock.info).toHaveBeenCalled();
  });

  test("cancels with --yes when multiple options exist", async () => {
    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Choose app",
        kind: "select",
        options: ["react", "vue"],
      },
      makeOptions({ yes: true })
    );

    expect(result).toEqual({ cancelled: true });
    expect(logMock.error).toHaveBeenCalled();
  });

  test("cancels when options list is empty", async () => {
    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Choose app",
        kind: "select",
        options: [],
      },
      makeOptions()
    );

    expect(result).toEqual({ cancelled: true });
  });

  test("uses apps array names when options not provided", async () => {
    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Choose app",
        kind: "select",
        apps: [{ name: "express-app", path: "/app", framework: "Express" }],
      },
      makeOptions({ yes: true })
    );

    expect(result).toEqual({ selectedApp: "express-app" });
  });

  test("calls clack select in interactive mode", async () => {
    selectImpl = mock(() => Promise.resolve("vue"));

    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Choose app",
        kind: "select",
        options: ["react", "vue"],
      },
      makeOptions({ yes: false })
    );

    expect(result).toEqual({ selectedApp: "vue" });
    expect(selectImpl).toHaveBeenCalled();
  });

  test("throws WizardCancelledError on user cancellation", async () => {
    selectImpl = mock(() => Promise.resolve(Symbol.for("cancel")));

    await expect(
      handleInteractive(
        {
          type: "interactive",
          prompt: "Choose app",
          kind: "select",
          options: ["react", "vue"],
        },
        makeOptions({ yes: false })
      )
    ).rejects.toThrow("Setup cancelled");
  });
});

describe("handleMultiSelect", () => {
  test("auto-selects all features with --yes", async () => {
    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Select features",
        kind: "multi-select",
        availableFeatures: [
          "errorMonitoring",
          "performanceMonitoring",
          "sessionReplay",
        ],
      },
      makeOptions({ yes: true })
    );

    expect(result.features).toEqual([
      "errorMonitoring",
      "performanceMonitoring",
      "sessionReplay",
    ]);
  });

  test("returns empty features when none available", async () => {
    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Select features",
        kind: "multi-select",
        availableFeatures: [],
      },
      makeOptions()
    );

    expect(result).toEqual({ features: [] });
  });

  test("prepends errorMonitoring when available but not user-selected", async () => {
    // User selects only sessionReplay, but errorMonitoring is available (required)
    multiselectImpl = mock(() => Promise.resolve(["sessionReplay"]));

    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Select features",
        kind: "multi-select",
        availableFeatures: [
          "errorMonitoring",
          "performanceMonitoring",
          "sessionReplay",
        ],
      },
      makeOptions({ yes: false })
    );

    const features = result.features as string[];
    expect(features[0]).toBe("errorMonitoring");
    expect(features).toContain("sessionReplay");
  });

  test("excludes errorMonitoring from multiselect options (always included)", async () => {
    multiselectImpl = mock(() => Promise.resolve(["performanceMonitoring"]));

    await handleInteractive(
      {
        type: "interactive",
        prompt: "Select features",
        kind: "multi-select",
        availableFeatures: ["errorMonitoring", "performanceMonitoring"],
      },
      makeOptions({ yes: false })
    );

    // The options passed to multiselect should NOT include errorMonitoring
    const callArgs = multiselectImpl.mock.calls[0][0] as {
      options: Array<{ value: string }>;
    };
    const values = callArgs.options.map((o: { value: string }) => o.value);
    expect(values).not.toContain("errorMonitoring");
    expect(values).toContain("performanceMonitoring");
  });
});

describe("handleConfirm", () => {
  test("auto-confirms with addExample when prompt contains 'example' and --yes", async () => {
    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Add an example error trigger?",
        kind: "confirm",
      },
      makeOptions({ yes: true })
    );

    expect(result).toEqual({ addExample: true });
  });

  test("auto-confirms with action: continue for non-example prompts with --yes", async () => {
    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Continue with setup?",
        kind: "confirm",
      },
      makeOptions({ yes: true })
    );

    expect(result).toEqual({ action: "continue" });
  });

  test("returns addExample based on user choice for example prompts", async () => {
    confirmImpl = mock(() => Promise.resolve(false));

    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Add an example error trigger?",
        kind: "confirm",
      },
      makeOptions({ yes: false })
    );

    expect(result).toEqual({ addExample: false });
  });

  test("returns action: stop when user declines non-example prompt", async () => {
    confirmImpl = mock(() => Promise.resolve(false));

    const result = await handleInteractive(
      {
        type: "interactive",
        prompt: "Continue with setup?",
        kind: "confirm",
      },
      makeOptions({ yes: false })
    );

    expect(result).toEqual({ action: "stop" });
  });
});
