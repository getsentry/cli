---
name: sentry-cli-react-native
version: 0.39.0-dev.0
description: Upload React Native sourcemaps from build steps
requires:
  bins: ["sentry"]
  auth: true
---

# React-native Commands

Upload React Native sourcemaps from build steps

### `sentry react-native gradle`

Upload a React Native bundle + sourcemap (Gradle build step)

**Flags:**
- `--sourcemap <value> - Path to the sourcemap to upload`
- `--bundle <value> - Path to the bundle to upload`
- `--release <value> - Release version to publish to`
- `--dist <value>... - Distribution(s) to publish (repeatable; requires --release)`
- `--wait - Accepted for compatibility (the CLI always waits for assembly)`
- `--wait-for <value> - Accepted for compatibility (the CLI always waits for assembly)`

**Examples:**

```bash
# Upload a bundle + sourcemap by debug ID (called by the Gradle plugin)
sentry react-native gradle \
  --bundle index.android.bundle \
  --sourcemap index.android.bundle.map

# Also associate with a release and distribution(s)
sentry react-native gradle \
  --bundle index.android.bundle \
  --sourcemap index.android.bundle.map \
  --release com.example.app@1.0.0 \
  --dist 1000
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
