---
title: "Migrating from v3 (sentry-cli)"
description: "Upgrade guide from the legacy sentry-cli (v3) to the new sentry CLI (v4), including the sentry-cli → sentry rename, command changes, and copy-paste compatibility shims."
url: "https://cli.sentry.dev/_preview/pr-1283/migrating-from-v3/"
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
| Flags | per-command `--auth-token`/`--url`/`--header`/… | `--org`/`--project`/`--log-level`/`-v` kept; others → env vars (see [Global flags](#global-flags-and-options)) |

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
| `sentry-cli organizations …` | `sentry org …` |
| `sentry-cli projects …` | `sentry project …` |
| `sentry-cli releases …` | `sentry release …` |
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
| `sentry-cli deploys new …` | `sentry release deploy …` (create) |
| `sentry-cli deploys list …` | `sentry release deploys …` (list) |
| `sentry-cli upload-dif …` | `sentry debug-files upload …` |
| `sentry-cli upload-dsym …` | `sentry debug-files upload …` |
| `sentry-cli difutil check …` | `sentry debug-files check …` |
| `sentry-cli upload-proguard …` | `sentry proguard upload …` |

Most of these were already soft-deprecated in v3 (hidden from `--help` in favor of `debug-files` / `proguard`); v4 simply drops the legacy top-level spellings.

## Drop-in compatibility shim

[Section titled “Drop-in compatibility shim”](#drop-in-compatibility-shim)

Paste this shell function into your `~/.bashrc` / `~/.zshrc` (or a CI step). It transparently translates every moved/renamed command to its v4 equivalent, so existing `sentry-cli …` calls keep working. Anything it doesn't special-case is passed straight through to `sentry`.

Terminal window

```
sentry-cli() {  # v3 GLOBAL flags that became environment variables in v4 (see the "Global  # flags" section below). They precede the command, so translate only the  # LEADING run and stop at the first command word — this leaves command-level  # flags untouched (notably `--url`, which `release create`/`deploy` use for  # the release/deploy URL, not the Sentry host). Other still-valid v4 globals  # are collected into `lead` and re-applied before the command.  local envs=() lead=() headers="" allow_failure=""  while [ "$#" -gt 0 ]; do    case "$1" in      --auth-token)   envs+=("SENTRY_AUTH_TOKEN=$2"); shift 2 2>/dev/null || shift ;;      --auth-token=*) envs+=("SENTRY_AUTH_TOKEN=${1#*=}"); shift ;;      --url)          envs+=("SENTRY_URL=$2"); shift 2 2>/dev/null || shift ;;      --url=*)        envs+=("SENTRY_URL=${1#*=}"); shift ;;      # Multiple --header flags merge into one semicolon-separated var.      --header)       headers="${headers:+$headers; }$2"; shift 2 2>/dev/null || shift ;;      --header=*)     headers="${headers:+$headers; }${1#*=}"; shift ;;      # Still-valid v4 globals: keep them (value-taking ones consume a value).      --org|--project|--log-level|--fields) lead+=("$1" "$2"); shift 2 2>/dev/null || shift ;;      --org=*|--project=*|--log-level=*|--fields=*) lead+=("$1"); shift ;;      -v|--verbose|--json) lead+=("$1"); shift ;;      # v3 `--allow-failure` (and SENTRY_ALLOW_FAILURE) is gone in v4 and would      # be rejected as unknown. Strip it and emulate its "never fail" behavior.      --allow-failure) allow_failure=1; shift ;;      *)              break ;;    esac  done  [ "${SENTRY_ALLOW_FAILURE:-}" = "1" ] && allow_failure=1  [ -n "$headers" ] && envs+=("SENTRY_CUSTOM_HEADERS=$headers")
  # `env` runs the real `sentry` (bypassing this function → no recursion),  # re-applying any leading global flags before the translated command.  local run=(env "${envs[@]}" sentry "${lead[@]}")
  # `deploys` handling (top-level or nested under `releases`). Bare/`list` map to  # `release deploys` (list); only `new` (create) can't be shimmed — v4 takes the  # environment/name as positionals, not v3's `-e`/`-n` flags — so flag those.  local deploy_msg='sentry-cli: `deploys new` changed in v4 — environment/name are positionals now:\n  sentry release deploy <version> <environment> [name] [--url … --started … --finished …]\n'  _scli_deploys() {    local a dargs=()    for a in "$@"; do [ "$a" = "new" ] && { printf '%b' "$deploy_msg" >&2; return 64; }; done    for a in "$@"; do [ "$a" = "list" ] || dargs+=("$a"); done  # drop v3 `list`    "${run[@]}" release deploys "${dargs[@]}"  }
  _scli_dispatch() {    case "$1" in    # Moved commands    login|logout)            local c=$1; shift; "${run[@]}" auth "$c" "$@" ;;    update)                  shift; "${run[@]}" cli upgrade "$@" ;;    uninstall)               shift; "${run[@]}" cli uninstall "$@" ;;    deploys)                 shift; _scli_deploys "$@" ;;    upload-dif|upload-dsym)  shift; "${run[@]}" debug-files upload "$@" ;;    upload-proguard)         shift; "${run[@]}" proguard upload "$@" ;;    difutil)                 shift; "${run[@]}" debug-files "$@" ;;
    # `releases` → `release` (bare lists). v3 nested deploys under `releases`.    releases)      shift      if [ "$1" = "deploys" ]; then shift; _scli_deploys "$@"; return; fi      # v3 `releases` lists; insert `list` when there's no subcommand (only flags).      if [ "$#" -eq 0 ] || [ "${1#-}" != "$1" ]; then "${run[@]}" release list "$@";      else "${run[@]}" release "$@"; fi ;;
    # Other renamed groups (plural → singular). Bare (or flags-only) form lists    # (matches v4's native aliases); a subcommand uses the singular group (v4    # aliases `new`→`create`, `ls`→`list`, so subcommands keep working).    organizations|projects|issues|monitors|repos|events)      local grp=$1; shift      case "$grp" in        organizations) grp=org ;;        projects)       grp=project ;;        issues)         grp=issue ;;        monitors)       grp=monitor ;;        repos)          grp=repo ;;        events)         grp=event ;;      esac      # No subcommand (empty or a leading flag like `--json`) → explicit `list`,      # since some groups (e.g. project) default to `view`, not `list`.      if [ "$#" -eq 0 ] || [ "${1#-}" != "$1" ]; then "${run[@]}" "$grp" list "$@";      else "${run[@]}" "$grp" "$@"; fi ;;
    # Everything else is unchanged    *) "${run[@]}" "$@" ;;  esac  }
  # v3's `--allow-failure`/`SENTRY_ALLOW_FAILURE` made any command exit 0. v4  # dropped it, so emulate here: swallow a non-zero status when it was set.  if [ -n "$allow_failure" ]; then    _scli_dispatch "$@" || { printf 'sentry-cli: command failed, but --allow-failure/SENTRY_ALLOW_FAILURE was set — exiting 0\n' >&2; return 0; }  else    _scli_dispatch "$@"  fi}
```
