---
title: profile
description: CPU profiling commands for the Sentry CLI
---

Analyze CPU profiling data for your Sentry projects.

## Commands

### `sentry profile list`

List transactions with profiling data, sorted by p75 duration.

```bash
sentry profile list [<org>/<project>]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org>/<project>` | Target project (optional, auto-detected from DSN) |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--period` | Time period: `1h`, `24h`, `7d`, `14d`, `30d` | `24h` |
| `-n, --limit` | Maximum transactions to return | `20` |
| `-w, --web` | Open in browser | |
| `--json` | Output as JSON | |

**Example:**

```bash
sentry profile list my-org/backend --period 7d
```

```
Transactions with Profiles in my-org/backend (last 7d):

  #   ALIAS   TRANSACTION                                         SAMPLES         p75         p95
─────────────────────────────────────────────────────────────────────────────────────────────────────
    1   u       projects/{project_id}/users/                            42        3.8s        5.0s
    2   a       webhooks/provision/account/                             18        2.7s        2.7s
    3   c       organizations/{org_id}/code-mappings/                    6        2.1s        2.1s
    4   e       projects/{project_id}/events/                          291        1.5s        8.6s
    5   i       organizations/{org_id}/issues/                         541        1.5s        2.8s

Common prefix stripped: /api/0/
Tip: Use 'sentry profile view 1' or 'sentry profile view <alias>' to analyze.
```

Transaction names are shown with common prefixes stripped and middle-truncated for readability. Short aliases are generated for quick reference.

### `sentry profile view`

View CPU profiling analysis for a specific transaction. Displays hot paths, performance percentiles, and optimization recommendations.

```bash
sentry profile view [<org>/<project>] <transaction>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org>/<project>` | Target project (optional, auto-detected from DSN) |
| `<transaction>` | Transaction index (`1`), alias (`e`), or full name (`/api/users`) |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--period` | Time period: `1h`, `24h`, `7d`, `14d`, `30d` | `24h` |
| `-n, --limit` | Number of hot paths to show (max 20) | `10` |
| `--allFrames` | Include library/system frames | `false` |
| `-w, --web` | Open in browser | |
| `--json` | Output as JSON | |

**Example using alias from list output:**

```bash
sentry profile view my-org/backend e --period 7d
```

```
/api/0/projects/{project_id}/events/: CPU Profile Analysis (last 7d)
════════════════════════════════════════════════════════════════════════════════

Performance Percentiles
  p75: 1.7s    p95: 12.1s    p99: 12.1s

Hot Paths (Top 10 by CPU time, user code only)
────────────────────────────────────────────────────────────
    #   Function                                  Location                        % Time
    1   EnvMiddleware.<locals>.EnvMiddleware_impl  middleware/env.py:14              7.7%
    2   access_log_middlewa…<locals>.middleware    middlew…ess_log.py:171            7.7%
    3   SubdomainMiddleware.__call__               middlew…ubdomain.py:53            7.7%
    4   AIAgentMiddleware.__call__                 middlew…ai_agent.py:97            7.6%
    5   IntegrationControlMiddleware.__call__      middlew…_control.py:60            7.6%
    6   ApiGatewayMiddleware.__call__              hybridc…ddleware.py:19            7.6%
    7   DemoModeGuardMiddleware.__call__           middlew…de_guard.py:44            7.6%
    8   CustomerDomainMiddleware.__call__          middlew…r_domain.py:97            7.6%
    9   StaffMiddleware.__call__                   middleware/staff.py:53            7.6%
   10   RatelimitMiddleware.__call__               middlew…atelimit.py:57            7.6%
```

**Include library/system frames:**

```bash
sentry profile view my-org/backend e --allFrames --limit 5
```

**JSON output for scripting:**

```bash
sentry profile view my-org/backend e --json | jq '.hotPaths[0].frames[0].name'
```

## Workflow

A typical profiling workflow:

1. **List** transactions to see what has profiling data:
   ```bash
   sentry profile list my-org/backend
   ```

2. **View** a specific transaction using its alias or index:
   ```bash
   sentry profile view my-org/backend e
   ```

3. **Investigate** with all frames to see library overhead:
   ```bash
   sentry profile view my-org/backend e --allFrames
   ```

4. **Open in browser** for the full Sentry UI experience:
   ```bash
   sentry profile view my-org/backend e -w
   ```

## Transaction References

The `profile view` command accepts three types of transaction references:

| Type | Example | Description |
|------|---------|-------------|
| Index | `1`, `5` | Numeric position from `profile list` output |
| Alias | `e`, `i` | Short alias generated by `profile list` |
| Full name | `/api/users` | Exact transaction name (quoted if it has spaces) |

Aliases and indices are cached from the most recent `profile list` run. If you change the project, org, or period, run `profile list` again to refresh them.
