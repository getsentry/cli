---
name: sentry-cli-explore
version: 0.30.0-dev.0
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
- `-d, --dataset <value> - Dataset to query (errors, transactions, spans, discover) - (default: "errors")`
- `-q, --query <value> - Search query (Sentry search syntax)`
- `-s, --sort <value> - Sort field (prefix with - for desc, e.g., "-count()")`
- `-n, --limit <value> - Number of rows (1-1000) - (default: "25")`
- `-t, --period <value> - Time range: "7d", "2026-03-01..2026-04-01", ">=2026-03-01" - (default: "7d")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

**Examples:**

```bash
# Top errors in the last 24 hours, scoped to a project
sentry explore my-org/cli

# All projects in an org
sentry explore my-org/

# Bare project slug (searches across orgs)
sentry explore cli

# Auto-detect from DSN/config
sentry explore

# Errors with user impact for a specific UTC window
sentry explore my-org/cli -F title -F "count()" -F "count_unique(user)" \
  --period "2024-01-15T00:00:00Z/2024-01-16T00:00:00Z"

# Filter by specific error type (combines with auto-injected project filter)
sentry explore my-org/cli -F title -F "count()" \
  -q "error.type:TypeError" --period 1h

# Transaction p50/p95 by endpoint
sentry explore my-org/cli -F transaction \
  -F "p50(transaction.duration)" -F "p95(transaction.duration)" \
  --dataset transactions --period 1h

# Slowest transactions
sentry explore my-org/cli -F transaction -F "avg(transaction.duration)" \
  --dataset transactions

# Span operations by count
sentry explore my-org/cli -F span.op -F "count()" \
  --dataset spans --period 1h

# Sort by count (sort is supported on spans dataset)
sentry explore my-org/cli -F span.op -F "count()" \
  --dataset spans --sort "-count()"

# Pipe to jq for filtering
sentry explore my-org/cli -F title -F "count()" --json | jq '.data[:5]'

# Get raw data for analysis
sentry explore my-org/cli -F title -F "count()" -F "count_unique(user)" \
  --json --limit 100
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
