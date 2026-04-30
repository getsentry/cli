/**
 * Dashboard view — interactive runtime.
 *
 * Mounts the React App from `dashboard-app.tsx` into a long-lived
 * `createCliRenderer` (alternate-screen mode) and drives the
 * imperative side of interactivity:
 *
 *   - User actions (refresh, cycle-period, toggle-auto-refresh,
 *     open-in-browser, quit) are dispatched from the App via the
 *     `DashboardStore`'s action dispatcher slot. This module
 *     services them.
 *   - Auto-refresh schedules a fetch every `autoRefreshIntervalMs`
 *     while enabled. Cancels cleanly on quit / manual refresh /
 *     toggle-off.
 *   - On quit (`q`, Ctrl+C, or Esc when no overlay is up), the
 *     renderer is destroyed, the React tree unmounted, and the
 *     `runInteractiveDashboard` promise resolves so the wizard
 *     runner can return to the shell.
 *
 * Bun-binary only — same gating as the static `renderDashboardTui`
 * in `dashboard-tui.ts`. Callers in `dashboard view` should
 * `try { await runInteractiveDashboard(...) } catch { fall back }`
 * so the npm/Node distribution lands on the plain-text formatter.
 *
 * This module imports `dashboard-app.tsx` via the embedded
 * `with { type: "file" }` indirection (same trick as the wizard's
 * `OpenTuiUI`) so Bun.compile doesn't attempt to bundle the
 * React tree's static React imports — which fails the same way
 * the wizard's static-bundle path failed before the embedding
 * trick was introduced.
 */

import { openBrowser } from "../browser.js";
import { logger } from "../logger.js";
import type { DashboardViewData } from "./dashboard.js";
// @ts-expect-error: `with { type: "file" }` is Bun-specific and not yet typed in @types/bun
import dashboardAppPath from "./dashboard-app.tsx" with { type: "file" };
import {
  type DashboardAction,
  DashboardStore,
  PERIOD_CYCLE,
} from "./dashboard-store.js";

/**
 * Inputs to a single fetch. Mirrors the relevant subset of the
 * existing `view.ts` fetch path so the caller can hand it through
 * to `queryAllWidgets` without this module knowing about Sentry's
 * widget query options.
 */
export type DashboardFetchOptions = {
  /** Period in `1h` / `24h` / `7d` / `30d` / `90d` form. */
  period: string;
};

/**
 * Caller-supplied callback that re-fetches widget data for the
 * given period and returns a fresh {@link DashboardViewData}. The
 * runtime calls this on `refresh`, `cycle-period`, and
 * auto-refresh ticks.
 *
 * Should resolve to the new view data on success or reject with an
 * Error whose `.message` will be surfaced in the status bar.
 */
export type DashboardFetcher = (
  options: DashboardFetchOptions
) => Promise<DashboardViewData>;

/** Runtime config + dependencies. */
export type RunInteractiveDashboardOptions = {
  /** Initial dashboard view data — already fetched by the caller. */
  initialData: DashboardViewData;
  /** Initial period (e.g. "24h"). Drives the cycle-period action. */
  initialPeriod: string;
  /** Re-fetch callback. See {@link DashboardFetcher}. */
  fetch: DashboardFetcher;
  /** Org slug — used for `o` (open in browser) action. */
  orgSlug: string;
  /**
   * Auto-refresh interval in milliseconds. `undefined` to disable
   * auto-refresh entirely; otherwise the user can toggle it on
   * with `R` and the runtime will fetch every `interval` ms.
   */
  autoRefreshIntervalMs?: number;
  /** Whether auto-refresh starts enabled (default false). */
  initialAutoRefresh?: boolean;
};

/**
 * Mount the interactive dashboard, drive the keyboard event loop,
 * and resolve when the user quits. Cleans up the renderer on
 * every exit path (success, throw, external abort).
 *
 * The fetched-data lifecycle:
 *
 *   1. Caller fetches initial data + passes it in via
 *      `initialData`. The store starts with this snapshot.
 *   2. User actions or auto-refresh ticks call the registered
 *      action dispatcher, which fires the `fetch` callback.
 *   3. Successful fetches replace the data via `store.setData`;
 *      React re-renders the App.
 *   4. On `quit`, the renderer is destroyed and the function
 *      returns.
 */
export async function runInteractiveDashboard(
  options: RunInteractiveDashboardOptions
): Promise<void> {
  // Lazy-import the heavy dependencies. Same imports as the
  // wizard's `OpenTuiUI` factory — keeps the npm/Node bundle
  // free of OpenTUI references at static-analysis time.
  const core = await import("@opentui/core");
  const reactBindings = await import("@opentui/react");
  const react = await import("react");
  const app = (await import(
    `${dashboardAppPath}?bridge=1`
  )) as typeof import("./dashboard-app.js");

  const renderer = await core.createCliRenderer({
    exitOnCtrlC: false,
    screenMode: "alternate-screen",
  });

  const store = new DashboardStore({
    data: options.initialData,
    currentPeriod: options.initialPeriod,
    autoRefreshIntervalMs: options.autoRefreshIntervalMs,
    autoRefreshEnabled: options.initialAutoRefresh ?? false,
  });

  // Promise that resolves when the user signals quit. The
  // dispatcher resolves it; `runInteractiveDashboard` awaits it
  // and falls through to teardown.
  let resolveQuit: () => void = () => {
    // populated synchronously below
  };
  const quitPromise = new Promise<void>((resolve) => {
    resolveQuit = resolve;
  });

  // Auto-refresh timer state. The interval ID is held in this
  // closure so the dispatcher can clear it on quit / disable.
  let autoRefreshTimer: ReturnType<typeof setInterval> | undefined;
  const stopAutoRefresh = (): void => {
    if (autoRefreshTimer !== undefined) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = undefined;
    }
  };

  // Track whether a fetch is currently in flight so we can avoid
  // overlapping requests when the user mashes `r` or auto-refresh
  // collides with a manual trigger.
  let fetchInFlight = false;

  /**
   * Run a fetch and apply the result to the store. Sets
   * `fetching: true` while the request is open; on success, swaps
   * in the fresh data; on failure, surfaces the error in the
   * status bar via `setFetchError`. Always clears the in-flight
   * flag.
   */
  const performFetch = async (period: string): Promise<void> => {
    if (fetchInFlight) {
      // Skip overlapping fetch — the in-flight request will
      // produce data shortly.
      return;
    }
    fetchInFlight = true;
    store.setFetching(true);
    try {
      const fresh = await options.fetch({ period });
      store.setData(fresh, period);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.setFetchError(message);
      logger.debug(`dashboard refresh failed: ${message}`);
    } finally {
      fetchInFlight = false;
    }
  };

  /**
   * Reset the auto-refresh interval. Called when the user
   * manually refreshes (so we don't fire again immediately) and
   * when toggling auto-refresh on. Honors the store's current
   * `autoRefreshEnabled` flag.
   */
  const restartAutoRefresh = (): void => {
    stopAutoRefresh();
    if (!store.getSnapshot().autoRefreshEnabled) {
      return;
    }
    const intervalMs = store.getSnapshot().autoRefreshIntervalMs;
    autoRefreshTimer = setInterval(() => {
      // Fire-and-forget — `performFetch` swallows its own errors
      // and surfaces them via `store.setFetchError`.
      performFetch(store.getSnapshot().currentPeriod).catch(() => {
        // unreachable — performFetch never rejects
      });
    }, intervalMs);
  };

  // Wire the action dispatcher. The App invokes
  // `store.dispatch({...})`; the store routes here.
  store.setActionDispatcher((action: DashboardAction) => {
    switch (action.kind) {
      case "refresh":
        performFetch(store.getSnapshot().currentPeriod).catch(() => {
          // unreachable — performFetch never rejects
        });
        // Also restart the auto-refresh interval so the next tick
        // is `intervalMs` from now, not from the previous one.
        restartAutoRefresh();
        break;
      case "cycle-period": {
        const current = store.getSnapshot().currentPeriod;
        const idx = PERIOD_CYCLE.indexOf(current);
        const nextIdx = (idx + 1) % PERIOD_CYCLE.length;
        const next = PERIOD_CYCLE[nextIdx] ?? PERIOD_CYCLE[0] ?? "24h";
        // Optimistically update the period in the header so the
        // user sees feedback immediately; the actual data follows.
        store.setCurrentPeriod(next);
        performFetch(next).catch(() => {
          // unreachable — performFetch never rejects
        });
        // Reset the auto-refresh interval so the next tick is
        // `intervalMs` from now, not from the previous tick —
        // matches the `refresh` action's behavior so user-driven
        // fetches always get a fresh interval window.
        restartAutoRefresh();
        break;
      }
      case "toggle-auto-refresh":
        store.setAutoRefreshEnabled(!store.getSnapshot().autoRefreshEnabled);
        restartAutoRefresh();
        break;
      case "open-in-browser": {
        // Reuse the URL the runtime already has on the data
        // snapshot rather than re-deriving it from the org +
        // dashboard id.
        const url = store.getSnapshot().data.url;
        // Use `openBrowser` directly (not `openInBrowser`) so we
        // skip the helper's "Opening in browser..." message and
        // QR-fallback prints — those write to `process.stdout`
        // which would corrupt the alternate-screen TUI. Browser
        // launch is fire-and-forget; failures get a debug log
        // entry and don't surface in the UI (they're rarely
        // actionable from a TUI keystroke).
        openBrowser(url).catch((err: unknown) => {
          logger.debug(
            `open-in-browser failed: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        });
        break;
      }
      case "quit":
        resolveQuit();
        break;
      default: {
        // Exhaustiveness check; if a new action kind is added the
        // type checker will flag this.
        const _: never = action;
        return _;
      }
    }
  });

  // Mount the React tree.
  const termWidth = renderer.terminalWidth ?? 100;
  const root = reactBindings.createRoot(renderer);
  root.render(
    react.createElement(app.App, {
      store,
      termWidth,
    })
  );

  // Re-render on terminal resize so widget widths track. The
  // `useTerminalDimensions` hook in App could pick this up, but
  // we don't currently use it — keep an explicit listener so
  // sizing stays correct.
  const onResize = (): void => {
    // Re-render with the new width prop. Since termWidth flows
    // as a prop (not via a hook), we have to re-render the root
    // explicitly to propagate the change.
    const newWidth = renderer.terminalWidth ?? 100;
    root.render(
      react.createElement(app.App, {
        store,
        termWidth: newWidth,
      })
    );
  };
  // OpenTUI's renderer emits "resize" via its event interface.
  // The exact emitter shape varies between versions; we prefer
  // `on("resize", ...)` if available, fallback to `process.stdout`.
  const rendererEvents = renderer as unknown as {
    on?: (event: string, cb: () => void) => void;
    off?: (event: string, cb: () => void) => void;
  };
  if (typeof rendererEvents.on === "function") {
    rendererEvents.on("resize", onResize);
  } else {
    process.stdout.on("resize", onResize);
  }

  // Start auto-refresh if it was enabled at construction time.
  restartAutoRefresh();

  // Block until the quit action fires.
  try {
    await quitPromise;
  } finally {
    // Clear the dispatcher first so any stray keystroke that
    // races teardown can't re-enter the action loop. Then stop
    // the auto-refresh timer (libuv interval handle) before
    // unmounting the React tree, then destroy the renderer
    // last — order matters because `renderer.destroy()` releases
    // the alternate-screen buffer + raw mode, which must happen
    // AFTER React commits its final unmount paint.
    store.setActionDispatcher(undefined);
    stopAutoRefresh();
    if (typeof rendererEvents.off === "function") {
      rendererEvents.off("resize", onResize);
    } else {
      process.stdout.off("resize", onResize);
    }
    try {
      root.unmount();
    } catch {
      // Ignore — disposal must never throw.
    }
    try {
      renderer.destroy();
    } catch {
      // Ignore.
    }
  }
}
