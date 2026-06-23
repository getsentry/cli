


## Examples

```bash
# Inspect a debug information file (auto-detects the format)
sentry debug-files check ./libexample.so
sentry debug-files check MyApp.dSYM/Contents/Resources/DWARF/MyApp
sentry debug-files check ./app.pdb --json

# Bundle JVM sources with a debug ID
sentry debug-files bundle-jvm --output ./out --debug-id <uuid> ./src

# Exclude additional directories
sentry debug-files bundle-jvm --output ./out --debug-id <uuid> --exclude generated --exclude build-tools ./src

# Output as JSON
sentry debug-files bundle-jvm --output ./out --debug-id <uuid> --json ./src
```

## Important Notes

- `check` and `bundle-jvm` are **local-only** — they make no network requests.
  Both parse object files in-process (Mach-O/dSYM, ELF, PE/PDB, Portable PDB,
  WebAssembly, Breakpad, source bundles) via a bundled `symbolic` WASM module.
- `check` exits non-zero if the file is not usable for symbolication (no debug
  id or no useful features).
- Upload a JVM bundle separately via `sentry debug-files upload --type jvm`.
- Supported JVM source file extensions: `.java`, `.kt`, `.scala`, `.sc`,
  `.groovy`, `.gvy`, `.gy`, `.gsh`, `.clj`, `.cljc`
- Build output directories (`build/`, `target/`, `out/`, `bin/`) are
  automatically excluded unless they appear under a `src/` ancestor.
- Source-set prefixes (e.g., `src/main/java/`) are stripped to produce
  package-relative paths matching JVM stack traces.
