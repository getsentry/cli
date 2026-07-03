---
title: "react-native"
description: "React-native commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1194/commands/react-native/"
---

# react-native

Upload React Native sourcemaps from build steps

## Commands

[Section titled “Commands”](#commands)

### `sentry react-native gradle`

[Section titled “sentry react-native gradle”](#sentry-react-native-gradle)

Upload a React Native bundle + sourcemap (Gradle build step)

**Options:**

| Option | Description |
| --- | --- |
| `--sourcemap <sourcemap>` | Path to the sourcemap to upload |
| `--bundle <bundle>` | Path to the bundle to upload |
| `--release <release>` | Release version to publish to |
| `--dist <dist>...` | Distribution(s) to publish (repeatable; requires --release) |
| `--wait` | Accepted for compatibility (the CLI always waits for assembly) |
| `--wait-for <wait-for>` | Accepted for compatibility (the CLI always waits for assembly) |

### `sentry react-native xcode <script-arg...>`

[Section titled “sentry react-native xcode <script-arg...>”](#sentry-react-native-xcode-script-arg)

Upload React Native sourcemaps (Xcode build step)

**Arguments:**

| Argument | Description |
| --- | --- |
| `<script-arg...>` | Extra arguments passed to the build script |

**Options:**

| Option | Description |
| --- | --- |
| `-f, --force` | Run even in a debug configuration |
| `--allow-fetch` | Fetch sourcemaps from the packager on simulator builds |
| `--fetch-from <fetch-from>` | Packager URL to fetch from (default: [http://127.0.0.1:8081/](http://127.0.0.1:8081/)) |
| `--build-script <build-script>` | Path to the react-native-xcode.sh build script |
| `--dist <dist>...` | Distribution(s) to publish (repeatable) |
| `--wait` | Accepted for compatibility (the CLI always waits for assembly) |
| `--wait-for <wait-for>` | Accepted for compatibility (the CLI always waits for assembly) |
| `--no-auto-release` | Don't read the release from Xcode project files |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples
Terminal window

```
# Upload a bundle + sourcemap by debug ID (called by the Gradle plugin)sentry react-native gradle \  --bundle index.android.bundle \  --sourcemap index.android.bundle.map
# Also associate with a release and distribution(s)sentry react-native gradle \  --bundle index.android.bundle \  --sourcemap index.android.bundle.map \  --release com.example.app@1.0.0 \  --dist 1000
# Xcode build phase (usually added automatically to your build script)../node_modules/.bin/sentry-cli react-native xcode
```


## Xcode build step (`react-native xcode`)

[Section titled “Xcode build step (react-native xcode)”](#xcode-build-step-react-native-xcode)

`react-native xcode` runs inside an Xcode "Bundle React Native code and images" build phase. It has three modes:

- **release build** — wraps the RN build script (standing in for
  `NODE_BINARY`/`HERMES_CLI_PATH`) to capture the produced bundle + sourcemap
  (including the Hermes combined sourcemap), then uploads them.
- **simulator build with `--allow-fetch`** — downloads the bundle + sourcemap
  from the running packager, then uploads.
- **debug build** — just runs the build script.

Release/distribution come from `SENTRY_RELEASE`/`SENTRY_DIST` or the app's `Info.plist` (`<CFBundleIdentifier>@<CFBundleShortVersionString>+<CFBundleVersion>`), unless `--no-auto-release` is set. Pass extra build-script arguments after the flags.

Limitations vs. the legacy CLI: `Info.plist` C preprocessing (`INFOPLIST_PREPROCESS`) and `xcodebuild`-based discovery outside an Xcode build are not supported — set `SENTRY_RELEASE`/`SENTRY_DIST` in those cases.

## Important Notes

[Section titled “Important Notes”](#important-notes)

- `react-native gradle` is normally invoked automatically by the
  [sentry-android-gradle-plugin](https://docs.sentry.io/platforms/react-native/sourcemaps/);
  you rarely run it by hand.
- It injects a debug ID into both the bundle and its sourcemap, then uploads
  them under the `~/<filename>` convention. Without `--release` the files are
  matched by debug ID; with `--release` they are also uploaded for each
  `--dist`.
- Indexed RAM bundles are not supported — use a plain or Hermes bundle.
- The CLI always waits for server-side assembly; `--wait`/`--wait-for` are
  accepted for backward compatibility but do not change behavior.
