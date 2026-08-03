---
title: "conversations"
description: "Conversations command for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1020/commands/conversations/"
---

# conversations

List recent AI conversations

## Usage

### `sentry conversations <org>`

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

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Navigation

- [Docs home](https://cli.sentry.dev/_preview/pr-1020/index.md)
- [Parent: Commands](https://cli.sentry.dev/_preview/pr-1020/commands.md)
- [Previous: conversation](https://cli.sentry.dev/_preview/pr-1020/commands/conversation.md)
- [Next: dart-symbol-map](https://cli.sentry.dev/_preview/pr-1020/commands/dart-symbol-map.md)
