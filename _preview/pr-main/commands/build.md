---
title: "build"
description: "Build commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-main/commands/build/"
---

# build

Manage mobile build artifacts

## Commands

[Section titled “Commands”](#commands)

### `sentry build download <build-id>`

[Section titled “sentry build download <build-id>”](#sentry-build-download-build-id)

Download a build artifact

**Arguments:**

| Argument | Description |
| --- | --- |
| `<build-id>` | ID of the build to download |

**Options:**

| Option | Description |
| --- | --- |
| `-o, --output <output>` | Output path (default: preprod_artifact_. in the current directory) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)
Terminal window

```
# Download a build artifact by IDsentry build download 1234567890
# Download to a specific pathsentry build download 1234567890 --output ./app.ipa
# Output the result as JSONsentry build download 1234567890 --json
```


## Important Notes

[Section titled “Important Notes”](#important-notes)

- `build download` fetches a mobile build artifact (APK or IPA) previously
  uploaded to Sentry's preprod system for size analysis. **Sentry SaaS only.**
- The build must be installable. Builds that are still processing — or that have
  no downloadable artifact — cannot be downloaded.
- Without `--output`, the artifact is saved as
  `preprod_artifact_<build-id>.<ext>` in the current directory.
- The organization is resolved from `--org`, `SENTRY_ORG`, config defaults, or a
  detected DSN.
