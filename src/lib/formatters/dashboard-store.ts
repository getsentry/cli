/**
 * Dashboard view — interactive UI state store.
 *
 * Tiny external store that bridges the imperative runtime (data
 * fetches, period cycling, refresh) to React's render loop. The
 * `App` component in `dashboard-app.tsx` subscribes via
 * `useSyncExternalStore`; the runtime in `dashboard-runtime.ts`
 * mutates the store as data arrives or the user issues actions.
 *
 * Mirrors the pattern the wizard's `WizardStore` established (see
 * `src/lib/init/ui/wizard-store.ts`) — same reasoning applies:
 * imperative state lives outside React, snapshots are immutable
 * objects, listeners fire synchronously, and `Object.is` reference
 * checks are enough for change detection.
 *
 * Two state classes:
 *
 *   - **Data state**: the resolved {@link DashboardViewData} and a
 *     transient `fetching` / `fetchError` pair signalling an
 *     in-flight refresh. Replaced wholesale on each successful
 *     fetch.
 *   - **UI state**: focused widget, drilldown / help overlay
 *     toggles, current period (so the header can stay accurate
 *     when the user cycles), auto-refresh enabled flag. Owned by
 *     this module — pure UX state, not business data.
 *
 * The store doesn't perform fetches itself; it exposes an
 * `actionDispatcher` slot the runtime fills with a callback that
 * routes user actions (refresh, cycle-period, etc.) to its async
 * orchestration layer.
 */

import type { DashboardViewData } from "./dashboard.js";

/**
 * Discrete user actions that change data or trigger side effects.
 * Actions that only mutate UI state (focus, drilldown, help) are
 * called directly on the store and don't go through the dispatcher.
 */
export type DashboardAction =
  /** Re-fetch widget data with the current period. */
  | { kind: "refresh" }
  /** Move to the next time period (1h → 24h → 7d → 30d → 90d → 1h). */
  | { kind: "cycle-period" }
  /** Toggle auto-refresh on/off. */
  | { kind: "toggle-auto-refresh" }
  /** Open the dashboard (or focused widget) URL in the user's browser. */
  | { kind: "open-in-browser" }
  /** Cooperatively shut down the interactive dashboard. */
  | { kind: "quit" };

/** Standard period cycle for the `t` keybinding. */
export const PERIOD_CYCLE: readonly string[] = [
  "1h",
  "24h",
  "7d",
  "30d",
  "90d",
];

/** Default auto-refresh interval in milliseconds (60 s). */
export const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 60_000;

export type DashboardSnapshot = {
  /** Resolved widget data + dashboard meta. Replaced on each fetch. */
  data: DashboardViewData;
  /** True while a re-fetch is in flight. Drives the spinner glyph in the status bar. */
  fetching: boolean;
  /** Last error from a failed fetch, or null when the most recent fetch succeeded. */
  fetchError: string | null;
  /**
   * Index into `data.widgets` of the currently-focused widget. `-1` means
   * no widget has focus (initial state — user hasn't navigated yet).
   * The focused widget gets the accent border treatment.
   */
  focusedWidgetIndex: number;
  /** True when the focused widget is expanded into a full-screen detail view. */
  drilldownActive: boolean;
  /** True while the help overlay is visible. */
  helpOverlayActive: boolean;
  /** Current effective period, kept in sync with the data fetch. */
  currentPeriod: string;
  /** True when auto-refresh is currently scheduling fetches. */
  autoRefreshEnabled: boolean;
  /** Interval (ms) used by auto-refresh. */
  autoRefreshIntervalMs: number;
};

export type DashboardListener = () => void;

/**
 * Initial values for a new store. `data`, `currentPeriod` are
 * required (they come from the first fetch the runtime performs
 * before mounting the App); everything else has sane defaults.
 */
export type DashboardStoreInit = {
  data: DashboardViewData;
  currentPeriod: string;
  autoRefreshIntervalMs?: number;
  autoRefreshEnabled?: boolean;
};

/**
 * Minimal external store with the React 18+ `useSyncExternalStore`
 * subscription contract. Same shape as `WizardStore`.
 */
export class DashboardStore {
  private snapshot: DashboardSnapshot;
  private readonly listeners = new Set<DashboardListener>();
  private actionDispatcher: ((action: DashboardAction) => void) | undefined;

  constructor(init: DashboardStoreInit) {
    this.snapshot = {
      data: init.data,
      fetching: false,
      fetchError: null,
      focusedWidgetIndex: -1,
      drilldownActive: false,
      helpOverlayActive: false,
      currentPeriod: init.currentPeriod,
      autoRefreshEnabled: init.autoRefreshEnabled ?? false,
      autoRefreshIntervalMs:
        init.autoRefreshIntervalMs ?? DEFAULT_AUTO_REFRESH_INTERVAL_MS,
    };
  }

  getSnapshot = (): DashboardSnapshot => this.snapshot;

  subscribe = (listener: DashboardListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // ── Action dispatch ───────────────────────────────────────────────

  /**
   * Register the action dispatcher. The runtime calls this once at
   * mount time; the App then invokes
   * `store.dispatch({ kind: "refresh" })` etc. without knowing
   * how the runtime services the action.
   */
  setActionDispatcher(
    dispatcher: ((action: DashboardAction) => void) | undefined
  ): void {
    this.actionDispatcher = dispatcher;
  }

  dispatch(action: DashboardAction): void {
    this.actionDispatcher?.(action);
  }

  // ── Data mutators ─────────────────────────────────────────────────

  setData(data: DashboardViewData, currentPeriod?: string): void {
    this.update({
      data,
      fetching: false,
      fetchError: null,
      ...(currentPeriod !== undefined ? { currentPeriod } : {}),
    });
  }

  setFetching(fetching: boolean): void {
    if (this.snapshot.fetching === fetching) {
      return;
    }
    this.update({ fetching });
  }

  setFetchError(message: string): void {
    this.update({ fetching: false, fetchError: message });
  }

  // ── UI mutators ───────────────────────────────────────────────────

  /**
   * Move focus to a specific widget index. Clamped to the valid
   * range; `-1` means "no focus" and is allowed (it's the initial
   * state). Out-of-range indices are silently clamped to the
   * nearest valid value rather than being rejected — keeps the
   * keyboard handler simple.
   */
  setFocusedWidget(index: number): void {
    const widgetCount = this.snapshot.data.widgets.length;
    if (widgetCount === 0) {
      return;
    }
    const clamped = Math.max(-1, Math.min(widgetCount - 1, index));
    if (clamped === this.snapshot.focusedWidgetIndex) {
      return;
    }
    this.update({ focusedWidgetIndex: clamped });
  }

  /**
   * Cycle focus forward (Tab / ArrowRight / ArrowDown) or backward
   * (Shift+Tab / ArrowLeft / ArrowUp). Wraps at the ends.
   */
  cycleFocus(direction: "forward" | "backward"): void {
    const widgetCount = this.snapshot.data.widgets.length;
    if (widgetCount === 0) {
      return;
    }
    const current = this.snapshot.focusedWidgetIndex;
    let next: number;
    if (direction === "forward") {
      next = current === -1 ? 0 : (current + 1) % widgetCount;
    } else {
      next = current <= 0 ? widgetCount - 1 : current - 1;
    }
    this.update({ focusedWidgetIndex: next });
  }

  /**
   * Toggle the drilldown view. Only meaningful when a widget is
   * focused — without focus there's nothing to drill into, so the
   * call is a no-op.
   */
  toggleDrilldown(): void {
    if (
      this.snapshot.focusedWidgetIndex < 0 &&
      !this.snapshot.drilldownActive
    ) {
      return;
    }
    this.update({ drilldownActive: !this.snapshot.drilldownActive });
  }

  /** Force exit drilldown (used by the Esc handler). */
  exitDrilldown(): void {
    if (!this.snapshot.drilldownActive) {
      return;
    }
    this.update({ drilldownActive: false });
  }

  /** Toggle the help overlay (`?` key). */
  toggleHelp(): void {
    this.update({ helpOverlayActive: !this.snapshot.helpOverlayActive });
  }

  /** Force exit help overlay. */
  exitHelp(): void {
    if (!this.snapshot.helpOverlayActive) {
      return;
    }
    this.update({ helpOverlayActive: false });
  }

  setAutoRefreshEnabled(enabled: boolean): void {
    if (this.snapshot.autoRefreshEnabled === enabled) {
      return;
    }
    this.update({ autoRefreshEnabled: enabled });
  }

  setCurrentPeriod(period: string): void {
    if (this.snapshot.currentPeriod === period) {
      return;
    }
    this.update({ currentPeriod: period });
  }

  // ── Internal ──────────────────────────────────────────────────────

  private update(patch: Partial<DashboardSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }
}
