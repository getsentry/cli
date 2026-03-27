---
name: sentry-cli
version: 0.22.0
description: Guide for using the Sentry CLI to interact with Sentry from the command line. Use when the user asks about viewing issues, events, projects, organizations, making API calls, or authenticating with Sentry via CLI.
requires:
  bins: ["sentry"]
  auth: true
---

# Sentry CLI Usage Guide

Help users interact with Sentry from the command line using the `sentry` CLI.

## Agent Guidance

Best practices and operational guidance for AI coding agents using the Sentry CLI.

### Key Principles

- **Prefer CLI commands over raw API calls** — the CLI has dedicated commands for most tasks. Reach for `sentry issue view`, `sentry issue list`, `sentry trace view`, etc. before constructing API calls manually or fetching external documentation.
- **Use `sentry schema` to explore the API** — if you need to discover API endpoints, run `sentry schema` to browse interactively or `sentry schema <resource>` to search. This is faster than fetching OpenAPI specs externally.
- **Use `sentry issue view <id>` to investigate issues** — when asked about a specific issue (e.g., `CLI-G5`, `PROJECT-123`), use `sentry issue view` directly.
- **Use `--json` for machine-readable output** — pipe through `jq` for filtering. Human-readable output includes formatting that is hard to parse.
- **The CLI auto-detects org/project** — most commands work without explicit targets by scanning for DSNs in `.env` files and source code.

### Design Principles

The `sentry` CLI follows conventions from well-known tools — if you're familiar with them, that knowledge transfers directly:

- **`gh` (GitHub CLI) conventions**: The `sentry` CLI uses the same `<noun> <verb>` command pattern (e.g., `sentry issue list`, `sentry org view`). Flags follow `gh` conventions: `--json` for machine-readable output, `--fields` to select specific fields, `-w`/`--web` to open in browser, `-q`/`--query` for filtering, `-n`/`--limit` for result count.
- **`sentry api` mimics `curl`**: The `sentry api` command provides direct API access with a `curl`-like interface — `--method` for HTTP method, `--data` for request body, `--header` for custom headers. It handles authentication automatically. If you know how to call a REST API with `curl`, the same patterns apply.

### Context Window Tips

- Use `--json --fields` to select specific fields and reduce output size. Run `<command> --help` to see available fields. Example: `sentry issue list --json --fields shortId,title,count,userCount,lastSeen`
- Use `--json` when piping output between commands or processing programmatically
- Use `--limit` to cap the number of results (default is usually 10–100)
- Prefer `sentry issue view PROJECT-123` over listing and filtering manually
- Use `sentry api` for endpoints not covered by dedicated commands

### Safety Rules

- Always confirm with the user before running destructive commands: `project delete`, `trial start`
- Verify the org/project context is correct before mutations — use `sentry auth status` to check defaults
- Never store or log authentication tokens — use `sentry auth login` and let the CLI manage credentials
- When in doubt about the target org/project, use explicit `<org>/<project>` arguments instead of auto-detection

### Workflow Patterns

#### Investigate an Issue

```bash
# 1. Find the issue
sentry issue list my-org/my-project --query "is:unresolved" --limit 5

# 2. Get details
sentry issue view PROJECT-123

# 3. Get AI root cause analysis
sentry issue explain PROJECT-123

# 4. Get a fix plan
sentry issue plan PROJECT-123
```

#### Explore Traces and Performance

```bash
# 1. List recent traces
sentry trace list my-org/my-project --limit 5

# 2. View a specific trace with span tree
sentry trace view my-org/my-project/abc123def456...

# 3. View spans for a trace
sentry span list my-org/my-project/abc123def456...

# 4. View logs associated with a trace
sentry trace logs my-org/abc123def456...
```

#### Stream Logs

```bash
# Stream logs in real-time
sentry log list my-org/my-project --follow

# Filter logs by severity
sentry log list my-org/my-project --query "severity:error"
```

#### Explore the API Schema

```bash
# Browse all API resource categories
sentry schema

# Search for endpoints related to a resource
sentry schema issues

# Get details about a specific endpoint
sentry schema "GET /api/0/organizations/{organization_id_or_slug}/issues/"
```

#### Arbitrary API Access

```bash
# GET request (default)
sentry api /api/0/organizations/my-org/

# POST request with data
sentry api /api/0/organizations/my-org/projects/ --method POST --data '{"name":"new-project","platform":"python"}'
```

### Dashboard Layout

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

### Common Mistakes

- **Wrong issue ID format**: Use `PROJECT-123` (short ID), not the numeric ID `123456789`. The short ID includes the project prefix.
- **Forgetting authentication**: Run `sentry auth login` before any other command. Check with `sentry auth status`.
- **Missing `--json` for piping**: Human-readable output includes formatting. Use `--json` when parsing output programmatically.
- **Org/project ambiguity**: Auto-detection scans for DSNs in `.env` files and source code. If the project is ambiguous, specify explicitly: `sentry issue list my-org/my-project`.
- **Confusing `--query` syntax**: The `--query` flag uses Sentry search syntax (e.g., `is:unresolved`, `assigned:me`), not free text search.
- **Not using `--web`**: View commands support `-w`/`--web` to open the resource in the browser — useful for sharing links.
- **Fetching API schemas instead of using the CLI**: Prefer `sentry schema` to browse the API and `sentry api` to make requests — the CLI handles authentication and endpoint resolution, so there's rarely a need to download OpenAPI specs separately.
- **Using `sentry api` when CLI commands suffice**: `sentry issue list --json` already includes `count`, `userCount`, `firstSeen`, `lastSeen`, `priority`, and other fields at the top level. Use `--fields` to select specific fields. Run `--help` to see all available fields. Only fall back to `sentry api` for data the CLI doesn't expose.

## Prerequisites

The CLI must be installed and authenticated before use.

### Installation

```bash
curl https://cli.sentry.dev/install -fsS | bash
curl https://cli.sentry.dev/install -fsS | bash -s -- --version nightly

# Or install via npm/pnpm/bun
npm install -g sentry
```

### Authentication

```bash
sentry auth login
sentry auth login --token YOUR_SENTRY_API_TOKEN
sentry auth status
sentry auth logout
```

## Command Reference

### Auth

Authenticate with Sentry

- `sentry auth login` — Authenticate with Sentry
- `sentry auth logout` — Log out of Sentry
- `sentry auth refresh` — Refresh your authentication token
- `sentry auth status` — View authentication status
- `sentry auth token` — Print the stored authentication token
- `sentry auth whoami` — Show the currently authenticated user

→ Full flags and examples: `references/auth.md`

### Org

Work with Sentry organizations

- `sentry org list` — List organizations
- `sentry org view <org>` — View details of an organization

→ Full flags and examples: `references/organizations.md`

### Project

Work with Sentry projects

- `sentry project create <name> <platform>` — Create a new project
- `sentry project delete <org/project>` — Delete a project
- `sentry project list <org/project>` — List projects
- `sentry project view <org/project>` — View details of a project

→ Full flags and examples: `references/projects.md`

### Issue

Manage Sentry issues

- `sentry issue list <org/project>` — List issues in a project
- `sentry issue explain <issue>` — Analyze an issue's root cause using Seer AI
- `sentry issue plan <issue>` — Generate a solution plan using Seer AI
- `sentry issue view <issue>` — View details of a specific issue

→ Full flags and examples: `references/issues.md`

### Event

View Sentry events

- `sentry event view <org/project/event-id...>` — View details of a specific event

→ Full flags and examples: `references/events.md`

### Api

Make an authenticated API request

- `sentry api <endpoint>` — Make an authenticated API request

→ Full flags and examples: `references/api.md`

### Cli

CLI-related commands

- `sentry cli feedback <message...>` — Send feedback about the CLI
- `sentry cli fix` — Diagnose and repair CLI database issues
- `sentry cli setup` — Configure shell integration
- `sentry cli upgrade <version>` — Update the Sentry CLI to the latest version

→ Full flags and examples: `references/setup.md`

### Dashboard

Manage Sentry dashboards

- `sentry dashboard list <org/title-filter...>` — List dashboards
- `sentry dashboard view <org/project/dashboard...>` — View a dashboard
- `sentry dashboard create <org/project/title...>` — Create a dashboard
- `sentry dashboard widget add <org/project/dashboard/title...>` — Add a widget to a dashboard
- `sentry dashboard widget edit <org/project/dashboard...>` — Edit a widget in a dashboard
- `sentry dashboard widget delete <org/project/dashboard...>` — Delete a widget from a dashboard

→ Full flags and examples: `references/dashboards.md`

### Repo

Work with Sentry repositories

- `sentry repo list <org/project>` — List repositories

→ Full flags and examples: `references/teams.md`

### Team

Work with Sentry teams

- `sentry team list <org/project>` — List teams

→ Full flags and examples: `references/teams.md`

### Log

View Sentry logs

- `sentry log list <org/project-or-trace-id...>` — List logs from a project
- `sentry log view <org/project/log-id...>` — View details of one or more log entries

→ Full flags and examples: `references/logs.md`

### Sourcemap

Manage sourcemaps

- `sentry sourcemap inject <directory>` — Inject debug IDs into JavaScript files and sourcemaps
- `sentry sourcemap upload <directory>` — Upload sourcemaps to Sentry

→ Full flags and examples: `references/sourcemap.md`

### Span

List and view spans in projects or traces

- `sentry span list <org/project/trace-id...>` — List spans in a project or trace
- `sentry span view <trace-id/span-id...>` — View details of specific spans

→ Full flags and examples: `references/traces.md`

### Trace

View distributed traces

- `sentry trace list <org/project>` — List recent traces in a project
- `sentry trace view <org/project/trace-id...>` — View details of a specific trace
- `sentry trace logs <org/trace-id...>` — View logs associated with a trace

→ Full flags and examples: `references/traces.md`

### Trial

Manage product trials

- `sentry trial list <org>` — List product trials
- `sentry trial start <name> <org>` — Start a product trial

→ Full flags and examples: `references/trials.md`

### Init

Initialize Sentry in your project (experimental)

- `sentry init <target> <directory>` — Initialize Sentry in your project (experimental)

→ Full flags and examples: `references/setup.md`

### Schema

Browse the Sentry API schema

- `sentry schema <resource...>` — Browse the Sentry API schema

→ Full flags and examples: `references/setup.md`

## Global Options

All commands support the following global options:

- `--help` - Show help for the command
- `--version` - Show CLI version
- `--log-level <level>` - Set log verbosity (`error`, `warn`, `log`, `info`, `debug`, `trace`). Overrides `SENTRY_LOG_LEVEL`
- `--verbose` - Shorthand for `--log-level debug`

## Output Formats

### JSON Output

Most list and view commands support `--json` flag for JSON output, making it easy to integrate with other tools:

```bash
sentry org list --json | jq '.[] | .slug'
```

### Opening in Browser

View commands support `-w` or `--web` flag to open the resource in your browser:

```bash
sentry issue view PROJ-123 -w
```
