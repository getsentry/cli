---
title: "react-native"
description: "React-native commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1191/commands/react-native/"
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

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples
Terminal window

```
# Upload a bundle + sourcemap by debug ID (called by the Gradle plugin)sentry react-native gradle \  --bundle index.android.bundle \  --sourcemap index.android.bundle.map
# Also associate with a release and distribution(s)sentry react-native gradle \  --bundle index.android.bundle \  --sourcemap index.android.bundle.map \  --release com.example.app@1.0.0 \  --dist 1000
```


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
