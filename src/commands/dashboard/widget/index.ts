import { buildRouteMap } from "@stricli/core";
import { addCommand } from "./add.js";
import { deleteCommand } from "./delete.js";
import { editCommand } from "./edit.js";

export const widgetRoute = buildRouteMap({
  routes: {
    add: addCommand,
    edit: editCommand,
    delete: deleteCommand,
  },
  docs: {
    brief: "Manage dashboard widgets",
    fullDescription:
      "Add, edit, or delete widgets in a Sentry dashboard.\n\n" +
      "Dashboards use a 6-column grid. Widget widths should sum to 6 per row.\n\n" +
      "Display types (width × height):\n" +
      "  common:      big_number (2×1), line (3×2), area (3×2), bar (3×2), table (6×2)\n" +
      "  specialized: stacked_area (3×2), top_n (3×2), categorical_bar (3×2), text (3×2)\n" +
      "  internal:    details (3×2), wheel (3×2), rage_and_dead_clicks (3×2),\n" +
      "               server_tree (3×2), agents_traces_table (3×2)\n\n" +
      "Datasets: spans (default), discover, issue, error-events, transaction-like,\n" +
      "          metrics, logs, tracemetrics, preprod-app-size\n\n" +
      "Aggregates (spans): count, count_unique, sum, avg, percentile, p50, p75,\n" +
      "  p90, p95, p99, p100, eps, epm, any, min, max\n" +
      "Aggregates (discover adds): failure_count, failure_rate, apdex,\n" +
      "  count_miserable, user_misery, count_web_vitals, count_if, count_at_least,\n" +
      "  last_seen, latest_event, var, stddev, cov, corr, performance_score,\n" +
      "  opportunity_score, count_scores\n" +
      "Aliases: spm → epm, sps → eps, tpm → epm, tps → eps\n\n" +
      "Row-filling examples:\n" +
      "  # 3 KPIs (2+2+2 = 6)\n" +
      '  sentry dashboard widget add <d> "Error Count" --display big_number --query count\n' +
      '  sentry dashboard widget add <d> "P95" --display big_number --query p95:span.duration\n' +
      '  sentry dashboard widget add <d> "Throughput" --display big_number --query epm\n\n' +
      "  # 2 charts (3+3 = 6)\n" +
      '  sentry dashboard widget add <d> "Errors" --display line --query count\n' +
      '  sentry dashboard widget add <d> "Latency" --display line --query p95:span.duration\n\n' +
      "  # Full-width table (6 = 6)\n" +
      '  sentry dashboard widget add <d> "Top Endpoints" --display table \\\n' +
      "    --query count --query p95:span.duration --group-by transaction \\\n" +
      "    --sort -count --limit 10\n\n" +
      "Commands:\n" +
      "  add    Add a widget to a dashboard\n" +
      "  edit   Edit a widget in a dashboard\n" +
      "  delete Delete a widget from a dashboard",
    hideRoute: {},
  },
});
