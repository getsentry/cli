

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

## Error handling

Both `sentry sourcemap inject` and `sentry sourcemap upload` exit with an
error if zero JS + sourcemap pairs are discovered in the target
directory. This catches silent bundler misconfigurations — the most
common cause is a bundler that isn't emitting `.map` files:

```
# Vite / Astro: set `vite.build.sourcemap: "hidden"` (Astro 5) or
# `vite.environments.client.build.sourcemap: "hidden"` (Astro 6+).

# webpack: set `devtool: "hidden-source-map"`.

# esbuild: set `sourcemap: true` or `sourcemap: "linked"`.
```

For CI steps that may run against legitimately-empty directories (e.g.,
library-only repos, conditional release skips), pass `--allow-empty` to
suppress the error:

```bash
sentry sourcemap upload ./dist --allow-empty
```
