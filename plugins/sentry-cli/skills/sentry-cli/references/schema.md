---
name: sentry-cli-schema
version: 0.35.0-dev.0
description: Browse the Sentry API schema
requires:
  bins: ["sentry"]
  auth: true
---

# Schema Commands

Browse the Sentry API schema

### `sentry schema <resource...>`

Browse the Sentry API schema

**Flags:**
- `--all - Show all endpoints in a flat list`
- `-q, --search <value> - Search endpoints by keyword`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
