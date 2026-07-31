---
title: "sourcemap"
description: "Sourcemap commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-main/commands/sourcemap/"
---

# sourcemap

Manage sourcemaps

## Commands

### `sentry sourcemap inject <directory>`

Inject debug IDs into JavaScript files and sourcemaps

**Arguments:**

| Argument | Description |
| --- | --- |
| `<directory>` | Directory to scan for JS + sourcemap pairs |

**Options:**

| Option | Description |
| --- | --- |
| `--ext <ext>` | Comma-separated file extensions to process (default: .js,.cjs,.mjs) |
| `--ignore <ignore>` | Comma-separated glob patterns to exclude (gitignore-style) |
| `--ignore-file <ignore-file>` | Path to a file with gitignore-style patterns to exclude |
| `--dry-run` | Show what would be modified without writing |
| `--allow-empty` | Exit successfully when no JS + sourcemap pairs are found (default: error out to catch silent build misconfigurations) |

### `sentry sourcemap upload <directory>`

Upload sourcemaps to Sentry

**Arguments:**

| Argument | Description |
| --- | --- |
| `<directory>` | Directory containing sourcemaps |

**Options:**

| Option | Description |
| --- | --- |
| `--release <release>` | Release version to associate with the upload |
| `--dist <dist>` | Distribution identifier to disambiguate builds within a release |
| `--url-prefix <url-prefix>` | URL prefix for uploaded files (default: ~/) |
| `--ext <ext>` | Comma-separated file extensions to process (default: .js,.cjs,.mjs) |
| `--ignore <ignore>` | Comma-separated glob patterns to exclude (gitignore-style) |
| `--ignore-file <ignore-file>` | Path to a file with gitignore-style patterns to exclude |
| `--strip-prefix <strip-prefix>` | Strip a prefix from uploaded file paths (e.g. 'build/') |
| `--strip-common-prefix` | Automatically strip the longest common path prefix from all files |
| `--no-rewrite` | Upload files as-is without injecting debug IDs |
| `--allow-empty` | Exit successfully when no JS + sourcemap pairs are found (default: error out to catch silent build misconfigurations) |

### `sentry sourcemap resolve <directory>`

Resolve and report sourcemap linkage for JavaScript files

**Arguments:**

| Argument | Description |
| --- | --- |
| `<directory>` | Directory to scan for JS files |

**Options:**

| Option | Description |
| --- | --- |
| `--ext <ext>` | Comma-separated file extensions to process (default: .js,.cjs,.mjs) |
| `--ignore <ignore>` | Comma-separated glob patterns to exclude (gitignore-style) |
| `--ignore-file <ignore-file>` | Path to a file with gitignore-style patterns to exclude |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

### Inject debug IDs

```bash
# Inject debug IDs into all JS files in dist/
sentry sourcemap inject ./dist


# Preview changes without writing
sentry sourcemap inject ./dist --dry-run


# Only process specific extensions
sentry sourcemap inject ./build --ext .js,.mjs
```


### Upload sourcemaps

```bash
# Upload sourcemaps from dist/
sentry sourcemap upload ./dist


# Associate with a release
sentry sourcemap upload ./dist --release 1.0.0


# Set a custom URL prefix
sentry sourcemap upload ./dist --url-prefix '~/static/js/'
```


### Resolve sourcemap linkage

```bash
# Report how each JS file's sourcemap resolves and whether a debug ID
# has been injected (read-only — never modifies files)
sentry sourcemap resolve ./dist


# Machine-readable output
sentry sourcemap resolve ./dist --json
```


Use `sentry sourcemap resolve` to debug why `sentry sourcemap upload` may not find the expected sourcemaps. It reports, for each JavaScript file, whether the companion `.map` was located (by convention or via a `sourceMappingURL` directive), whether the map is inline (`data:` URL) or remote, and whether a Sentry debug ID is present.

## Error handling

Both `sentry sourcemap inject` and `sentry sourcemap upload` exit with an error if zero JS + sourcemap pairs are discovered in the target directory. This catches silent bundler misconfigurations — the most common cause is a bundler that isn't emitting `.map` files:

```plaintext
# Vite / Astro: set `vite.build.sourcemap: "hidden"` (Astro 5) or
# `vite.environments.client.build.sourcemap: "hidden"` (Astro 6+).


# webpack: set `devtool: "hidden-source-map"`.


# esbuild: set `sourcemap: true` or `sourcemap: "linked"`.
```


For CI steps that may run against legitimately-empty directories (e.g., library-only repos, conditional release skips), pass `--allow-empty` to suppress the error:

```bash
sentry sourcemap upload ./dist --allow-empty
```

## Navigation

- [Docs home](https://cli.sentry.dev/_preview/pr-main/index.md)
- [Parent: Commands](https://cli.sentry.dev/_preview/pr-main/commands.md)
- [Previous: snapshots](https://cli.sentry.dev/_preview/pr-main/commands/snapshots.md)
- [Next: span](https://cli.sentry.dev/_preview/pr-main/commands/span.md)
