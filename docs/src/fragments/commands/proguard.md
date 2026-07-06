

## Examples

### Uploading mapping files

```bash
# Upload a single ProGuard/R8 mapping file
sentry proguard upload ./app/build/outputs/mapping/release/mapping.txt

# Upload multiple mapping files at once
sentry proguard upload build/mapping1.txt build/mapping2.txt

# Force a specific UUID instead of computing from content
sentry proguard upload mapping.txt --uuid 5db7294d-87fc-5726-a5c0-4a90679657a5

# Dry-run: compute UUIDs without uploading
sentry proguard upload mapping.txt --no-upload

# Require at least one file (useful in CI)
sentry proguard upload mapping.txt --require-one
```

### Computing UUIDs

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
