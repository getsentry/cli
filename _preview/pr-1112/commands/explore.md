---
title: "explore"
description: "Explore command for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1112/commands/explore/"
---

# explore

Query aggregate event data (Explore)

## Usage

[Section titled “Usage”](#usage)

### `sentry explore <target>`

[Section titled “sentry explore <target>”](#sentry-explore-target)

Query aggregate event data (Explore)

**Arguments:**

| Argument | Description |
| --- | --- |
| `<target>` | Target: <org>/<project>, <org>/, or <project>. Auto-detected if omitted. |

**Options:**

| Option | Description |
| --- | --- |
| `-F, --field <field>...` | API field or aggregate (repeatable). E.g., title, "count()", "p50(transaction.duration)" |
| `-m, --metric <metric>` | Metric name for --dataset metrics. Auto-resolves type/unit via API. |
| `--agg <agg>` | Aggregation for --metric (sum, avg, count, p50, p95, etc.) (default: "sum") |
| `-d, --dataset <dataset>` | Dataset to query (errors, spans, metrics, logs, replays) (default: "errors") |
| `-q, --query <query>` | Search query (Sentry search syntax) |
| `-s, --sort <sort>` | Sort field (prefix with - for desc, e.g., "-count()") |
| `-e, --environment <environment>...` | Replay environment filter for --dataset replays (repeatable, comma-separated) |
| `-n, --limit <limit>` | Number of rows (1-1000) (default: "25") |
| `-t, --period <period>` | Time range: "7d", "2026-05-01..2026-06-01", ">=2026-05-01" (default: "24h") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)

### Top errors (default)

[Section titled “Top errors (default)”](#top-errors-default)
Terminal window

```
# Top errors in the last 24 hours, scoped to a projectsentry explore my-org/cli
# All projects in an orgsentry explore my-org/
# Bare project slug (searches across orgs)sentry explore cli
# Auto-detect from DSN/configsentry explore
```


### Spike analysis

[Section titled “Spike analysis”](#spike-analysis)
Terminal window

```
# Errors with user impact for a specific UTC windowsentry explore my-org/cli -F title -F "count()" -F "count_unique(user)" \  --period "2024-01-15T00:00:00Z/2024-01-16T00:00:00Z"
# Filter by specific error type (combines with auto-injected project filter)sentry explore my-org/cli -F title -F "count()" \  -q "error.type:TypeError" --period 1h
```


### Span queries (performance)

[Section titled “Span queries (performance)”](#span-queries-performance)
Terminal window

```
# Span operation latency by routesentry explore my-org/cli -F span.op -F "p50(span.duration)" \  -F "p95(span.duration)" --dataset spans --period 1h
# Top spans by countsentry explore my-org/cli -F span.op -F "count()" \  --dataset spans --sort "-count()"
```


### Metrics

[Section titled “Metrics”](#metrics)

Use `--metric` (`-m`) to query metrics by name. The CLI auto-resolves the metric's type and unit.

Terminal window

```
# Sum a custom metric (e.g., LLM token usage) across an orgsentry explore my-org/ -m llm.token_usage --dataset metrics --period 7d
# Break down by a tag column (e.g., model name)sentry explore my-org/seer -F gen_ai.request.model \  -m llm.token_usage --dataset metrics --period 7d
# Use a different aggregation (default is sum)sentry explore my-org/ -m cache.hit_rate --agg avg --dataset metrics
```


You can also use the raw tracemetrics format: `aggregation(value,metric_name,metric_type,unit)`.

Terminal window

```
sentry explore my-org/ \  -F "sum(value,llm.token_usage,distribution,none)" \  --dataset metrics --period 7d
```


### Logs

[Section titled “Logs”](#logs)
Terminal window

```
# Log severity counts in the last hoursentry explore my-org/cli -F severity -F "count()" \  --dataset logs --period 1h
```


### JSON output for scripting

[Section titled “JSON output for scripting”](#json-output-for-scripting)
Terminal window

```
# Pipe to jq for filteringsentry explore my-org/cli -F title -F "count()" --json | jq '.data[:5]'
# Get raw data for analysissentry explore my-org/cli -F title -F "count()" -F "count_unique(user)" \  --json --limit 100
```


## Target Patterns

[Section titled “Target Patterns”](#target-patterns)

| Target | Behavior |
| --- | --- |
| `<org>/<project>` | Auto-adds `project:<slug>` to query |
| `<org>/` | All projects in org (no project filter) |
| `<project>` | Searches for project across all accessible orgs |
| (omitted) | Auto-detect from DSN/config |
