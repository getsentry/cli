---
name: sentry-cli-explore
version: 0.35.0-dev.0
description: Query aggregate event data (Explore)
requires:
  bins: ["sentry"]
  auth: true
---

# Explore Commands

Query aggregate event data (Explore)

### `sentry explore <target>`

Query aggregate event data (Explore)

**Flags:**
- `-F, --field <value>... - API field or aggregate (repeatable). E.g., title, "count()", "p50(transaction.duration)"`
- `-m, --metric <value> - Metric name for --dataset metrics. Auto-resolves type/unit via API.`
- `--agg <value> - Aggregation for --metric (sum, avg, count, p50, p95, etc.) - (default: "sum")`
- `-d, --dataset <value> - Dataset to query (errors, spans, metrics, logs, replays) - (default: "errors")`
- `-q, --query <value> - Search query (Sentry search syntax)`
- `-s, --sort <value> - Sort field (prefix with - for desc, e.g., "-count()")`
- `-e, --environment <value>... - Replay environment filter for --dataset replays (repeatable, comma-separated)`
- `-n, --limit <value> - Number of rows (1-1000) - (default: "25")`
- `-t, --period <value> - Time range: "7d", "2026-04-01..2026-05-01", ">=2026-04-01" - (default: "24h")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
