/**
 * Tests for the wizard store's step-progress state.
 *
 * Covers:
 *   - canonical pre-population from CHECKLIST_VISIBLE_STEPS
 *   - in_progress / completed transitions
 *   - implicit skip back-fill when a later step starts
 *   - idempotent re-entry (a step suspending multiple times)
 *   - protection against `skipped` clobbering completed entries
 *
 * The Ink app itself is not tested here — see the React tree
 * verification via direct `createInkUI()` invocation in
 * dev/binary builds. This test file focuses on the pure data layer.
 */

import { describe, expect, test } from "bun:test";
import {
  CANONICAL_STEP_ORDER,
  CHECKLIST_VISIBLE_STEPS,
} from "../../../../src/lib/init/clack-utils.js";
import { WizardStore } from "../../../../src/lib/init/ui/wizard-store.js";

describe("WizardStore step progress", () => {
  test("pre-populates the checklist from CHECKLIST_VISIBLE_STEPS", () => {
    const store = new WizardStore();
    const snapshot = store.getSnapshot();
    expect(snapshot.steps.map((entry) => entry.id)).toEqual(
      CHECKLIST_VISIBLE_STEPS.slice()
    );
    expect(snapshot.steps.every((entry) => entry.status === "pending")).toBe(
      true
    );
  });

  test("flips a step to in_progress on first call", () => {
    const store = new WizardStore();
    store.setStepStatus("ensure-sentry-project", "in_progress");
    const entry = store
      .getSnapshot()
      .steps.find((row) => row.id === "ensure-sentry-project");
    expect(entry?.status).toBe("in_progress");
  });

  test("re-entering an in_progress step is idempotent (no flicker)", () => {
    const store = new WizardStore();
    store.setStepStatus("install-deps", "in_progress");
    const before = store.getSnapshot().steps;
    store.setStepStatus("install-deps", "in_progress");
    const after = store.getSnapshot().steps;
    // Reference equality: no update emitted, so the array is the
    // same instance. This is what the store guarantees for no-op
    // mutations and what `useSyncExternalStore` relies on.
    expect(after).toBe(before);
  });

  test("back-fills earlier pending steps as skipped when a later step starts", () => {
    const store = new WizardStore();
    // Jump straight to a later step — simulates the workflow
    // taking an `if`-branch that bypassed the earlier ones.
    store.setStepStatus("install-deps", "in_progress");
    const steps = store.getSnapshot().steps;
    const installIdx = CANONICAL_STEP_ORDER.indexOf("install-deps");
    for (const entry of steps) {
      const idx = CANONICAL_STEP_ORDER.indexOf(entry.id);
      if (idx >= 0 && idx < installIdx) {
        expect(entry.status).toBe("skipped");
      }
    }
    expect(steps.find((entry) => entry.id === "install-deps")?.status).toBe(
      "in_progress"
    );
  });

  test("does not back-fill steps that have already completed", () => {
    const store = new WizardStore();
    store.setStepStatus("discover-context", "in_progress");
    store.setStepStatus("discover-context", "completed");
    store.setStepStatus("install-deps", "in_progress");
    const discover = store
      .getSnapshot()
      .steps.find((row) => row.id === "discover-context");
    expect(discover?.status).toBe("completed");
  });

  test("ignores stepIds outside the visible allowlist", () => {
    const store = new WizardStore();
    // `select-target-app` is in CANONICAL_STEP_ORDER but not in
    // CHECKLIST_VISIBLE_STEPS — the call should still drive the
    // back-fill on visible earlier rows but not add a new row.
    const initialLength = store.getSnapshot().steps.length;
    store.setStepStatus("select-target-app", "in_progress");
    // Note: variable is deliberately not named `after` because
    // Biome's `noDoneCallback` rule pattern-matches Mocha hooks
    // (`after`, `before`, …) by identifier and would flag the
    // arrow-function callback inside `.find()` below.
    const updated = store.getSnapshot().steps;
    expect(updated.length).toBe(initialLength);
    // Visible rows earlier than `select-target-app` (i.e.
    // `discover-context`) should be back-filled to skipped.
    const discover = updated.find((entry) => entry.id === "discover-context");
    expect(discover?.status).toBe("skipped");
  });

  test("completed transition wins over the existing status", () => {
    const store = new WizardStore();
    store.setStepStatus("apply-codemods", "in_progress");
    store.setStepStatus("apply-codemods", "completed");
    const entry = store
      .getSnapshot()
      .steps.find((row) => row.id === "apply-codemods");
    expect(entry?.status).toBe("completed");
  });

  test("failed transition wins over the existing status", () => {
    const store = new WizardStore();
    store.setStepStatus("install-deps", "in_progress");
    store.setStepStatus("install-deps", "failed");
    const entry = store
      .getSnapshot()
      .steps.find((row) => row.id === "install-deps");
    expect(entry?.status).toBe("failed");
  });

  test("explicit skipped does not overwrite a completed entry", () => {
    const store = new WizardStore();
    store.setStepStatus("discover-context", "in_progress");
    store.setStepStatus("discover-context", "completed");
    // A bogus (and impossible) explicit skip call should be a no-op.
    store.setStepStatus("discover-context", "skipped");
    const entry = store
      .getSnapshot()
      .steps.find((row) => row.id === "discover-context");
    expect(entry?.status).toBe("completed");
  });

  test("notifies subscribers on step transitions", () => {
    const store = new WizardStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    store.setStepStatus("install-deps", "in_progress");
    store.setStepStatus("install-deps", "in_progress"); // idempotent
    store.setStepStatus("install-deps", "completed");
    unsubscribe();
    // Two real transitions = two notifications. The middle no-op
    // does not fire a listener — saves a render in React.
    expect(notifications).toBe(2);
  });
});

/**
 * Cancellation callback contract.
 *
 * The Ink App reads `snapshot.requestCancel` from inside its
 * top-level `useInput` handler when no prompt is mounted (spinner
 * window). The bridge (`InkUI`) registers the callback at
 * construction and clears it on teardown so a stale Ink dispatch
 * after unmount can't re-enter cancellation.
 */
describe("WizardStore status messages", () => {
  test("starts with empty status messages", () => {
    const store = new WizardStore();
    expect(store.getSnapshot().statusMessages).toEqual([]);
    expect(store.getSnapshot().statusExpanded).toBe(false);
  });

  test("appendStatus adds messages", () => {
    const store = new WizardStore();
    store.appendStatus("Analyzing project...");
    store.appendStatus("Reading files...");
    expect(store.getSnapshot().statusMessages).toEqual([
      "Analyzing project...",
      "Reading files...",
    ]);
  });

  test("appendStatus ignores empty strings", () => {
    const store = new WizardStore();
    store.appendStatus("");
    expect(store.getSnapshot().statusMessages).toEqual([]);
  });

  test("toggleStatusExpanded flips the flag", () => {
    const store = new WizardStore();
    expect(store.getSnapshot().statusExpanded).toBe(false);
    store.toggleStatusExpanded();
    expect(store.getSnapshot().statusExpanded).toBe(true);
    store.toggleStatusExpanded();
    expect(store.getSnapshot().statusExpanded).toBe(false);
  });
});

describe("WizardStore.setRequestCancel", () => {
  test("starts undefined so an early Ctrl+C is a no-op", () => {
    const store = new WizardStore();
    expect(store.getSnapshot().requestCancel).toBeUndefined();
  });

  test("registers a callback and exposes it on the snapshot", () => {
    const store = new WizardStore();
    const cancel = () => {
      /* no-op */
    };
    store.setRequestCancel(cancel);
    expect(store.getSnapshot().requestCancel).toBe(cancel);
  });

  test("clears the callback on teardown by passing undefined", () => {
    const store = new WizardStore();
    store.setRequestCancel(() => {
      /* no-op */
    });
    store.setRequestCancel(undefined);
    expect(store.getSnapshot().requestCancel).toBeUndefined();
  });

  test("setting the same callback reference twice is a no-op", () => {
    // Avoid React re-render churn when the bridge re-registers the
    // same callback (idempotency for cheap callers).
    const store = new WizardStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    const cancel = () => {
      /* no-op */
    };
    store.setRequestCancel(cancel);
    store.setRequestCancel(cancel);
    unsubscribe();
    expect(notifications).toBe(1);
  });

  test("invocation runs the registered callback", () => {
    // The store doesn't invoke the callback itself — the App does
    // — but verify the wiring lets callers reach the function.
    const store = new WizardStore();
    let invoked = 0;
    store.setRequestCancel(() => {
      invoked += 1;
    });
    store.getSnapshot().requestCancel?.();
    expect(invoked).toBe(1);
  });
});
