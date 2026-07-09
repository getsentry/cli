---
title: "build"
description: "Build commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1218/commands/build/"
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
| `<path...>` | Path(s) to the build(s) to upload (APK, AAB, IPA, or XCArchive) |

**Options:**

| Option | Description |
| --- | --- |
| `--build-configuration <build-configuration>` | Build configuration for the upload (defaults to the current version) |
| `--release-notes <release-notes>` | Release notes for the build |
| `--install-group <install-group>...` | Install group(s) for this build (repeatable); builds sharing a group show updates for each other |
| `--head-sha <head-sha>` | VCS commit SHA (defaults to the current commit) |
| `--base-sha <base-sha>` | VCS base commit SHA (defaults to the merge-base with the base ref) |
| `--vcs-provider <vcs-provider>` | VCS provider (defaults to the current remote's provider) |
| `--head-repo-name <head-repo-name>` | Head repository name, e.g. owner/repo (defaults to the current) |
| `--base-repo-name <base-repo-name>` | Base repository name, e.g. owner/repo (for forks) |
| `--head-ref <head-ref>` | Head branch/reference (defaults to the current branch) |
| `--base-ref <base-ref>` | Base branch/reference (defaults to the merge-base tracking ref) |
| `--pr-number <pr-number>` | Pull request number (auto-detected in pull_request GitHub Actions runs) |
| `--force-git-metadata` | Force collecting git metadata even outside CI (conflicts with --no-git-metadata) |
| `--no-git-metadata` | Disable automatic git metadata collection |

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
# Upload an iOS build (XCArchive directory or IPA)sentry build upload ./MyApp.xcarchivesentry build upload ./MyApp.ipa
# Upload with a build configuration and release notessentry build upload ./app.aab --build-configuration Release --release-notes "Nightly"
# Tag a build with install groups (repeatable)sentry build upload ./app.aab --install-group qa --install-group beta
# Attach explicit git metadata (otherwise auto-collected in CI)sentry build upload ./app.aab --head-sha "$GIT_SHA" --pr-number 42 --base-ref main
# Download a build artifact by IDsentry build download 1234567890
# Download to a specific pathsentry build download 1234567890 --output ./app.ipa
# Output the result as JSONsentry build download 1234567890 --json
```


## Important Notes

[Section titled “Important Notes”](#important-notes)

- `build upload` supports **Android APK/AAB** and **iOS XCArchive/IPA**. An
  XCArchive is a directory; an IPA is converted to an XCArchive layout for
  upload. **Sentry SaaS only.**
- iOS caveat: `Assets.car` asset catalogs are **not** parsed into per-asset
  images (that required native macOS frameworks), so the server sees the raw
  `.car` rather than a per-image breakdown. XCArchive symlinks and Unix file
  permissions are preserved.
- Multiple paths may be uploaded at once; the command exits non-zero if any
  build fails to upload.
- Git metadata (commit, branch, PR number, repo) is **auto-collected in CI**
  (GitHub Actions env vars + the local git repo). Use `--no-git-metadata` to
  disable it, `--force-git-metadata` to collect outside CI, or the explicit
  `--head-sha` / `--base-sha` / `--head-ref` / `--base-ref` / `--pr-number` /
  `--vcs-provider` / `--head-repo-name` / `--base-repo-name` flags to override.
- `build download` fetches a mobile build artifact (APK or IPA) previously
  uploaded to Sentry's preprod system for size analysis. **Sentry SaaS only.**
- The build must be installable. Builds that are still processing — or that have
  no downloadable artifact — cannot be downloaded.
- Without `--output`, the artifact is saved as
  `preprod_artifact_<build-id>.<ext>` in the current directory.
- The organization is resolved from `--org`, `SENTRY_ORG`, config defaults, or a
  detected DSN.
