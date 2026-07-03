## Examples

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

## Important Notes

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
