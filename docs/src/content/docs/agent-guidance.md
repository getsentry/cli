---
title: Agent Guidance
description: Operational guidance for AI coding agents using the Sentry CLI
---

Best practices and operational guidance for AI coding agents using the Sentry CLI.

## Key Principles

- **Just run the command** — the CLI handles authentication and org/project detection automatically. Don't pre-authenticate or look up org/project before running commands. If auth is needed, the CLI prompts interactively.
- **Prefer CLI commands over raw API calls** — the CLI has dedicated commands for most tasks. Reach for `sentry issue view`, `sentry issue list`, `sentry trace view`, etc. before constructing API calls manually or fetching external documentation.
- **Use `sentry schema` to explore the API** — if you need to discover API endpoints, run `sentry schema` to browse interactively or `sentry schema <resource>` to search. This is faster than fetching OpenAPI specs externally.
- **Use `sentry issue view <id>` to investigate issues** — when asked about a specific issue (e.g., `CLI-G5`, `PROJECT-123`), use `sentry issue view` directly.
- **Use `--json` for machine-readable output** — pipe through `jq` for filtering. Human-readable output includes formatting that is hard to parse.
- **The CLI auto-detects org/project** — most commands work without explicit targets by scanning for DSNs in `.env` files, source code, config defaults, and directory names. Only specify `<org>/<project>` when the CLI reports it can't detect the target or detects the wrong one.

## Design Principles

The `sentry` CLI follows conventions from well-known tools — if you're familiar with them, that knowledge transfers directly:

- **`gh` (GitHub CLI) conventions**: The `sentry` CLI uses the same `<noun> <verb>` command pattern (e.g., `sentry issue list`, `sentry org view`). Flags follow `gh` conventions: `--json` for machine-readable output, `--fields` to select specific fields, `-w`/`--web` to open in browser, `-q`/`--query` for filtering, `-n`/`--limit` for result count.
- **`sentry api` mimics `curl`**: The `sentry api` command provides direct API access with a `curl`-like interface — `--method` for HTTP method, `--data` for request body, `--header` for custom headers. It handles authentication automatically. If you know how to call a REST API with `curl`, the same patterns apply.

## Context Window Tips

- Use `--json --fields` to select specific fields and reduce output size. Run `<command> --help` to see available fields. Example: `sentry issue list --json --fields shortId,title,priority,level,status`
- Use `--json` when piping output between commands or processing programmatically
- Use `--limit` to cap the number of results (default is usually 10–100)
- Prefer `sentry issue view PROJECT-123` over listing and filtering manually
- Use `sentry api` for endpoints not covered by dedicated commands

## Safety Rules

- Always confirm with the user before running destructive commands: `project delete`, `trial start`
- For mutations, verify the org/project context looks correct in the command output before proceeding with further changes
- Never store or log authentication tokens — the CLI manages credentials automatically
- If the CLI reports the wrong org/project, override with explicit `<org>/<project>` arguments

## Workflow Patterns

### Investigate an Issue

```bash
# 1. Find the issue (auto-detects org/project from DSN or config)
sentry issue list --query "is:unresolved" --limit 5

# 2. Get details
sentry issue view PROJECT-123

# 3. Get AI root cause analysis
sentry issue explain PROJECT-123

# 4. Get a fix plan
sentry issue plan PROJECT-123
```

### Explore Traces and Performance

```bash
# 1. List recent traces (auto-detects org/project)
sentry trace list --limit 5

# 2. View a specific trace with span tree
sentry trace view abc123def456...

# 3. View spans for a trace
sentry span list abc123def456...

# 4. View logs associated with a trace
sentry trace logs abc123def456...
```

### Stream Logs

```bash
# Stream logs in real-time (auto-detects org/project)
sentry log list --follow

# Filter logs by severity
sentry log list --query "severity:error"
```

### Explore the API Schema

```bash
# Browse all API resource categories
sentry schema

# Search for endpoints related to a resource
sentry schema issues

# Get details about a specific endpoint
sentry schema "GET /api/0/organizations/{organization_id_or_slug}/issues/"
```

### Arbitrary API Access

```bash
# GET request (default)
sentry api /api/0/organizations/my-org/

# POST request with data
sentry api /api/0/organizations/my-org/projects/ --method POST --data '{"name":"new-project","platform":"python"}'
```

## Dashboard Layout

Sentry dashboards use a **6-column grid**. When adding widgets, aim to fill complete rows (widths should sum to 6).

Display types with default sizes:

| Display Type | Width | Height | Category | Notes |
|---|---|---|---|---|
| `big_number` | 2 | 1 | common | Compact KPI — place 3 per row (2+2+2=6) |
| `line` | 3 | 2 | common | Half-width chart — place 2 per row (3+3=6) |
| `area` | 3 | 2 | common | Half-width chart — place 2 per row |
| `bar` | 3 | 2 | common | Half-width chart — place 2 per row |
| `table` | 6 | 2 | common | Full-width — always takes its own row |
| `stacked_area` | 3 | 2 | specialized | Stacked area chart |
| `top_n` | 3 | 2 | specialized | Top N ranked list |
| `categorical_bar` | 3 | 2 | specialized | Categorical bar chart |
| `text` | 3 | 2 | specialized | Static text/markdown widget |
| `details` | 3 | 2 | internal | Detail view |
| `wheel` | 3 | 2 | internal | Pie/wheel chart |
| `rage_and_dead_clicks` | 3 | 2 | internal | Rage/dead click visualization |
| `server_tree` | 3 | 2 | internal | Hierarchical tree display |
| `agents_traces_table` | 3 | 2 | internal | Agents traces table |

Use **common** types for general dashboards. Use **specialized** only when specifically requested. Avoid **internal** types unless the user explicitly asks.

Available datasets: `spans` (default, covers most use cases), `discover`, `issue`, `error-events`, `transaction-like`, `metrics`, `logs`, `tracemetrics`, `preprod-app-size`.

Run `sentry dashboard widget --help` for the full list including aggregate functions.

**Row-filling examples:**

```bash
# 3 KPIs filling one row (2+2+2 = 6)
sentry dashboard widget add <dashboard> "Error Count" --display big_number --query count
sentry dashboard widget add <dashboard> "P95 Duration" --display big_number --query p95:span.duration
sentry dashboard widget add <dashboard> "Throughput" --display big_number --query epm

# 2 charts filling one row (3+3 = 6)
sentry dashboard widget add <dashboard> "Errors Over Time" --display line --query count
sentry dashboard widget add <dashboard> "Latency Over Time" --display line --query p95:span.duration

# Full-width table (6 = 6)
sentry dashboard widget add <dashboard> "Top Endpoints" --display table \
  --query count --query p95:span.duration \
  --group-by transaction --sort -count --limit 10
```

## Quick Reference

### Time filtering

Use `--period` (alias: `-t`) to filter by time window:

```bash
sentry trace list --period 1h
sentry span list --period 24h
sentry span list -t 7d
```

### Scoping to an org or project

Org and project are positional arguments following `gh` CLI conventions:

```bash
sentry trace list my-org/my-project
sentry issue list my-org/my-project
sentry span list my-org/my-project/abc123def456...
```

### Listing spans in a trace

Pass the trace ID as a positional argument to `span list`:

```bash
sentry span list abc123def456...
sentry span list my-org/my-project/abc123def456...
```

### Dataset names for the Events API

When querying the Events API (directly or via `sentry api`), valid dataset values are: `spans`, `transactions`, `logs`, `errors`, `discover`.

## Common Mistakes

- **Wrong issue ID format**: Use `PROJECT-123` (short ID), not the numeric ID `123456789`. The short ID includes the project prefix.
- **Pre-authenticating unnecessarily**: Don't run `sentry auth login` before every command. The CLI detects missing/expired auth and prompts automatically. Only run `sentry auth login` if you need to switch accounts.
- **Missing `--json` for piping**: Human-readable output includes formatting. Use `--json` when parsing output programmatically.
- **Specifying org/project when not needed**: Auto-detection resolves org/project from DSNs, env vars, config defaults, and directory names. Let it work first — only add `<org>/<project>` if the CLI says it can't detect the target or detects the wrong one.
- **Confusing `--query` syntax**: The `--query` flag uses Sentry search syntax (e.g., `is:unresolved`, `assigned:me`), not free text search.
- **Not using `--web`**: View commands support `-w`/`--web` to open the resource in the browser — useful for sharing links.
- **Fetching API schemas instead of using the CLI**: Prefer `sentry schema` to browse the API and `sentry api` to make requests — the CLI handles authentication and endpoint resolution, so there's rarely a need to download OpenAPI specs separately.
- **Using `sentry api` when CLI commands suffice**: `sentry issue list --json` already includes `shortId`, `title`, `priority`, `level`, `status`, `permalink`, and other fields at the top level. Some fields like `count`, `userCount`, `firstSeen`, and `lastSeen` may be null depending on the issue. Use `--fields` to select specific fields and `--help` to see all available fields. Only fall back to `sentry api` for data the CLI doesn't expose.
