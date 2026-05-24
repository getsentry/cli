---
name: sentry-cli-ai-conversations
version: 0.35.0-dev.0
description: List and view AI conversations
requires:
  bins: ["sentry"]
  auth: true
---

# Ai-conversations Commands

List and view AI conversations

### `sentry ai-conversations list <org>`

List recent AI conversations

**Flags:**
- `-n, --limit <value> - Number of conversations (1-1000) - (default: "25")`
- `-q, --query <value> - Search query`
- `-t, --period <value> - Time range: "7d", "2026-04-01..2026-05-01", ">=2026-04-01" - (default: "7d")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

**JSON Fields** (use `--json --fields` to select specific fields):

| Field | Type | Description |
|-------|------|-------------|
| `conversationId` | string |  |
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

**Examples:**

```bash
# List last 10 AI conversations
sentry ai-conversations list

# Explicit organization
sentry ai-conversations list my-org

# Show more, last 24 hours
sentry ai-conversations list --limit 50 --period 24h

# Filter conversations
sentry ai-conversations list -q "has:errors"

# Paginate through results
sentry ai-conversations list my-org -c next
```

### `sentry ai-conversations view <org> <conversation-id>`

View an AI conversation transcript

**Flags:**
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**Examples:**

```bash
# View full transcript
sentry ai-conversations view my-org conv-123

# JSON output
sentry ai-conversations view my-org conv-123 --json
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
