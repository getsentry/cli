/**
 * ClackUI — interactive WizardUI implementation backed by `@clack/prompts`.
 *
 * This is the **default** interactive implementation while the OpenTUI
 * port is in progress. Its job is to preserve current visible behavior
 * (one-line scrolling layout, clack symbol icons, multiline spinner from
 * `createWizardSpinner`) while letting the rest of the wizard code call a
 * stable `WizardUI` interface.
 *
 * The wrapper is intentionally thin — it forwards each call to the same
 * clack primitives the wizard already uses. When OpenTuiUI lands in PR3
 * and is flipped to default in PR4, this module is deleted along with
 * the `@clack/prompts` dependency.
 */

import {
  type Option as ClackOption,
  cancel as clackCancel,
  confirm as clackConfirm,
  intro as clackIntro,
  isCancel as clackIsCancel,
  log as clackLog,
  multiselect as clackMultiSelect,
  outro as clackOutro,
  select as clackSelect,
} from "@clack/prompts";
import { renderMarkdown } from "../../formatters/markdown.js";
import { createWizardSpinner } from "../spinner.js";
import {
  CANCELLED,
  type Cancelled,
  type ConfirmOptions,
  type MultiSelectOptions,
  type SelectOption,
  type SelectOptions,
  type SpinnerHandle,
  type WizardLog,
  type WizardUI,
} from "./types.js";

/**
 * Map a `WizardUI` `SelectOption` to clack's `Option` shape.
 *
 * Clack's `Option<Value>` is a conditional type — `Value extends Primitive`
 * — and TypeScript will not distribute the conditional through our own
 * generic `T extends string`. Asserting the return type lets the wrapper
 * compile while preserving correctness (clack's primitive branch matches
 * `string` exactly).
 *
 * Clack types `hint` as an optional property (`hint?: string`) — meaning
 * the key must be either omitted or a `string`. Spreading `option.hint`
 * into the object as-is would set the key to `undefined`. The conditional
 * spread is kept in one place here.
 */
function toClackOption<T extends string>(
  option: SelectOption<T>
): ClackOption<T> {
  const base = { value: option.value, label: option.label };
  return (
    option.hint === undefined ? base : { ...base, hint: option.hint }
  ) as ClackOption<T>;
}

/**
 * Interactive WizardUI backed by clack. See module doc.
 */
export class ClackUI implements WizardUI {
  // ── Lifecycle ─────────────────────────────────────────────────────

  intro(title: string): void {
    clackIntro(title);
  }

  outro(message: string): void {
    clackOutro(message);
  }

  cancel(message: string): void {
    clackCancel(message);
  }

  // ── Logging ───────────────────────────────────────────────────────

  log: WizardLog = {
    info: (message: string) => clackLog.info(message),
    warn: (message: string) => clackLog.warn(message),
    error: (message: string) => clackLog.error(message),
    success: (message: string) => clackLog.success(message),
    // `log.message` is the caller's plain markdown block — render it here
    // so call sites don't need to import the markdown renderer themselves.
    message: (message: string) => clackLog.message(renderMarkdown(message)),
  };

  // ── Spinner ───────────────────────────────────────────────────────

  spinner(): SpinnerHandle {
    return createWizardSpinner();
  }

  // ── Prompts ───────────────────────────────────────────────────────

  async select<T extends string>(
    opts: SelectOptions<T>
  ): Promise<T | Cancelled> {
    const result = await clackSelect<T>({
      message: opts.message,
      options: opts.options.map(toClackOption),
      initialValue: opts.initialValue,
    });
    if (clackIsCancel(result)) {
      return CANCELLED;
    }
    return result;
  }

  async multiselect<T extends string>(
    opts: MultiSelectOptions<T>
  ): Promise<T[] | Cancelled> {
    const result = await clackMultiSelect<T>({
      message: opts.message,
      options: opts.options.map(toClackOption),
      initialValues: opts.initialValues,
      required: opts.required,
    });
    if (clackIsCancel(result)) {
      return CANCELLED;
    }
    return result;
  }

  async confirm(opts: ConfirmOptions): Promise<boolean | Cancelled> {
    const result = await clackConfirm({
      message: opts.message,
      initialValue: opts.initialValue,
    });
    if (clackIsCancel(result)) {
      return CANCELLED;
    }
    return Boolean(result);
  }

  // ── Disposal ──────────────────────────────────────────────────────

  [Symbol.asyncDispose](): Promise<void> {
    // Nothing to tear down — clack writes inline and owns no persistent
    // renderer state. Spinners returned from `spinner()` self-clean on
    // `stop()`.
    return Promise.resolve();
  }
}
