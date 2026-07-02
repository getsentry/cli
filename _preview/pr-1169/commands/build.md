---
title: "build"
description: "Build commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1169/commands/build/"
---

# build

Manage mobile build artifacts

## Commands

[Section titled “Commands”](#commands)

### `sentry build upload <path...>`

[Section titled “sentry build upload <path...>”](#sentry-build-upload-path)

Upload builds to a project

**Arguments:**

| Argument | Description |
| --- | --- |
| `<path...>` | Path(s) to the build(s) to upload (APK or AAB) |

**Options:**

| Option | Description |
| --- | --- |
| `--build-configuration <build-configuration>` | Build configuration for the upload (defaults to the current version) |
| `--release-notes <release-notes>` | Release notes for the build |
| `--install-group <install-group>...` | Install group(s) for this build (repeatable); builds sharing a group show updates for each other |

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
# Upload an Android build (APK or AAB) for size analysissentry build upload ./app-release.apk
# Upload with a build configuration and release notessentry build upload ./app.aab --build-configuration Release --release-notes "Nightly"
# Tag a build with install groups (repeatable)sentry build upload ./app.aab --install-group qa --install-group beta
# Download a build artifact by IDsentry build download 1234567890
# Download to a specific pathsentry build download 1234567890 --output ./app.ipa
# Output the result as JSONsentry build download 1234567890 --json
```


## Important Notes

[Section titled “Important Notes”](#important-notes)

- `build upload` supports **Android APK and AAB**. iOS XCArchive/IPA upload is
  not yet supported. **Sentry SaaS only.**
- Multiple paths may be uploaded at once; the command exits non-zero if any
  build fails to upload.
- `build download` fetches a mobile build artifact (APK or IPA) previously
  uploaded to Sentry's preprod system for size analysis. **Sentry SaaS only.**
- The build must be installable. Builds that are still processing — or that have
  no downloadable artifact — cannot be downloaded.
- Without `--output`, the artifact is saved as
  `preprod_artifact_<build-id>.<ext>` in the current directory.
- The organization is resolved from `--org`, `SENTRY_ORG`, config defaults, or a
  detected DSN.
