

## Examples

### Upload mapping files

```bash
# Upload a ProGuard/R8 mapping file
sentry proguard upload ./app/build/outputs/mapping/release/mapping.txt

# Upload multiple mapping files at once
sentry proguard upload mapping1.txt mapping2.txt

# Preview without uploading (dry run)
sentry proguard upload mapping.txt --no-upload

# Force a specific UUID instead of computing from content
sentry proguard upload mapping.txt --uuid 12345678-1234-1234-1234-123456789abc

# Require at least one mapping file (exit non-zero if none found)
sentry proguard upload ./mappings/ --require-one
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
- `sentry proguard upload` uses the DIF chunk-upload protocol. Each mapping
  file is bundled as `proguard/<uuid>.txt`. Org/project are resolved via
  standard auto-detection (DSN, env vars, config defaults).
