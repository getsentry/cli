---
title: span
description: Span commands for the Sentry CLI
---

List and view spans in projects or traces

## Commands

### `sentry span list <org/project/trace-id...>`

List spans in a project or trace

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project/trace-id...>` | [&lt;org&gt;/&lt;project&gt;] or [&lt;org&gt;/&lt;project&gt;/]&lt;trace-id&gt; |

**Options:**

| Option | Description |
|--------|-------------|
| `-n, --limit <limit>` | Number of spans (<=1000) (default: "25") |
| `-q, --query <query>` | Filter spans (e.g., "op:db", "duration:>100ms", "project:backend") |
| `-s, --sort <sort>` | Sort order: date, duration (default: "date") |
| `-t, --period <period>` | Time range: "7d", "2026-03-09..2026-04-09", ">=2026-03-09" (default: "7d") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry span view <trace-id/span-id...>`

View details of specific spans

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<trace-id/span-id...>` | [&lt;org&gt;/&lt;project&gt;/]&lt;trace-id&gt; &lt;span-id&gt; [&lt;span-id&gt;...] - Trace ID and one or more span IDs |

**Options:**

| Option | Description |
|--------|-------------|
| `--spans <spans>` | Span tree depth limit (number, "all" for unlimited, "no" to disable) (default: "3") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

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

### View spans

```bash
# View a single span
sentry span view abc123def456abc123def456abc12345 a1b2c3d4e5f67890

# View multiple spans at once
sentry span view abc123def456abc123def456abc12345 a1b2c3d4e5f67890 b2c3d4e5f6789012

# With explicit org/project
sentry span view my-org/backend/abc123def456abc123def456abc12345 a1b2c3d4e5f67890
```
