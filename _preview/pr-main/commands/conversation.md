---
title: "conversation"
description: "Conversation commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-main/commands/conversation/"
---

# conversation

List and view AI conversations

## Commands

### `sentry conversation list <org>`

List recent AI conversations

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org>` | Organization slug |

**Options:**

| Option | Description |
| --- | --- |
| `-n, --limit <limit>` | Number of conversations (1-1000) (default: "25") |
| `-q, --query <query>` | Search query |
| `-t, --period <period>` | Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01" (default: "7d") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry conversation view <org/conversation-id>`

View an AI conversation transcript

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/conversation-id>` | [<org>/]<conversation-id> - Org (optional) and conversation ID |

**Options:**

| Option | Description |
| --- | --- |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

### List conversations

```bash
# List recent AI conversations
sentry conversation list


# Explicit organization
sentry conversation list my-org


# Show more, last 24 hours
sentry conversation list --limit 50 --period 24h


# Filter conversations
sentry conversation list -q "has:errors"


# Paginate through results
sentry conversation list my-org -c next
```


### View a conversation transcript

```bash
# View full transcript
sentry conversation view my-org conv-123


# JSON output
sentry conversation view my-org conv-123 --json
```

## Navigation

- [Docs home](https://cli.sentry.dev/_preview/pr-main/index.md)
- [Parent: Commands](https://cli.sentry.dev/_preview/pr-main/commands.md)
- [Previous: code-mappings](https://cli.sentry.dev/_preview/pr-main/commands/code-mappings.md)
- [Next: dart-symbol-map](https://cli.sentry.dev/_preview/pr-main/commands/dart-symbol-map.md)
