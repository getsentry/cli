/**
 * Tests for the interactive dashboard's external state store.
 *
 * Mirrors the pattern in `test/lib/init/ui/wizard-store.test.ts`:
 * exercise mutators directly, assert on snapshot changes, verify
 * subscriber notification and idempotency invariants.
 */

import { describe, expect, test } from "bun:test";
import type { DashboardViewData } from "../../../src/lib/formatters/dashboard.js";
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
      title: "Widget A",
      displayType: "big_number",
      layout: { x: 0, y: 0, w: 2, h: 1 },
      data: { type: "scalar", value: 1, unit: null },
    },
    {
      title: "Widget B",
      displayType: "line",
      layout: { x: 2, y: 0, w: 4, h: 2 },
      data: {
        type: "timeseries",
        series: [{ label: "errors", unit: null, values: [] }],
      },
    },
    {
      title: "Widget C",
      displayType: "table",
      layout: { x: 0, y: 2, w: 6, h: 2 },
      data: { type: "table", columns: ["x"], rows: [] },
    },
  ],
};

function makeStore(): DashboardStore {
  return new DashboardStore({ data: SAMPLE_DATA, currentPeriod: "24h" });
}

describe("DashboardStore initial state", () => {
  test("starts with no widget focused, no overlays, no auto-refresh", () => {
    const snap = makeStore().getSnapshot();
    expect(snap.focusedWidgetIndex).toBe(-1);
    expect(snap.drilldownActive).toBe(false);
    expect(snap.helpOverlayActive).toBe(false);
    expect(snap.autoRefreshEnabled).toBe(false);
    expect(snap.fetching).toBe(false);
    expect(snap.fetchError).toBeNull();
    expect(snap.currentPeriod).toBe("24h");
  });

  test("respects auto-refresh init values", () => {
    const store = new DashboardStore({
      data: SAMPLE_DATA,
      currentPeriod: "7d",
      autoRefreshEnabled: true,
      autoRefreshIntervalMs: 30_000,
    });
    const snap = store.getSnapshot();
    expect(snap.autoRefreshEnabled).toBe(true);
    expect(snap.autoRefreshIntervalMs).toBe(30_000);
  });
});

describe("DashboardStore.cycleFocus", () => {
  test("forward from -1 lands on 0", () => {
    const store = makeStore();
    store.cycleFocus("forward");
    expect(store.getSnapshot().focusedWidgetIndex).toBe(0);
  });

  test("forward wraps from last to first", () => {
    const store = makeStore();
    store.setFocusedWidget(2);
    store.cycleFocus("forward");
    expect(store.getSnapshot().focusedWidgetIndex).toBe(0);
  });

  test("backward from -1 wraps to last widget", () => {
    const store = makeStore();
    store.cycleFocus("backward");
    expect(store.getSnapshot().focusedWidgetIndex).toBe(2);
  });

  test("backward wraps from first to last", () => {
    const store = makeStore();
    store.setFocusedWidget(0);
    store.cycleFocus("backward");
    expect(store.getSnapshot().focusedWidgetIndex).toBe(2);
  });

  test("no-op when widget list is empty", () => {
    const store = new DashboardStore({
      data: { ...SAMPLE_DATA, widgets: [] },
      currentPeriod: "24h",
    });
    store.cycleFocus("forward");
    expect(store.getSnapshot().focusedWidgetIndex).toBe(-1);
  });
});

describe("DashboardStore.setFocusedWidget", () => {
  test("clamps to valid range", () => {
    const store = makeStore();
    store.setFocusedWidget(99);
    expect(store.getSnapshot().focusedWidgetIndex).toBe(2);
    store.setFocusedWidget(-99);
    expect(store.getSnapshot().focusedWidgetIndex).toBe(-1);
  });

  test("idempotent for same index", () => {
    const store = makeStore();
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.setFocusedWidget(1);
    store.setFocusedWidget(1);
    expect(calls).toBe(1);
  });
});

describe("DashboardStore.toggleDrilldown", () => {
  test("ignored when no widget focused", () => {
    const store = makeStore();
    store.toggleDrilldown();
    expect(store.getSnapshot().drilldownActive).toBe(false);
  });

  test("toggles when a widget is focused", () => {
    const store = makeStore();
    store.setFocusedWidget(0);
    store.toggleDrilldown();
    expect(store.getSnapshot().drilldownActive).toBe(true);
    store.toggleDrilldown();
    expect(store.getSnapshot().drilldownActive).toBe(false);
  });

  test("exitDrilldown is idempotent", () => {
    const store = makeStore();
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.exitDrilldown();
    expect(calls).toBe(0);
  });
});

describe("DashboardStore data mutations", () => {
  test("setData clears fetching + fetchError", () => {
    const store = makeStore();
    store.setFetching(true);
    store.setFetchError("boom");
    store.setData(SAMPLE_DATA);
    const snap = store.getSnapshot();
    expect(snap.fetching).toBe(false);
    expect(snap.fetchError).toBeNull();
  });

  test("setData updates currentPeriod when provided", () => {
    const store = makeStore();
    store.setData(SAMPLE_DATA, "7d");
    expect(store.getSnapshot().currentPeriod).toBe("7d");
  });

  test("setFetching is idempotent for same value", () => {
    const store = makeStore();
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.setFetching(false);
    expect(calls).toBe(0);
  });
});

describe("DashboardStore action dispatch", () => {
  test("dispatch routes to registered dispatcher", () => {
    const store = makeStore();
    const seen: DashboardAction[] = [];
    store.setActionDispatcher((a) => seen.push(a));
    store.dispatch({ kind: "refresh" });
    store.dispatch({ kind: "cycle-period" });
    expect(seen).toEqual([{ kind: "refresh" }, { kind: "cycle-period" }]);
  });

  test("dispatch is a no-op when no dispatcher is registered", () => {
    const store = makeStore();
    expect(() => store.dispatch({ kind: "quit" })).not.toThrow();
  });

  test("clearing the dispatcher disables future dispatches", () => {
    const store = makeStore();
    let calls = 0;
    store.setActionDispatcher(() => {
      calls += 1;
    });
    store.dispatch({ kind: "refresh" });
    store.setActionDispatcher(undefined);
    store.dispatch({ kind: "refresh" });
    expect(calls).toBe(1);
  });
});

describe("DashboardStore subscribers", () => {
  test("notifies on real changes only", () => {
    const store = makeStore();
    let calls = 0;
    const unsub = store.subscribe(() => {
      calls += 1;
    });
    store.setFocusedWidget(0); // change → 1 call
    store.setFocusedWidget(0); // no-op → 0 calls
    store.toggleHelp(); // change → 1 call
    store.toggleHelp(); // change (toggle) → 1 call
    unsub();
    store.setFocusedWidget(2); // unsubscribed → 0 calls
    expect(calls).toBe(3);
  });
});
