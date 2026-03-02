/**
 * Interactive Dispatcher Tests
 *
 * Tests for the init wizard interactive prompt handlers. Uses spyOn on
 * @clack/prompts namespace to intercept calls from named imports.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as clack from "@clack/prompts";
import { handleInteractive } from "../../../src/lib/init/interactive.js";
import type { WizardOptions } from "../../../src/lib/init/types.js";

const noop = () => {
  /* suppress clack output */
};

let selectSpy: ReturnType<typeof spyOn>;
let multiselectSpy: ReturnType<typeof spyOn>;
let confirmSpy: ReturnType<typeof spyOn>;
let logInfoSpy: ReturnType<typeof spyOn>;
let logErrorSpy: ReturnType<typeof spyOn>;
let logWarnSpy: ReturnType<typeof spyOn>;
let cancelSpy: ReturnType<typeof spyOn>;
let isCancelSpy: ReturnType<typeof spyOn>;

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
  selectSpy = spyOn(clack, "select").mockImplementation(
    () => Promise.resolve("default") as any
  );
  multiselectSpy = spyOn(clack, "multiselect").mockImplementation(
    () => Promise.resolve([]) as any
  );
  confirmSpy = spyOn(clack, "confirm").mockImplementation(
    () => Promise.resolve(true) as any
  );
  logInfoSpy = spyOn(clack.log, "info").mockImplementation(noop);
  logErrorSpy = spyOn(clack.log, "error").mockImplementation(noop);
  logWarnSpy = spyOn(clack.log, "warn").mockImplementation(noop);
  cancelSpy = spyOn(clack, "cancel").mockImplementation(noop);
  isCancelSpy = spyOn(clack, "isCancel").mockImplementation(
    (v: unknown) => v === Symbol.for("cancel")
  );
});

afterEach(() => {
  selectSpy.mockRestore();
  multiselectSpy.mockRestore();
  confirmSpy.mockRestore();
  logInfoSpy.mockRestore();
  logErrorSpy.mockRestore();
  logWarnSpy.mockRestore();
  cancelSpy.mockRestore();
  isCancelSpy.mockRestore();
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
    expect(logInfoSpy).toHaveBeenCalled();
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
    expect(logErrorSpy).toHaveBeenCalled();
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
    selectSpy.mockImplementation(() => Promise.resolve("vue") as any);

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
    expect(selectSpy).toHaveBeenCalled();
  });

  test("throws WizardCancelledError on user cancellation", async () => {
    selectSpy.mockImplementation(
      () => Promise.resolve(Symbol.for("cancel")) as any
    );

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
    multiselectSpy.mockImplementation(
      () => Promise.resolve(["sessionReplay"]) as any
    );

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

  test("throws WizardCancelledError when user cancels multi-select", async () => {
    multiselectSpy.mockImplementation(
      () => Promise.resolve(Symbol.for("cancel")) as any
    );

    await expect(
      handleInteractive(
        {
          type: "interactive",
          prompt: "Select features",
          kind: "multi-select",
          availableFeatures: ["errorMonitoring", "performanceMonitoring"],
        },
        makeOptions({ yes: false })
      )
    ).rejects.toThrow("Setup cancelled");
  });

  test("excludes errorMonitoring from multiselect options (always included)", async () => {
    multiselectSpy.mockImplementation(
      () => Promise.resolve(["performanceMonitoring"]) as any
    );

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
    const callArgs = multiselectSpy.mock.calls[0][0] as {
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
    confirmSpy.mockImplementation(() => Promise.resolve(false) as any);

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

  test("throws WizardCancelledError when user cancels confirm", async () => {
    confirmSpy.mockImplementation(
      () => Promise.resolve(Symbol.for("cancel")) as any
    );

    await expect(
      handleInteractive(
        {
          type: "interactive",
          prompt: "Continue with setup?",
          kind: "confirm",
        },
        makeOptions({ yes: false })
      )
    ).rejects.toThrow("Setup cancelled");
  });

  test("returns action: stop when user declines non-example prompt", async () => {
    confirmSpy.mockImplementation(() => Promise.resolve(false) as any);

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
