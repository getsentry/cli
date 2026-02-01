---
title: feedback
description: Send feedback about the Sentry CLI
---

Send feedback about your experience with the CLI.

## Commands

### `sentry feedback`

Submit feedback about the CLI directly to the Sentry team.

```bash
sentry feedback <message>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<message>` | Your feedback message (all words after `feedback` are joined) |

## Examples

```bash
# Send positive feedback
sentry feedback i love this tool

# Report an issue
sentry feedback the issue view is confusing

# Suggest an improvement
sentry feedback would be great to have a search command
```

## Notes

- Feedback is sent via Sentry's telemetry system
- If telemetry is disabled (`SENTRY_CLI_NO_TELEMETRY=1`), feedback cannot be sent
- All feedback is anonymous and used to improve the CLI
