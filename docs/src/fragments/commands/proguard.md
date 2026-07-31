

## Examples

```bash
# Upload a ProGuard/R8 mapping file (auto-detects org/project)
sentry proguard upload ./app/build/outputs/mapping/release/mapping.txt

# Upload with a specific UUID (overrides content-derived UUID)
sentry proguard upload mapping.txt --uuid 5db7294d-87fc-5726-a5c0-4a90679657a5

# Dry-run: compute UUIDs without uploading
sentry proguard upload mapping.txt --no-upload

# Upload multiple mapping files at once
sentry proguard upload mapping-release.txt mapping-debug.txt

# Compute the UUID for a mapping file (without uploading)
sentry proguard uuid ./app/build/outputs/mapping/release/mapping.txt

# Output UUID as JSON (includes the file path)
sentry proguard uuid mapping.txt --json
```

## Important Notes

- The UUID is **deterministically derived from the mapping file contents** —
  identical files always produce the same UUID. This is the same value
  Sentry uses to associate a mapping with obfuscated Android stack traces.
- This matches the UUID computed by the legacy `sentry-cli proguard uuid`
  command byte-for-byte.
