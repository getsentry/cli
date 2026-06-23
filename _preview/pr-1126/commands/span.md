---
title: "span"
description: "Span commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1126/commands/span/"
---

# span

List and view spans in projects or traces

## Commands

[Section titled “Commands”](#commands)

### `sentry span list <org/project/trace-id...>`

[Section titled “sentry span list <org/project/trace-id...>”](#sentry-span-list-orgprojecttrace-id)

List spans in a project or trace

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project/trace-id...>` | [<org>/<project>] or [<org>/<project>/]<trace-id> |

**Options:**

| Option | Description |
| --- | --- |
| `-n, --limit <limit>` | Number of spans (<=1000) (default: "25") |
| `-q, --query <query>` | Filter spans (e.g., "op:db", "project:backend", "project:[cli,api]") |
| `-s, --sort <sort>` | Sort order: date, duration (default: "date") |
| `-t, --period <period>` | Time range: "7d", "2026-05-01..2026-06-01", ">=2026-05-01" (default: "7d") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry span view <trace-id/span-id...>`

[Section titled “sentry span view <trace-id/span-id...>”](#sentry-span-view-trace-idspan-id)

View details of specific spans

**Arguments:**

| Argument | Description |
| --- | --- |
| `<trace-id/span-id...>` | [<org>/<project>/]<trace-id> <span-id> [<span-id>...] - Trace ID and one or more span IDs |

**Options:**

| Option | Description |
| --- | --- |
| `--spans <spans>` | Span tree depth limit (number, "all" for unlimited, "no" to disable) (default: "3") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)

### List spans

[Section titled “List spans”](#list-spans)
Terminal window

```
# List recent spans in the current projectsentry span list
# Find all DB spanssentry span list -q "op:db"
# Slow spans in the last 24 hourssentry span list -q "duration:>100ms" --period 24h
# List spans within a specific tracesentry span list abc123def456abc123def456abc12345
# Paginate through resultssentry span list -c next
```


### Filter by project in a trace

[Section titled “Filter by project in a trace”](#filter-by-project-in-a-trace)
Terminal window

```
# Show only spans from one project within a tracesentry span list my-org/cli-server/abc123def456abc123def456abc12345
# Or use --query to filter by projectsentry span list abc123def456abc123def456abc12345 -q "project:cli-server"
# Multiple projects at oncesentry span list abc123def456abc123def456abc12345 -q "project:[cli-server,api]"
```


### View spans

[Section titled “View spans”](#view-spans)
Terminal window

```
# View a single spansentry span view abc123def456abc123def456abc12345 a1b2c3d4e5f67890
# View multiple spans at oncesentry span view abc123def456abc123def456abc12345 a1b2c3d4e5f67890 b2c3d4e5f6789012
# With explicit org/projectsentry span view my-org/backend/abc123def456abc123def456abc12345 a1b2c3d4e5f67890
```
