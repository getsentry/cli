---
name: sentry-cli-info
version: 0.44.0-dev.0
description: Print configuration and verify authentication
requires:
  bins: ["sentry"]
  auth: true
---

# Info Commands

Print configuration and verify authentication

### `sentry info`

Print configuration and verify authentication

**Flags:**
- `--config-status-json - Emit configuration + auth status as JSON (for external tooling); always exits 0`
- `--no-defaults - Verify only authentication, without requiring a default org/project`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
