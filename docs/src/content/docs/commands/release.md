---
title: release
description: Release commands for the Sentry CLI
---

Work with Sentry releases

## Commands

### `sentry release list <org/project>`

List releases

### `sentry release view <org/version>`

View release details

### `sentry release create <org/version>`

Create a release

### `sentry release finalize <org/version>`

Finalize a release

### `sentry release delete <org/version>`

Delete a release

### `sentry release deploy <org/version> <environment> [name]`

Create a deploy for a release

### `sentry release set-commits <org/version>`

Set commits for a release

### `sentry release propose-version`

Propose a release version (outputs the current git HEAD SHA)

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

```bash
# List releases (auto-detect org)
sentry release list

# List releases in a specific org
sentry release list my-org/

# View release details
sentry release view 1.0.0
sentry release view my-org/1.0.0

# Create and finalize a release
sentry release create 1.0.0 --finalize

# Create a release, then finalize separately
sentry release create 1.0.0
sentry release set-commits 1.0.0 --auto
sentry release finalize 1.0.0

# Set commits from local git history
sentry release set-commits 1.0.0 --local

# Create a deploy
sentry release deploy 1.0.0 production
sentry release deploy 1.0.0 staging "Deploy #42"

# Propose a version from git HEAD
sentry release create $(sentry release propose-version)

# Output as JSON
sentry release list --json
sentry release view 1.0.0 --json
```
