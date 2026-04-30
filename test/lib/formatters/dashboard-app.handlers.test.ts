/**
 * Unit tests for the dashboard App's keyboard dispatch.
 *
 * The `handleKey` family is a pure state machine over store
 * mutations + action dispatches; we exercise it directly here
 * rather than driving a live OpenTUI renderer (which `bun test`
 * can't easily do in a sandboxed PTY).
 *
 * Each test constructs a `DashboardStore`, registers an action
 * collector, fires synthetic `KeyEventLike` objects, and asserts
 * on the resulting store state + dispatched actions.
 */

import { describe, expect, test } from "bun:test";
import type { DashboardViewData } from "../../../src/lib/formatters/dashboard.js";
import {
  handleKey,
  type KeyboardSnapshot,
  type KeyEventLike,
} from "../../../src/lib/formatters/dashboard-app.js";
import {
  type DashboardAction,
  DashboardStore,
} from "../../../src/lib/formatters/dashboard-store.js";

const SAMPLE_DATA: DashboardViewData = {
  id: "1",
  title: "Test",
  period: "24h",
  fetchedAt: "2024-01-01T00:00:00Z",
  url: "https://sentry.io/test",
  widgets: [
    {
      title: "A",
      displayType: "big_number",
      layout: { x: 0, y: 0, w: 2, h: 1 },
      data: { type: "scalar", value: 1, unit: null },
    },
    {
      title: "B",
      displayType: "line",
      layout: { x: 2, y: 0, w: 4, h: 1 },
      data: {
        type: "timeseries",
        series: [{ label: "x", unit: null, values: [] }],
      },
    },
  ],
};

function setup(snapshot?: Partial<KeyboardSnapshot>): {
  store: DashboardStore;
  actions: DashboardAction[];
  /**
   * Fire a synthetic keystroke. The `KeyboardSnapshot` view is
   * read fresh from `store.getSnapshot()` on every call so tests
   * don't need to thread snapshot mutations between events —
   * matches the real `useKeyboard` hook in `App` which closes
   * over the latest store snapshot.
   */
  fire: (event: KeyEventLike) => void;
} {
  const store = new DashboardStore({
    data: SAMPLE_DATA,
    currentPeriod: "24h",
  });
  // Pre-mutate the store to match the requested overlay state.
  // The real `App` reads these from `useSyncExternalStore`, so
  // the test's `view` parameter must agree with store reality.
  if (snapshot?.helpOverlayActive) {
    store.toggleHelp();
  }
  if (snapshot?.drilldownActive) {
    store.setFocusedWidget(0); // drilldown requires a focused widget
    store.toggleDrilldown();
  }
  const actions: DashboardAction[] = [];
  store.setActionDispatcher((a) => actions.push(a));
  return {
    store,
    actions,
    fire: (event) => {
      const live = store.getSnapshot();
      handleKey(
        event,
        {
          drilldownActive: live.drilldownActive,
          helpOverlayActive: live.helpOverlayActive,
        },
        store
      );
    },
  };
}

describe("handleKey — universal", () => {
  test("Ctrl+C quits regardless of overlay", () => {
    const grid = setup();
    grid.fire({ name: "c", ctrl: true });
    expect(grid.actions).toEqual([{ kind: "quit" }]);

    const drilldown = setup({ drilldownActive: true });
    drilldown.fire({ name: "c", ctrl: true });
    expect(drilldown.actions).toEqual([{ kind: "quit" }]);

    const help = setup({ helpOverlayActive: true });
    help.fire({ name: "c", ctrl: true });
    expect(help.actions).toEqual([{ kind: "quit" }]);
  });

  test("Esc closes drilldown first when both overlays could apply", () => {
    const ctx = setup({ drilldownActive: true, helpOverlayActive: true });
    ctx.fire({ name: "escape" });
    // Drilldown goes first (vim-style staged dismissal).
    expect(ctx.store.getSnapshot().drilldownActive).toBe(false);
    expect(ctx.store.getSnapshot().helpOverlayActive).toBe(true);
    expect(ctx.actions).toEqual([]);
  });

  test("Esc closes help when no drilldown", () => {
    const ctx = setup({ helpOverlayActive: true });
    ctx.fire({ name: "escape" });
    expect(ctx.store.getSnapshot().helpOverlayActive).toBe(false);
    expect(ctx.actions).toEqual([]);
  });

  test("Esc quits when no overlays are up", () => {
    const ctx = setup();
    ctx.fire({ name: "escape" });
    expect(ctx.actions).toEqual([{ kind: "quit" }]);
  });
});

describe("handleKey — grid mode", () => {
  test("Tab cycles focus forward", () => {
    const ctx = setup();
    ctx.fire({ name: "tab" });
    expect(ctx.store.getSnapshot().focusedWidgetIndex).toBe(0);
    ctx.fire({ name: "tab" });
    expect(ctx.store.getSnapshot().focusedWidgetIndex).toBe(1);
  });

  test("Shift+Tab cycles backward", () => {
    const ctx = setup();
    ctx.fire({ name: "tab", shift: true });
    // From -1, backward wraps to last (index 1).
    expect(ctx.store.getSnapshot().focusedWidgetIndex).toBe(1);
  });

  test("backtab cycles backward (terminal alias for shift+tab)", () => {
    const ctx = setup();
    ctx.fire({ name: "backtab" });
    expect(ctx.store.getSnapshot().focusedWidgetIndex).toBe(1);
  });

  test("arrow keys cycle focus", () => {
    const ctx = setup();
    ctx.fire({ name: "right" });
    expect(ctx.store.getSnapshot().focusedWidgetIndex).toBe(0);
    ctx.fire({ name: "down" });
    expect(ctx.store.getSnapshot().focusedWidgetIndex).toBe(1);
    ctx.fire({ name: "left" });
    expect(ctx.store.getSnapshot().focusedWidgetIndex).toBe(0);
    ctx.fire({ name: "up" });
    expect(ctx.store.getSnapshot().focusedWidgetIndex).toBe(1);
  });

  test("Enter toggles drilldown when a widget is focused", () => {
    const ctx = setup();
    ctx.store.setFocusedWidget(0);
    ctx.fire({ name: "return" });
    expect(ctx.store.getSnapshot().drilldownActive).toBe(true);
  });

  test("Enter is a no-op when no widget is focused", () => {
    const ctx = setup();
    ctx.fire({ name: "return" });
    expect(ctx.store.getSnapshot().drilldownActive).toBe(false);
  });

  test("? toggles help overlay", () => {
    const ctx = setup();
    ctx.fire({ name: "?" });
    expect(ctx.store.getSnapshot().helpOverlayActive).toBe(true);
    ctx.fire({ name: "?" });
    expect(ctx.store.getSnapshot().helpOverlayActive).toBe(false);
  });

  test("? recognised via sequence (terminals that don't fill `name`)", () => {
    const ctx = setup();
    ctx.fire({ name: "/", sequence: "?" });
    expect(ctx.store.getSnapshot().helpOverlayActive).toBe(true);
  });

  test("q quits", () => {
    const ctx = setup();
    ctx.fire({ name: "q" });
    expect(ctx.actions).toEqual([{ kind: "quit" }]);
  });

  test("t dispatches cycle-period", () => {
    const ctx = setup();
    ctx.fire({ name: "t" });
    expect(ctx.actions).toEqual([{ kind: "cycle-period" }]);
  });

  test("r dispatches refresh", () => {
    const ctx = setup();
    ctx.fire({ name: "r" });
    expect(ctx.actions).toEqual([{ kind: "refresh" }]);
  });

  test("Shift+R dispatches toggle-auto-refresh", () => {
    const ctx = setup();
    ctx.fire({ name: "r", shift: true });
    expect(ctx.actions).toEqual([{ kind: "toggle-auto-refresh" }]);
  });

  test("R sequence dispatches toggle-auto-refresh", () => {
    // Some terminals report capital R as `name: "r"` without
    // shift but with `sequence: "R"`. The handler accepts either.
    const ctx = setup();
    ctx.fire({ name: "r", sequence: "R" });
    expect(ctx.actions).toEqual([{ kind: "toggle-auto-refresh" }]);
  });

  test("o dispatches open-in-browser", () => {
    const ctx = setup();
    ctx.fire({ name: "o" });
    expect(ctx.actions).toEqual([{ kind: "open-in-browser" }]);
  });

  test("unknown keys are ignored", () => {
    const ctx = setup();
    ctx.fire({ name: "x" });
    ctx.fire({ name: "f1" });
    expect(ctx.actions).toEqual([]);
    expect(ctx.store.getSnapshot().focusedWidgetIndex).toBe(-1);
  });
});

describe("handleKey — help overlay mode", () => {
  test("? toggles help off", () => {
    const ctx = setup({ helpOverlayActive: true });
    ctx.fire({ name: "?" });
    expect(ctx.store.getSnapshot().helpOverlayActive).toBe(false);
  });

  test("q still quits", () => {
    const ctx = setup({ helpOverlayActive: true });
    ctx.fire({ name: "q" });
    expect(ctx.actions).toEqual([{ kind: "quit" }]);
  });

  test("other keys are swallowed", () => {
    const ctx = setup({ helpOverlayActive: true });
    ctx.fire({ name: "t" });
    ctx.fire({ name: "r" });
    ctx.fire({ name: "o" });
    ctx.fire({ name: "tab" });
    expect(ctx.actions).toEqual([]);
    expect(ctx.store.getSnapshot().focusedWidgetIndex).toBe(-1);
  });
});

describe("handleKey — drilldown mode", () => {
  test("Enter exits drilldown", () => {
    const ctx = setup({ drilldownActive: true });
    ctx.fire({ name: "return" });
    expect(ctx.store.getSnapshot().drilldownActive).toBe(false);
  });

  test("q still quits", () => {
    const ctx = setup({ drilldownActive: true });
    ctx.fire({ name: "q" });
    expect(ctx.actions).toEqual([{ kind: "quit" }]);
  });

  test("navigation keys are swallowed (focus doesn't change)", () => {
    const ctx = setup({ drilldownActive: true });
    // setup() set focus to widget 0 to make drilldown legal.
    expect(ctx.store.getSnapshot().focusedWidgetIndex).toBe(0);
    ctx.fire({ name: "tab" });
    ctx.fire({ name: "right" });
    expect(ctx.store.getSnapshot().focusedWidgetIndex).toBe(0);
  });
});
