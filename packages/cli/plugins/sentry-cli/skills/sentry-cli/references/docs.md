---
name: sentry-cli-docs
version: 0.45.0-dev.0
description: Search and query current Sentry documentation
requires:
  bins: ["sentry"]
  auth: true
---

# Docs Commands

Search and query current Sentry documentation

### `sentry docs list <keywords...>`

Find Sentry documentation pages by keyword

**Flags:**
- `-n, --limit <value> - Maximum matches to return (1-20) - (default: "8")`

### `sentry docs query <question...>`

Ask a cited question about Sentry documentation

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
