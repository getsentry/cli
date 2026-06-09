---
name: sentry-cli-code-mappings
version: 0.38.0-dev.0
description: Manage code mappings for stack trace linking
requires:
  bins: ["sentry"]
  auth: true
---

# Code-mappings Commands

Manage code mappings for stack trace linking

### `sentry code-mappings upload <path>`

Upload code mappings for stack trace linking

**Flags:**
- `--repo <value> - Repository name (e.g., owner/repo). Auto-detected from git remote if omitted.`
- `--default-branch <value> - Default branch name. Auto-detected from git remote HEAD if omitted.`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
