---
title: "info"
description: "Info command for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1279/commands/info/"
---

# info

Print configuration and verify authentication

## Usage

[Section titled “Usage”](#usage)

### `sentry info`

[Section titled “sentry info”](#sentry-info)

Print configuration and verify authentication

**Options:**

| Option | Description |
| --- | --- |
| `--config-status-json` | Emit configuration + auth status as JSON (for external tooling); always exits 0 |
| `--no-defaults` | Verify only authentication, without requiring a default org/project |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples
Terminal window

```
# Print the resolved config and verify authenticationsentry info
# Verify only authentication (don't require a default org/project)sentry info --no-defaults
# Machine-readable status for external tooling (always exits 0)sentry info --config-status-json
```


## Important Notes

[Section titled “Important Notes”](#important-notes)

- `info` prints the resolved Sentry server URL and the default organization and
  project, then verifies your credentials against the server.
- The server URL comes from `SENTRY_URL`, the stored default, or the SaaS
  default; org/project come from `SENTRY_ORG`/`SENTRY_PROJECT` or stored
  defaults. `have_dsn` reflects whether `SENTRY_DSN` is set.
- Exits non-zero when authentication fails, or (unless `--no-defaults`) when no
  default organization/project is configured.
- `--config-status-json` emits a JSON status object (`config`, `auth`,
  `have_dsn`) for external tooling and **always exits 0** — it is a status
  report, not a check. For general machine-readable output use `--json`.
