---
name: sentry-cli-events
version: 0.22.0
description: View individual error events
requires:
  bins: ["sentry"]
  auth: true
---

# Event Commands

View Sentry events

### `sentry event view <org/project/event-id...>`

View details of a specific event

**Flags:**
- `-w, --web - Open in browser`
- `--spans <value> - Span tree depth limit (number, "all" for unlimited, "no" to disable) - (default: "3")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**Examples:**

```bash
sentry event view abc123def456abc123def456abc12345

# Open in browser
sentry event view abc123def456abc123def456abc12345 -w
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
