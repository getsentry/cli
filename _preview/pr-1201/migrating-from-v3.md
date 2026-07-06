---
title: "Migrating from v3 (sentry-cli)"
description: "Upgrade guide from the legacy sentry-cli (v3) to the new sentry CLI (v4), including the sentry-cli → sentry rename, command changes, and copy-paste compatibility shims."
url: "https://cli.sentry.dev/_preview/pr-1201/migrating-from-v3/"
---

# Migrating from v3 (sentry-cli)

Version 4 is a ground-up rewrite of the Sentry CLI. The most visible change is the name: the tool is now called **`sentry`** (not `sentry-cli`), shipped from the **`sentry`** npm package (not `@sentry/cli`). Most of your commands keep working — many old names are kept as hidden aliases — but a handful moved, and the output/exit-code behavior was modernized.

This guide covers everything that changed and gives you **copy-paste shims** so existing scripts and muscle memory keep working while you migrate.

In a hurry?

Add the [compatibility shim](#drop-in-compatibility-shim) to your shell profile and most `sentry-cli …` invocations keep working unchanged. Then migrate at your own pace.

## What changed at a glance

[Section titled “What changed at a glance”](#what-changed-at-a-glance)

| Area | v3 (`sentry-cli`) | v4 (`sentry`) |
| --- | --- | --- |
| Binary name | `sentry-cli` | `sentry` |
| npm package | `@sentry/cli` | `sentry` |
| Command groups | plural (`releases`, `projects`) | singular (`release`, `project`) |
| Output | plain text | Markdown on a TTY, plain when piped, `--json` for machines |
| Exit codes | mostly `1` | [semantic ranges](/exit-codes/) (auth=1x, input=2x, API=3x…) |
| Auth | token-only | OAuth device flow (`sentry auth login`) **or** token |
| Some commands | `login`, `update`, `upload-dif`, `deploys` | moved (see [table](#command-changes)) |

Your **environment variables** (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_DSN`, `SENTRY_URL`) and your **`.sentryclirc`** file are still read, so CI credentials keep working as-is.

## Installation

[Section titled “Installation”](#installation)

Uninstall the old package/binary and install the new one.

Terminal window

```
# npm / pnpm / yarn / bunnpm uninstall -g @sentry/clinpm install -g sentry            # or: pnpm add -g sentry / yarn global add sentry / bun add -g sentry
# Homebrewbrew uninstall sentry-clibrew install getsentry/tools/sentry
# Install scriptcurl https://cli.sentry.dev/install -fsS | bash
# One-off, no installnpx sentry@latest --help
```


Verify:

Terminal window

```
sentry --versionsentry auth status
```


## The `sentry-cli` → `sentry` rename

[Section titled “The sentry-cli → sentry rename”](#the-sentry-cli--sentry-rename)

If you only ever call the top-level binary, the simplest bridge is a plain alias so old commands and scripts resolve to the new binary:

Terminal window

```
# ~/.bashrc or ~/.zshrcalias sentry-cli='sentry'
```


This is enough **if** you only used commands whose names didn't move (see the [table below](#command-changes)). For the commands that did move, use the [compatibility shim](#drop-in-compatibility-shim) instead of a plain alias.

For CI, either update your install step to `npm install -g sentry` and call `sentry`, or add a one-line shim in your job:

Terminal window

```
# GitHub Actions / any CI shellnpm install -g sentrysentry-cli() { sentry "$@"; }   # if you didn't use any moved commands
```


## Command changes

[Section titled “Command changes”](#command-changes)

### Still work unchanged

[Section titled “Still work unchanged”](#still-work-unchanged)

These are identical, or the old plural form still works as a shortcut:

| v3 | v4 |
| --- | --- |
| `sentry-cli info` | `sentry info` |
| `sentry-cli send-event …` | `sentry send-event …` |
| `sentry-cli send-envelope …` | `sentry send-envelope …` |
| `sentry-cli bash-hook` | `sentry bash-hook` |
| `sentry-cli sourcemaps …` | `sentry sourcemaps …` (or `sentry sourcemap …`) |
| `sentry-cli debug-files …` | `sentry debug-files …` |
| `sentry-cli react-native gradle` | `sentry react-native gradle` |
| `sentry-cli react-native xcode` | `sentry react-native xcode` |

### Renamed groups (plural → singular)

[Section titled “Renamed groups (plural → singular)”](#renamed-groups-plural--singular)

Command **groups** are singular now. The plural name still works as a shortcut for the bare **list** (`sentry releases` → lists releases), but any **subcommand** must use the singular form:

| v3 | v4 |
| --- | --- |
| `sentry-cli organizations …` / `orgs` | `sentry org …` |
| `sentry-cli projects …` | `sentry project …` |
| `sentry-cli releases new/finalize/set-commits …` | `sentry release new/finalize/set-commits …` |
| `sentry-cli issues …` | `sentry issue …` |
| `sentry-cli monitors …` | `sentry monitor …` |
| `sentry-cli repos …` | `sentry repo …` |
| `sentry-cli events …` | `sentry event …` |

Terminal window

```
# v3sentry-cli releases new 1.0.0# v4sentry release new 1.0.0
```


### Moved commands

[Section titled “Moved commands”](#moved-commands)

These live under a different group now:

| v3 | v4 |
| --- | --- |
| `sentry-cli login` | `sentry auth login` |
| `sentry-cli logout` | `sentry auth logout` |
| `sentry-cli update` | `sentry cli upgrade` |
| `sentry-cli uninstall` | `sentry cli uninstall` |
| `sentry-cli deploys new …` | `sentry release deploys new …` |
| `sentry-cli upload-dif …` | `sentry debug-files upload …` |
| `sentry-cli upload-dsym …` | `sentry debug-files upload …` |
| `sentry-cli difutil check …` | `sentry debug-files check …` |
| `sentry-cli upload-proguard …` | `sentry proguard upload …` |

### Removed

[Section titled “Removed”](#removed)

| v3 | v4 |
| --- | --- |
| `sentry-cli send-metric …` | **Removed** — metrics were deprecated in Sentry. No replacement. |

## Drop-in compatibility shim

[Section titled “Drop-in compatibility shim”](#drop-in-compatibility-shim)

Paste this shell function into your `~/.bashrc` / `~/.zshrc` (or a CI step). It transparently translates every moved/renamed command to its v4 equivalent, so existing `sentry-cli …` calls keep working. Anything it doesn't special-case is passed straight through to `sentry`.

Terminal window

```
sentry-cli() {  case "$1" in    # Moved commands    login|logout)            local c=$1; shift; command sentry auth "$c" "$@" ;;    update)                  shift; command sentry cli upgrade "$@" ;;    uninstall)               shift; command sentry cli uninstall "$@" ;;    deploys)                 shift; command sentry release deploys "$@" ;;    upload-dif|upload-dsym)  shift; command sentry debug-files upload "$@" ;;    upload-proguard)         shift; command sentry proguard upload "$@" ;;    difutil)                 shift; command sentry debug-files "$@" ;;
    # Renamed groups (plural → singular) so subcommands keep working    organizations|orgs)      shift; command sentry org "$@" ;;    projects)                shift; command sentry project "$@" ;;    releases)                shift; command sentry release "$@" ;;    issues)                  shift; command sentry issue "$@" ;;    monitors)                shift; command sentry monitor "$@" ;;    repos)                   shift; command sentry repo "$@" ;;    events)                  shift; command sentry event "$@" ;;
    # Removed    send-metric)      echo "sentry-cli send-metric was removed in v4 (metrics are deprecated)." >&2      return 1 ;;
    # Everything else is unchanged    *) command sentry "$@" ;;  esac}
```


Note

The `command` builtin bypasses the function so `sentry` always resolves to the real binary (no infinite recursion). In `fish`, wrap the same `switch`/`case` logic in a `function sentry-cli … end` instead.

## Output and scripting

[Section titled “Output and scripting”](#output-and-scripting)

v4 produces richer human output (Markdown, rendered on a TTY) but stays **script-friendly**:

- **Piping / non-TTY** automatically emits plain text — no ANSI codes.
- **`--json`** on any command emits stable JSON for machines; combine with
  `--fields` to select columns.
- Color respects `NO_COLOR`, `FORCE_COLOR`, and `SENTRY_PLAIN_OUTPUT`.

Terminal window

```
# v3: parse text with grep/awksentry-cli releases list | awk '{print $1}'
# v4: query structured JSONsentry release list --json | jq -r '.[].version'
```


If a script parsed the old plain-text tables, switch it to `--json` — it's far more robust than screen-scraping.

## Authentication

[Section titled “Authentication”](#authentication)

v4 adds a browser-based **OAuth device flow** for interactive use, while still honoring tokens for CI:

Terminal window

```
# Interactive (opens a browser, no token needed)sentry auth login
# Check who you are / token validitysentry auth statussentry auth whoami        # or the top-level: sentry whoami
# CI / non-interactive — unchanged from v3export SENTRY_AUTH_TOKEN=sntrys_…sentry auth status
```


`SENTRY_AUTH_TOKEN` (and the legacy `SENTRY_TOKEN`) continue to take precedence over stored credentials, so existing pipelines don't need changes.

## Exit codes

[Section titled “Exit codes”](#exit-codes)

v3 mostly exited `1` on any error. v4 uses [semantic exit codes](/exit-codes/) so scripts and CI can branch on the failure category (`1x` auth, `2x` input/config, `3x` API/network, `4x` feature/billing, …).

If a script did `sentry-cli … || handle_error`, it still works — any non-zero code triggers the fallback. Only update it if you were matching the **specific** value `1`.

## Sourcemaps

[Section titled “Sourcemaps”](#sourcemaps)

Sourcemap upload is now **debug-ID-first** and decoupled from releases — you no longer have to create a release just to upload maps:

Terminal window

```
# v3sentry-cli releases files 1.0.0 upload-sourcemaps ./dist
# v4 — debug-ID based (release optional)sentry sourcemap upload ./dist
```


`sentry sourcemaps …` (plural) is aliased to the same command, so existing invocations keep working. See [`sourcemap`](/commands/sourcemap/) for details.

## Configuration

[Section titled “Configuration”](#configuration)

Configuration precedence is unchanged in spirit and fully backward compatible:

1. CLI flags
2. `SENTRY_ORG` / `SENTRY_PROJECT` env vars (`SENTRY_PROJECT` accepts
   `org/project`)
3. Stored defaults (`sentry auth login` / `sentry cli defaults`)
4. DSN auto-detection from your source and `.env` files
5. Directory-name inference

Your existing **`.sentryclirc`** and `SENTRY_*` environment variables are still read. See [Configuration](/configuration/) for the full list.

## Getting help

[Section titled “Getting help”](#getting-help)

- `sentry --help` — top-level command list
- `sentry <command> --help` — details and flags for any command
- [Command reference](/commands/) · [Exit codes](/exit-codes/) ·
  [Configuration](/configuration/)

If a command you relied on isn't covered here, please [open an issue](https://github.com/getsentry/sentry-cli/issues) — we want the migration to be painless.
