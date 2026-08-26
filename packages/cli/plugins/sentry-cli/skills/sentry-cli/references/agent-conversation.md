---
name: sentry-cli-agent-conversation
version: 0.44.0-dev.0
description: List and view agent conversations
requires:
  bins: ["sentry"]
  auth: true
---

# Agent-conversation Commands

List and view agent conversations

### `sentry agent-conversation list <org>`

List recent agent conversations

**Flags:**
- `-n, --limit <value> - Number of conversations (1-1000) - (default: "25")`
- `-q, --query <value> - Search query`
- `-t, --period <value> - Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01" - (default: "7d")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

**JSON Fields** (use `--json --fields` to select specific fields):

| Field | Type | Description |
|-------|------|-------------|
| `conversationId` | string |  |
| `title` | string \| null |  |
| `flow` | array |  |
| `errors` | number |  |
| `llmCalls` | number |  |
| `toolCalls` | number |  |
| `totalTokens` | number |  |
| `totalCost` | number |  |
| `startTimestamp` | number |  |
| `endTimestamp` | number |  |
| `traceCount` | number |  |
| `traceIds` | array |  |
| `firstInput` | string \| null |  |
| `lastOutput` | string \| null |  |
| `user` | object \| null |  |
| `toolNames` | array |  |
| `toolErrors` | number |  |

### `sentry agent-conversation view <org/conversation-id>`

View an agent conversation transcript

**Flags:**
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
