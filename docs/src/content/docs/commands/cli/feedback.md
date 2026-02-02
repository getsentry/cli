---
title: cli feedback
description: Send feedback about the Sentry CLI
---

Send feedback about your experience with the CLI.

## Usage

```bash
sentry cli feedback <message>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<message>` | Your feedback message (all words after `feedback` are joined) |

## Examples

```bash
# Send positive feedback
sentry cli feedback i love this tool

# Report an issue
sentry cli feedback the issue view is confusing

# Suggest an improvement
sentry cli feedback would be great to have a search command
```

## Notes

- Feedback is sent via Sentry's telemetry system
- If telemetry is disabled (`SENTRY_CLI_NO_TELEMETRY=1`), feedback cannot be sent
- All feedback is anonymous and used to improve the CLI
