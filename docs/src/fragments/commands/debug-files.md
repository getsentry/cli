


## Examples

```bash
# Inspect a debug information file (auto-detects the format)
sentry debug-files check ./libexample.so
sentry debug-files check MyApp.dSYM/Contents/Resources/DWARF/MyApp
sentry debug-files check ./app.pdb --json

# List the source files a debug file references (and whether they're available)
sentry debug-files print-sources ./libexample.so
sentry debug-files print-sources ./app.pdb --json

# Bundle a debug file's referenced source files (run on the build machine)
sentry debug-files bundle-sources ./libexample.so
sentry debug-files bundle-sources ./app.pdb --output ./app.src.zip

# Bundle JVM sources with a debug ID
sentry debug-files bundle-jvm --output ./out --debug-id <uuid> ./src

# Exclude additional directories
sentry debug-files bundle-jvm --output ./out --debug-id <uuid> --exclude generated --exclude build-tools ./src

# Output as JSON
sentry debug-files bundle-jvm --output ./out --debug-id <uuid> --json ./src

# Upload debug information files (scans directories recursively)
sentry debug-files upload ./build
sentry debug-files upload ./libexample.so --include-sources

# .zip archives are scanned in place; use --no-zips to skip them
sentry debug-files upload ./symbols.zip
sentry debug-files upload ./build --no-zips

# Restrict by type or debug id, and wait for server-side processing
sentry debug-files upload ./dsyms --type dsym --wait
sentry debug-files upload ./build --id <debug-id> --require-all

# Preview what would be uploaded without uploading (no credentials needed)
sentry debug-files upload ./build --no-upload
```

## Important Notes

- `check`, `print-sources`, `bundle-sources`, and `bundle-jvm` are **local-only**
  — they make no network requests. They parse object files in-process
  (Mach-O/dSYM, ELF, PE/PDB, Portable PDB, WebAssembly, Breakpad, source bundles)
  via a bundled `symbolic` WASM module.
- `check` exits non-zero if the file is not usable for symbolication (no debug
  id or no useful features).
- `print-sources` lists the source files each object references, reporting for
  each whether the source is embedded in the debug file, available via a source
  link, or present on the local disk. It is a read-only preview of what
  `bundle-sources` would collect and always exits zero on a parseable file.
- `bundle-sources` reads source files from the paths recorded in the debug info,
  so it is normally run on the build machine right after compiling. Referenced
  files that are not present locally are skipped; it exits non-zero (writing
  nothing) when none are found. The bundle defaults to `<path>.src.zip` and is
  uploaded via `sentry debug-files upload`.
- `upload` scans each path (files or directories, walked recursively) for
  native debug information files, parses them in-process, and uploads matching
  files via the chunk-upload protocol. Use `--type`/`--id` to restrict which
  files are sent, `--no-debug`/`--no-unwind`/`--no-sources` to drop files whose
  only useful feature is the named one, and `--include-sources` to attach a
  source bundle per file. `.zip` archives are scanned in place by default (their
  entries run through the same filters; nested archives are not recursed) — pass
  `--no-zips` to skip them. `--derived-data` additionally scans Xcode's
  `~/Library/Developer/Xcode/DerivedData` folder (macOS only). `--no-upload`
  previews the selection without credentials; `--wait`/`--wait-for` block on
  server-side processing and exit non-zero if any file fails. `--require-all`
  fails if a requested `--id` was not found. The server-advertised maximum file
  size and maximum processing wait are honored automatically (oversized files
  are skipped with a warning). `--symbol-maps` (BCSymbolMap resolution) and
  `--il2cpp-mapping` line mappings are not yet supported.
- Upload a JVM bundle separately via `sentry debug-files upload --type jvm`.
- Supported JVM source file extensions: `.java`, `.kt`, `.scala`, `.sc`,
  `.groovy`, `.gvy`, `.gy`, `.gsh`, `.clj`, `.cljc`
- Build output directories (`build/`, `target/`, `out/`, `bin/`) are
  automatically excluded unless they appear under a `src/` ancestor.
- Source-set prefixes (e.g., `src/main/java/`) are stripped to produce
  package-relative paths matching JVM stack traces.
