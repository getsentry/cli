---
title: "snapshots"
description: "Snapshots commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-main/commands/snapshots/"
---

# snapshots

Manage and compare snapshots

## Commands

[Section titled “Commands”](#commands)

### `sentry snapshots diff <base-dir> <head-dir>`

[Section titled “sentry snapshots diff <base-dir> <head-dir>”](#sentry-snapshots-diff-base-dir-head-dir)

Compare two directories of snapshot images

**Arguments:**

| Argument | Description |
| --- | --- |
| `<base-dir>` | Path to the baseline image directory |
| `<head-dir>` | Path to the head image directory |

**Options:**

| Option | Description |
| --- | --- |
| `-o, --output <output>` | Directory for diff mask images (default: ./diff-output/) |
| `--threshold <threshold>` | Pixel color difference threshold (0.0-1.0) (default: "0.01") |
| `--no-antialiasing` | Disable antialiasing detection |
| `--fail-on-diff` | Exit non-zero if any diffs (changed/added/removed/errored) are found |
| `--selective` | Treat images missing from head as skipped instead of removed |

### `sentry snapshots download`

[Section titled “sentry snapshots download”](#sentry-snapshots-download)

Download baseline snapshot images

**Options:**

| Option | Description |
| --- | --- |
| `--app-id <app-id>` | App identifier (e.g. my-app) to resolve the latest baseline; mutually exclusive with --snapshot-id |
| `--snapshot-id <snapshot-id>` | Direct snapshot artifact ID; mutually exclusive with --app-id |
| `--branch <branch>` | Git branch filter (only with --app-id) |
| `-o, --output <output>` | Directory for extracted images (default: ./snapshots-base/) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)
Terminal window

```
# Compare two directories of snapshot images locallysentry snapshots diff ./baseline ./head
# Fail (non-zero exit) if any images changed, with a custom thresholdsentry snapshots diff ./baseline ./head --fail-on-diff --threshold 0.02
# Download a specific baseline snapshot by IDsentry snapshots download --snapshot-id 1234567890
# Download the latest baseline for an app, filtered by branchsentry snapshots download --app-id my-app --branch main
# Extract images to a specific directorysentry snapshots download --app-id my-app --output ./baseline/
```


## Important Notes

[Section titled “Important Notes”](#important-notes)

- `snapshots diff` compares two local image directories (PNG/JPEG) perceptually
  — anti-aliasing aware, with a per-pixel `--threshold` (0.0–1.0) — and writes a
  PNG diff mask per changed image. It makes **no network requests**. Use
  `--fail-on-diff` to exit non-zero when any images changed/added/removed, and
  `--selective` to treat images missing from head as skipped rather than removed.
- `snapshots download` fetches baseline snapshot images from Sentry's preprod
  system and extracts them to a local directory. **Sentry SaaS only.**
- Provide exactly one of `--snapshot-id` (a direct artifact ID) or `--app-id`
  (resolves the latest baseline). `--branch` only applies with `--app-id`.
- With org auth tokens, resolving by `--app-id` requires `--project` (a project
  ID or slug).
- If the downloadable archive has not been built yet, the command triggers a
  build and waits for it (up to 5 minutes).
- Images are extracted to `./snapshots-base/` by default; override with
  `--output`.
- The organization is resolved from `--org`, `SENTRY_ORG`, config defaults, or a
  detected DSN.
