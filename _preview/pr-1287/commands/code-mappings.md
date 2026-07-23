---
title: "code-mappings"
description: "Code-mappings commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1287/commands/code-mappings/"
---

# code-mappings

Manage code mappings for stack trace linking

## Commands

### `sentry code-mappings upload <path>`

Upload code mappings for stack trace linking

**Arguments:**

| Argument | Description |
| --- | --- |
| `<path>` | Path to the code mappings JSON file |

**Options:**

| Option | Description |
| --- | --- |
| `--repo <repo>` | Repository name (e.g., owner/repo). Auto-detected from git remote if omitted. |
| `--default-branch <default-branch>` | Default branch name. Auto-detected from git remote HEAD if omitted. |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

```bash
# Upload code mappings from a JSON file
sentry code-mappings upload mappings.json


# Specify repository explicitly
sentry code-mappings upload mappings.json --repo owner/repo


# Specify repository and default branch
sentry code-mappings upload mappings.json --repo owner/repo --default-branch develop


# Output as JSON
sentry code-mappings upload mappings.json --json
```


## Input Format

The JSON file must contain an array of objects with `stackRoot` and `sourceRoot`:

```json
[
  { "stackRoot": "com/example/module", "sourceRoot": "src/main/java/com/example/module" },
  { "stackRoot": "com/example/other", "sourceRoot": "src/main/java/com/example/other" }
]
```


## Important Notes

- Repository name and default branch are **auto-detected** from git remotes if
  not provided via `--repo` and `--default-branch`.
- Requires an Organization Token with `org:ci` scope.
- Mappings are uploaded in batches of 300 per API request.

## Navigation

- [Docs home](https://cli.sentry.dev/_preview/pr-1287/index.md)
- [Parent: Commands](https://cli.sentry.dev/_preview/pr-1287/commands.md)
- [Previous: cli](https://cli.sentry.dev/_preview/pr-1287/commands/cli.md)
- [Next: dart-symbol-map](https://cli.sentry.dev/_preview/pr-1287/commands/dart-symbol-map.md)
