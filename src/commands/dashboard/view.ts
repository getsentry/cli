/**
 * sentry dashboard view
 *
 * View a dashboard with rendered widget data (sparklines, tables, big numbers).
 * Supports --refresh for auto-refreshing live display.
 */

import type { SentryContext } from "../../context.js";
import { getDashboard, queryAllWidgets } from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import type { DashboardViewData } from "../../lib/formatters/dashboard.js";
import { createDashboardViewRenderer } from "../../lib/formatters/dashboard.js";
import { ClearScreen, CommandOutput } from "../../lib/formatters/output.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { logger } from "../../lib/logger.js";
import { withProgress } from "../../lib/polling.js";
import { resolveOrgRegion } from "../../lib/region.js";
import { buildDashboardUrl } from "../../lib/sentry-urls.js";
import {
  formatTimeRangeFlag,
  PERIOD_BRIEF,
  parsePeriod,
  TIME_RANGE_24H,
  type TimeRange,
  timeRangeToSeconds,
} from "../../lib/time-range.js";
import type {
  DashboardWidget,
  WidgetDataResult,
} from "../../types/dashboard.js";
import {
  enrichDashboardError,
  parseDashboardPositionalArgs,
  resolveDashboardId,
  resolveOrgFromTarget,
} from "./resolve.js";

/**
 * True when the dashboard should mount the interactive Bun-binary
 * TUI rather than the static one-shot renderer. Requires a
 * real TTY on both stdin (for keystrokes) and stdout (for the
 * alternate-screen takeover) AND non-JSON output mode AND the
 * Bun runtime (where the OpenTUI bindings can load).
 *
 * Stays a function rather than a boolean so the test suite can
 * mock TTY-ness per-test without import-order timing issues.
 *
 * The `stdout` argument is the Writer from `SentryContext`. We
 * read `.isTTY` via a structural type because the `Writer` shape
 * deliberately omits TTY metadata to keep library-mode consumers
 * pluggable — but in practice the production stdout is
 * `process.stdout` and exposes the flag.
 */
function isInteractiveContext(
  flags: ViewFlags,
  stdin: NodeJS.ReadStream,
  stdout: { isTTY?: boolean }
): boolean {
  if (flags.json) {
    return false;
  }
  if (!(stdin.isTTY && stdout.isTTY)) {
    return false;
  }
  // The Bun-compiled binary exposes `process.versions.bun`. The
  // npm/Node distribution doesn't. The interactive runtime
  // imports OpenTUI which only loads under Bun.
  return typeof process.versions.bun === "string";
}

/** Default auto-refresh interval in seconds */
const DEFAULT_REFRESH_INTERVAL = 60;

/** Minimum auto-refresh interval in seconds (avoid rate limiting) */
const MIN_REFRESH_INTERVAL = 10;

type ViewFlags = {
  readonly web: boolean;
  readonly fresh: boolean;
  readonly refresh?: number;
  readonly period?: TimeRange;
  readonly json: boolean;
  readonly fields?: string[];
};

/**
 * Parse --refresh flag value.
 * Supports: -r (empty string → 60s default), -r 30 (explicit interval in seconds)
 */
function parseRefresh(value: string): number {
  if (value === "") {
    return DEFAULT_REFRESH_INTERVAL;
  }
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num) || num < MIN_REFRESH_INTERVAL) {
    throw new Error(
      `--refresh interval must be at least ${MIN_REFRESH_INTERVAL} seconds`
    );
  }
  return num;
}

/**
 * Sleep that resolves early when an AbortSignal fires.
 * Resolves (not rejects) on abort for clean generator shutdown.
 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Build the DashboardViewData from a dashboard and its widget query results.
 *
 * The returned object is also passed through {@link tryPreRenderTui}
 * before being yielded so the OpenTUI string lives on the data
 * itself — keeps the human renderer synchronous while letting us
 * await the async OpenTUI rendering in the command body.
 */
function buildViewData(
  dashboard: {
    id: string;
    title: string;
    dateCreated?: string;
    environment?: string[];
  },
  widgetResults: Map<number, WidgetDataResult>,
  widgets: DashboardWidget[],
  opts: { period: string; url: string }
): DashboardViewData {
  return {
    id: dashboard.id,
    title: dashboard.title,
    period: opts.period,
    fetchedAt: new Date().toISOString(),
    url: opts.url,
    dateCreated: dashboard.dateCreated,
    environment: dashboard.environment,
    widgets: widgets.map((w, i) => ({
      title: w.title,
      displayType: w.displayType,
      widgetType: w.widgetType,
      description: (w as Record<string, unknown>).description as
        | string
        | undefined,
      layout: w.layout,
      queries: w.queries,
      data: widgetResults.get(i) ?? {
        type: "error" as const,
        message: "No data returned",
      },
    })),
  };
}

/**
 * Try to pre-render the dashboard with OpenTUI. Returns the
 * passed-in data with `rendered` populated on success; returns
 * the original data unchanged on failure (e.g. on the npm/Node
 * distribution where OpenTUI's native bindings can't load).
 *
 * Skipped entirely in JSON mode — JSON output uses the raw data
 * shape, so there's no point spending the render cycles.
 *
 * **Lazy import.** `dashboard-tui.js` is loaded via dynamic
 * `await import()` (rather than a top-level `import` statement)
 * so its module-level `with { type: "file" }` resolution and
 * heavy OpenTUI dependencies never load when this command isn't
 * the one being run. Tests that walk the Stricli route map (via
 * `app.ts`) would otherwise eagerly evaluate the OpenTUI side
 * effects and fail with module-cache-collision errors the same
 * way the wizard's `OpenTuiUI` did before its `?bridge=1` fix.
 */
async function tryPreRenderTui(
  data: DashboardViewData,
  flags: ViewFlags
): Promise<DashboardViewData> {
  if (flags.json) {
    return data;
  }
  try {
    const { renderDashboardTui } = await import(
      "../../lib/formatters/dashboard-tui.js"
    );
    const rendered = await renderDashboardTui(data);
    return { ...data, rendered };
  } catch (err) {
    // Fall back to the plain-text formatter. The human renderer
    // checks `data.rendered === undefined` and uses
    // `formatDashboardWithData` in that case. We log at debug
    // level so a missing-binding diagnosis is recoverable; we
    // don't surface to the user because the fallback is fully
    // functional.
    logger.debug(
      `OpenTUI dashboard render unavailable, using plain-text fallback: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return data;
  }
}

/**
 * Resolve the effective time range for a dashboard view.
 *
 * Priority: explicit --period flag > dashboard's saved period > 24h default.
 * Dashboard period is a raw string from the API that needs parsing.
 */
function resolveViewTimeRange(
  flagPeriod: TimeRange | undefined,
  dashboardPeriod: string | null | undefined
): TimeRange {
  if (flagPeriod) {
    return flagPeriod;
  }
  return dashboardPeriod ? parsePeriod(dashboardPeriod) : TIME_RANGE_24H;
}

/**
 * Inputs for the interactive dashboard runtime. Bundled into a
 * single object so the helper can stay readable instead of
 * threading 9+ positional args.
 */
type InteractiveContext = {
  regionUrl: string;
  orgSlug: string;
  url: string;
  dashboard: Awaited<ReturnType<typeof getDashboard>>;
  widgets: DashboardWidget[];
  widgetTimeOpts:
    | { period: string }
    | { start: string | undefined; end: string | undefined };
  /**
   * Seconds covered by the current period. `undefined` is the
   * legitimate "couldn't compute" return from `timeRangeToSeconds`
   * for malformed absolute ranges; downstream API code accepts
   * undefined and falls back to its own period parsing.
   */
  periodSeconds: number | undefined;
  timeRange: TimeRange;
  /** From `flags.refresh` — undefined when auto-refresh is off. */
  refreshSeconds: number | undefined;
};

/**
 * Fetch initial widget data and hand off to the OpenTUI runtime.
 *
 * Returns `true` when the runtime took over and ran to user-quit;
 * the caller should `return` from `func()` immediately. Returns
 * `false` when the runtime is unavailable (npm/Node distribution,
 * unusual environment) so the caller can fall through to the
 * non-interactive path.
 *
 * Lazy-imports `dashboard-runtime.js` for the same reason
 * `tryPreRenderTui` lazy-imports `dashboard-tui.js`: keep
 * OpenTUI references out of the npm bundle's static module
 * graph.
 */
async function tryRunInteractive(ctx: InteractiveContext): Promise<boolean> {
  // Initial fetch happens before mounting the renderer so any
  // error (auth, 404, network) surfaces in the normal stderr
  // stream rather than getting wiped by the alternate-screen
  // takeover.
  const initialWidgetData = await withProgress(
    { message: "Querying widget data...", json: false },
    () =>
      queryAllWidgets(ctx.regionUrl, ctx.orgSlug, ctx.dashboard, {
        ...ctx.widgetTimeOpts,
        periodSeconds: ctx.periodSeconds,
      })
  );
  const initialData = buildViewData(
    ctx.dashboard,
    initialWidgetData,
    ctx.widgets,
    { period: formatTimeRangeFlag(ctx.timeRange), url: ctx.url }
  );

  try {
    const { runInteractiveDashboard } = await import(
      "../../lib/formatters/dashboard-runtime.js"
    );
    await runInteractiveDashboard({
      initialData,
      initialPeriod: formatTimeRangeFlag(ctx.timeRange),
      orgSlug: ctx.orgSlug,
      fetch: async ({ period }) => {
        const fresh = await queryAllWidgets(
          ctx.regionUrl,
          ctx.orgSlug,
          ctx.dashboard,
          { period, periodSeconds: timeRangeToSeconds(parsePeriod(period)) }
        );
        return buildViewData(ctx.dashboard, fresh, ctx.widgets, {
          period,
          url: ctx.url,
        });
      },
      autoRefreshIntervalMs:
        ctx.refreshSeconds !== undefined
          ? ctx.refreshSeconds * 1000
          : undefined,
      initialAutoRefresh: ctx.refreshSeconds !== undefined,
    });
    return true;
  } catch (err) {
    logger.debug(
      `Interactive dashboard unavailable, falling back to static render: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return false;
  }
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View a dashboard",
    fullDescription:
      "View a Sentry dashboard with rendered widget data.\n\n" +
      "Fetches actual data for each widget and displays sparkline charts,\n" +
      "tables, and big numbers in the terminal.\n\n" +
      "The dashboard can be specified by numeric ID or title.\n\n" +
      "Examples:\n" +
      "  sentry dashboard view 12345\n" +
      "  sentry dashboard view 'My Dashboard'\n" +
      "  sentry dashboard view my-org 12345\n" +
      "  sentry dashboard view my-org 'My Dashboard'\n" +
      "  sentry dashboard view my-org/my-project 12345\n" +
      "  sentry dashboard view 12345 --json\n" +
      "  sentry dashboard view 12345 --period 7d\n" +
      "  sentry dashboard view 12345 -r\n" +
      "  sentry dashboard view 12345 -r 30\n" +
      "  sentry dashboard view 12345 --web",
  },
  output: {
    human: createDashboardViewRenderer,
    // `rendered` is the pre-baked OpenTUI ANSI string that the
    // human renderer prints directly. Strip it from JSON output —
    // machine consumers want the structured widget data, not a
    // pre-formatted screen capture.
    jsonExclude: ["rendered"],
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "org/project/dashboard",
        brief: "[<org/project>] <dashboard-id-or-title>",
        parse: String,
      },
    },
    flags: {
      web: {
        kind: "boolean",
        brief: "Open in browser",
        default: false,
      },
      fresh: FRESH_FLAG,
      refresh: {
        kind: "parsed",
        parse: parseRefresh,
        brief: "Auto-refresh interval in seconds (default: 60, min: 10)",
        optional: true,
        inferEmpty: true,
      },
      period: {
        kind: "parsed",
        parse: parsePeriod,
        brief: PERIOD_BRIEF,
        optional: true,
      },
    },
    aliases: { ...FRESH_ALIASES, w: "web", r: "refresh", t: "period" },
  },
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sequential dispatch across web/interactive/refresh-poll/single-fetch modes is inherently flat; further splitting would spread one logical flow across multiple helpers without simplifying the branching
  async *func(this: SentryContext, flags: ViewFlags, ...args: string[]) {
    applyFreshFlag(flags);
    const { cwd } = this;

    const { dashboardRef, targetArg } = parseDashboardPositionalArgs(args);
    const parsed = parseOrgProjectArg(targetArg);
    const orgSlug = await resolveOrgFromTarget(
      parsed,
      cwd,
      "sentry dashboard view <org>/ <id>"
    );
    const dashboardId = await resolveDashboardId(orgSlug, dashboardRef);
    const url = buildDashboardUrl(orgSlug, dashboardId);

    if (flags.web) {
      await openInBrowser(url, "dashboard");
      return;
    }

    // Fetch the dashboard definition (widget structure)
    const dashboard = await withProgress(
      { message: "Fetching dashboard...", json: flags.json },
      () => getDashboard(orgSlug, dashboardId)
    ).catch((error: unknown) =>
      enrichDashboardError(error, {
        orgSlug,
        dashboardId,
        operation: "view",
      })
    );

    const regionUrl = await resolveOrgRegion(orgSlug);
    const timeRange = resolveViewTimeRange(flags.period, dashboard.period);
    const periodSeconds = timeRangeToSeconds(timeRange);
    // WidgetQueryOptions uses `period` (not `statsPeriod`) for the relative field
    const widgetTimeOpts =
      timeRange.type === "relative"
        ? { period: timeRange.period }
        : { start: timeRange.start, end: timeRange.end };
    const widgets = dashboard.widgets ?? [];

    // Interactive path — Bun binary, real TTY, non-JSON. Mounts a
    // long-lived OpenTUI app that owns the alternate screen until
    // the user quits. The `--refresh N` flag becomes "start with
    // auto-refresh enabled at N-second interval"; without it,
    // auto-refresh starts off and the user can toggle with `R`.
    if (
      isInteractiveContext(
        flags,
        this.stdin,
        // The Writer type doesn't expose `isTTY` (kept abstract
        // for library-mode consumers), but the production stdout
        // is `process.stdout` and does. Cast to read the flag
        // without coupling Writer to Node's stream shape.
        this.stdout as unknown as { isTTY?: boolean }
      )
    ) {
      const handled = await tryRunInteractive({
        regionUrl,
        orgSlug,
        url,
        dashboard,
        widgets,
        widgetTimeOpts,
        periodSeconds,
        timeRange,
        refreshSeconds: flags.refresh,
      });
      if (handled) {
        return;
      }
      // tryRunInteractive returned false → fall through to the
      // non-interactive paths below.
    }

    if (flags.refresh !== undefined) {
      // ── Refresh mode: poll and re-render ──
      const interval = flags.refresh;
      if (!flags.json) {
        logger.info(
          `Auto-refreshing dashboard every ${interval}s. Press Ctrl+C to stop.`
        );
      }

      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once("SIGINT", stop);

      // Library mode: honor external abort signal (e.g., consumer break)
      const externalSignal = (this.process as { abortSignal?: AbortSignal })
        ?.abortSignal;
      if (externalSignal) {
        externalSignal.addEventListener("abort", stop, { once: true });
      }

      let isFirstRender = true;

      try {
        while (!controller.signal.aborted) {
          const widgetData = await queryAllWidgets(
            regionUrl,
            orgSlug,
            dashboard,
            { ...widgetTimeOpts, periodSeconds }
          );

          // Build output data before clearing so clear→render is
          // instantaneous. `tryPreRenderTui` runs the OpenTUI
          // pipeline (Bun binary) or short-circuits to the
          // plain-text fallback (Node) — either way we yield a
          // `CommandOutput` carrying ready-to-print state.
          const viewData = await tryPreRenderTui(
            buildViewData(dashboard, widgetData, widgets, {
              period: formatTimeRangeFlag(timeRange),
              url,
            }),
            flags
          );

          if (!isFirstRender) {
            yield new ClearScreen();
          }
          isFirstRender = false;

          yield new CommandOutput(viewData);

          await abortableSleep(interval * 1000, controller.signal);
        }
      } finally {
        process.removeListener("SIGINT", stop);
      }
      return;
    }

    // ── Single fetch mode ──
    const widgetData = await withProgress(
      { message: "Querying widget data...", json: flags.json },
      () =>
        queryAllWidgets(regionUrl, orgSlug, dashboard, {
          ...widgetTimeOpts,
          periodSeconds,
        })
    );

    yield new CommandOutput(
      await tryPreRenderTui(
        buildViewData(dashboard, widgetData, widgets, {
          period: formatTimeRangeFlag(timeRange),
          url,
        }),
        flags
      )
    );
    return { hint: `Dashboard: ${url}` };
  },
});
