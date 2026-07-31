

## Examples

### `sentry proguard upload`

```bash
# Upload a ProGuard/R8 mapping file
sentry proguard upload ./app/build/outputs/mapping/release/mapping.txt

# Upload multiple mapping files
sentry proguard upload build/mapping1.txt build/mapping2.txt

# Force a specific UUID (single file only)
sentry proguard upload mapping.txt --uuid 5db7294d-87fc-5726-a5c0-4a90679657a5

# Dry-run: compute UUIDs without uploading
sentry proguard upload mapping.txt --no-upload

# Require at least one mapping file (useful in CI)
sentry proguard upload mapping.txt --require-one
```

### `sentry proguard uuid`

```bash
# Compute the UUID for a ProGuard/R8 mapping file
sentry proguard uuid ./app/build/outputs/mapping/release/mapping.txt

# Output as JSON (includes the file path)
sentry proguard uuid mapping.txt --json
```

## Important Notes

- The UUID is **deterministically derived from the mapping file contents** —
  identical files always produce the same UUID. This is the same value
  Sentry uses to associate a mapping with obfuscated Android stack traces.
- This matches the UUID computed by the legacy `sentry-cli proguard uuid`
  command byte-for-byte.
- The `upload` command uses the DIF chunk-upload protocol; org/project are
  resolved via the standard auto-detection cascade (DSN, env vars, config defaults).
