---
title: "code-mappings"
description: "Code-mappings commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1224/commands/code-mappings/"
---

# code-mappings

Manage code mappings for stack trace linking

## Commands

[Section titled “Commands”](#commands)

### `sentry code-mappings upload <path>`

[Section titled “sentry code-mappings upload <path>”](#sentry-code-mappings-upload-path)

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

[Section titled “Examples”](#examples)
Terminal window

```
# Upload code mappings from a JSON filesentry code-mappings upload mappings.json
# Specify repository explicitlysentry code-mappings upload mappings.json --repo owner/repo
# Specify repository and default branchsentry code-mappings upload mappings.json --repo owner/repo --default-branch develop
# Output as JSONsentry code-mappings upload mappings.json --json
```


## Input Format

[Section titled “Input Format”](#input-format)

The JSON file must contain an array of objects with `stackRoot` and `sourceRoot`:

```
[  { "stackRoot": "com/example/module", "sourceRoot": "src/main/java/com/example/module" },  { "stackRoot": "com/example/other", "sourceRoot": "src/main/java/com/example/other" }]
```


## Important Notes

[Section titled “Important Notes”](#important-notes)

- Repository name and default branch are **auto-detected** from git remotes if
  not provided via `--repo` and `--default-branch`.
- Requires an Organization Token with `org:ci` scope.
- Mappings are uploaded in batches of 300 per API request.
