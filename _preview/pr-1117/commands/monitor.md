---
title: "monitor"
description: "Monitor commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1117/commands/monitor/"
---

# monitor

Work with Sentry cron monitors

## Commands

[Section titled “Commands”](#commands)

### `sentry monitor run <monitor-slug command...>`

[Section titled “sentry monitor run <monitor-slug command...>”](#sentry-monitor-run-monitor-slug-command)

Wrap a command with cron monitor check-ins

**Arguments:**

| Argument | Description |
| --- | --- |
| `<monitor-slug command...>` | Monitor slug followed by the command to run |

**Options:**

| Option | Description |
| --- | --- |
| `--dsn <dsn>` | DSN to send check-ins to (overrides SENTRY_DSN env var) |
| `-e, --environment <environment>` | Environment of the monitor (default: "production") |
| `-s, --schedule <schedule>` | Upsert the monitor with this crontab schedule (e.g. '0 * * * *') |
| `--check-in-margin <check-in-margin>` | Minutes after the expected check-in before it is missed (requires --schedule) |
| `--max-runtime <max-runtime>` | Minutes a check-in may run before timing out (requires --schedule) |
| `--timezone <timezone>` | Timezone of the schedule, tz database string (requires --schedule) |
| `--failure-issue-threshold <failure-issue-threshold>` | Consecutive failures before an issue is created (requires --schedule) |
| `--recovery-threshold <recovery-threshold>` | Consecutive successes before an issue is resolved (requires --schedule) |

### `sentry monitor list <org/project>`

[Section titled “sentry monitor list <org/project>”](#sentry-monitor-list-orgproject)

List cron monitors

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project>` | <org>/ (all projects), <org>/<project>, or <project> (search) |

**Options:**

| Option | Description |
| --- | --- |
| `-n, --limit <limit>` | Maximum number of monitors to list (default: "25") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)
Terminal window

```
# Wrap a command with cron monitor check-ins (DSN-based)SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0 \  sentry monitor run nightly-job -- python manage.py cron
# The -- separator is optional when the command has no flagssentry monitor run nightly-job npm run task
# Create/update the monitor on the first check-in via --schedule (crontab)sentry monitor run nightly-job -s "0 0 * * *" --max-runtime 30 --timezone UTC -- ./backup.sh
# List cron monitors in an orgsentry monitor list my-org/
# Paginate through monitorssentry monitor list my-org/ -c next
# Output as JSONsentry monitor list --json
```


## Check-in lifecycle

[Section titled “Check-in lifecycle”](#check-in-lifecycle)

`monitor run` sends an `in_progress` check-in when the wrapped command starts, then an `ok` or `error` check-in (with duration) when it finishes, based on the exit code. The wrapped command inherits stdio, has `SIGINT`/`SIGTERM` forwarded, receives the `SENTRY_MONITOR_SLUG` environment variable, and its exit code is preserved. Check-in delivery failures are non-fatal — the wrapped command still runs and exits with its own code.
