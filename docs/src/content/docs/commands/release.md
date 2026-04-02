---
title: release
description: Release commands for the Sentry CLI
---

Work with Sentry releases

## Commands

### `sentry release list <org/project>`

List releases

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project>` | &lt;org&gt;/ (all projects), &lt;org&gt;/&lt;project&gt;, or &lt;project&gt; (search) |

**Options:**

| Option | Description |
|--------|-------------|
| `-n, --limit <limit>` | Maximum number of releases to list (default: "30") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry release view <org/version...>`

View release details

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/version...>` | [&lt;org&gt;/]&lt;version&gt; - Release version to view |

**Options:**

| Option | Description |
|--------|-------------|
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry release create <org/version...>`

Create a release

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/version...>` | [&lt;org&gt;/]&lt;version&gt; - Release version to create |

**Options:**

| Option | Description |
|--------|-------------|
| `-p, --project <project>` | Associate with project(s), comma-separated |
| `--finalize` | Immediately finalize the release (set dateReleased) |
| `--ref <ref>` | Git ref (branch or tag name) |
| `--url <url>` | URL to the release source |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry release finalize <org/version...>`

Finalize a release

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/version...>` | [&lt;org&gt;/]&lt;version&gt; - Release version to finalize |

**Options:**

| Option | Description |
|--------|-------------|
| `--released <released>` | Custom release timestamp (ISO 8601). Defaults to now. |
| `--url <url>` | URL for the release |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry release delete <org/version...>`

Delete a release

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/version...>` | [&lt;org&gt;/]&lt;version&gt; - Release version to delete |

**Options:**

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip confirmation prompt |
| `-f, --force` | Force the operation without confirmation |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry release deploy <org/version environment name...>`

Create a deploy for a release

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/version environment name...>` | [&lt;org&gt;/]&lt;version&gt; &lt;environment&gt; [name] |

**Options:**

| Option | Description |
|--------|-------------|
| `--url <url>` | URL for the deploy |
| `--started <started>` | Deploy start time (ISO 8601) |
| `--finished <finished>` | Deploy finish time (ISO 8601) |
| `-t, --time <time>` | Deploy duration in seconds (sets started = now - time, finished = now) |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry release deploys <org/version...>`

List deploys for a release

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/version...>` | [&lt;org&gt;/]&lt;version&gt; - Release version |

### `sentry release set-commits <org/version...>`

Set commits for a release

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/version...>` | [&lt;org&gt;/]&lt;version&gt; - Release version |

**Options:**

| Option | Description |
|--------|-------------|
| `--auto` | Use repository integration to auto-discover commits |
| `--local` | Read commits from local git history |
| `--clear` | Clear all commits from the release |
| `--commit <commit>` | Explicit commit as REPO@SHA or REPO@PREV..SHA (comma-separated) |
| `--initial-depth <initial-depth>` | Number of commits to read with --local (default: "20") |

### `sentry release propose-version`

Propose a release version

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
