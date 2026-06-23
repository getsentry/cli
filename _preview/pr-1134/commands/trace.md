---
title: "trace"
description: "Trace commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1134/commands/trace/"
---

# trace

View distributed traces

## Commands

[Section titled “Commands”](#commands)

### `sentry trace list <org/project>`

[Section titled “sentry trace list <org/project>”](#sentry-trace-list-orgproject)

List recent traces in a project

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project>` | <org>/<project> or <project> (search) |

**Options:**

| Option | Description |
| --- | --- |
| `-n, --limit <limit>` | Number of traces (1-1000) (default: "25") |
| `-q, --query <query>` | Search query (Sentry search syntax) |
| `-s, --sort <sort>` | Sort by: date, duration (default: "date") |
| `-t, --period <period>` | Time range: "7d", "2026-05-01..2026-06-01", ">=2026-05-01" (default: "7d") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry trace view <org/project/trace-id...>`

[Section titled “sentry trace view <org/project/trace-id...>”](#sentry-trace-view-orgprojecttrace-id)

View details of a specific trace

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project/trace-id...>` | [<org>/<project>/]<trace-id> - Target (optional) and trace ID (required) |

**Options:**

| Option | Description |
| --- | --- |
| `-w, --web` | Open in browser |
| `--full` | Fetch full span attributes (auto-enabled with --json) |
| `--spans <spans>` | Span tree depth limit (number, "all" for unlimited, "no" to disable) (default: "3") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry trace logs <org/project/trace-id...>`

[Section titled “sentry trace logs <org/project/trace-id...>”](#sentry-trace-logs-orgprojecttrace-id)

View logs associated with a trace

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project/trace-id...>` | [<org>/[<project>/]]<trace-id> - Optional org/project and required trace ID |

**Options:**

| Option | Description |
| --- | --- |
| `-w, --web` | Open trace in browser |
| `-t, --period <period>` | Time range: "7d", "2026-05-01..2026-06-01", ">=2026-05-01" (default: "14d") |
| `-n, --limit <limit>` | Number of log entries (<=1000) (default: "100") |
| `-q, --query <query>` | Filter query (e.g., "level:error", "project:backend", "project:[a,b]") |
| `-s, --sort <sort>` | Sort order: "newest" (default) or "oldest" (default: "newest") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)

### List traces

[Section titled “List traces”](#list-traces)
Terminal window

```
# List last 20 traces (default)sentry trace list
# Sort by slowest firstsentry trace list --sort duration
# Filter by transaction name, last 24 hourssentry trace list -q "transaction:GET /api/users" --period 24h
# Paginate through resultssentry trace list my-org/backend -c next
```


### View a trace

[Section titled “View a trace”](#view-a-trace)
Terminal window

```
# View trace details with span treesentry trace view abc123def456abc123def456abc12345
# Open trace in browsersentry trace view abc123def456abc123def456abc12345 -w
# Auto-recover from an issue short IDsentry trace view PROJ-123
```


### Cross-project traces

[Section titled “Cross-project traces”](#cross-project-traces)
Terminal window

```
# Filter trace view to one project's spanssentry trace view my-org/cli-server/abc123def456abc123def456abc12345
# Full trace across all projects (default)sentry trace view my-org/abc123def456abc123def456abc12345
# Filter trace logs by projectsentry trace logs my-org/cli-server/abc123def456abc123def456abc12345
# Multiple projects via --querysentry trace logs abc123def456abc123def456abc12345 -q "project:[cli-server,api]"
```


### View trace logs

[Section titled “View trace logs”](#view-trace-logs)
Terminal window

```
# View logs for a tracesentry trace logs abc123def456abc123def456abc12345
# Search with a longer time windowsentry trace logs --period 30d abc123def456abc123def456abc12345
# Filter logs within a tracesentry trace logs -q 'level:error' abc123def456abc123def456abc12345
```
