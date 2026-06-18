---
title: "token"
description: "Token commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1112/commands/token/"
---

# token

Manage org auth tokens

## Commands

[Section titled “Commands”](#commands)

### `sentry token create <org>`

[Section titled “sentry token create <org>”](#sentry-token-create-org)

Create an org auth token

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org>` | Organization slug |

**Options:**

| Option | Description |
| --- | --- |
| `--name <name>` | Name for the new token |

### `sentry token delete <org> <token-id>`

[Section titled “sentry token delete <org> <token-id>”](#sentry-token-delete-org-token-id)

Delete an org auth token

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org>` | Organization slug |
| `<token-id>` | Token ID or name |

**Options:**

| Option | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation prompt |
| `-f, --force` | Force the operation without confirmation |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry token list <org>`

[Section titled “sentry token list <org>”](#sentry-token-list-org)

List org auth tokens

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org>` | Organization slug |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.
