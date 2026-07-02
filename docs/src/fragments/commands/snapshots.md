

## Examples

```bash
# Download a specific baseline snapshot by ID
sentry snapshots download --snapshot-id 1234567890

# Download the latest baseline for an app, filtered by branch
sentry snapshots download --app-id my-app --branch main

# Extract images to a specific directory
sentry snapshots download --app-id my-app --output ./baseline/
```

## Important Notes

- `snapshots download` fetches baseline snapshot images from Sentry's preprod
  system and extracts them to a local directory. **Sentry SaaS only.**
- Provide exactly one of `--snapshot-id` (a direct artifact ID) or `--app-id`
  (resolves the latest baseline). `--branch` only applies with `--app-id`.
- With org auth tokens, resolving by `--app-id` requires `--project` with a
  numeric project ID.
- If the downloadable archive has not been built yet, the command triggers a
  build and waits for it (up to 5 minutes).
- Images are extracted to `./snapshots-base/` by default; override with
  `--output`.
- The organization is resolved from `--org`, `SENTRY_ORG`, config defaults, or a
  detected DSN.
