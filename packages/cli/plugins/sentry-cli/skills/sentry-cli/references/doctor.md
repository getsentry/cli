---
name: sentry-cli-doctor
version: 0.45.0-dev.0
description: Check whether Sentry is correctly set up and actually working
requires:
  bins: ["sentry"]
  auth: true
---

# Doctor Commands

Check whether Sentry is correctly set up and actually working

### `sentry doctor`

Check whether Sentry is correctly set up and actually working

**Flags:**
- `--sendTestEvent - Send a synthetic event to the configured DSN and confirm it arrives (a write)`
- `--fix - After reporting, run the setup workflow to produce a fix plan`

**Examples:**

```bash
# Read-only health check
sentry doctor

# Machine-readable report (every result, including passes)
sentry doctor --json

# Send a test event and confirm ingest (a write)
sentry doctor --send-test-event
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
