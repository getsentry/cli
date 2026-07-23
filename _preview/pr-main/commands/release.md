---
title: "release"
description: "Release commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-main/commands/release/"
---

# release

Work with Sentry releases

## Commands

### `sentry release list <org/project>`

List releases with adoption and health metrics

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project>` | <org>/ (all projects), <org>/<project>, or <project> (search) |

**Options:**

| Option | Description |
| --- | --- |
| `-n, --limit <limit>` | Maximum number of releases to list (default: "25") |
| `-s, --sort <sort>` | Sort: date, sessions, users, crash_free_sessions (cfs), crash_free_users (cfu) (default: "date") |
| `-e, --environment <environment>...` | Filter by environment (repeatable, comma-separated) |
| `-t, --period <period>` | Health stats period (e.g., 24h, 7d, 14d, 90d) (default: "90d") |
| `--status <status>` | Filter by status: open (default) or archived (default: "open") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry release view <org/version>`

View release details with health metrics

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/version>` | [<org>/]<version> - Release version to view |

**Options:**

| Option | Description |
| --- | --- |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry release create <org/version>`

Create a release

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/version>` | [<org>/]<version> - Release version to create |

**Options:**

| Option | Description |
| --- | --- |
| `-p, --project <project>` | Associate with project(s), comma-separated |
| `--finalize` | Immediately finalize the release (set dateReleased) |
| `--ref <ref>` | Git ref (branch or tag name) |
| `--url <url>` | URL to the release source |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry release finalize <org/version>`

Finalize a release

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/version>` | [<org>/]<version> - Release version to finalize |

**Options:**

| Option | Description |
| --- | --- |
| `--released <released>` | Custom release timestamp (ISO 8601). Defaults to now. |
| `--url <url>` | URL for the release |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry release delete <org/version>`

Delete a release

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/version>` | [<org>/]<version> - Release version to delete |

**Options:**

| Option | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation prompt |
| `-f, --force` | Force the operation without confirmation |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry release archive <org/version>`

Archive a release

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/version>` | [<org>/]<version> - Release version to archive |

**Options:**

| Option | Description |
| --- | --- |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry release restore <org/version>`

Restore an archived release

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/version>` | [<org>/]<version> - Release version to restore |

**Options:**

| Option | Description |
| --- | --- |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry release deploy <org/version> <environment> <name>`

Create a deploy for a release

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/version>` | [<org>/]<version> - Release version |
| `<environment>` | Deploy environment (e.g. production) |
| `<name>` | Optional deploy name (quote multi-word names, e.g. "Deploy #42") |

**Options:**

| Option | Description |
| --- | --- |
| `--url <url>` | URL for the deploy |
| `--started <started>` | Deploy start time (ISO 8601) |
| `--finished <finished>` | Deploy finish time (ISO 8601) |
| `-t, --time <time>` | Deploy duration in seconds (sets started = now - time, finished = now) |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry release deploys <org/version>`

List deploys for a release

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/version>` | [<org>/]<version> - Release version |

### `sentry release set-commits <org/version>`

Set commits for a release

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/version>` | [<org>/]<version> - Release version |

**Options:**

| Option | Description |
| --- | --- |
| `--auto` | Auto-discover commits via repository integration (needs local git checkout) |
| `--local` | Read commits from local git history |
| `--clear` | Clear all commits from the release |
| `--commit <commit>` | Explicit commit as REPO@SHA or REPO@PREV..SHA (comma-separated) |
| `--path <path>` | Filter commits to these paths (comma-separated). Implies --local. |
| `--from <from>` | Read the local range ..HEAD (e.g. previous release tag). Implies --local. |
| `--initial-depth <initial-depth>` | Number of commits to read with --local (default: "20") |

### `sentry release propose-version`

Propose a release version

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

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


# List deploys for a release
sentry release deploys 1.0.0
sentry release deploys my-org/1.0.0


# Archive a release (hide it from the default list, but keep it)
sentry release archive 1.0.0
sentry release archive my-org/1.0.0 --dry-run   # Preview without archiving


# Restore a previously archived release
sentry release restore 1.0.0
sentry release restore my-org/1.0.0


# Delete a release
sentry release delete my-org/1.0.0
sentry release delete my-org/1.0.0 --yes        # Skip confirmation
sentry release delete my-org/1.0.0 --dry-run    # Preview without deleting


# Output as JSON
sentry release list --json
sentry release view 1.0.0 --json


# Full release workflow with explicit org
sentry release create my-org/1.0.0 --project my-project
sentry release set-commits my-org/1.0.0 --auto
sentry release finalize my-org/1.0.0
sentry release deploy my-org/1.0.0 production
```


## Important Notes

- **Version matching**: The release version must match the `release` value in your `Sentry.init()` call. If your SDK uses `"1.0.0"`, create the release as `sentry release create org/1.0.0` (version = `1.0.0`), **not** `sentry release create org/myapp/1.0.0`.
- **The `org/` prefix is the org slug**: In `sentry release create sentry/1.0.0`, `sentry` is the org slug and `1.0.0` is the version. The `/` separates org from version — it is not part of the version string.
- **`--auto` needs a git checkout**: The `--auto` flag lists repos from the Sentry API and matches against your local `origin` remote URL. Without a local git repo, use `--local` instead.
- **Default mode tries `--auto` first**: When neither `--auto` nor `--local` is specified, `set-commits` tries auto-discovery first and falls back to local git history if the integration isn't configured.

## Navigation

- [Docs home](https://cli.sentry.dev/_preview/pr-main/index.md)
- [Parent: Commands](https://cli.sentry.dev/_preview/pr-main/commands.md)
- [Previous: react-native](https://cli.sentry.dev/_preview/pr-main/commands/react-native.md)
- [Next: replay](https://cli.sentry.dev/_preview/pr-main/commands/replay.md)
