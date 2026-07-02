

## Examples

```bash
# Upload an Android build (APK or AAB) for size analysis
sentry build upload ./app-release.apk

# Upload with a build configuration and release notes
sentry build upload ./app.aab --build-configuration Release --release-notes "Nightly"

# Tag a build with install groups (repeatable)
sentry build upload ./app.aab --install-group qa --install-group beta

# Download a build artifact by ID
sentry build download 1234567890

# Download to a specific path
sentry build download 1234567890 --output ./app.ipa

# Output the result as JSON
sentry build download 1234567890 --json
```

## Important Notes

- `build upload` supports **Android APK and AAB**. iOS XCArchive/IPA upload is
  not yet supported. **Sentry SaaS only.**
- Multiple paths may be uploaded at once; the command exits non-zero if any
  build fails to upload.
- `build download` fetches a mobile build artifact (APK or IPA) previously
  uploaded to Sentry's preprod system for size analysis. **Sentry SaaS only.**
- The build must be installable. Builds that are still processing — or that have
  no downloadable artifact — cannot be downloaded.
- Without `--output`, the artifact is saved as
  `preprod_artifact_<build-id>.<ext>` in the current directory.
- The organization is resolved from `--org`, `SENTRY_ORG`, config defaults, or a
  detected DSN.
