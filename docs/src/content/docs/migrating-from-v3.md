---
title: Migrating from v3 (sentry-cli)
description: Upgrade guide from the legacy sentry-cli (v3) to the new sentry CLI (v4), including the sentry-cli → sentry rename, command changes, and copy-paste compatibility shims.
---

Version 4 is a ground-up rewrite of the Sentry CLI. The most visible change is
the name: the tool is now called **`sentry`** (not `sentry-cli`), shipped from
the **`sentry`** npm package (not `@sentry/cli`). Most of your commands keep
working — many old names are kept as hidden aliases — but a handful moved, and
the output/exit-code behavior was modernized.

This guide covers everything that changed and gives you **copy-paste shims** so
existing scripts and muscle memory keep working while you migrate.

:::tip[In a hurry?]
Add the [compatibility shim](#drop-in-compatibility-shim) to your shell profile
and most `sentry-cli …` invocations keep working unchanged. Then migrate at your
own pace.
:::

## What changed at a glance

| Area | v3 (`sentry-cli`) | v4 (`sentry`) |
|------|-------------------|---------------|
| Binary name | `sentry-cli` | `sentry` |
| npm package | `@sentry/cli` | `sentry` |
| Command groups | plural (`releases`, `projects`) | singular (`release`, `project`) |
| Output | plain text | Markdown on a TTY, plain when piped, `--json` for machines |
| Exit codes | mostly `1` | [semantic ranges](/exit-codes/) (auth=1x, input=2x, API=3x…) |
| Auth | token-only | OAuth device flow (`sentry auth login`) **or** token |
| Some commands | `login`, `update`, `upload-dif`, `deploys` | moved (see [table](#command-changes)) |
| Flags | per-command `--auth-token`/`--url`/`--header`/… | `--org`/`--project`/`--log-level`/`-v` kept; others → env vars (see [Global flags](#global-flags-and-options)) |

Your **environment variables** (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`,
`SENTRY_PROJECT`, `SENTRY_DSN`, `SENTRY_URL`) and your **`.sentryclirc`** file
are still read, so CI credentials keep working as-is.

## Installation

Uninstall the old package/binary and install the new one.

```bash
# npm / pnpm / yarn / bun
npm uninstall -g @sentry/cli
npm install -g sentry            # or: pnpm add -g sentry / yarn global add sentry / bun add -g sentry

# Homebrew
brew uninstall sentry-cli
brew install getsentry/tools/sentry

# Install script
curl https://cli.sentry.dev/install -fsS | bash

# One-off, no install
npx sentry@latest --help
```

Verify:

```bash
sentry --version
sentry auth status
```

## The `sentry-cli` → `sentry` rename

If you only ever call the top-level binary, the simplest bridge is a plain
alias so old commands and scripts resolve to the new binary:

```bash
# ~/.bashrc or ~/.zshrc
alias sentry-cli='sentry'
```

This is enough **if** you only used commands whose names didn't move (see the
[table below](#command-changes)). For the commands that did move, use the
[compatibility shim](#drop-in-compatibility-shim) instead of a plain alias.

For CI, either update your install step to `npm install -g sentry` and call
`sentry`, or add a one-line shim in your job:

```bash
# GitHub Actions / any CI shell
npm install -g sentry
sentry-cli() { sentry "$@"; }   # if you didn't use any moved commands
```

## Command changes

### Still work unchanged

These are identical, or the old plural form still works as a shortcut:

| v3 | v4 |
|----|----|
| `sentry-cli info` | `sentry info` |
| `sentry-cli send-event …` | `sentry send-event …` |
| `sentry-cli send-envelope …` | `sentry send-envelope …` |
| `sentry-cli bash-hook` | `sentry bash-hook` |
| `sentry-cli sourcemaps …` | `sentry sourcemaps …` (or `sentry sourcemap …`) |
| `sentry-cli debug-files …` | `sentry debug-files …` |
| `sentry-cli react-native gradle` | `sentry react-native gradle` |
| `sentry-cli react-native xcode` | `sentry react-native xcode` |

### Renamed groups (plural → singular)

Command **groups** are singular now. The plural name still works as a shortcut
for the bare **list** (`sentry releases` → lists releases), but any
**subcommand** must use the singular form:

| v3 | v4 |
|----|----|
| `sentry-cli organizations …` | `sentry org …` |
| `sentry-cli projects …` | `sentry project …` |
| `sentry-cli releases …` | `sentry release …` |
| `sentry-cli issues …` | `sentry issue …` |
| `sentry-cli monitors …` | `sentry monitor …` |
| `sentry-cli repos …` | `sentry repo …` |
| `sentry-cli events …` | `sentry event …` |

```bash
# v3
sentry-cli releases new 1.0.0
# v4
sentry release new 1.0.0
```

### Moved commands

These live under a different group now:

| v3 | v4 |
|----|----|
| `sentry-cli login` | `sentry auth login` |
| `sentry-cli logout` | `sentry auth logout` |
| `sentry-cli update` | `sentry cli upgrade` |
| `sentry-cli uninstall` | `sentry cli uninstall` |
| `sentry-cli deploys new …` | `sentry release deploys new …` |
| `sentry-cli upload-dif …` | `sentry debug-files upload …` |
| `sentry-cli upload-dsym …` | `sentry debug-files upload …` |
| `sentry-cli difutil check …` | `sentry debug-files check …` |
| `sentry-cli upload-proguard …` | `sentry proguard upload …` |

Most of these were already soft-deprecated in v3 (hidden from `--help` in favor
of `debug-files` / `proguard`); v4 simply drops the legacy top-level spellings.

## Drop-in compatibility shim

Paste this shell function into your `~/.bashrc` / `~/.zshrc` (or a CI step). It
transparently translates every moved/renamed command to its v4 equivalent, so
existing `sentry-cli …` calls keep working. Anything it doesn't special-case is
passed straight through to `sentry`.

```bash
sentry-cli() {
  # v3 global flags that became environment variables in v4 (see the
  # "Global flags" section below). Translate them into a per-call env prefix
  # so we don't pollute the parent shell.
  local envs=() rest=() headers=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --auth-token)   envs+=("SENTRY_AUTH_TOKEN=$2"); shift 2 ;;
      --auth-token=*) envs+=("SENTRY_AUTH_TOKEN=${1#*=}"); shift ;;
      --url)          envs+=("SENTRY_URL=$2"); shift 2 ;;
      --url=*)        envs+=("SENTRY_URL=${1#*=}"); shift ;;
      # Multiple --header flags merge into one semicolon-separated var.
      --header)       headers="${headers:+$headers; }$2"; shift 2 ;;
      --header=*)     headers="${headers:+$headers; }${1#*=}"; shift ;;
      *)              rest+=("$1"); shift ;;
    esac
  done
  [ -n "$headers" ] && envs+=("SENTRY_CUSTOM_HEADERS=$headers")
  set -- "${rest[@]}"

  # `env` runs the real `sentry` binary (bypassing this function → no recursion).
  case "$1" in
    # Moved commands
    login|logout)            local c=$1; shift; env "${envs[@]}" sentry auth "$c" "$@" ;;
    update)                  shift; env "${envs[@]}" sentry cli upgrade "$@" ;;
    uninstall)               shift; env "${envs[@]}" sentry cli uninstall "$@" ;;
    deploys)                 shift; env "${envs[@]}" sentry release deploys "$@" ;;
    upload-dif|upload-dsym)  shift; env "${envs[@]}" sentry debug-files upload "$@" ;;
    upload-proguard)         shift; env "${envs[@]}" sentry proguard upload "$@" ;;
    difutil)                 shift; env "${envs[@]}" sentry debug-files "$@" ;;

    # Renamed groups (plural → singular) so subcommands keep working
    organizations)           shift; env "${envs[@]}" sentry org "$@" ;;
    projects)                shift; env "${envs[@]}" sentry project "$@" ;;
    releases)                shift; env "${envs[@]}" sentry release "$@" ;;
    issues)                  shift; env "${envs[@]}" sentry issue "$@" ;;
    monitors)                shift; env "${envs[@]}" sentry monitor "$@" ;;
    repos)                   shift; env "${envs[@]}" sentry repo "$@" ;;
    events)                  shift; env "${envs[@]}" sentry event "$@" ;;

    # Everything else is unchanged
    *) env "${envs[@]}" sentry "$@" ;;
  esac
}
```

:::note
`env` runs the real `sentry` binary, bypassing the function (no infinite
recursion), and applies the translated `--auth-token`/`--url`/`--header` values
for that one call only. In `fish`, port the same preprocessing + `switch`/`case`
into a `function sentry-cli … end`.
:::

## Global flags and options

v3 accepted many of the same flags on (nearly) every command. v4 keeps a small
set as **global flags** and moves the rest to environment variables — so the
biggest migration gotcha is flags that silently no longer exist.

### Still global (work on every command)

| v3 flag | v4 |
|---------|----|
| `--org <slug>` | `--org` (accepted; also `SENTRY_ORG`) |
| `--project <slug>` | `--project` (accepted; also `SENTRY_PROJECT`, or `org/project` combo) |
| `--log-level <level>` | `--log-level` |
| — | `-v` / `--verbose` |
| — | `--json`, `--fields` (new — structured output) |

### Replaced by environment variables

| v3 flag | v4 replacement |
|---------|----------------|
| `--auth-token <tok>` | `SENTRY_AUTH_TOKEN` (or `sentry auth login`) |
| `--url <url>` (self-hosted) | `SENTRY_URL` / `SENTRY_HOST`, or pass the URL as a command argument |
| `--header "K: V"` | `SENTRY_CUSTOM_HEADERS` |

The [compatibility shim](#drop-in-compatibility-shim) above translates
`--auth-token`, `--url`, and `--header` into these env vars automatically.

### Dropped

`--quiet` has no direct replacement — pipe the output (non-TTY is plain) or use
`--log-level error`.

:::caution
Command-specific flags changed more than the global ones, and some v3 flags
don't exist in v4 yet. A few notable ones:

- `release set-commits` drops `--ignore-missing`.
- `release deploy` takes the environment and name as part of the positional
  target (`org/version/env/name`), not `--env`/`--name`.
- `sourcemap upload`/`inject` drop several flags (see [Sourcemaps](#sourcemaps)).

Before relying on a flag, confirm it with `sentry <command> --help` — that's the
authoritative list for v4. If a flag you depend on is missing, please
[open an issue](https://github.com/getsentry/cli/issues).
:::

## Node.js wrapper (`SentryCli` class)

v3's `@sentry/cli` package exported a `SentryCli` class for programmatic use:

```js
// v3
const SentryCli = require("@sentry/cli");
const cli = new SentryCli(null, { authToken: process.env.SENTRY_AUTH_TOKEN });
await cli.releases.new("1.0.0");
await cli.releases.uploadSourceMaps("1.0.0", { include: ["./dist"] });
await cli.releases.setCommits("1.0.0", { auto: true });
await cli.releases.finalize("1.0.0");
```

v4 does **not** ship the `SentryCli` class. Instead, the `sentry` package is
itself usable as a library via `createSentrySDK()`, which exposes a typed method
for **every** command (full reference: [Library Usage](/library-usage/)):

```js
// v4
import createSentrySDK from "sentry";
const sdk = createSentrySDK({ token: process.env.SENTRY_AUTH_TOKEN });
await sdk.release.create({ orgVersion: "1.0.0" });
await sdk.sourcemap.upload({ directory: "./dist", release: "1.0.0" });
await sdk.release["set-commits"]({ orgVersion: "1.0.0", auto: true });
await sdk.release.finalize({ orgVersion: "1.0.0" });
```

Mapping:

| v3 (`@sentry/cli`) | v4 (`sentry`) |
|--------------------|---------------|
| `new SentryCli(configFile, { authToken })` | `createSentrySDK({ token })` (`configFile` dropped) |
| `cli.releases.new(v)` | `sdk.release.create({ orgVersion: v })` |
| `cli.releases.finalize(v)` | `sdk.release.finalize({ orgVersion: v })` |
| `cli.releases.setCommits(v, o)` | `sdk.release["set-commits"]({ orgVersion: v, ...o })` |
| `cli.releases.uploadSourceMaps(v, { include })` | `sdk.sourcemap.upload({ directory, release: v })` |
| `cli.releases.newDeploy(v, { env, name })` | `sdk.release.deploy({ orgVersionEnvironmentName: "v/env/name" })` (env/name are part of the positional target, not options; `url`/`started`/`finished`/`time` are options) |
| `cli.releases.proposeVersion()` | `sdk.release["propose-version"]()` |
| `cli.execute(args)` | `sdk.run(...args)` |

Note the argument reshaping: the v3 `uploadSourceMaps` `include` array becomes
the `directory` argument of `sourcemap.upload`, and the release is optional
(sourcemap upload is keyed by debug ID, as it has been since v2).

### Codemod

To automate the mechanical parts of this migration, run the codemod (it rewrites
the import, constructor, and method chain, and inserts `// TODO(sentry-v4): …`
comments where option shapes changed and need a manual check):

```bash
npx jscodeshift \
  -t https://raw.githubusercontent.com/getsentry/cli/main/codemods/sentry-v3-to-v4.cjs \
  src/
```

Use `--parser=tsx` for TypeScript sources. Review the diff afterward — argument
shapes differ (especially for `uploadSourceMaps`), so the codemod flags those
rather than guessing. See [`codemods/`](https://github.com/getsentry/cli/tree/main/codemods)
for details.

## Output and scripting

v4 produces richer human output (Markdown, rendered on a TTY) but stays
**script-friendly**:

- **Piping / non-TTY** automatically emits plain text — no ANSI codes.
- **`--json`** on any command emits stable JSON for machines; combine with
  `--fields` to select columns.
- Color respects `NO_COLOR`, `FORCE_COLOR`, and `SENTRY_PLAIN_OUTPUT`.

```bash
# v3: parse text with grep/awk
sentry-cli releases list | awk '{print $1}'

# v4: query structured JSON
sentry release list --json | jq -r '.[].version'
```

If a script parsed the old plain-text tables, switch it to `--json` — it's far
more robust than screen-scraping.

## Authentication

v4 adds a browser-based **OAuth device flow** for interactive use, while still
honoring tokens for CI:

```bash
# Interactive (opens a browser, no token needed)
sentry auth login

# Check who you are / token validity
sentry auth status
sentry auth whoami        # or the top-level: sentry whoami

# CI / non-interactive — unchanged from v3
export SENTRY_AUTH_TOKEN=sntrys_…
sentry auth status
```

`SENTRY_AUTH_TOKEN` works exactly as before and takes precedence over stored
credentials, so existing CI pipelines don't need changes. (v4 also accepts
`SENTRY_TOKEN` as an alias for it.)

Note: there is **no `--auth-token` flag** in v4 — authentication comes from
`sentry auth login`, `SENTRY_AUTH_TOKEN`, or `.sentryclirc`. See
[Global flags](#global-flags-and-options) below.

## Exit codes

v3 mostly exited `1` on any error. v4 uses [semantic exit
codes](/exit-codes/) so scripts and CI can branch on the failure category
(`1x` auth, `2x` input/config, `3x` API/network, `4x` feature/billing, …).

If a script did `sentry-cli … || handle_error`, it still works — any non-zero
code triggers the fallback. Only update it if you were matching the **specific**
value `1`.

## Sourcemaps

The command maps `sourcemaps` → `sourcemap` (the plural is aliased, so existing
invocations keep working):

```bash
# v3
sentry-cli sourcemaps upload ./dist

# v4 (either form works)
sentry sourcemap upload ./dist
```

Two behavioral differences to be aware of:

- **Positional args:** v3 accepted multiple paths (`[PATHS]...`); v4 takes a
  single `<directory>` (both `upload` and `inject`). Run one invocation per
  directory.
- **Flags:** v4 `sourcemap upload` keeps `--release`, `--dist`, `--url-prefix`,
  `--ext`, `--ignore`, `--ignore-file`, `--strip-prefix`,
  `--strip-common-prefix`, `--no-rewrite`, `--allow-empty`. These v3 flags are
  **not present** in v4: `--url-suffix`, `--note`, `--validate`, `--decompress`,
  `--wait`, `--wait-for`, `--no-sourcemap-reference`, `--debug-id-reference`,
  `--bundle`, `--bundle-sourcemap`, `--strict`. `sourcemap inject` also drops
  `--release`. Run `sentry sourcemap upload --help` for the current set.

See [`sourcemap`](/commands/sourcemap/) for details.

## Configuration

Configuration precedence is unchanged in spirit and fully backward compatible:

1. CLI flags
2. `SENTRY_ORG` / `SENTRY_PROJECT` env vars (`SENTRY_PROJECT` accepts
   `org/project`)
3. Stored defaults (`sentry auth login` / `sentry cli defaults`)
4. DSN auto-detection from your source and `.env` files
5. Directory-name inference

Your existing **`.sentryclirc`** and `SENTRY_*` environment variables are still
read. See [Configuration](/configuration/) for the full list.

## Getting help

- `sentry --help` — top-level command list
- `sentry <command> --help` — details and flags for any command
- [Command reference](/commands/) · [Exit codes](/exit-codes/) ·
  [Configuration](/configuration/)

If a command you relied on isn't covered here, please
[open an issue](https://github.com/getsentry/cli/issues) — we want the
migration to be painless.
