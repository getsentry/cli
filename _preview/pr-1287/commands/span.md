---
title: "span"
description: "Span commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1287/commands/span/"
---

# span

List and view spans in projects or traces

## Commands

### `sentry span list <org/project/trace-id...>`

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
| `-t, --period <period>` | Time range: "7d", "2026-06-01..2026-07-01", ">=2026-06-01" (default: "7d") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry span view <trace-id/span-id...>`

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

### List spans

```bash
# List recent spans in the current project
sentry span list


# Find all DB spans
sentry span list -q "op:db"


# Slow spans in the last 24 hours
sentry span list -q "duration:>100ms" --period 24h


# List spans within a specific trace
sentry span list abc123def456abc123def456abc12345


# Paginate through results
sentry span list -c next
```


### Filter by project in a trace

```bash
# Show only spans from one project within a trace
sentry span list my-org/cli-server/abc123def456abc123def456abc12345


# Or use --query to filter by project
sentry span list abc123def456abc123def456abc12345 -q "project:cli-server"


# Multiple projects at once
sentry span list abc123def456abc123def456abc12345 -q "project:[cli-server,api]"
```


### View spans

```bash
# View a single span
sentry span view abc123def456abc123def456abc12345 a1b2c3d4e5f67890


# View multiple spans at once
sentry span view abc123def456abc123def456abc12345 a1b2c3d4e5f67890 b2c3d4e5f6789012


# With explicit org/project
sentry span view my-org/backend/abc123def456abc123def456abc12345 a1b2c3d4e5f67890
```

## Navigation

- [Docs home](https://cli.sentry.dev/_preview/pr-1287/index.md)
- [Parent: Commands](https://cli.sentry.dev/_preview/pr-1287/commands.md)
- [Previous: sourcemap](https://cli.sentry.dev/_preview/pr-1287/commands/sourcemap.md)
- [Next: team](https://cli.sentry.dev/_preview/pr-1287/commands/team.md)
