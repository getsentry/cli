

## Examples

### Upload mapping files

```bash
# Upload a ProGuard/R8 mapping file (org/project auto-detected)
sentry proguard upload ./app/build/outputs/mapping/release/mapping.txt

# Upload multiple mapping files at once
sentry proguard upload build/mapping1.txt build/mapping2.txt

# Upload with a forced UUID (single file only)
sentry proguard upload mapping.txt --uuid 5db7294d-87fc-5726-a5c0-4a90679657a5

# Dry run — compute UUIDs without uploading
sentry proguard upload mapping.txt --no-upload

# Require at least one file (useful in CI — fails if glob expands to nothing)
sentry proguard upload build/outputs/**/*.txt --require-one
```

### Compute UUID

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
