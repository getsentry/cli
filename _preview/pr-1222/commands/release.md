---
title: "release"
description: "Release commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1222/commands/release/"
---

# release

Work with Sentry releases

## Commands

[Section titled “Commands”](#commands)

### `sentry release list <org/project>`

[Section titled “sentry release list <org/project>”](#sentry-release-list-orgproject)

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

[Section titled “sentry release view <org/version>”](#sentry-release-view-orgversion)

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

[Section titled “sentry release create <org/version>”](#sentry-release-create-orgversion)

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

[Section titled “sentry release finalize <org/version>”](#sentry-release-finalize-orgversion)

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

[Section titled “sentry release delete <org/version>”](#sentry-release-delete-orgversion)

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

[Section titled “sentry release archive <org/version>”](#sentry-release-archive-orgversion)

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

[Section titled “sentry release restore <org/version>”](#sentry-release-restore-orgversion)

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

[Section titled “sentry release deploy <org/version> <environment> <name>”](#sentry-release-deploy-orgversion-environment-name)

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

[Section titled “sentry release deploys <org/version>”](#sentry-release-deploys-orgversion)

List deploys for a release

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/version>` | [<org>/]<version> - Release version |

### `sentry release set-commits <org/version>`

[Section titled “sentry release set-commits <org/version>”](#sentry-release-set-commits-orgversion)

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

[Section titled “sentry release propose-version”](#sentry-release-propose-version)

Propose a release version

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)
Terminal window

```
# List releases (auto-detect org)sentry release list
# List releases in a specific orgsentry release list my-org/
# View release detailssentry release view 1.0.0sentry release view my-org/1.0.0
# Create and finalize a releasesentry release create 1.0.0 --finalize
# Create a release, then finalize separatelysentry release create 1.0.0sentry release set-commits 1.0.0 --autosentry release finalize 1.0.0
# Set commits from local git historysentry release set-commits 1.0.0 --local
# Create a deploysentry release deploy 1.0.0 productionsentry release deploy 1.0.0 staging "Deploy #42"
# Propose a version from git HEADsentry release create $(sentry release propose-version)
# List deploys for a releasesentry release deploys 1.0.0sentry release deploys my-org/1.0.0
# Archive a release (hide it from the default list, but keep it)sentry release archive 1.0.0sentry release archive my-org/1.0.0 --dry-run   # Preview without archiving
# Restore a previously archived releasesentry release restore 1.0.0sentry release restore my-org/1.0.0
# Delete a releasesentry release delete my-org/1.0.0sentry release delete my-org/1.0.0 --yes        # Skip confirmationsentry release delete my-org/1.0.0 --dry-run    # Preview without deleting
# Output as JSONsentry release list --jsonsentry release view 1.0.0 --json
# Full release workflow with explicit orgsentry release create my-org/1.0.0 --project my-projectsentry release set-commits my-org/1.0.0 --autosentry release finalize my-org/1.0.0sentry release deploy my-org/1.0.0 production
```


## Important Notes

[Section titled “Important Notes”](#important-notes)

- **Version matching**: The release version must match the `release` value in your `Sentry.init()` call. If your SDK uses `"1.0.0"`, create the release as `sentry release create org/1.0.0` (version = `1.0.0`), **not** `sentry release create org/myapp/1.0.0`.
- **The `org/` prefix is the org slug**: In `sentry release create sentry/1.0.0`, `sentry` is the org slug and `1.0.0` is the version. The `/` separates org from version — it is not part of the version string.
- **`--auto` needs a git checkout**: The `--auto` flag lists repos from the Sentry API and matches against your local `origin` remote URL. Without a local git repo, use `--local` instead.
- **Default mode tries `--auto` first**: When neither `--auto` nor `--local` is specified, `set-commits` tries auto-discovery first and falls back to local git history if the integration isn't configured.
