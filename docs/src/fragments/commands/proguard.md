

## Examples

### Upload

```bash
# Upload a ProGuard/R8 mapping file (org/project auto-detected)
sentry proguard upload ./app/build/outputs/mapping/release/mapping.txt

# Upload multiple mapping files
sentry proguard upload mapping-app.txt mapping-lib.txt

# Upload with a specific UUID (overrides the computed UUID)
sentry proguard upload --uuid abcdef01-2345-6789-abcd-ef0123456789 mapping.txt

# Validate without uploading
sentry proguard upload --no-upload mapping.txt
```

### UUID

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
- Upload uses the Sentry chunk-upload protocol (DIF). Each mapping is
  bundled as `proguard/<uuid>.txt`.
