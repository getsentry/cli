---
name: sentry-cli-release
version: 0.24.0-dev.0
description: Sentry CLI release commands
requires:
  bins: ["sentry"]
  auth: true
---

# release Commands

Work with Sentry releases

### `sentry release list <org/project>`

List releases

**Flags:**
- `-n, --limit <value> - Maximum number of releases to list - (default: "30")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

**JSON Fields** (use `--json --fields` to select specific fields):

| Field | Type | Description |
|-------|------|-------------|
| `id` | number |  |
| `version` | string |  |
| `shortVersion` | string |  |
| `status` | string |  |
| `dateCreated` | string |  |
| `dateReleased` | string \| null |  |
| `dateStarted` | string \| null |  |
| `firstEvent` | string \| null |  |
| `lastEvent` | string \| null |  |
| `ref` | string \| null |  |
| `url` | string \| null |  |
| `commitCount` | number |  |
| `deployCount` | number |  |
| `authors` | array |  |
| `projects` | array |  |
| `lastDeploy` | object \| null |  |
| `newGroups` | number |  |
| `owner` | unknown \| null |  |
| `versionInfo` | object |  |

### `sentry release view <org/version...>`

View release details

**Flags:**
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

### `sentry release create <org/version...>`

Create a release

**Flags:**
- `-p, --project <value> - Associate with a project (can be repeated)`
- `--finalize - Immediately finalize the release (set dateReleased)`
- `--ref <value> - Git ref (branch or tag name)`
- `--url <value> - URL to the release source`

### `sentry release finalize <org/version...>`

Finalize a release

### `sentry release delete <org/version...>`

Delete a release

**Flags:**
- `-y, --yes - Skip confirmation prompt`

### `sentry release deploy <org/version environment name...>`

Create a deploy for a release

**Flags:**
- `--url <value> - URL for the deploy`
- `--started <value> - Deploy start time (ISO 8601)`
- `--finished <value> - Deploy finish time (ISO 8601)`

### `sentry release set-commits <org/version...>`

Set commits for a release

**Flags:**
- `--auto - Use repository integration to auto-discover commits (default)`
- `--local - Read commits from local git history`
- `--initial-depth <value> - Number of commits to read with --local - (default: "20")`

### `sentry release propose-version`

Propose a release version

**Examples:**

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

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
