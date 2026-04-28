/**
 * MockUI — test double for the `WizardUI` interface.
 *
 * Records every method call as a JSON-serialisable trace so tests can
 * make assertions about ordering, arguments, and call counts. Prompt
 * methods are programmable: tests push fake responses onto a queue and
 * `MockUI` returns them in order. Empty queue → returns `CANCELLED` so
 * cancellation paths are easy to exercise.
 *
 * Lives in `test/lib/init/ui/` rather than `src/` because it's a
 * test-only helper — it should not be bundled into the CLI.
 */

import {
  CANCELLED,
  type Cancelled,
  type ConfirmOptions,
  type MultiSelectOptions,
  type SelectOptions,
  type SpinnerExitCode,
  type SpinnerHandle,
  type WizardLog,
  type WizardSummary,
  type WizardUI,
} from "../../../../src/lib/init/ui/types.js";

export type MockCall =
  | { kind: "banner"; art: string }
  | { kind: "intro"; title: string }
  | { kind: "summary"; summary: WizardSummary }
  | { kind: "outro"; message: string }
  | { kind: "cancel"; message: string }
  | { kind: "log.info"; message: string }
  | { kind: "log.warn"; message: string }
  | { kind: "log.error"; message: string }
  | { kind: "log.success"; message: string }
  | { kind: "log.message"; message: string }
  | { kind: "spinner.start"; message?: string }
  | { kind: "spinner.message"; message?: string }
  | { kind: "spinner.stop"; message?: string; code?: SpinnerExitCode }
  | { kind: "select"; message: string; options: string[] }
  | {
      kind: "multiselect";
      message: string;
      options: string[];
      initialValues?: string[];
    }
  | { kind: "confirm"; message: string; initialValue?: boolean };

/**
 * Programmable prompt response. `value` is what the impl returns when
 * the matching prompt method is invoked (or `CANCELLED` to simulate a
 * user abort).
 */
export type MockResponse =
  | { kind: "select"; value: string | Cancelled }
  | { kind: "multiselect"; value: string[] | Cancelled }
  | { kind: "confirm"; value: boolean | Cancelled };

/**
 * Build a mock `WizardUI` plus its observable state.
 *
 * Returns the impl, the call trace, and a `respond()` helper for
 * pushing canned responses onto the prompt queue.
 */
export function createMockUI(): {
  ui: WizardUI;
  calls: MockCall[];
  respond: {
    select(value: string | Cancelled): void;
    multiselect(value: string[] | Cancelled): void;
    confirm(value: boolean | Cancelled): void;
  };
} {
  const calls: MockCall[] = [];
  const responses: MockResponse[] = [];

  const log: WizardLog = {
    info: (message) => calls.push({ kind: "log.info", message }),
    warn: (message) => calls.push({ kind: "log.warn", message }),
    error: (message) => calls.push({ kind: "log.error", message }),
    success: (message) => calls.push({ kind: "log.success", message }),
    message: (message) => calls.push({ kind: "log.message", message }),
  };

  const spinner = (): SpinnerHandle => ({
    start: (message) => calls.push({ kind: "spinner.start", message }),
    message: (message) => calls.push({ kind: "spinner.message", message }),
    stop: (message, code) =>
      calls.push({ kind: "spinner.stop", message, code }),
  });

  function takeResponse<K extends MockResponse["kind"]>(
    kind: K
  ): Extract<MockResponse, { kind: K }>["value"] | Cancelled {
    const next = responses.shift();
    if (!next) {
      // Tests that don't push a response get a clean cancel — easier to
      // detect mistakes than silent default values.
      return CANCELLED;
    }
    if (next.kind !== kind) {
      throw new Error(
        `MockUI: expected next response of kind "${kind}" but found "${next.kind}"`
      );
    }
    return next.value as Extract<MockResponse, { kind: K }>["value"];
  }

  const ui: WizardUI = {
    banner: (art) => calls.push({ kind: "banner", art }),
    intro: (title) => calls.push({ kind: "intro", title }),
    summary: (summary) => calls.push({ kind: "summary", summary }),
    outro: (message) => calls.push({ kind: "outro", message }),
    cancel: (message) => calls.push({ kind: "cancel", message }),
    log,
    spinner,
    select: (opts: SelectOptions<string>) => {
      calls.push({
        kind: "select",
        message: opts.message,
        options: opts.options.map((option) => option.value),
      });
      return Promise.resolve(takeResponse("select"));
    },
    multiselect: (opts: MultiSelectOptions<string>) => {
      calls.push({
        kind: "multiselect",
        message: opts.message,
        options: opts.options.map((option) => option.value),
        ...(opts.initialValues ? { initialValues: opts.initialValues } : {}),
      });
      return Promise.resolve(takeResponse("multiselect"));
    },
    confirm: (opts: ConfirmOptions) => {
      calls.push({
        kind: "confirm",
        message: opts.message,
        ...(opts.initialValue !== undefined
          ? { initialValue: opts.initialValue }
          : {}),
      });
      return Promise.resolve(takeResponse("confirm"));
    },
    [Symbol.asyncDispose]: () => Promise.resolve(),
  };

  return {
    ui,
    calls,
    respond: {
      select: (value) => responses.push({ kind: "select", value }),
      multiselect: (value) => responses.push({ kind: "multiselect", value }),
      confirm: (value) => responses.push({ kind: "confirm", value }),
    },
  };
}
