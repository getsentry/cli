


## Examples

```bash
# Bundle JVM sources with a debug ID
sentry debug-files bundle-jvm --output ./out --debug-id <uuid> ./src

# Exclude additional directories
sentry debug-files bundle-jvm --output ./out --debug-id <uuid> --exclude generated --exclude build-tools ./src

# Output as JSON
sentry debug-files bundle-jvm --output ./out --debug-id <uuid> --json ./src
```

## Important Notes

- This command is **local-only** — it makes no network requests. Upload the
  generated bundle separately via `sentry debug-files upload --type jvm`.
- Supported JVM source file extensions: `.java`, `.kt`, `.scala`, `.sc`,
  `.groovy`, `.gvy`, `.gy`, `.gsh`, `.clj`, `.cljc`
- Build output directories (`build/`, `target/`, `out/`, `bin/`) are
  automatically excluded unless they appear under a `src/` ancestor.
- Source-set prefixes (e.g., `src/main/java/`) are stripped to produce
  package-relative paths matching JVM stack traces.
