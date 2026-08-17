# Sentry CLI — Complete Command Catalog

Auto-generated from the Stricli route tree. Includes all commands, flags, positional
parameters, descriptions, hidden status, and aliases.

## Global Flags (injected into every leaf command)

These flags are automatically injected by `buildCommand` and are available on every command:

| Flag | Short | Kind | Description |
|------|-------|------|-------------|
| `--verbose` | `-v` | boolean | Enable verbose (debug-level) logging output |
| `--log-level` | — | value | Set log verbosity level |
| `--json` | — | boolean | Output as JSON (only on commands with `output` config) |
| `--fields` | — | value | Comma-separated fields for JSON output (dot.notation) |
| `--org` | — | value | Organization slug (compat shim → SENTRY_ORG) |
| `--project` | — | value | Project slug (compat shim → SENTRY_PROJECT) |

All global flags are hidden in `--help` output. `--json` and `--fields` are only injected
when the command has an `output` config (most read commands).

## Auto-injected Flags by Command Builder

### `buildListCommand` auto-injects:
- `--fresh` / `-f` — Bypass cache, re-detect projects, and fetch fresh data
- `--cursor` / `-c` — Navigate pages: "next", "prev", "first" (or raw cursor string)

### `buildOrgListCommand` auto-injects (in addition to buildListCommand):
- `--limit` / `-n` — Maximum number of items to list (default: 25)
- Positional: `[org/project]` — Target pattern

### `buildDeleteCommand` auto-injects:
- `--yes` / `-y` — Skip confirmation prompt
- `--force` / `-f` — Force the operation without confirmation
- `--dry-run` / `-n` — Show what would happen without making changes

## Route Map Auto-Aliases

Route maps built with `buildRouteMap` auto-inject these subcommand aliases:
- `list` → `ls`
- `view` → `show`
- `delete` → `remove`, `rm`
- `create` → `new`

---

## Command Groups

## `sentry alert`

**Brief:** Manage Sentry alert rules

**Full description:** View and manage alert rules in your Sentry organization.

Alert types:
  issues    Issue alert rules — trigger on matching error events (project-scoped)
  metrics   Metric alert rules — trigger on metric query thresholds (org-scoped)

### `sentry alert issues list`

**Brief:** List issue alert rules

**Full description:** List issue alert rules for one or more Sentry projects.

Issue alerts trigger notifications when error events match conditions.

Target patterns:
  sentry alert issues list                     # auto-detect from DSN or config
  sentry alert issues list <org>/<project>     # explicit org and project
  sentry alert issues list <org>/              # all projects in org
  sentry alert issues list <project>           # find project across all orgs

The trailing slash on <org>/ is significant — without it, the argument is treated as a project name search (e.g., 'sentry' searches for a project named 'sentry', while 'sentry/' lists all projects in the 'sentry' org).

In monorepos with multiple Sentry projects, shows alert rules from all detected projects.

Use --cursor / -c next / -c prev to paginate through larger result sets.

**Positional parameters:**
  - `<org/project>` (optional): <org>/ (all projects), <org>/<project>, or <project> (search)

**Flags:**
  - `--web / -w` (boolean) (default: false): Open in browser
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of issue alert rules to list
  - `--query / -q` (value): Filter rules by name
  - `--cursor / -c` (value): Pagination cursor (use "next" for next page, "prev" for previous)
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--limit`, `-c` → `--cursor`, `-w` → `--web`, `-q` → `--query`, `-f` → `--fresh`, `-v` → `--verbose`

---

### `sentry alert issues view`

**Brief:** View an issue alert rule

**Full description:** View a single issue alert rule by ID or name.

Examples:
  sentry alert issues view 12345
  sentry alert issues view my-org/my-project/12345
  sentry alert issues view my-org/my-project/'Error Spike'

**Positional parameters:**
  - `<org/project/rule-id-or-name>`: Issue alert rule ID or name

**Flags:**
  - `--web / -w` (boolean) (default: false): Open issue alert rules page in browser
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-w` → `--web`, `-v` → `--verbose`

---

### `sentry alert issues create`

**Brief:** Create an issue alert rule

**Full description:** Create a project-scoped issue alert rule. The target may be an explicit <org>/<project>, an auto-detected project, or a bare project search when it resolves to exactly one project.

Required fields:
  --name, --condition (>=1), --action (>=1)

Optional fields:
  --frequency, --environment, --filter, --filter-match, --owner

Conditions and actions are workflow-native JSON (this targets the
org-scoped workflows endpoint):
  --condition  a trigger data-condition: {type, comparison, conditionResult}
  --action     an action: {type, data, config}
  --filter     an action-filter condition (same shape as --condition)

Match mode: --filter-match all|any controls how the action-filter
conditions combine. Issue-alert triggers always evaluate as 'any-short'
(they fire on a single error detector), so there is no trigger match flag.

Examples:
  sentry alert issues create my-org/my-app --name 'New Issues' \
    --condition '{"type":"first_seen_event","comparison":true,"conditionResult":true}' \
    --action '{"type":"email","data":{},"config":{"targetType":"team","targetIdentifier":"1"}}'

  sentry alert issues create my-org/my-app --name 'High Priority' \
    --condition '{"type":"new_high_priority_issue","comparison":true,"conditionResult":true}' \
    --action '{"type":"email","data":{},"config":{"targetType":"user","targetIdentifier":"56789"}}' \
    --frequency 30 --dry-run

**Positional parameters:**
  - `<target>` (optional): <org>/<project>, auto-detected project, or <project> (search)

**Flags:**
  - `--name` (value) **required**: Rule name
  - `--condition / -c` (value) (variadic): Condition object JSON (repeatable, or pass one JSON array)
  - `--action / -a` (value) (variadic): Action object JSON (repeatable, or pass one JSON array)
  - `--frequency` (value) (default: 30) **required**: Frequency in minutes (default: 30)
  - `--environment` (value): Environment filter
  - `--filter` (value) (variadic): Filter object JSON (repeatable, or pass one JSON array)
  - `--filter-match / -m` (value): Filter match mode: all or any
  - `--owner` (value): Owner (team:user style value accepted by Sentry API)
  - `--dry-run / -n` (boolean) (default: false): Show what would happen without making changes
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--dry-run`, `-c` → `--condition`, `-a` → `--action`, `-m` → `--filter-match`, `-v` → `--verbose`

---

### `sentry alert issues delete`

**Brief:** Delete an issue alert rule

**Full description:** Permanently remove an issue alert rule from a project. This cannot be undone.

You will be asked to type org/project/rule-id to confirm, unless you pass --yes or --force, or use --dry-run to preview only.

Examples:
  sentry alert issues delete my-org/my-app/12345
  sentry alert issues delete my-org/my-app/'My Rule' --yes
  sentry alert issues delete my-org/my-app/12345 --dry-run

**Positional parameters:**
  - `<org/project/rule-id-or-name>`: Rule id or name (same as view)

**Flags:**
  - `--yes / -y` (boolean) (default: false): Skip confirmation prompt
  - `--force / -f` (boolean) (default: false): Force the operation without confirmation
  - `--dry-run / -n` (boolean) (default: false): Show what would happen without making changes
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-y` → `--yes`, `-f` → `--force`, `-n` → `--dry-run`, `-v` → `--verbose`

---

### `sentry alert issues edit`

**Brief:** Edit an issue alert rule

**Full description:** Update an issue alert rule by id or name. You must set at least one of --name or --status.

The CLI loads the current rule, applies your changes, and updates it via the API.

Examples:
  sentry alert issues edit my-org/my-app/12 --name 'Prod errors'
  sentry alert issues edit my-org/my-app/'Old name' --status disabled
  sentry alert issues edit 12 --name 'Renamed' --status active
  sentry alert issues edit my-org/my-app/12 --condition '{"id":"sentry.rules.conditions.first_seen_event.FirstSeenEventCondition"}'

**Positional parameters:**
  - `<org/project/rule-id-or-name>`: Rule id or name (same as view)

**Flags:**
  - `--name` (value): New rule name
  - `--status` (value): Rule status: active or disabled
  - `--condition / -c` (value) (variadic): Condition object JSON (repeatable, or pass one JSON array)
  - `--action / -a` (value) (variadic): Action object JSON (repeatable, or pass one JSON array)
  - `--frequency` (value): Frequency in minutes
  - `--environment` (value): Environment value (pass empty string to clear)
  - `--filter` (value) (variadic): Filter object JSON (repeatable, or pass one JSON array)
  - `--filter-match / -m` (value): Filter match mode: all or any
  - `--owner` (value): Owner value (pass empty string to clear)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-c` → `--condition`, `-a` → `--action`, `-m` → `--filter-match`, `-v` → `--verbose`

---

### `sentry alert metrics list`

**Brief:** List metric alert rules

**Full description:** List metric alert rules for one or more Sentry organizations.

Metric alerts trigger notifications when a metric query crosses a threshold.

Target patterns:
  sentry alert metrics list                     # auto-detect from DSN or config
  sentry alert metrics list <org>/              # explicit org (paginated)
  sentry alert metrics list <org>/<project>     # explicit org (project ignored)
  sentry alert metrics list <project>           # find project across all orgs

The trailing slash on <org>/ is significant — without it, the argument is treated as a project name search (e.g., 'sentry' searches for a project named 'sentry', while 'sentry/' lists all projects in the 'sentry' org).

Metric alert rules are org-scoped; the project part is ignored when provided.

Use --cursor / -c next / -c prev to paginate through larger result sets.

**Positional parameters:**
  - `<target>` (optional): <org>/, <org>/<project> (project ignored), or <project> (search)

**Flags:**
  - `--web / -w` (boolean) (default: false): Open in browser
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of metric alert rules to list
  - `--query / -q` (value): Filter rules by name
  - `--cursor / -c` (value): Pagination cursor (use "next" for next page, "prev" for previous)
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--limit`, `-c` → `--cursor`, `-w` → `--web`, `-q` → `--query`, `-f` → `--fresh`, `-v` → `--verbose`

---

### `sentry alert metrics view`

**Brief:** View a metric alert rule

**Full description:** View a single metric alert rule by ID or name.

Examples:
  sentry alert metrics view 12345
  sentry alert metrics view my-org/12345
  sentry alert metrics view my-org/'p95 latency alert'

**Positional parameters:**
  - `<org/rule-id-or-name>`: Metric alert rule ID or name

**Flags:**
  - `--web / -w` (boolean) (default: false): Open metric alert rules page in browser
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-w` → `--web`, `-v` → `--verbose`

---

### `sentry alert metrics create`

**Brief:** Create a metric alert rule

**Full description:** Create an organization-scoped metric alert rule.

Required fields:
  --name, --query, --aggregate, --dataset, --time-window, --trigger (>=1), --project

Optional fields:
  --environment, --owner

Examples:
  sentry alert metrics create my-org --name 'P95 latency' \
    --query 'environment:prod' --aggregate 'p95(transaction.duration)' \
    --dataset transactions --time-window 5 \
    --trigger '{"alertThreshold":500,"actions":[{"id":"sentry.mail.actions.NotifyEmailAction","targetType":"Team","targetIdentifier":1}]}'

  sentry alert metrics create my-org --name 'Error volume' \
    --query 'event.type:error' --aggregate 'count()' --dataset errors \
    --time-window 15 --trigger '[{"alertThreshold":100,"actions":[{"id":"sentry.mail.actions.NotifyEmailAction","targetType":"Team","targetIdentifier":1}]}]' \
    --project my-app --dry-run

**Positional parameters:**
  - `<org>`: Target organization

**Flags:**
  - `--name` (value) **required**: Rule name
  - `--query` (value) **required**: Metric query filter string
  - `--aggregate` (value) **required**: Aggregate expression (for example count(), p95(transaction.duration))
  - `--dataset` (value) **required**: Dataset: errors (error-events), transactions (transaction-like), sessions, events, spans, metrics
  - `--time-window` (value) **required**: Evaluation window in minutes
  - `--trigger / -t` (value) (variadic): Trigger object JSON (repeatable, or pass one JSON array)
  - `--project / -p` (value) (variadic): Project slug filter (repeatable or comma-separated)
  - `--environment` (value): Environment filter
  - `--owner` (value): Owner value accepted by Sentry API
  - `--dry-run / -n` (boolean) (default: false): Show what would happen without making changes
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug

**Flag aliases:** `-n` → `--dry-run`, `-t` → `--trigger`, `-p` → `--project`, `-v` → `--verbose`

---

### `sentry alert metrics delete`

**Brief:** Delete a metric alert rule

**Full description:** Permanently remove a metric alert rule from an organization. Type org/rule-id to confirm, or use --yes / --force, or --dry-run.

Examples:
  sentry alert metrics delete my-org/12345
  sentry alert metrics delete my-org/'P95 alert' --yes

**Positional parameters:**
  - `<org/rule-id-or-name>`: Rule id or name (same as view)

**Flags:**
  - `--yes / -y` (boolean) (default: false): Skip confirmation prompt
  - `--force / -f` (boolean) (default: false): Force the operation without confirmation
  - `--dry-run / -n` (boolean) (default: false): Show what would happen without making changes
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-y` → `--yes`, `-f` → `--force`, `-n` → `--dry-run`, `-v` → `--verbose`

---

### `sentry alert metrics edit`

**Brief:** Edit a metric alert rule

**Full description:** Update a metric alert rule. Pass at least one of --name or --status. Status 'active' enables the rule; 'disabled' sets it to disabled (API status 1).

Examples:
  sentry alert metrics edit my-org/9 --name 'Error budget'
  sentry alert metrics edit my-org/9 --status disabled
  sentry alert metrics edit my-org/9 --time-window 15 --dataset transactions

**Positional parameters:**
  - `<org/rule-id-or-name>`: Rule id or name (same as view)

**Flags:**
  - `--name` (value): New rule name
  - `--status` (value): active or disabled
  - `--query` (value): Metric query filter
  - `--aggregate` (value): Aggregate expression
  - `--dataset` (value): Dataset: errors (error-events), transactions (transaction-like), sessions, events, spans, metrics
  - `--time-window` (value): Evaluation window in minutes
  - `--trigger / -t` (value) (variadic): Trigger object JSON (repeatable, or pass one JSON array)
  - `--project / -p` (value) (variadic): Project slug filter (repeatable or comma-separated)
  - `--environment` (value): Environment value (pass empty string to clear)
  - `--owner` (value): Owner value (pass empty string to clear)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug

**Flag aliases:** `-t` → `--trigger`, `-p` → `--project`, `-v` → `--verbose`

---

## `sentry auth`

**Brief:** Authenticate with Sentry

**Full description:** Manage authentication with Sentry. Use 'sentry auth' to log in when logged out or show status when logged in. Explicit subcommands: 'sentry auth login', 'sentry auth logout', 'sentry auth refresh', 'sentry auth status', 'sentry auth whoami', and 'sentry auth token'.

### `sentry auth default` **[HIDDEN]**

**Brief:** Authenticate with Sentry or show auth status

**Full description:** When not authenticated, starts the login flow. When already authenticated, shows auth status. Equivalent to `sentry auth login` or `sentry auth status` depending on current credentials. Login-only flags (e.g. --token, --url) force the login path.

**Flags:**
  - `--token` (value): Authenticate using an API token instead of OAuth
  - `--timeout` (value) (default: "900") **required**: Timeout for OAuth flow in seconds (default: 900)
  - `--force` (boolean) (default: false): Re-authenticate without prompting
  - `--url` (value): Sentry instance URL to authenticate against (e.g. https://sentry.example.com). Required for self-hosted; defaults to SaaS (https://sentry.io).
  - `--read-only` (boolean) (default: false): Request only read-only OAuth scopes (project:read, org:read, event:read, member:read, team:read). Useful for handing tokens to AI agents or CI jobs that should not be able to mutate Sentry state.
  - `--scope / -s` (value) (variadic): Request specific OAuth scopes (repeatable, comma-separated). E.g. --scope project:read --scope org:read. Overrides the default scope set.
  - `--show-token` (boolean) (default: false): Show the stored token (masked by default)
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-s` → `--scope`, `-f` → `--fresh`, `-v` → `--verbose`

---

### `sentry auth login`

**Brief:** Authenticate with Sentry

**Full description:** Log in to Sentry using OAuth or an API token.

The OAuth flow uses a device code - you'll be given a code to enter at a URL.
Alternatively, use --token to authenticate with an existing API token.

For self-hosted Sentry, pass --url <url> to authenticate against that
instance. This is the ONLY way to trust a new Sentry host — URL
arguments and config files are refused when they don't match the
currently-authenticated host.

**Flags:**
  - `--token` (value): Authenticate using an API token instead of OAuth
  - `--timeout` (value) (default: "900") **required**: Timeout for OAuth flow in seconds (default: 900)
  - `--force` (boolean) (default: false): Re-authenticate without prompting
  - `--url` (value): Sentry instance URL to authenticate against (e.g. https://sentry.example.com). Required for self-hosted; defaults to SaaS (https://sentry.io).
  - `--read-only` (boolean) (default: false): Request only read-only OAuth scopes (project:read, org:read, event:read, member:read, team:read). Useful for handing tokens to AI agents or CI jobs that should not be able to mutate Sentry state.
  - `--scope / -s` (value) (variadic): Request specific OAuth scopes (repeatable, comma-separated). E.g. --scope project:read --scope org:read. Overrides the default scope set.
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-s` → `--scope`, `-v` → `--verbose`

---

### `sentry auth logout`

**Brief:** Log out of Sentry

**Full description:** Remove stored authentication credentials from the local database.

**Flags:**
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry auth refresh`

**Brief:** Refresh your OAuth access token

**Full description:** Manually refresh your OAuth access token using the stored refresh token.

Access token refresh normally happens automatically when making API requests.
Use this command to force an immediate refresh or to verify the refresh
mechanism is working correctly.

When --scope or --read-only is passed, re-authenticates via the OAuth
device flow with the requested scopes instead of refreshing the existing
token. This is the preferred way to add or change scopes on an existing
session (similar to `gh auth refresh -s <scope>`).

Examples:
  $ sentry auth refresh
  ✓ Access token refreshed successfully. Access token valid for 59 minutes.

  $ sentry auth refresh --force
  ✓ Access token refreshed successfully. Access token valid for 1 hour.

  $ sentry auth refresh --scope event:read --scope org:read
  Re-authenticating with scopes: event:read, org:read...

  $ sentry auth refresh --read-only
  Re-authenticating with read-only scopes...

  $ sentry auth refresh --json
  {"success":true,"refreshed":true,"expiresIn":3600,"expiresAt":"..."}

**Flags:**
  - `--force` (boolean) (default: false): Force refresh even if the access token is still valid
  - `--read-only` (boolean) (default: false): Re-authenticate with read-only OAuth scopes (project:read, org:read, event:read, member:read, team:read)
  - `--scope / -s` (value) (variadic): Re-authenticate with specific OAuth scopes (repeatable, comma-separated). E.g. --scope project:read --scope org:read
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-s` → `--scope`, `-v` → `--verbose`

---

### `sentry auth status`

**Brief:** View authentication status

**Full description:** Display information about your current authentication status, including whether you're logged in and your default organization/project settings.

**Flags:**
  - `--show-token` (boolean) (default: false): Show the stored token (masked by default)
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-v` → `--verbose`

---

### `sentry auth token`

**Brief:** Print the stored authentication token

**Full description:** Print the stored authentication token to stdout.

This outputs the raw token without any formatting, making it suitable for piping to other commands or scripts.

**Flags:**
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry auth whoami`

**Brief:** Show the currently authenticated identity

**Full description:** Display the identity behind the current authentication token.

For user-scoped tokens (OAuth, personal access tokens), this fetches the user from the Sentry API. For organization auth tokens (`sntrys_`), it shows which organization the token belongs to.

**Flags:**
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-v` → `--verbose`

---

## `sentry build`

**Brief:** Manage mobile build artifacts

**Full description:** Upload and download mobile build artifacts (APK/AAB/IPA/XCArchive) for Sentry preprod size analysis. Sentry SaaS only.

### `sentry build upload`

**Brief:** Upload builds to a project

**Full description:** Upload mobile builds to Sentry for preprod size analysis. Each build is normalized into a deterministic ZIP and uploaded via the chunk-upload + assemble protocol.

Supported formats: Android APK/AAB, iOS XCArchive (a directory) and IPA. Note: iOS Assets.car asset catalogs are not parsed into per-asset images. This feature only works with Sentry SaaS.

Usage:
  sentry build upload ./app-release.apk
  sentry build upload ./MyApp.xcarchive
  sentry build upload ./MyApp.ipa --build-configuration Release
  sentry build upload ./app.aab --install-group qa --install-group beta

**Positional parameters:**
  - `<path...>` (optional): Path(s) to the build(s) to upload (APK, AAB, IPA, or XCArchive)

**Flags:**
  - `--build-configuration` (value): Build configuration for the upload (defaults to the current version)
  - `--release-notes` (value): Release notes for the build
  - `--install-group` (value) (variadic): Install group(s) for this build (repeatable); builds sharing a group show updates for each other
  - `--head-sha` (value): VCS commit SHA (defaults to the current commit)
  - `--base-sha` (value): VCS base commit SHA (defaults to the merge-base with the base ref)
  - `--vcs-provider` (value): VCS provider (defaults to the current remote's provider)
  - `--head-repo-name` (value): Head repository name, e.g. owner/repo (defaults to the current)
  - `--base-repo-name` (value): Base repository name, e.g. owner/repo (for forks)
  - `--head-ref` (value): Head branch/reference (defaults to the current branch)
  - `--base-ref` (value): Base branch/reference (defaults to the merge-base tracking ref)
  - `--pr-number` (value): Pull request number (auto-detected in pull_request GitHub Actions runs)
  - `--force-git-metadata` (boolean): Force collecting git metadata even outside CI (conflicts with --no-git-metadata)
  - `--no-git-metadata` (boolean): Disable automatic git metadata collection
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry build download`

**Brief:** Download a build artifact

**Full description:** Download a mobile build artifact (APK or IPA) previously uploaded to Sentry's preprod system for size analysis. The build is resolved by ID within the organization; the artifact is streamed to a local file.

This feature only works with Sentry SaaS.

Usage:
  sentry build download 1234567890
  sentry build download 1234567890 --output ./app.ipa

**Positional parameters:**
  - `<build-id>`: ID of the build to download

**Flags:**
  - `--output / -o` (value): Output path (default: preprod_artifact_<build-id>.<ext> in the current directory)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-o` → `--output`, `-v` → `--verbose`

---

## `sentry cli`

**Brief:** CLI-related commands

**Full description:** Commands for managing the Sentry CLI itself, including configuring defaults, sending feedback, upgrading to newer versions, and repairing the local database.

### `sentry cli defaults`

**Brief:** View and manage default settings

**Full description:** View and manage persistent CLI default settings.

With no arguments, shows all current defaults. Pass a key and value
to set a default, or use `--clear` to remove defaults.

## Examples

```
sentry cli defaults                    # Show all defaults
sentry cli defaults org my-org         # Set default organization
sentry cli defaults project my-proj    # Set default project
sentry cli defaults telemetry off      # Disable telemetry
sentry cli defaults agent-skills off   # Stop installing agent skills on upgrade
sentry cli defaults url https://...    # Set Sentry URL (self-hosted)
sentry cli defaults headers 'X-IAP: t'  # Set custom headers (self-hosted)
sentry cli defaults ca-cert /path/to/ca.pem  # Trust a custom CA certificate
sentry cli defaults org --clear        # Clear a specific default
sentry cli defaults --clear --yes      # Clear all defaults
```

## Recognized keys

| Key | Description |
|-----|------------|
| `org` | Default organization slug |
| `project` | Default project slug |
| `telemetry` | Telemetry preference (on/off, yes/no, true/false, 1/0) |
| `agent-skills` | Install agent skills on setup/upgrade (on/off, yes/no, true/false, 1/0) |
| `url` | Sentry instance URL (for self-hosted installations) |
| `headers` | Custom HTTP headers for self-hosted proxies (semicolon-separated `Name: Value`) |
| `ca-cert` | Path to PEM file with custom CA certificates (for corporate proxies) |

**Positional parameters:**
  - `<key value...>` (optional): Setting key and optional value

**Flags:**
  - `--clear` (boolean) (default: false): Clear the specified default, or all defaults if no key is given
  - `--yes / -y` (boolean) (default: false): Skip confirmation prompt
  - `--force / -f` (boolean) (default: false): Force the operation without confirmation
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-y` → `--yes`, `-f` → `--force`, `-v` → `--verbose`

---

### `sentry cli feedback`

**Brief:** Send feedback about the CLI

**Full description:** Submit feedback about your experience with the Sentry CLI. All text after 'feedback' is sent as your message.

**Positional parameters:**
  - `<message...>` (optional): Your feedback message

**Flags:**
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry cli fix`

**Brief:** Diagnose and repair CLI database issues

**Full description:** Check the CLI's local SQLite database for schema, permission, and ownership
issues and repair them.

This is useful when upgrading from older CLI versions, if the database
becomes inconsistent due to interrupted operations, or if file permissions
prevent the CLI from writing to its local database.

The command performs non-destructive repairs only - it adds missing tables
and columns, fixes file permissions, and transfers ownership — but never
deletes data.

If files are owned by root (e.g. after `sudo brew install`), run with sudo
to transfer ownership back to the current user:

  sudo sentry cli fix

Examples:
  sentry cli fix              # Fix database issues
  sudo sentry cli fix         # Fix root-owned files
  sentry cli fix --dry-run    # Show what would be fixed without making changes

**Flags:**
  - `--dry-run` (boolean) (default: false): Show what would be fixed without making changes
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry cli import`

**Brief:** Import settings from legacy .sentryclirc files

**Full description:** Scan for .sentryclirc config files (used by the old Rust-based sentry-cli) and import their settings into the new CLI.

Imported settings:
  - Auth token -> stored credentials (with proper host scoping)
  - URL -> default Sentry instance URL
  - Organization -> default organization
  - Project -> default project

Security: token and URL must come from the same file to be trusted.
Cross-file URL requires explicit --url confirmation.

Examples:
  sentry cli import               # Scan and import interactively
  sentry cli import --yes         # Auto-confirm (CI-safe)
  sentry cli import --dry-run     # Preview without changes
  sentry cli import --url <url>   # Trust a specific URL

**Flags:**
  - `--yes / -y` (boolean) (default: false): Skip confirmation prompt
  - `--dry-run / -n` (boolean) (default: false): Show what would happen without making changes
  - `--url` (value): Explicitly trust this URL (bypasses same-file trust check)
  - `--skip-validation` (boolean) (default: false): Skip token validation against the Sentry API
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-y` → `--yes`, `-n` → `--dry-run`, `-v` → `--verbose`

---

### `sentry cli setup`

**Brief:** Configure shell integration

**Full description:** Sets up shell integration for the Sentry CLI:

- Adds binary directory to PATH (if not already in PATH)
- Installs shell completions (bash, zsh, fish)
- Installs agent skills for detected AI coding assistants
- Records installation metadata for upgrades

With --install, also handles binary placement from a temporary
download location (used by the install script and upgrade command).

This command is called automatically by the install script,
but can also be run manually after downloading the binary.

Examples:
  sentry cli setup                    # Auto-detect and configure
  sentry cli setup --method curl      # Record install method
  sentry cli setup --install          # Place binary and configure
  sentry cli setup --no-modify-path   # Skip PATH modification
  sentry cli setup --no-completions   # Skip shell completions
  sentry cli setup --no-agent-skills  # Skip agent skill installation

**Flags:**
  - `--install` (boolean) (default: false): Install the binary from a temp location to the system path
  - `--method` (value): Installation method (curl, npm, pnpm, bun, yarn)
  - `--channel` (value): Release channel to persist (stable or nightly)
  - `--no-modify-path` (boolean) (default: false): Skip PATH modification
  - `--no-completions` (boolean) (default: false): Skip shell completion installation
  - `--no-agent-skills` (boolean) (default: false): Skip agent skill installation for AI coding assistants
  - `--quiet` (boolean) (default: false): Suppress output (for scripted usage)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--ensure-auth-scopes` (boolean) (default: false) **[hidden]**: Refresh an outdated stored OAuth authorization
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry cli uninstall`

**Brief:** Uninstall Sentry CLI

**Full description:** Remove the Sentry CLI binary, shell completions, PATH entries, agent skill files, and configuration directory. Reverses the changes made by `sentry cli setup`.

**Flags:**
  - `--keep-config` (boolean) (default: false): Keep the config directory (~/.sentry) and auth tokens
  - `--yes / -y` (boolean) (default: false): Skip confirmation prompt
  - `--force / -f` (boolean) (default: false): Force the operation without confirmation
  - `--dry-run / -n` (boolean) (default: false): Show what would happen without making changes
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-y` → `--yes`, `-f` → `--force`, `-n` → `--dry-run`, `-v` → `--verbose`

---

### `sentry cli upgrade`

**Brief:** Update the Sentry CLI to the latest version

**Full description:** Check for updates and upgrade the Sentry CLI to the latest or a specific version.

By default, detects how the CLI was installed (npm, curl, etc.) and uses the same method to upgrade.

Two release channels are supported:
  stable  (default) Latest stable release
  nightly           Built from main, updated on every commit

The channel is persisted so that subsequent bare `sentry cli upgrade` calls
use the same channel.

Examples:
  sentry cli upgrade              # Update to latest (using persisted channel)
  sentry cli upgrade nightly      # Switch to nightly channel and update
  sentry cli upgrade stable       # Switch back to stable channel and update
  sentry cli upgrade 0.5.0        # Install a specific stable version
  sentry cli upgrade --check      # Check for updates without installing
  sentry cli upgrade --force      # Force re-download even if up to date
  sentry cli upgrade --method npm # Force using npm to upgrade
  sentry cli upgrade --offline    # Upgrade from cached patches (no network)
  sentry cli upgrade --no-agent-skills # Skip reinstalling agent skills

**Positional parameters:**
  - `<version>` (optional): Specific version (e.g. 0.5.0), or "nightly"/"stable" to switch channel; omit to update within current channel

**Flags:**
  - `--check` (boolean) (default: false): Check for updates without installing
  - `--force` (boolean) (default: false): Force upgrade even if already on the latest version
  - `--offline` (boolean) (default: false): Upgrade using only cached version info and patches (no network)
  - `--no-agent-skills` (boolean) (default: false): Skip agent skill installation for AI coding assistants
  - `--method` (value): Installation method to use (curl, brew, npm, pnpm, bun, yarn)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

## `sentry code-mappings`

**Brief:** Manage code mappings for stack trace linking

**Full description:** Upload and manage code mappings that link stack trace paths to source code paths in your repository.

### `sentry code-mappings upload`

**Brief:** Upload code mappings for stack trace linking

**Full description:** Bulk-upload code mappings (stack trace root → source code root) for a Sentry project. Code mappings link stack trace paths to source code paths in your repository, enabling source context, suspect commits, and stack trace linking.

The input file must be a JSON array of objects with `stackRoot` and `sourceRoot` fields.

Usage:
  sentry code-mappings upload mappings.json
  sentry code-mappings upload mappings.json --repo owner/repo
  sentry code-mappings upload mappings.json --repo owner/repo --default-branch develop
  sentry code-mappings upload mappings.json --json

Requires an Organization Token with `org:ci` scope.

**Positional parameters:**
  - `<path>`: Path to the code mappings JSON file

**Flags:**
  - `--repo` (value): Repository name (e.g., owner/repo). Auto-detected from git remote if omitted.
  - `--default-branch` (value): Default branch name. Auto-detected from git remote HEAD if omitted.
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

## `sentry conversation`

**Brief:** List and view AI conversations

**Full description:** List and view AI conversations from Sentry Explore.

Commands:
  list     List recent AI conversations
  view     View a conversation transcript


### `sentry conversation list`

**Brief:** List recent AI conversations

**Full description:** List recent AI conversations from a Sentry organization.

Examples:
  sentry conversation list                # List recent conversations
  sentry conversation list my-org         # Explicit org
  sentry conversation list --limit 50     # Show more
  sentry conversation list --period 24h   # Last 24 hours
  sentry conversation list -q "has:errors" # Filter


JSON fields (use --json --fields to select):
  conversationId (string)
  title (string | null, optional)
  flow (array)
  errors (number)
  llmCalls (number)
  toolCalls (number)
  totalTokens (number)
  totalCost (number)
  startTimestamp (number)
  endTimestamp (number)
  traceCount (number)
  traceIds (array)
  firstInput (string | null)
  lastOutput (string | null)
  user (object | null, optional)
  toolNames (array)
  toolErrors (number)

**Positional parameters:**
  - `<org>` (optional): Organization slug

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Number of conversations (1-1000)
  - `--query / -q` (value): Search query
  - `--period / -t` (value) (default: "7d") **required**: Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: conversationId, title, flow, errors, llmCalls, toolCalls, totalTokens, totalCost, startTimestamp, endTimestamp, traceCount, traceIds, firstInput, lastOutput, user, toolNames, toolErrors

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-t` → `--period`, `-n` → `--limit`, `-q` → `--query`, `-f` → `--fresh`, `-c` → `--cursor`, `-v` → `--verbose`

---

### `sentry conversation view`

**Brief:** View an AI conversation transcript

**Full description:** View the full transcript of an AI conversation.

The org is optional and auto-detected from your project context when
omitted. Prefix the ID with an org slug to target a specific org.

Examples:
  sentry conversation view conv-123
  sentry conversation view my-org/conv-123
  sentry conversation view my-org/conv-123 --json


**Positional parameters:**
  - `<org/conversation-id>`: [<org>/]<conversation-id> - Org (optional) and conversation ID

**Flags:**
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-v` → `--verbose`

---

## `sentry dart-symbol-map`

**Brief:** Work with Dart/Flutter symbol maps

**Full description:** Upload Dart/Flutter obfuscation maps for deobfuscating Dart exception types in Sentry.

### `sentry dart-symbol-map upload`

**Brief:** Upload a Dart/Flutter symbol map to Sentry

**Full description:** Upload a Dart/Flutter obfuscation map for deobfuscating Dart exception types. The map must be a JSON array of strings with an even number of entries (alternating obfuscated/original name pairs).

A debug ID (--debug-id) is required to associate the map with its companion native debug file (dSYM/ELF). The sentry-dart-plugin extracts this automatically.

Usage:
  sentry dart-symbol-map upload --debug-id <uuid> mapping.json
  sentry dart-symbol-map upload --debug-id <uuid> mapping.json --no-upload
  sentry dart-symbol-map upload --debug-id <uuid> mapping.json --json

Supported on Sentry SaaS and self-hosted >= 25.8.0.

**Positional parameters:**
  - `<path>`: Path to the dart symbol map JSON file

**Flags:**
  - `--debug-id / -d` (value) **required**: Debug ID (UUID) from the companion native debug file
  - `--no-upload` (boolean) (default: false): Validate the file without uploading (dry-run)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-d` → `--debug-id`, `-v` → `--verbose`

---

## `sentry debug-files`

**Brief:** Work with debug information files

**Full description:** Create and manage debug information files (DIFs) for source context in Sentry stack traces.

### `sentry debug-files check`

**Brief:** Inspect a debug information file

**Full description:** Inspect a debug information file and print its debug id, code id, architecture, kind, and feature flags. Supports Mach-O/dSYM, ELF, PE/PDB, Portable PDB, WebAssembly, Breakpad, and source bundles.

The format is auto-detected. This command is local-only and makes no network requests.

Usage:
  sentry debug-files check ./libexample.so
  sentry debug-files check MyApp.dSYM/Contents/Resources/DWARF/MyApp
  sentry debug-files check ./app.pdb --json

Exits non-zero if the file is not usable for symbolication.

**Positional parameters:**
  - `<path>`: Path to the debug information file

**Flags:**
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry debug-files find`

**Brief:** Locate debug files for given debug identifiers

**Full description:** Locate debug-information files for one or more debug identifiers.

Searches Xcode's DerivedData (for dSYMs), the current directory, and any extra `--path` directories, matching each file's embedded debug id against the requested ids. Local-only — no API calls.

Exits non-zero if any id could not be located.

Usage:
  sentry debug-files find <debug-id> [<debug-id>...]
  sentry debug-files find <id> --type dsym --path ./build
  sentry debug-files find <id> --no-cwd --no-well-known -p /symbols

**Positional parameters:**
  - `<id...>` (optional): Debug identifier(s) to search for

**Flags:**
  - `--type / -t` (value) (variadic): Only consider debug files of the given type (repeatable). Default: all
  - `--no-well-known` (boolean): Do not look for debug files in well-known locations
  - `--no-cwd` (boolean): Do not look for debug files in the current directory
  - `--path / -p` (value) (variadic): Add a directory to search recursively (repeatable)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-t` → `--type`, `-p` → `--path`, `-v` → `--verbose`

---

### `sentry debug-files upload`

**Brief:** Upload debug information files to Sentry

**Full description:** Scan files and directories for native debug information files and upload them to Sentry using the chunk-upload protocol. Supports Mach-O/dSYM, ELF, PE/PDB, Portable PDB, WebAssembly, Breakpad, and source bundles. Directories are scanned recursively.

Org/project are auto-detected from DSN, env vars, or config defaults.

Filters:
  --type     Only upload files of the given type (repeatable):
             dsym, elf, pe, pdb, portablepdb, wasm, breakpad,
             sourcebundle, jvm
  --id       Only upload the object with the given debug id (repeatable)
  --no-debug / --no-unwind / --no-sources   Drop files whose only
             useful feature is the named one
  --derived-data   Also scan Xcode's DerivedData folder (macOS only)
  --no-zips        Do not scan inside .zip archives

.zip archives are scanned in place by default; nested archives are not recursed.

Managed PE assemblies (.NET) that embed a Portable PDB have it extracted and uploaded automatically as a separate <name>.pdb debug file.

With --il2cpp-mapping, Unity IL2CPP C++->C# line mappings are computed from each file's referenced generated C++ sources and uploaded as separate il2cpp debug files; combine with --include-sources to also bundle the referenced C# source files.

Usage:
  sentry debug-files upload ./build
  sentry debug-files upload ./symbols.zip
  sentry debug-files upload ./libexample.so --include-sources
  sentry debug-files upload ./dsyms --type dsym --wait
  sentry debug-files upload ./build --il2cpp-mapping --include-sources
  sentry debug-files upload --derived-data --no-upload
  sentry debug-files upload ./build --no-zips --no-upload

BCSymbolMap resolution (legacy --symbol-maps) is not supported: it only applies to Apple Bitcode, which Apple has deprecated. Use the legacy Rust sentry-cli if you still need it.

**Positional parameters:**
  - `<path...>` (optional): Files or directories to scan for debug information files

**Flags:**
  - `--type / -t` (value) (variadic): Only upload files of this type (repeatable): dsym, elf, pe, pdb, portablepdb, wasm, breakpad, sourcebundle, jvm
  - `--id` (value) (variadic): Only upload the object with this debug id (repeatable)
  - `--require-all` (boolean) (default: false): Fail if any --id value was not found among scanned files
  - `--no-debug` (boolean) (default: false): Do not upload files whose only feature is debug/symbol info
  - `--no-unwind` (boolean) (default: false): Do not upload files whose only feature is unwind info
  - `--no-sources` (boolean) (default: false): Do not upload files whose only feature is source info
  - `--include-sources` (boolean) (default: false): Build and upload a source bundle for each file with debug info
  - `--il2cpp-mapping` (boolean) (default: false): Compute and upload Unity IL2CPP line mappings for each scanned file
  - `--derived-data` (boolean) (default: false): Also scan Xcode's DerivedData folder (macOS only)
  - `--no-zips` (boolean) (default: false): Do not scan inside .zip archives
  - `--no-upload` (boolean) (default: false): Scan and print what would be uploaded without uploading
  - `--wait` (boolean) (default: false): Wait for server-side processing and report any errors
  - `--wait-for` (value): Wait up to this many seconds for server-side processing
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-t` → `--type`, `-v` → `--verbose`

---

### `sentry debug-files print-sources`

**Brief:** List the source files a debug file references

**Full description:** List the source files referenced by a debug information file. For each referenced file it reports whether the source is embedded in the file, available via a source link, or present on the local disk — useful for checking what `bundle-sources` would include. Supports Mach-O/dSYM, ELF, PE/PDB, Portable PDB, and Breakpad.

The format is auto-detected. This command is local-only and makes no network requests.

Usage:
  sentry debug-files print-sources ./libexample.so
  sentry debug-files print-sources ./app.pdb --json

**Positional parameters:**
  - `<path>`: Path to the debug information file

**Flags:**
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry debug-files bundle-sources`

**Brief:** Bundle a debug file's source files for source context

**Full description:** Build a source bundle from the source files referenced by a debug information file. The bundle is a ZIP archive stamped with the object's debug id that can be uploaded to Sentry (debug-files upload) for source context in stack traces. Supports Mach-O/dSYM, ELF, PE/PDB, Portable PDB, WebAssembly, and Breakpad.

Source files are read from the paths recorded in the debug info, so this is normally run on the build machine right after compiling. Referenced files that are not present locally are skipped. The format is auto-detected, and this command makes no network requests.

Usage:
  sentry debug-files bundle-sources ./libexample.so
  sentry debug-files bundle-sources ./app.pdb -o ./app.src.zip

Exits non-zero if no referenced source files are found on disk.

**Positional parameters:**
  - `<path>`: Path to the debug information file

**Flags:**
  - `--output / -o` (value): Output path for the source bundle ZIP (default: <path>.src.zip)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-o` → `--output`, `-v` → `--verbose`

---

### `sentry debug-files bundle-jvm`

**Brief:** Create a JVM source bundle for source context

**Full description:** Create a JVM source bundle from a directory of Java, Kotlin, Scala, Groovy, or Clojure source files. The bundle is a ZIP archive that can be uploaded to Sentry for source context in JVM stack traces.

This command is local-only — it makes no network requests.

**Positional parameters:**
  - `<path>`: Directory containing JVM source files

**Flags:**
  - `--output / -o` (value) **required**: Output directory for the bundle ZIP
  - `--debug-id / -d` (value) **required**: Debug ID (UUID) to stamp on the bundle
  - `--exclude / -e` (value) (variadic): Additional directory names to exclude (repeatable)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-o` → `--output`, `-d` → `--debug-id`, `-e` → `--exclude`, `-v` → `--verbose`

---

## `sentry dashboard`

**Brief:** Manage Sentry dashboards

**Full description:** View and manage dashboards in your Sentry organization.

Commands:
  list       List dashboards
  view       View a dashboard
  create     Create a dashboard
  widget     Manage dashboard widgets (add, edit, delete)
  revisions  List dashboard revision history
  restore    Restore a dashboard to a previous revision

### `sentry dashboard list`

**Brief:** List dashboards

**Full description:** List dashboards in a Sentry organization.

The optional name argument supports glob patterns for filtering by title.
Glob matching is case-insensitive. Quote patterns to prevent shell expansion.

Examples:
  sentry dashboard list                     # auto-detect org
  sentry dashboard list my-org/             # explicit org
  sentry dashboard list my-org/my-project   # org from explicit project
  sentry dashboard list 'Error*'            # filter by title glob
  sentry dashboard list my-org '*API*'      # bare org + filter
  sentry dashboard list my-org/ '*API*'     # org/ + filter
  sentry dashboard list -c next             # next page
  sentry dashboard list -c prev             # previous page
  sentry dashboard list --json              # JSON with pagination envelope
  sentry dashboard list --web

**Positional parameters:**
  - `<org/title-filter...>` (optional): [<org/project>] [<name-glob>]

**Flags:**
  - `--web / -w` (boolean) (default: false): Open in browser
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of dashboards to list
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-w` → `--web`, `-n` → `--limit`, `-f` → `--fresh`, `-c` → `--cursor`, `-v` → `--verbose`

---

### `sentry dashboard view`

**Brief:** View a dashboard

**Full description:** View a Sentry dashboard with rendered widget data.

Fetches actual data for each widget and displays sparkline charts,
tables, and big numbers in the terminal.

The dashboard can be specified by numeric ID or title.

Examples:
  sentry dashboard view 12345
  sentry dashboard view 'My Dashboard'
  sentry dashboard view my-org 12345
  sentry dashboard view my-org 'My Dashboard'
  sentry dashboard view my-org/my-project 12345
  sentry dashboard view 12345 --json
  sentry dashboard view 12345 --period 7d
  sentry dashboard view 12345 -r
  sentry dashboard view 12345 -r 30
  sentry dashboard view 12345 --web

**Positional parameters:**
  - `<org/project/dashboard...>` (optional): [<org/project>] <dashboard-id-or-title>

**Flags:**
  - `--web / -w` (boolean) (default: false): Open in browser
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--refresh / -r` (value): Auto-refresh interval in seconds (default: 60, min: 10)
  - `--period / -t` (value): Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-w` → `--web`, `-r` → `--refresh`, `-t` → `--period`, `-v` → `--verbose`

---

### `sentry dashboard create`

**Brief:** Create a dashboard

**Full description:** Create a new Sentry dashboard.

Examples:
  sentry dashboard create 'My Dashboard'
  sentry dashboard create my-org/ 'My Dashboard'
  sentry dashboard create my-org/my-project 'My Dashboard'

Add widgets after creation with:
  sentry dashboard widget add <dashboard> "My Widget" --display line --query count

**Positional parameters:**
  - `<org/project/title...>` (optional): [<org/project>] <title>

**Flags:**
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry dashboard widget add`

**Brief:** Add a widget to a dashboard

**Full description:** Add a widget to an existing Sentry dashboard.

The dashboard can be specified by numeric ID or title.

Examples:
  sentry dashboard widget add 'My Dashboard' "Error Count" \
    --display big_number --query count

  sentry dashboard widget add 'My Dashboard' "Errors by Browser" \
    --display line --query count --group-by browser.name

  sentry dashboard widget add 'My Dashboard' "Top Endpoints" \
    --display table --query count --query p95:span.duration \
    --group-by transaction --sort -count --limit 10

Query shorthand (--query flag):
  count          → count()         (bare name = no-arg aggregate)
  p95:span.duration → p95(span.duration)  (colon = function with arg)
  count()        → count()         (parens passthrough)

Sort shorthand (--sort flag):
  count          → count()         (ascending)
  -count         → -count()        (descending)

Layout flags (--col/-x, --row/-y, --width, --height) control widget position
and size in the 6-column dashboard grid. Omitted values use auto-layout.

**Positional parameters:**
  - `<org/project/dashboard/title...>` (optional): [<org/project>] <dashboard> <title>

**Flags:**
  - `--display / -d` (value) **required**: Display type (big_number, line, area, bar, table, stacked_area, top_n, text, categorical_bar, details, wheel, rage_and_dead_clicks, server_tree, agents_traces_table)
  - `--dataset` (value): Widget dataset (default: spans). Accepts canonical names and API synonyms: spans, error-events/errors, transaction-like/transactions, tracemetrics/metrics, logs, issue, discover
  - `--query / -q` (value) (variadic): Aggregate expression (e.g. count, p95:span.duration)
  - `--where / -w` (value): Search conditions filter (e.g. is:unresolved)
  - `--group-by / -g` (value) (variadic): Group-by column (repeatable)
  - `--sort / -s` (value): Order by (prefix - for desc, e.g. -count)
  - `--limit / -n` (value): Result limit
  - `--col / -x` (value): Grid column position (0-based, 0–5)
  - `--row / -y` (value): Grid row position (0-based)
  - `--width` (value): Widget width in grid columns (1–6)
  - `--height` (value): Widget height in grid rows (min 1)
  - `--layout / -l` (value) (default: "sequential") **required**: Layout mode: sequential (append in order) or dense (fill gaps)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-d` → `--display`, `-q` → `--query`, `-w` → `--where`, `-g` → `--group-by`, `-s` → `--sort`, `-n` → `--limit`, `-l` → `--layout`, `-x` → `--col`, `-y` → `--row`, `-v` → `--verbose`

---

### `sentry dashboard widget edit`

**Brief:** Edit a widget in a dashboard

**Full description:** Edit a widget in an existing Sentry dashboard.

The dashboard can be specified by numeric ID or title.
Identify the widget by --index (0-based) or --title.
Only provided flags are changed — omitted values are preserved.

Layout flags (--col/-x, --row/-y, --width, --height) control widget position
and size in the 6-column dashboard grid.

Examples:
  sentry dashboard widget edit 12345 --title 'Error Rate' --display bar
  sentry dashboard widget edit 'My Dashboard' --index 0 --query p95:span.duration
  sentry dashboard widget edit 12345 --title 'Old Name' --new-title 'New Name'
  sentry dashboard widget edit 12345 --index 0 --col 0 --row 0 --width 6 --height 2

**Positional parameters:**
  - `<org/project/dashboard...>` (optional): [<org/project>] <dashboard-id-or-title>

**Flags:**
  - `--index / -i` (value): Widget index (0-based)
  - `--title / -t` (value): Widget title to match
  - `--new-title` (value): New widget title
  - `--display / -d` (value): Display type (big_number, line, area, bar, table, stacked_area, top_n, text, categorical_bar, details, wheel, rage_and_dead_clicks, server_tree, agents_traces_table)
  - `--dataset` (value): Widget dataset (default: spans). Accepts canonical names and API synonyms: spans, error-events/errors, transaction-like/transactions, tracemetrics/metrics, logs, issue, discover
  - `--query / -q` (value) (variadic): Aggregate expression (e.g. count, p95:span.duration)
  - `--where / -w` (value): Search conditions filter (e.g. is:unresolved)
  - `--group-by / -g` (value) (variadic): Group-by column (repeatable)
  - `--sort / -s` (value): Order by (prefix - for desc, e.g. -count)
  - `--limit / -n` (value): Result limit
  - `--col / -x` (value): Grid column position (0-based, 0–5)
  - `--row / -y` (value): Grid row position (0-based)
  - `--width` (value): Widget width in grid columns (1–6)
  - `--height` (value): Widget height in grid rows (min 1)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-i` → `--index`, `-t` → `--title`, `-d` → `--display`, `-q` → `--query`, `-w` → `--where`, `-g` → `--group-by`, `-s` → `--sort`, `-n` → `--limit`, `-x` → `--col`, `-y` → `--row`, `-v` → `--verbose`

---

### `sentry dashboard widget delete`

**Brief:** Delete a widget from a dashboard

**Full description:** Remove a widget from an existing Sentry dashboard.

The dashboard can be specified by numeric ID or title.
Identify the widget by --index (0-based) or --title.

Examples:
  sentry dashboard widget delete 12345 --index 0
  sentry dashboard widget delete 'My Dashboard' --title 'Error Rate'
  sentry dashboard widget delete 12345 --index 0 --dry-run

**Positional parameters:**
  - `<org/project/dashboard...>` (optional): [<org/project>] <dashboard-id-or-title>

**Flags:**
  - `--index / -i` (value): Widget index (0-based)
  - `--title / -t` (value): Widget title to match
  - `--yes / -y` (boolean) (default: false): Skip confirmation prompt
  - `--force / -f` (boolean) (default: false): Force the operation without confirmation
  - `--dry-run / -n` (boolean) (default: false): Show what would happen without making changes
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-i` → `--index`, `-t` → `--title`, `-y` → `--yes`, `-f` → `--force`, `-n` → `--dry-run`, `-v` → `--verbose`

---

### `sentry dashboard revisions`

**Brief:** List dashboard revisions

**Full description:** List revision history for a Sentry dashboard.

Shows saved revisions with their IDs, titles, authors, and timestamps.
Use `sentry dashboard restore` to revert to a previous revision.

Examples:
  sentry dashboard revisions 12345
  sentry dashboard revisions 'My Dashboard'
  sentry dashboard revisions my-org 12345
  sentry dashboard revisions my-org 12345 --json
  sentry dashboard revisions my-org 12345 -c next

**Positional parameters:**
  - `<org/dashboard...>` (optional): [<org/project>] <dashboard-id-or-title>

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of revisions to list
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--limit`, `-c` → `--cursor`, `-v` → `--verbose`

---

### `sentry dashboard restore`

**Brief:** Restore a dashboard revision

**Full description:** Restore a Sentry dashboard to a previous revision.

Use `sentry dashboard revisions` to list available revisions first.

Examples:
  sentry dashboard restore 12345 --revision 42
  sentry dashboard restore my-org 12345 --revision 42
  sentry dashboard restore 'My Dashboard' --revision 42
  sentry dashboard restore 12345 --revision 42 --json

**Positional parameters:**
  - `<org/dashboard...>` (optional): [<org/project>] <dashboard-id-or-title>

**Flags:**
  - `--revision / -r` (value) **required**: Revision ID to restore
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-r` → `--revision`, `-v` → `--verbose`

---

## `sentry org`

**Brief:** Work with Sentry organizations

**Full description:** List and manage Sentry organizations you have access to.

Alias: `sentry orgs` → `sentry org list`

### `sentry org list`

**Brief:** List organizations

**Full description:** List organizations that you have access to.

Examples:
  sentry org list
  sentry org list --limit 10
  sentry org list --json

Alias: `sentry orgs` → `sentry org list`

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of organizations to list
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-n` → `--limit`, `-v` → `--verbose`

---

### `sentry org view`

**Brief:** View details of an organization

**Full description:** View detailed information about a Sentry organization.

The organization is resolved from:
  1. Positional argument <org-slug>
  2. Config defaults
  3. SENTRY_DSN environment variable or source code detection

**Positional parameters:**
  - `<org>` (optional): Organization slug (optional if auto-detected)

**Flags:**
  - `--web / -w` (boolean) (default: false): Open in browser
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-w` → `--web`, `-v` → `--verbose`

---

## `sentry platform`

**Brief:** List valid Sentry platform identifiers

**Full description:** List all valid Sentry platform identifiers — the full set behind `sentry project create <name>:<platform>`.

Alias: `sentry platforms` → `sentry platform list`

### `sentry platform list`

**Brief:** List all valid Sentry platform identifiers

**Full description:** List every valid Sentry platform identifier — the full set behind `sentry project create <name>:<platform>`. Use --search to filter.

Examples:
  sentry platform list                 List all valid platforms
  sentry platform list --search python  Filter by substring
  sentry platform list --json           Machine-readable output

**Flags:**
  - `--search / -q` (value): Filter platforms by substring
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-q` → `--search`, `-v` → `--verbose`

---

## `sentry project`

**Brief:** Work with Sentry projects

**Full description:** List and manage Sentry projects in your organizations.

Alias: `sentry projects` → `sentry project list`

### `sentry project create`

**Brief:** Create one or more projects

**Full description:** Create Sentry projects in an organization.

Names support org/name syntax to specify the organization explicitly.
If omitted, the org is auto-detected from config defaults. Project names
cannot contain whitespace.

Every project is a name:platform pair. Create several projects at once
by passing multiple pairs as separate arguments. All projects share one org.

Projects are created under a team. If the org has one team, it is used
automatically. If no teams exist, one is created. Otherwise, specify --team.

Examples:
  sentry project create my-app:node
  sentry project create acme-corp/my-app:javascript-nextjs
  sentry project create web:javascript api:python-django worker:node
  sentry project create my-app:python-django --team backend
  sentry project create my-app:go --json

**Positional parameters:**
  - `<name:platform...>` (optional): One or more project name and platform pairs

**Flags:**
  - `--team / -t` (value): Team to create the project under
  - `--dry-run / -n` (boolean) (default: false): Show what would happen without making changes
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--dry-run`, `-t` → `--team`, `-v` → `--verbose`

---

### `sentry project delete`

**Brief:** Delete a project

**Full description:** Permanently delete a Sentry project. This action cannot be undone.

Requires explicit target — auto-detection is disabled for safety.

Examples:
  sentry project delete acme-corp/my-app
  sentry project delete my-app
  sentry project delete acme-corp/my-app --yes
  sentry project delete acme-corp/my-app --force
  sentry project delete acme-corp/my-app --dry-run

**Positional parameters:**
  - `<org/project>`: <org>/<project> or <project> (search across orgs)

**Flags:**
  - `--yes / -y` (boolean) (default: false): Skip confirmation prompt
  - `--force / -f` (boolean) (default: false): Force the operation without confirmation
  - `--dry-run / -n` (boolean) (default: false): Show what would happen without making changes
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-y` → `--yes`, `-f` → `--force`, `-n` → `--dry-run`, `-v` → `--verbose`

---

### `sentry project list`

**Brief:** List projects

**Full description:** List projects in an organization.

Target patterns:
  sentry project list                # auto-detect from DSN or config
  sentry project list <org>/         # all projects in org (paginated)
  sentry project list <org>/<proj>   # show specific project
  sentry project list <project>      # find project across all orgs

The trailing slash on <org>/ is significant — without it, the argument is treated as a project name search (e.g., 'sentry' searches for a project named 'sentry', while 'sentry/' lists all projects in the 'sentry' org). Cursor pagination (--cursor) requires the <org>/ form.

Pagination:
  sentry project list <org>/ -c next      # next page
  sentry project list <org>/ -c prev      # previous page
  sentry project list <org>/ -c <cursor>  # resume at specific cursor

Filtering and output:
  sentry project list --platform javascript  # filter by platform
  sentry project list --limit 50              # show more results
  sentry project list --json                  # output as JSON

Alias: `sentry projects` → `sentry project list`

**Positional parameters:**
  - `<org/project>` (optional): <org>/ (all projects), <org>/<project>, or <project> (search)

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of projects to list
  - `--platform / -p` (value): Filter by platform (e.g., javascript, python)
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--limit`, `-c` → `--cursor`, `-p` → `--platform`, `-f` → `--fresh`, `-v` → `--verbose`

---

### `sentry project view`

**Brief:** View details of a project

**Full description:** View detailed information about Sentry projects.

Target patterns:
  sentry project view                       # auto-detect from DSN or config
  sentry project view <org>/<project>       # explicit org and project
  sentry project view <project>             # find project across all orgs

A bare name (no slash) is treated as a project search. Use <org>/<project> for an explicit target.

In monorepos with multiple Sentry projects, shows details for all detected projects.

**Positional parameters:**
  - `<org/project>` (optional): <org>/<project>, <project> (search), or omit for auto-detect

**Flags:**
  - `--web / -w` (boolean) (default: false): Open in browser
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-w` → `--web`, `-v` → `--verbose`

---

## `sentry proguard`

**Brief:** Work with ProGuard/R8 mapping files

**Full description:** Upload and manage Android ProGuard/R8 mapping files.

The UUID is derived deterministically from the mapping file contents and identifies the mapping when deobfuscating Android stack traces.

### `sentry proguard upload`

**Brief:** Upload ProGuard/R8 mapping files to Sentry

**Full description:** Upload one or more ProGuard/R8 mapping files to Sentry using the chunk-upload protocol. Each mapping is identified by a deterministic UUID derived from its content.

Org/project are auto-detected from DSN, env vars, or config defaults.

Usage:
  sentry proguard upload mapping.txt
  sentry proguard upload build/mapping1.txt build/mapping2.txt
  sentry proguard upload mapping.txt --uuid 5db7294d-87fc-5726-a5c0-4a90679657a5
  sentry proguard upload mapping.txt --no-upload
  sentry proguard upload mapping.txt --json

**Positional parameters:**
  - `<path...>` (optional): Paths to ProGuard/R8 mapping files

**Flags:**
  - `--uuid` (value): Force a specific UUID instead of computing from file content (only valid with a single file)
  - `--no-upload` (boolean) (default: false): Compute and print UUIDs without uploading (dry-run)
  - `--require-one` (boolean) (default: false): Require at least one mapping file (error if none provided)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry proguard uuid`

**Brief:** Compute the UUID for a ProGuard mapping file

**Full description:** Compute and print the UUID of a ProGuard/R8 mapping file. The UUID is deterministically derived from the file contents and matches the value assigned by `sentry proguard upload`.

Usage:
  sentry proguard uuid ./app/build/outputs/mapping/release/mapping.txt
  sentry proguard uuid mapping.txt --json

**Positional parameters:**
  - `<path>`: Path to the ProGuard mapping file

**Flags:**
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

## `sentry react-native`

**Brief:** Upload React Native sourcemaps from build steps

**Full description:** Integrations for uploading React Native bundles and sourcemaps from native build steps (Gradle/Xcode).

### `sentry react-native gradle`

**Brief:** Upload a React Native bundle + sourcemap (Gradle build step)

**Full description:** Upload a React Native bundle and sourcemap during a Gradle build step (invoked by the sentry-android-gradle-plugin). A debug ID is injected into both files and they are uploaded under the `~/<filename>` convention.

Without `--release`, files are matched by debug ID. With `--release`, they are also uploaded for each `--dist`.

Use `--wait`/`--wait-for` to block until the server finishes processing the upload. Indexed/file RAM bundles (a pre-Hermes format) are not supported; use a plain or Hermes bundle.

**Flags:**
  - `--sourcemap` (value) **required**: Path to the sourcemap to upload
  - `--bundle` (value) **required**: Path to the bundle to upload
  - `--release` (value): Release version to publish to
  - `--dist` (value) (variadic): Distribution(s) to publish (repeatable; requires --release)
  - `--wait` (boolean): Wait for the server to fully process the uploaded files
  - `--wait-for` (value): Wait for processing, but at most this many seconds
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry react-native xcode`

**Brief:** Upload React Native sourcemaps (Xcode build step)

**Full description:** Upload React Native sourcemaps from an Xcode build phase. In a release build the RN build script is wrapped so the produced bundle and sourcemap are captured and uploaded; in a simulator build with `--allow-fetch` they are fetched from the packager; in a debug build the script simply runs.

Release/distribution come from `SENTRY_RELEASE`/`SENTRY_DIST` or the app Info.plist (unless `--no-auto-release`); outside an Xcode build the release is discovered via `xcodebuild`. Use `--wait`/`--wait-for` to block until the server finishes processing the upload.

**Positional parameters:**
  - `<script-arg...>` (optional): Extra arguments passed to the build script

**Flags:**
  - `--force / -f` (boolean): Run even in a debug configuration
  - `--allow-fetch` (boolean): Fetch sourcemaps from the packager on simulator builds
  - `--fetch-from` (value): Packager URL to fetch from (default: http://127.0.0.1:8081/)
  - `--build-script` (value): Path to the react-native-xcode.sh build script
  - `--dist` (value) (variadic): Distribution(s) to publish (repeatable)
  - `--wait` (boolean): Wait for the server to fully process the uploaded files
  - `--wait-for` (value): Wait for processing, but at most this many seconds
  - `--no-auto-release` (boolean): Don't read the release from Xcode project files
  - `--allow-xcode-infoplist-preprocessing` (boolean): Run the C preprocessor over Info.plist (INFOPLIST_PREPROCESS)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--force`, `-v` → `--verbose`

---

## `sentry replay`

**Brief:** Search and inspect Session Replays

**Full description:** Search and inspect Session Replays from your Sentry organization.

Commands:
  list     List recent replays in an org or project
  view     View details of a specific replay

Alias: `sentry replays` → `sentry replay list`

### `sentry replay list`

**Brief:** List recent Session Replays

**Full description:** List recent Session Replays from Sentry.

Target patterns:
  sentry replay list              # auto-detect org from config or DSN
  sentry replay list <org>/       # list all org replays
  sentry replay list <org>/<proj> # list replays for one project
  sentry replay list <project>    # find project across all orgs

The trailing slash on <org>/ is significant — without it, the argument is treated as a project name search (e.g., 'sentry' searches for a project named 'sentry', while 'sentry/' lists all projects in the 'sentry' org).

Examples:
  sentry replay list
  sentry replay list sentry/
  sentry replay list sentry/cli --limit 50
  sentry replay list sentry/cli --sort duration
  sentry replay list sentry/cli -q "user.email:foo@example.com"
  sentry replay list sentry/cli -e production -e canary
  sentry replay list sentry/cli --period 24h

Alias: `sentry replays` → `sentry replay list`

JSON fields (use --json --fields to select):
  activity (number | null, optional) — Replay activity score
  browser (object | null, optional) — Browser metadata
  count_dead_clicks (number | null, optional) — Dead click count
  count_errors (number | null, optional) — Associated error count
  count_infos (number | null, optional) — Info event count
  count_rage_clicks (number | null, optional) — Rage click count
  count_segments (number | null, optional) — Recording segment count
  count_urls (number | null, optional) — Visited URL count
  count_warnings (number | null, optional) — Warning event count
  device (object | null, optional) — Device metadata
  dist (string | null, optional) — Distribution
  duration (number | null, optional) — Replay duration in seconds
  environment (string | null, optional) — Environment
  error_ids (array) — Linked error IDs
  finished_at (string | null, optional) — Replay finish timestamp
  has_viewed (boolean | null, optional) — Whether the current user has viewed the replay
  id (string) — Replay ID
  info_ids (array) — Linked info event IDs
  is_archived (boolean | null, optional) — Archived flag
  os (object | null, optional) — Operating system metadata
  ota_updates (object | null, optional) — OTA update metadata
  platform (string | null, optional) — Platform
  project_id (string | null, optional) — Numeric project ID
  releases (array) — Associated releases
  sdk (object | null, optional) — SDK metadata
  started_at (string | null, optional) — Replay start timestamp
  tags (object) — Replay tags
  trace_ids (array) — Linked trace IDs
  urls (array) — Visited URLs
  user (object | null, optional) — User metadata
  warning_ids (array) — Linked warning event IDs

**Positional parameters:**
  - `<org/project>` (optional): <org>/, <org>/<project>, or <project> (search)

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Number of replays (1-1000)
  - `--query / -q` (value): Search query (Sentry replay search syntax)
  - `--environment / -e` (value) (variadic): Filter by environment (repeatable, comma-separated)
  - `--sort / -s` (value) (default: "date") **required**: Sort by: date, oldest, duration, errors, activity, or a raw replay sort field
  - `--period / -t` (value) (default: "7d") **required**: Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: activity, browser, count_dead_clicks, count_errors, count_infos, count_rage_clicks, count_segments, count_urls, count_warnings, device, dist, duration, environment, error_ids, finished_at, has_viewed, id, info_ids, is_archived, os, ota_updates, platform, project_id, releases, sdk, started_at, tags, trace_ids, urls, user, warning_ids

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-t` → `--period`, `-e` → `--environment`, `-n` → `--limit`, `-q` → `--query`, `-s` → `--sort`, `-f` → `--fresh`, `-c` → `--cursor`, `-v` → `--verbose`

---

### `sentry replay view`

**Brief:** View a Session Replay

**Full description:** View detailed information about a Session Replay.

Replay ID formats:
  <replay-id>              - auto-detect org from config or DSN
  <org>/<replay-id>        - explicit organization
  <org>/<project>/<id>     - explicit org/project context
  <replay-url>             - parse org and replay ID from a Sentry URL

Examples:
  sentry replay view 346789a703f6454384f1de473b8b9fcc
  sentry replay view sentry/346789a703f6454384f1de473b8b9fcc
  sentry replay view sentry/cli/346789a703f6454384f1de473b8b9fcc
  sentry replay view https://sentry.io/organizations/sentry/explore/replays/346789a703f6454384f1de473b8b9fcc/
  sentry replay view --web sentry/346789a703f6454384f1de473b8b9fcc

JSON fields (use --json --fields to select):
  activity (array) — Summarized replay activity
  browser (object | null, optional) — Browser metadata
  count_dead_clicks (number | null, optional) — Dead click count
  count_errors (number | null, optional) — Associated error count
  count_infos (number | null, optional) — Info event count
  count_rage_clicks (number | null, optional) — Rage click count
  count_segments (number | null, optional) — Recording segment count
  count_urls (number | null, optional) — Visited URL count
  count_warnings (number | null, optional) — Warning event count
  device (object | null, optional) — Device metadata
  dist (string | null, optional) — Distribution
  duration (number | null, optional) — Replay duration in seconds
  environment (string | null, optional) — Environment
  error_ids (array) — Linked error IDs
  finished_at (string | null, optional) — Replay finish timestamp
  has_viewed (boolean | null, optional) — Whether the current user has viewed the replay
  id (string) — Replay ID
  info_ids (array) — Linked info event IDs
  is_archived (boolean | null, optional) — Archived flag
  os (object | null, optional) — Operating system metadata
  ota_updates (object | null, optional) — OTA update metadata
  platform (string | null, optional) — Platform
  project_id (string | null, optional) — Numeric project ID
  releases (array) — Associated releases
  sdk (object | null, optional) — SDK metadata
  started_at (string | null, optional) — Replay start timestamp
  tags (object) — Replay tags
  trace_ids (array) — Linked trace IDs
  urls (array) — Visited URLs
  user (object | null, optional) — User metadata
  warning_ids (array) — Linked warning event IDs
  clicks (array, optional) — Replay click summaries
  replay_type (string | null, optional) — Replay type
  org (string) — Organization slug
  relatedIssues (array) — Replay-related issues
  relatedTraces (array) — Replay-related traces

**Positional parameters:**
  - `<replay-id-or-url...>` (optional): [<org>/<project>] <replay-id> or <replay-url>

**Flags:**
  - `--web / -w` (boolean) (default: false): Open in browser
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: activity, browser, count_dead_clicks, count_errors, count_infos, count_rage_clicks, count_segments, count_urls, count_warnings, device, dist, duration, environment, error_ids, finished_at, has_viewed, id, info_ids, is_archived, os, ota_updates, platform, project_id, releases, sdk, started_at, tags, trace_ids, urls, user, warning_ids, clicks, replay_type, org, relatedIssues, relatedTraces

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-w` → `--web`, `-v` → `--verbose`

---

## `sentry release`

**Brief:** Work with Sentry releases

**Full description:** List, create, finalize, and deploy Sentry releases.

Alias: `sentry releases` → `sentry release list`

### `sentry release list`

**Brief:** List releases with adoption and health metrics

**Full description:** List releases in an organization with adoption and crash-free metrics.

When run from a project directory (DSN auto-detection or explicit
<org>/<project> target), shows only releases for that project.

Sort options:
  date                 # by creation date (default)
  sessions             # by total sessions
  users                # by total users
  crash_free_sessions  # by crash-free session rate (aliases: stable_sessions, cfs)
  crash_free_users     # by crash-free user rate (aliases: stable_users, cfu)

Target specification:
  sentry release list               # auto-detect from DSN (project-scoped)
  sentry release list <org>/        # list all releases in org (paginated)
  sentry release list <org>/<proj>  # list releases for project
  sentry release list <org>         # list releases in org

Pagination:
  sentry release list <org>/ -c next  # fetch next page
  sentry release list <org>/ -c prev  # fetch previous page

Examples:
  sentry release list                         # auto-detect project
  sentry release list my-org/                  # all releases in org
  sentry release list my-org/my-proj           # project-scoped
  sentry release list --sort cfs               # sort by crash-free sessions
  sentry release list --environment production  # filter by env
  sentry release list --period 7d              # last 7 days of health data
  sentry release list --json

Alias: `sentry releases` → `sentry release list`

**Positional parameters:**
  - `<org/project>` (optional): <org>/ (all projects), <org>/<project>, or <project> (search)

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of releases to list
  - `--sort / -s` (value) (default: "date") **required**: Sort: date, sessions, users, crash_free_sessions (cfs), crash_free_users (cfu)
  - `--environment / -e` (value) (variadic): Filter by environment (repeatable, comma-separated)
  - `--period / -t` (value) (default: "90d") **required**: Health stats period (e.g., 24h, 7d, 14d, 90d)
  - `--status` (value) (default: "open") **required**: Filter by status: open (default) or archived
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--limit`, `-c` → `--cursor`, `-s` → `--sort`, `-e` → `--environment`, `-t` → `--period`, `-f` → `--fresh`, `-v` → `--verbose`

---

### `sentry release view`

**Brief:** View release details with health metrics

**Full description:** Show detailed information about a Sentry release, including
per-project adoption and crash-free metrics.

Examples:
  sentry release view 1.0.0
  sentry release view my-org/1.0.0
  sentry release view "sentry-cli@0.24.0"
  sentry release view 1.0.0 --json

**Positional parameters:**
  - `<org/version>`: [<org>/]<version> - Release version to view

**Flags:**
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-v` → `--verbose`

---

### `sentry release create`

**Brief:** Create a release

**Full description:** Create a new Sentry release.

The version must match the `release` value in Sentry.init().
Use `org/version` to specify the org — the `org/` prefix is the org slug, not
part of the version. E.g., `sentry/1.0.0` means org=sentry, version=1.0.0.

Examples:
  sentry release create 1.0.0
  sentry release create my-org/1.0.0
  sentry release create 1.0.0 --project my-project
  sentry release create 1.0.0 --project proj-a,proj-b
  sentry release create 1.0.0 --finalize
  sentry release create 1.0.0 --ref main
  sentry release create 1.0.0 --url https://github.com/org/repo/releases/tag/1.0.0
  sentry release create 1.0.0 --dry-run

**Positional parameters:**
  - `<org/version>`: [<org>/]<version> - Release version to create

**Flags:**
  - `--project / -p` (value): Associate with project(s), comma-separated
  - `--finalize` (boolean) (default: false): Immediately finalize the release (set dateReleased)
  - `--ref` (value): Git ref (branch or tag name)
  - `--url` (value): URL to the release source
  - `--dry-run / -n` (boolean) (default: false): Show what would happen without making changes
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug

**Flag aliases:** `-n` → `--dry-run`, `-p` → `--project`, `-v` → `--verbose`

---

### `sentry release finalize`

**Brief:** Finalize a release

**Full description:** Mark a release as finalized by setting its release date.

Examples:
  sentry release finalize 1.0.0
  sentry release finalize my-org/1.0.0
  sentry release finalize 1.0.0 --released 2025-01-01T00:00:00Z
  sentry release finalize 1.0.0 --dry-run

**Positional parameters:**
  - `<org/version>`: [<org>/]<version> - Release version to finalize

**Flags:**
  - `--released` (value): Custom release timestamp (ISO 8601). Defaults to now.
  - `--url` (value): URL for the release
  - `--dry-run / -n` (boolean) (default: false): Show what would happen without making changes
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--dry-run`, `-v` → `--verbose`

---

### `sentry release delete`

**Brief:** Delete a release

**Full description:** Permanently delete a Sentry release.

Examples:
  sentry release delete 1.0.0
  sentry release delete my-org/1.0.0
  sentry release delete 1.0.0 --yes
  sentry release delete 1.0.0 --dry-run

**Positional parameters:**
  - `<org/version>`: [<org>/]<version> - Release version to delete

**Flags:**
  - `--yes / -y` (boolean) (default: false): Skip confirmation prompt
  - `--force / -f` (boolean) (default: false): Force the operation without confirmation
  - `--dry-run / -n` (boolean) (default: false): Show what would happen without making changes
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-y` → `--yes`, `-f` → `--force`, `-n` → `--dry-run`, `-v` → `--verbose`

---

### `sentry release archive`

**Brief:** Archive a release

**Full description:** Mark a release as archived. Archived releases are hidden from the default `sentry release list` but are retained and can be restored with `sentry release restore`.

Examples:
  sentry release archive 1.0.0
  sentry release archive my-org/1.0.0
  sentry release archive 1.0.0 --dry-run

**Positional parameters:**
  - `<org/version>`: [<org>/]<version> - Release version to archive

**Flags:**
  - `--dry-run / -n` (boolean) (default: false): Show what would happen without making changes
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--dry-run`, `-v` → `--verbose`

---

### `sentry release restore`

**Brief:** Restore an archived release

**Full description:** Restore an archived release by setting its status back to open, making it visible in the default `sentry release list` again.

Examples:
  sentry release restore 1.0.0
  sentry release restore my-org/1.0.0
  sentry release restore 1.0.0 --dry-run

**Positional parameters:**
  - `<org/version>`: [<org>/]<version> - Release version to restore

**Flags:**
  - `--dry-run / -n` (boolean) (default: false): Show what would happen without making changes
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--dry-run`, `-v` → `--verbose`

---

### `sentry release deploy`

**Brief:** Create a deploy for a release

**Full description:** Create a deploy record for a release in a specific environment.

Examples:
  sentry release deploy 1.0.0 production
  sentry release deploy my-org/1.0.0 staging "Deploy #42"
  sentry release deploy 1.0.0 production --url https://example.com
  sentry release deploy 1.0.0 production --time 120
  sentry release deploy 1.0.0 production --dry-run

**Positional parameters:**
  - `<org/version>`: [<org>/]<version> - Release version
  - `<environment>`: Deploy environment (e.g. production)
  - `<name>` (optional): Optional deploy name (quote multi-word names, e.g. "Deploy #42")

**Flags:**
  - `--url` (value): URL for the deploy
  - `--started` (value): Deploy start time (ISO 8601)
  - `--finished` (value): Deploy finish time (ISO 8601)
  - `--time / -t` (value): Deploy duration in seconds (sets started = now - time, finished = now)
  - `--dry-run / -n` (boolean) (default: false): Show what would happen without making changes
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--dry-run`, `-t` → `--time`, `-v` → `--verbose`

---

### `sentry release deploys`

**Brief:** List deploys for a release

**Full description:** List all deploys recorded for a specific release.

Examples:
  sentry release deploys 1.0.0
  sentry release deploys my-org/1.0.0
  sentry release deploys 1.0.0 --json

**Positional parameters:**
  - `<org/version>`: [<org>/]<version> - Release version

**Flags:**
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry release set-commits`

**Brief:** Set commits for a release

**Full description:** Associate commits with a release.

Use --auto to let Sentry discover commits via your repository integration
(requires a local git checkout — matches the origin remote against Sentry repos),
or --local to read commits from the local git history.
With no flag, tries --auto first and falls back to --local on failure.

For monorepos, --path restricts commits to one or more subtrees
(comma-separated). It implies --local and cannot be combined with
--auto or --commit, whose ranges are expanded server-side.

Use --from <ref> to read the local range <ref>..HEAD (e.g. the previous
release tag through the current checkout). It implies --local, reads the
whole range (--initial-depth does not apply), and combines with --path to
scope a monorepo release to the files that changed since the last release.
Like --path, it cannot be combined with --auto or --commit. Requires a
full (non-shallow) checkout spanning the range.

Examples:
  sentry release set-commits 1.0.0 --auto
  sentry release set-commits my-org/1.0.0 --local
  sentry release set-commits 1.0.0 --local --initial-depth 50
  sentry release set-commits 1.0.0 --path apps/mobile,packages/shared-ui
  sentry release set-commits 1.0.0 --from v0.9.0
  sentry release set-commits 1.0.0 --from v0.9.0 --path apps/mobile,apps/shared
  sentry release set-commits 1.0.0 --commit owner/repo@abc123..def456
  sentry release set-commits 1.0.0 --clear

**Positional parameters:**
  - `<org/version>`: [<org>/]<version> - Release version

**Flags:**
  - `--auto` (boolean) (default: false): Auto-discover commits via repository integration (needs local git checkout)
  - `--local` (boolean) (default: false): Read commits from local git history
  - `--clear` (boolean) (default: false): Clear all commits from the release
  - `--commit` (value): Explicit commit as REPO@SHA or REPO@PREV..SHA (comma-separated)
  - `--path` (value): Filter commits to these paths (comma-separated). Implies --local.
  - `--from` (value): Read the local range <ref>..HEAD (e.g. previous release tag). Implies --local.
  - `--initial-depth` (value) (default: "20") **required**: Number of commits to read with --local
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry release propose-version`

**Brief:** Propose a release version

**Full description:** Propose a release version from CI environment variables or git HEAD SHA.

Detection order:
  1. SENTRY_RELEASE env var
  2. SOURCE_VERSION (Heroku)
  3. HEROKU_BUILD_COMMIT / HEROKU_SLUG_COMMIT
  4. CODEBUILD_RESOLVED_SOURCE_VERSION (AWS CodeBuild)
  5. CIRCLE_SHA1 (CircleCI)
  6. CF_PAGES_COMMIT_SHA (Cloudflare Pages)
  7. GAE_DEPLOYMENT_ID (Google App Engine)
  8. GITHUB_SHA (GitHub Actions)
  9. VERCEL_GIT_COMMIT_SHA (Vercel)
  10. RENDER_GIT_COMMIT (Render)
  11. NETLIFY_COMMIT_SHA (Netlify)
  12. CI_COMMIT_SHA (GitLab CI)
  13. BITBUCKET_COMMIT (Bitbucket Pipelines)
  14. TRAVIS_COMMIT (Travis CI)
  15. Git HEAD SHA (fallback)

Useful in CI scripts:
  sentry release create $(sentry release propose-version)

Examples:
  sentry release propose-version
  sentry release propose-version --json

**Flags:**
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

## `sentry repo`

**Brief:** Work with Sentry repositories

**Full description:** List and manage repositories connected to your Sentry organizations.

Alias: `sentry repos` → `sentry repo list`

### `sentry repo list`

**Brief:** List repositories

**Full description:** List repositories connected to an organization.

Target specification:
  sentry repo list               # auto-detect from DSN or config
  sentry repo list <org>/        # list all repos in org (paginated)
  sentry repo list <org>/<proj>  # list repos in org (project context)
  sentry repo list <org>         # list repos in org

Pagination:
  sentry repo list <org>/ -c next  # fetch next page
  sentry repo list <org>/ -c prev  # fetch previous page

Examples:
  sentry repo list              # auto-detect or list all
  sentry repo list my-org/      # list repositories in my-org (paginated)
  sentry repo list --limit 10
  sentry repo list --json

Alias: `sentry repos` → `sentry repo list`

JSON fields (use --json --fields to select):
  id (string) — Repository ID
  name (string) — Repository name
  url (string | null) — Repository URL
  provider (object) — Version control provider
  status (string) — Integration status
  dateCreated (string, optional) — Creation date (ISO 8601)
  integrationId (string, optional) — Integration ID
  externalSlug (string | null, optional) — External slug (e.g. org/repo)
  externalId (string | null, optional) — External ID

**Positional parameters:**
  - `<org/project>` (optional): <org>/ (all projects), <org>/<project>, or <project> (search)

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of repositories to list
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: id, name, url, provider, status, dateCreated, integrationId, externalSlug, externalId

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--limit`, `-c` → `--cursor`, `-f` → `--fresh`, `-v` → `--verbose`

---

## `sentry team`

**Brief:** Work with Sentry teams

**Full description:** List and manage teams in your Sentry organizations.

Alias: `sentry teams` → `sentry team list`

### `sentry team list`

**Brief:** List teams

**Full description:** List teams in an organization.

Target specification:
  sentry team list               # auto-detect from DSN or config
  sentry team list <org>/        # list all teams in org (paginated)
  sentry team list <org>/<proj>  # list teams in org (project context)
  sentry team list <org>         # list teams in org

Pagination:
  sentry team list <org>/ -c next  # fetch next page
  sentry team list <org>/ -c prev  # fetch previous page

Examples:
  sentry team list              # auto-detect or list all
  sentry team list my-org/      # list teams in my-org (paginated)
  sentry team list --limit 10
  sentry team list --json

Alias: `sentry teams` → `sentry team list`

JSON fields (use --json --fields to select):
  id (string) — Team ID
  slug (string) — Team slug
  name (string) — Team name
  dateCreated (string | null, optional) — Creation date (ISO 8601)
  isMember (boolean, optional) — Whether you are a member
  teamRole (string | null, optional) — Your role in the team
  memberCount (number, optional) — Number of members

**Positional parameters:**
  - `<org/project>` (optional): <org>/ (all projects), <org>/<project>, or <project> (search)

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of teams to list
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: id, slug, name, dateCreated, isMember, teamRole, memberCount

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--limit`, `-c` → `--cursor`, `-f` → `--fresh`, `-v` → `--verbose`

---

## `sentry issue`

**Brief:** Manage Sentry issues

**Full description:** View and manage issues from your Sentry projects.

Commands:
  list       List issues in a project
  events     List events for a specific issue
  view       View details of a specific issue
  explain    Analyze an issue using Seer AI
  plan       Generate a solution plan using Seer AI
  resolve    Mark an issue as resolved (optionally in a release)
  unresolve  Reopen a resolved issue (alias: reopen)
  archive    Archive/ignore an issue (alias: ignore)
  merge      Merge 2+ issues into a single group

Magic selectors (available for view, events, explain, plan, resolve, unresolve, archive):
  @latest          Most recent unresolved issue
  @most_frequent   Issue with the highest event frequency

Examples:
  sentry issue view @latest
  sentry issue events CLI-G
  sentry issue resolve CLI-12Z --in 0.26.1
  sentry issue archive CLI-AB --until auto
  sentry issue merge CLI-K9 CLI-15H CLI-15N
  sentry issue explain @most_frequent
  sentry issue plan my-org/@latest

Alias: `sentry issues` → `sentry issue list`

### `sentry issue list`

**Brief:** List issues in a project

**Full description:** List issues from Sentry projects.

Target patterns:
  sentry issue list               # auto-detect from DSN or config
  sentry issue list <org>/<proj>  # explicit org and project
  sentry issue list <org>/        # all projects in org (trailing / required)
  sentry issue list <project>     # find project across all orgs

The trailing slash on <org>/ is significant — without it, the argument is treated as a project name search (e.g., 'sentry' searches for a project named 'sentry', while 'sentry/' lists all projects in the 'sentry' org).

In monorepos with multiple Sentry projects, shows issues from all detected projects.

The --limit flag specifies the total number of issues to display (max 1000). When multiple projects are detected, the limit is distributed evenly across them. Projects with fewer issues than their share give their surplus to others. Use --cursor / -c next / -c prev to paginate through larger result sets.

By default, only issues with activity in the last 90 days are shown. Use --period to adjust (e.g. --period 24h, --period 14d).

Query syntax (--query flag):
  Terms are space-separated and implicitly ANDed together.
  AND/OR operators are NOT supported. Use alternatives:
    key:[val1,val2]   # in-list: matches val1 OR val2 for one key
    *term*            # wildcard matching
  Filters:  key:value, !key:value (negation), key:>N, key:<N
  Quoted:   message:"exact phrase with spaces"
  Built-in: is:unresolved, is:resolved, assigned:me, has:user
  Dates:    age:-24h (last 24h), firstSeen:+7d (older than 7d)
  Docs:     https://docs.sentry.io/concepts/search/

Alias: `sentry issues` → `sentry issue list`

JSON fields (use --json --fields to select):
  id (string) — Numeric issue ID
  shortId (string) — Human-readable short ID (e.g. PROJ-ABC)
  title (string) — Issue title
  culprit (string | null, optional) — Culprit string
  count (string, optional) — Total event count
  userCount (number, optional) — Number of affected users
  firstSeen (string | null, optional) — First occurrence (ISO 8601)
  lastSeen (string | null, optional) — Most recent occurrence (ISO 8601)
  level (string, optional) — Severity level
  status (string, optional) — Issue status
  permalink (string, optional) — URL to the issue in Sentry
  project (object, optional) — Project info
  metadata (object, optional) — Issue metadata
  assignedTo (object | null, optional) — Assigned user or team
  priority (string, optional) — Triage priority
  platform (string, optional) — Platform
  substatus (string | null, optional) — Issue substatus
  isUnhandled (boolean, optional) — Whether the issue is unhandled
  seerFixabilityScore (number | null, optional) — Seer AI fixability score (0-1)

**Positional parameters:**
  - `<org/project>` (optional): <org>/ (all projects), <org>/<project>, or <project> (search)

**Flags:**
  - `--query / -q` (value): Search query (Sentry syntax, implicit AND, no OR operator)
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of issues to list
  - `--sort / -s` (value): Sort by: recommended, date, new, freq, user (default: recommended on sentry.io, else date)
  - `--period / -t` (value) (default: "90d") **required**: Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--cursor / -c` (value): Pagination cursor (use "next" for next page, "prev" for previous)
  - `--compact` (boolean): Single-line rows for compact output (auto-detects if omitted)
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: id, shortId, title, culprit, count, userCount, firstSeen, lastSeen, level, status, permalink, project, metadata, assignedTo, priority, platform, substatus, isUnhandled, seerFixabilityScore

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--limit`, `-c` → `--cursor`, `-q` → `--query`, `-s` → `--sort`, `-t` → `--period`, `-f` → `--fresh`, `-v` → `--verbose`

---

### `sentry issue events`

**Brief:** List events for a specific issue

**Full description:** List events belonging to a Sentry issue.

Issue formats:
  @latest          - Most recent unresolved issue
  @most_frequent   - Issue with highest event frequency
  <org>/ID         - Explicit org: sentry/EXTENSION-7
  <project>-suffix - Project + suffix: cli-G
  ID               - Short ID: CLI-G
  numeric          - Numeric ID: 123456789

Examples:
  sentry issue events CLI-G
  sentry issue events @latest --limit 50
  sentry issue events 123456789 --full
  sentry issue events CLI-G -q "user.email:foo@bar.com"
  sentry issue events CLI-G --json

JSON fields (use --json --fields to select):
  id (string) — Internal event ID
  event.type (string) — Event type (error, default, transaction)
  groupID (string | null, optional) — Group (issue) ID
  eventID (string) — UUID-format event ID
  projectID (string, optional) — Project ID
  message (string, optional) — Event message
  title (string, optional) — Event title
  location (string | null, optional) — Source location (file:line)
  culprit (string | null, optional) — Culprit function/module
  user (object | null, optional) — User context
  tags (array, optional) — Event tags
  platform (string | null, optional) — Platform (python, javascript, etc.)
  dateCreated (string, optional) — ISO 8601 creation timestamp
  crashFile (string | null, optional) — Crash file URL
  metadata (object, optional) — Event metadata

**Positional parameters:**
  - `<issue>`: Issue: @latest, @most_frequent, <org>/ID, <org>/<project>#ID, <project>-suffix, ID, or suffix

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Number of events (1-1000)
  - `--query / -q` (value): Search query (Sentry search syntax)
  - `--full` (boolean) (default: false): Include full event body (stacktraces)
  - `--period / -t` (value) (default: "7d") **required**: Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: id, event.type, groupID, eventID, projectID, message, title, location, culprit, user, tags, platform, dateCreated, crashFile, metadata

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-t` → `--period`, `-n` → `--limit`, `-q` → `--query`, `-f` → `--fresh`, `-c` → `--cursor`, `-v` → `--verbose`

---

### `sentry issue explain`

**Brief:** Analyze an issue's root cause using Seer AI

**Full description:** Get a root cause analysis for a Sentry issue using Seer AI.

This command analyzes the issue and provides:
  - Identified root causes
  - Reproduction steps
  - Relevant code locations

The analysis may take a few minutes for new issues.
Use --force to trigger a fresh analysis even if one already exists.

Issue formats:
  @latest          - Most recent unresolved issue
  @most_frequent   - Issue with highest event frequency
  <org>/ID         - Explicit org: sentry/EXTENSION-7, sentry/cli-G
  <org>/@selector  - Selector with org: my-org/@latest
  <project>-suffix - Project + suffix: cli-G, spotlight-electron-4Y
  ID               - Short ID: CLI-G (searches across orgs)
  suffix           - Suffix only: G (requires DSN context)
  numeric          - Numeric ID: 123456789

Examples:
  sentry issue explain @latest
  sentry issue explain 123456789
  sentry issue explain sentry/EXTENSION-7
  sentry issue explain cli-G
  sentry issue explain 123456789 --json
  sentry issue explain 123456789 --force

**Positional parameters:**
  - `<issue>`: Issue: @latest, @most_frequent, <org>/ID, <org>/<project>#ID, <project>-suffix, ID, or suffix

**Flags:**
  - `--force` (boolean) (default: false): Force new analysis even if one exists
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-v` → `--verbose`

---

### `sentry issue plan`

**Brief:** Generate a solution plan using Seer AI

**Full description:** Generate a solution plan for a Sentry issue using Seer AI.

This command automatically runs root cause analysis if needed, then generates a solution plan with specific implementation steps to fix the issue.

Use --force to regenerate a plan even if one already exists.

Issue formats:
  @latest          - Most recent unresolved issue
  @most_frequent   - Issue with highest event frequency
  <org>/ID         - Explicit org: sentry/EXTENSION-7, sentry/cli-G
  <org>/@selector  - Selector with org: my-org/@latest
  <project>-suffix - Project + suffix: cli-G, spotlight-electron-4Y
  ID               - Short ID: CLI-G (searches across orgs)
  suffix           - Suffix only: G (requires DSN context)
  numeric          - Numeric ID: 123456789

Prerequisites:
  - GitHub integration configured for your organization
  - Code mappings set up for your project

Examples:
  sentry issue plan @latest
  sentry issue plan 123456789
  sentry issue plan sentry/EXTENSION-7
  sentry issue plan cli-G
  sentry issue plan 123456789 --force

**Positional parameters:**
  - `<issue>`: Issue: @latest, @most_frequent, <org>/ID, <org>/<project>#ID, <project>-suffix, ID, or suffix

**Flags:**
  - `--force` (boolean) (default: false): Force new plan even if one exists
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-v` → `--verbose`

---

### `sentry issue view`

**Brief:** View details of a specific issue

**Full description:** View detailed information about a Sentry issue by its ID or short ID. The latest event is automatically included for full context.

Issue formats:
  @latest         - Most recent unresolved issue
  @most_frequent  - Issue with highest event frequency
  <org>/ID        - Explicit org: sentry/EXTENSION-7, sentry/cli-G
  <org>/@selector - Selector with org: my-org/@latest
  <project>-suffix - Project + suffix: cli-G, spotlight-electron-4Y
  ID              - Short ID: CLI-G (searches across orgs)
  suffix          - Suffix only: G (requires DSN context)
  numeric         - Numeric ID: 123456789
  org/project#ID  - GitHub-style: my-org/my-project#PROJ-123

In multi-project mode (after 'issue list'), use alias-suffix format (e.g., 'f-g' where 'f' is the project alias shown in the list).

JSON fields (use --json --fields to select):
  id (string) — Numeric issue ID
  shortId (string) — Human-readable short ID (e.g. PROJ-ABC)
  title (string) — Issue title
  culprit (string | null, optional) — Culprit string
  count (string, optional) — Total event count
  userCount (number, optional) — Number of affected users
  firstSeen (string | null, optional) — First occurrence (ISO 8601)
  lastSeen (string | null, optional) — Most recent occurrence (ISO 8601)
  level (string, optional) — Severity level
  status (string, optional) — Issue status
  permalink (string, optional) — URL to the issue in Sentry
  project (object, optional) — Project info
  metadata (object, optional) — Issue metadata
  assignedTo (object | null, optional) — Assigned user or team
  priority (string, optional) — Triage priority
  platform (string, optional) — Platform
  substatus (string | null, optional) — Issue substatus
  isUnhandled (boolean, optional) — Whether the issue is unhandled
  seerFixabilityScore (number | null, optional) — Seer AI fixability score (0-1)
  event (unknown | null, optional) — Latest event for the issue (full detail). Select named fields with `--fields event.id,event.title` to avoid pulling the whole payload; the `request` entry may include live session data.
  org (string | null, optional) — Organization slug
  replayIds (array, optional) — Related Session Replay IDs
  trace (object | null, optional) — Trace context from the latest event's span tree

**Positional parameters:**
  - `<issue>`: Issue: @latest, @most_frequent, <org>/ID, <org>/<project>#ID, <project>-suffix, ID, or suffix

**Flags:**
  - `--web / -w` (boolean) (default: false): Open in browser
  - `--spans` (value) (default: "3") **required**: Span tree depth limit (number, "all" for unlimited, "no" to disable)
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: id, shortId, title, culprit, count, userCount, firstSeen, lastSeen, level, status, permalink, project, metadata, assignedTo, priority, platform, substatus, isUnhandled, seerFixabilityScore, event, org, replayIds, trace

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-w` → `--web`, `-v` → `--verbose`

---

### `sentry issue resolve`

**Brief:** Mark an issue as resolved

**Full description:** Resolve an issue, optionally tied to a release or commit.

Resolution spec (--in / -i):
  @next                        Resolve in the next release (tied to HEAD)
  @commit                      Resolve in the current git HEAD — auto-detects repo
  @commit:<repo>@<sha>       Resolve in an explicit repo + commit (repo must be registered in Sentry)
  <version>                    Resolve in this specific release (e.g., 0.26.1, spotlight@1.2.3)
  (omitted)                    Resolve immediately (no regression tracking)

@commit auto-detection requires a git repository whose 'origin' remote
maps to a Sentry-registered repo. The command errors out clearly if any
part of the detection fails — use the explicit form to override.

Examples:
  sentry issue resolve CLI-12Z
  sentry issue resolve CLI-12Z --in 0.26.1
  sentry issue resolve CLI-196 --in @next
  sentry issue resolve CLI-XX --in @commit
  sentry issue resolve CLI-XX -i @commit:getsentry/cli@abc123
  sentry issue resolve my-org/CLI-AB

**Positional parameters:**
  - `<issue>`: Issue: @latest, @most_frequent, <org>/ID, <org>/<project>#ID, <project>-suffix, ID, or suffix

**Flags:**
  - `--in / -i` (value): Resolve in a release, next release, or commit ('<version>' | '@next' | '@commit' | '@commit:<repo>@<sha>')
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-i` → `--in`, `-v` → `--verbose`

---

### `sentry issue unresolve`

**Brief:** Reopen a resolved issue

**Full description:** Mark an issue as unresolved. Inverse of `sentry issue resolve`.

Examples:
  sentry issue unresolve CLI-12Z
  sentry issue reopen CLI-12Z
  sentry issue unresolve my-org/CLI-AB

**Positional parameters:**
  - `<issue>`: Issue: @latest, @most_frequent, <org>/ID, <org>/<project>#ID, <project>-suffix, ID, or suffix

**Flags:**
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry issue archive`

**Brief:** Archive (ignore) an issue

**Full description:** Archive an issue, suppressing alerts until an optional condition is met.

Without --until, the issue is archived forever (equivalent to 'Archive Forever'
in the Sentry UI). Use --until to control when the issue automatically unarchives.

Modes:
  (no --until)     Archive forever — fully silenced, no automatic unarchival
  --until auto     Smart detection — unarchives when Sentry detects a spike in
                   event frequency (recommended for most use cases)
  --until <time>   Duration-based — unarchives after a fixed time period
  --until <N>x     Count-based — unarchives after N more events occur
  --until <N>u     User-based — unarchives after N more users are affected

Time formats: 30m (minutes), 1h (hours), 7d (days), 1w (weeks),
              or ISO dates like 2026-12-31

Compound conditions — add a time window with /:
  --until 10x/5m   Unarchive when 10 events occur within 5 minutes
  --until 5u/1h    Unarchive when 5 users are affected within 1 hour

Verbose forms are also accepted: 10events, 10users, 30minutes, 2hours, 7days

Examples:
  sentry issue archive CLI-12Z                  # Archive forever
  sentry issue archive CLI-12Z --until auto     # Smart spike detection
  sentry issue archive CLI-12Z -u auto          # Same (short alias)
  sentry issue archive CLI-12Z --until 1h       # Archive for 1 hour
  sentry issue archive CLI-12Z --until 7d       # Archive for 7 days
  sentry issue archive CLI-12Z --until 100x     # Until 100 more events
  sentry issue archive CLI-12Z --until 100x/1h  # 100 events within 1 hour
  sentry issue archive CLI-12Z --until 10u/1d   # 10 users within 1 day
  sentry issue ignore CLI-12Z --until auto      # 'ignore' alias works too

**Positional parameters:**
  - `<issue>`: Issue: @latest, @most_frequent, <org>/ID, <org>/<project>#ID, <project>-suffix, ID, or suffix

**Flags:**
  - `--until / -u` (value): Condition for unarchival: forever, auto, 30m, 10x, 10u, 10x/5m, etc.
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-u` → `--until`, `-v` → `--verbose`

---

### `sentry issue merge`

**Brief:** Merge 2+ issues into a single canonical group

**Full description:** Consolidate multiple issues into one. Useful when the same logical
error was split into separate groups (e.g. by Sentry's default
stack-trace grouping before fingerprint rules were applied).

Sentry picks the canonical parent based on event count — typically
the largest group. --into is a preference, not a guarantee: if your
choice has fewer events, Sentry may still pick a different parent,
in which case a warning is printed to stderr.

All issues must belong to the same organization. Only error-type
issues can be merged (the API rejects performance/info issues).

Examples:
  sentry issue merge CLI-K9 CLI-15H CLI-15N
  sentry issue merge CLI-K9 CLI-15H --into CLI-K9
  sentry issue merge my-org/CLI-AB my-org/CLI-CD

**Positional parameters:**
  - `<issue...>` (optional): Issue IDs to merge (2 or more required)

**Flags:**
  - `--into / -i` (value): Prefer this issue as the canonical parent (included in the merge if not already listed)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-i` → `--into`, `-v` → `--verbose`

---

## `sentry event`

**Brief:** View, list, and send Sentry events

**Full description:** View, list, and send event data from Sentry.

Use 'sentry event view <event-id>' to view a specific event.
Use 'sentry event list <issue-id>' to list events for an issue.
Use 'sentry event send -m <message>' to send a test event.

### `sentry event view`

**Brief:** View details of one or more events

**Full description:** View detailed information about Sentry events by their IDs.

Target specification:
  sentry event view <event-id>                         # auto-detect from DSN or config
  sentry event view <org>/<proj> <event-id> [<id>...]  # explicit org and project
  sentry event view <project> <event-id> [<id>...]     # find project across all orgs

Multiple event IDs can be passed as separate arguments or newline-separated
within a single argument (handy when piping from other commands).

**Positional parameters:**
  - `<org/project/event-id...>` (optional): [<org>/<project>] <event-id> [<event-id>...] - Target (optional) and one or more event IDs

**Flags:**
  - `--web / -w` (boolean) (default: false): Open in browser
  - `--spans` (value) (default: "3") **required**: Span tree depth limit (number, "all" for unlimited, "no" to disable)
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-w` → `--web`, `-v` → `--verbose`

---

### `sentry event list`

**Brief:** List events for an issue

**Full description:** List events belonging to a Sentry issue.

Issue formats:
  @latest          - Most recent unresolved issue
  @most_frequent   - Issue with highest event frequency
  <org>/ID         - Explicit org: sentry/EXTENSION-7
  <project>-suffix - Project + suffix: cli-G
  ID               - Short ID: CLI-G
  numeric          - Numeric ID: 123456789

Examples:
  sentry event list CLI-G
  sentry event list @latest --limit 50
  sentry event list 123456789 --full
  sentry event list CLI-G -q "user.email:foo@bar.com"
  sentry event list CLI-G --json

JSON fields (use --json --fields to select):
  id (string) — Internal event ID
  event.type (string) — Event type (error, default, transaction)
  groupID (string | null, optional) — Group (issue) ID
  eventID (string) — UUID-format event ID
  projectID (string, optional) — Project ID
  message (string, optional) — Event message
  title (string, optional) — Event title
  location (string | null, optional) — Source location (file:line)
  culprit (string | null, optional) — Culprit function/module
  user (object | null, optional) — User context
  tags (array, optional) — Event tags
  platform (string | null, optional) — Platform (python, javascript, etc.)
  dateCreated (string, optional) — ISO 8601 creation timestamp
  crashFile (string | null, optional) — Crash file URL
  metadata (object, optional) — Event metadata

**Positional parameters:**
  - `<issue>`: Issue: @latest, @most_frequent, <org>/ID, <org>/<project>#ID, <project>-suffix, ID, or suffix

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Number of events (1-1000)
  - `--query / -q` (value): Search query (Sentry search syntax)
  - `--full` (boolean) (default: false): Include full event body (stacktraces)
  - `--period / -t` (value) (default: "7d") **required**: Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: id, event.type, groupID, eventID, projectID, message, title, location, culprit, user, tags, platform, dateCreated, crashFile, metadata

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-t` → `--period`, `-n` → `--limit`, `-q` → `--query`, `-f` → `--fresh`, `-c` → `--cursor`, `-v` → `--verbose`

---

### `sentry event send`

**Brief:** Send a Sentry event

**Full description:** Send a Sentry event to the ingest pipeline using DSN-based authentication.

No login required — provide a DSN via --dsn or the SENTRY_DSN environment variable.

## Building an event from flags

```
sentry event send -m "Something went wrong" -l error --tag env:prod
```

## Sending from a JSON file

The JSON file must be a valid serialized Sentry Event object:

```
sentry event send ./event.json
```

Use --raw to skip JSON parsing and send the file bytes directly to the ingest endpoint.
This also supports sending pre-built Sentry envelope files.

When file arguments are provided, flags like -m/--message are ignored — the event is
built entirely from the file contents.

## Common flags

| Flag | Description |
|------|-------------|
| `--dsn` | DSN to send to (overrides SENTRY_DSN) |
| `-m` / `--message` | Event message (repeat for multi-line) |
| `-l` / `--level` | Severity: debug, info, warning, error, fatal |
| `-r` / `--release` | Release version |
| `-E` / `--env` | Environment name |
| `-t` / `--tag` | Tag as KEY:VALUE (repeat for multiple) |
| `-e` / `--extra` | Extra data as KEY:VALUE |
| `-u` / `--user` | User info as KEY:VALUE (id, email, username, ip_address) |
| `-f` / `--fingerprint` | Custom fingerprint parts (repeat) |
| `--logfile` | Attach last 100 log lines as breadcrumbs |
| `--with-categories` | Parse 'CATEGORY: message' from logfile lines |


**Positional parameters:**
  - `<args...>` (optional): Path(s) to JSON event file(s) to send

**Flags:**
  - `--dsn` (value): DSN to send events to (overrides SENTRY_DSN env var)
  - `--message / -m` (value) (variadic): Event message (repeat for multi-line)
  - `--message-arg / -a` (value) (variadic): Arguments for message template (repeat for multiple)
  - `--level / -l` (enum) (default: "error"): Event severity level
  - `--release / -r` (value): Release version
  - `--dist / -d` (value): Distribution identifier
  - `--env / -E` (value): Environment name (e.g. production, staging)
  - `--platform / -p` (value): Platform identifier (default: other)
  - `--tag / -t` (value) (variadic): Tag as KEY:VALUE (repeat for multiple)
  - `--extra / -e` (value) (variadic): Extra data as KEY:VALUE (repeat for multiple)
  - `--user / -u` (value) (variadic): User info as KEY:VALUE — id, email, username, ip_address, or custom
  - `--fingerprint / -f` (value) (variadic): Custom fingerprint part (repeat for multiple)
  - `--timestamp` (value): Event timestamp (Unix epoch, ISO 8601, or RFC 2822)
  - `--no-environ` (boolean) (default: false): Do not include environment variables in the event
  - `--logfile` (value): Path to a log file — last 100 lines are attached as breadcrumbs
  - `--with-categories` (boolean) (default: false): Parse 'CATEGORY: message' prefixes from logfile breadcrumbs
  - `--raw` (boolean) (default: false): Send file contents as-is without parsing
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-m` → `--message`, `-a` → `--message-arg`, `-l` → `--level`, `-r` → `--release`, `-d` → `--dist`, `-E` → `--env`, `-p` → `--platform`, `-t` → `--tag`, `-e` → `--extra`, `-u` → `--user`, `-f` → `--fingerprint`, `-v` → `--verbose`

---

## `sentry feedback`

**Brief:** Search and inspect User Feedback

**Full description:** Search and inspect modern User Feedback from your Sentry organization.

Commands:
  list  List and search feedback
  view  View feedback with its latest event context

### `sentry feedback list`

**Brief:** List and search User Feedback

**Full description:** List modern User Feedback captured by Sentry. Feedback is queried from the issue index with a mandatory category filter.

Target patterns:
  sentry feedback list              # auto-detect organization
  sentry feedback list <org>/       # all projects in an organization
  sentry feedback list <org>/<proj> # one project
  sentry feedback list <project>    # find project across organizations

The trailing slash on <org>/ is significant — without it, the argument is treated as a project name search (e.g., 'sentry' searches for a project named 'sentry', while 'sentry/' lists all projects in the 'sentry' org).

Mailboxes:
  unresolved  Inbox feedback (default)
  resolved    Resolved feedback
  spam        Feedback marked as spam
  all         All feedback statuses

JSON fields (use --json --fields to select):
  id (string) — Numeric issue ID
  shortId (string) — Human-readable short ID (e.g. PROJ-ABC)
  title (string) — Issue title
  culprit (string | null, optional) — Culprit string
  count (string, optional) — Total event count
  userCount (number, optional) — Number of affected users
  firstSeen (string | null, optional) — First occurrence (ISO 8601)
  lastSeen (string | null, optional) — Most recent occurrence (ISO 8601)
  level (string, optional) — Severity level
  status (string, optional) — Issue status
  permalink (string, optional) — URL to the issue in Sentry
  project (object, optional) — Project info
  metadata (object) — Feedback metadata
  assignedTo (object | null, optional) — Assigned user or team
  priority (string, optional) — Triage priority
  platform (string, optional) — Platform
  substatus (string | null, optional) — Issue substatus
  isUnhandled (boolean, optional) — Whether the issue is unhandled
  seerFixabilityScore (number | null, optional) — Seer AI fixability score (0-1)
  issueCategory (string) — Issue category discriminator
  issueType (string) — Issue type discriminator
  hasSeen (boolean, optional) — Whether the feedback has been read
  latestEventHasAttachments (boolean, optional) — Whether the latest event has attachments

**Positional parameters:**
  - `<org/project>` (optional): <org>/, <org>/<project>, or <project> (search)

**Flags:**
  - `--status` (enum) (default: "unresolved") **required**: Mailbox: unresolved, resolved, spam, or all
  - `--limit / -n` (value) (default: "25") **required**: Number of feedback items (1-1000)
  - `--query / -q` (value): Search query (Sentry issue search syntax)
  - `--period / -t` (value) (default: "14d") **required**: Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: id, shortId, title, culprit, count, userCount, firstSeen, lastSeen, level, status, permalink, project, metadata, assignedTo, priority, platform, substatus, isUnhandled, seerFixabilityScore, issueCategory, issueType, hasSeen, latestEventHasAttachments

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-t` → `--period`, `-n` → `--limit`, `-q` → `--query`, `-f` → `--fresh`, `-c` → `--cursor`, `-v` → `--verbose`

---

### `sentry feedback view`

**Brief:** View a User Feedback item

**Full description:** View modern User Feedback by ID or select the most recent unresolved Feedback with @latest. The latest event, linked error, Session Replays, and attachment metadata are included when available.

Feedback formats:
  @latest                     Most recent unresolved Feedback
  <org>/@latest               Most recent unresolved Feedback in an organization
  <short-id>                  Search accessible organizations
  <numeric-id>                Resolve by numeric issue ID
  <org>/<short-id>            Explicit organization
  <org>/<project>/<suffix>    Explicit organization and project

The resolved issue must have issue.category:feedback. Use 'sentry issue view' for other issue categories.

JSON fields (use --json --fields to select):
  id (string) — Numeric issue ID
  shortId (string) — Human-readable short ID (e.g. PROJ-ABC)
  title (string) — Issue title
  culprit (string | null, optional) — Culprit string
  count (string, optional) — Total event count
  userCount (number, optional) — Number of affected users
  firstSeen (string | null, optional) — First occurrence (ISO 8601)
  lastSeen (string | null, optional) — Most recent occurrence (ISO 8601)
  level (string, optional) — Severity level
  status (string, optional) — Issue status
  permalink (string, optional) — URL to the issue in Sentry
  project (object, optional) — Project info
  metadata (object) — Feedback metadata
  assignedTo (object | null, optional) — Assigned user or team
  priority (string, optional) — Triage priority
  platform (string, optional) — Platform
  substatus (string | null, optional) — Issue substatus
  isUnhandled (boolean, optional) — Whether the issue is unhandled
  seerFixabilityScore (number | null, optional) — Seer AI fixability score (0-1)
  issueCategory (string) — Issue category discriminator
  issueType (string) — Issue type discriminator
  hasSeen (boolean, optional) — Whether the feedback has been read
  latestEventHasAttachments (boolean, optional) — Whether the latest event has attachments
  org (string | null) — Organization slug
  event (unknown | null) — Latest feedback event
  replayIds (array) — Related Session Replay IDs
  attachments (array) — Attachments on the latest feedback event

**Positional parameters:**
  - `<feedback>`: Feedback: @latest, numeric ID, short ID, <org>/SHORT-ID, or <org>/<project>/<suffix>

**Flags:**
  - `--web / -w` (boolean) (default: false): Open in browser
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: id, shortId, title, culprit, count, userCount, firstSeen, lastSeen, level, status, permalink, project, metadata, assignedTo, priority, platform, substatus, isUnhandled, seerFixabilityScore, issueCategory, issueType, hasSeen, latestEventHasAttachments, org, event, replayIds, attachments

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-w` → `--web`, `-v` → `--verbose`

---

## `sentry log`

**Brief:** View Sentry logs

**Full description:** View and stream logs from your Sentry projects.

Commands:
  list     List or stream logs from a project
  view     View details of a specific log entry

Alias: `sentry logs` → `sentry log list`

### `sentry log list`

**Brief:** List logs from a project

**Full description:** List and stream logs from Sentry projects.

Target patterns:
  sentry log list               # auto-detect from DSN or config
  sentry log list <org>/<proj>  # explicit org and project
  sentry log list <project>     # find project across all orgs

A bare name (no slash) is treated as a project search. Use <org>/<project> for an explicit target.

Trace filtering:
  sentry log list <trace-id>           # Filter by trace (auto-detect org)
  sentry log list <org>/<trace-id>     # Filter by trace (explicit org)

Examples:
  sentry log list                    # List last 100 logs
  sentry log list -f                 # Stream logs (2s poll interval)
  sentry log list -f 5               # Stream logs (5s poll interval)
  sentry log list --limit 50         # Show last 50 logs
  sentry log list -q 'severity:error' # Filter to errors only
  sentry log list abc123def456abc123def456abc123de  # Filter by trace

Alias: `sentry logs` → `sentry log list`

JSON fields (use --json --fields to select):
  sentry.item_id (string) — Unique log entry ID
  timestamp (string) — Log timestamp (ISO 8601)
  timestamp_precise (number) — Nanosecond-precision timestamp
  message (string | null, optional) — Log message
  severity (string | null, optional) — Severity level (error, warning, info, debug)
  trace (string | null, optional) — Trace ID for correlation

**Positional parameters:**
  - `<org/project-or-trace-id...>` (optional): [<org>/[<project>/]]<trace-id>, <org>/<project>, or <project>

**Flags:**
  - `--limit / -n` (value) (default: "100") **required**: Number of log entries (1-1000)
  - `--query / -q` (value): Filter query (e.g., "severity:error", "project:backend", "project:[a,b]")
  - `--follow / -f` (value): Stream logs (optionally specify poll interval in seconds)
  - `--period / -t` (value): Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--sort / -s` (value) (default: "newest") **required**: Sort order: "newest" (default) or "oldest"
  - `--fresh` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: sentry.item_id, timestamp, timestamp_precise, message, severity, trace

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--limit`, `-q` → `--query`, `-f` → `--follow`, `-t` → `--period`, `-s` → `--sort`, `-v` → `--verbose`

---

### `sentry log view`

**Brief:** View details of one or more log entries

**Full description:** View detailed information about Sentry log entries by their IDs.

Target specification:
  sentry log view <log-id>                          # auto-detect from DSN or config
  sentry log view <org>/<proj> <log-id> [<id>...]   # explicit org and project
  sentry log view <project> <log-id> [<id>...]      # find project across all orgs

Multiple log IDs can be passed as separate arguments or newline-separated
within a single argument (handy when piping from other commands).

The log ID is the 32-character hexadecimal identifier shown in log listings.

**Positional parameters:**
  - `<org/project/log-id...>` (optional): [<org>/<project>] <log-id> [<log-id>...] - Target (optional) and one or more log IDs

**Flags:**
  - `--web / -w` (boolean) (default: false): Open in browser
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-w` → `--web`, `-v` → `--verbose`

---

## `sentry monitor`

**Brief:** Work with Sentry cron monitors

**Full description:** Run commands with cron monitor check-ins and list configured monitors.

  sentry monitor run <slug> -- <command>  # wrap a command with check-ins
  sentry monitor list                     # list configured monitors

Alias: `sentry monitors` → `sentry monitor list`

### `sentry monitor run`

**Brief:** Wrap a command with cron monitor check-ins

**Full description:** Run a command and report its execution to a Sentry cron monitor.

An `in_progress` check-in is sent when the command starts, then an `ok` or
`error` check-in (with duration) is sent when it finishes, based on the exit
code. The wrapped command's stdio and signals are forwarded and its exit code
is preserved.

Check-ins are sent via DSN — no `sentry auth login` required. The DSN is
resolved from `--dsn`, the `SENTRY_DSN` environment variable, or by
auto-detecting it from your project sources.

## Usage

```
sentry monitor run <monitor-slug> -- <command>
```

The `--` separator is recommended so flags belonging to your command are not
interpreted by `monitor run`. It is optional when your command has no flags:

```
sentry monitor run nightly-job -- python manage.py cron
sentry monitor run nightly-job npm run task        # -- optional here
```

## Creating/updating the monitor

Pass `--schedule` (crontab format) to upsert the monitor on the first
check-in. Dependent flags require `--schedule`:

```
sentry monitor run nightly-job -s "0 0 * * *" --max-runtime 30 --timezone UTC -- ./backup.sh
```

The wrapped command receives the `SENTRY_MONITOR_SLUG` environment variable.

**Positional parameters:**
  - `<monitor-slug command...>` (optional): Monitor slug followed by the command to run

**Flags:**
  - `--dsn` (value): DSN to send check-ins to (overrides SENTRY_DSN env var)
  - `--environment / -e` (value) (default: "production") **required**: Environment of the monitor
  - `--schedule / -s` (value): Upsert the monitor with this crontab schedule (e.g. '0 * * * *')
  - `--check-in-margin` (value): Minutes after the expected check-in before it is missed (requires --schedule)
  - `--max-runtime` (value): Minutes a check-in may run before timing out (requires --schedule)
  - `--timezone` (value): Timezone of the schedule, tz database string (requires --schedule)
  - `--failure-issue-threshold` (value): Consecutive failures before an issue is created (requires --schedule)
  - `--recovery-threshold` (value): Consecutive successes before an issue is resolved (requires --schedule)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-e` → `--environment`, `-s` → `--schedule`, `-v` → `--verbose`

---

### `sentry monitor list`

**Brief:** List cron monitors

**Full description:** List cron monitors in an organization.

Target specification:
  sentry monitor list               # auto-detect from DSN or config
  sentry monitor list <org>/        # list all monitors in org (paginated)
  sentry monitor list <org>/<proj>  # list monitors in org (project context)
  sentry monitor list <org>         # list monitors in org

Pagination:
  sentry monitor list <org>/ -c next  # fetch next page
  sentry monitor list <org>/ -c prev  # fetch previous page

Examples:
  sentry monitor list              # auto-detect or list all
  sentry monitor list my-org/      # list monitors in my-org (paginated)
  sentry monitor list --limit 10
  sentry monitor list --json

Alias: `sentry monitors` → `sentry monitor list`

JSON fields (use --json --fields to select):
  id (string) — Monitor ID
  slug (string) — Monitor slug
  name (string) — Monitor name
  status (string) — Monitor status (e.g. active, disabled)
  isMuted (boolean, optional) — Whether the monitor is muted
  config (object, optional) — Schedule configuration
  dateCreated (string, optional) — Creation date (ISO 8601)
  project (object, optional) — Owning project

**Positional parameters:**
  - `<org/project>` (optional): <org>/ (all projects), <org>/<project>, or <project> (search)

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of monitors to list
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: id, slug, name, status, isMuted, config, dateCreated, project

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--limit`, `-c` → `--cursor`, `-f` → `--fresh`, `-v` → `--verbose`

---

## `sentry snapshots`

**Brief:** Manage and compare snapshots

### `sentry snapshots diff`

**Brief:** Compare two directories of snapshot images

**Full description:** Compare two directories of snapshot images locally. Images present in both directories are diffed perceptually; a PNG diff mask is written for each changed image, and a JSON report is printed.

Comparison is anti-aliasing aware (disable with --no-antialiasing) and makes no network requests.

Usage:
  sentry snapshots diff ./baseline ./head
  sentry snapshots diff ./baseline ./head --threshold 0.02 --output ./diffs/
  sentry snapshots diff ./baseline ./head --fail-on-diff

**Positional parameters:**
  - `<base-dir>`: Path to the baseline image directory
  - `<head-dir>`: Path to the head image directory

**Flags:**
  - `--output / -o` (value): Directory for diff mask images (default: ./diff-output/)
  - `--threshold` (value) (default: "0.01") **required**: Pixel color difference threshold (0.0-1.0)
  - `--no-antialiasing` (boolean): Disable antialiasing detection
  - `--fail-on-diff` (boolean): Exit non-zero if any diffs (changed/added/removed/errored) are found
  - `--selective` (boolean): Treat images missing from head as skipped instead of removed
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-o` → `--output`, `-v` → `--verbose`

---

### `sentry snapshots download`

**Brief:** Download baseline snapshot images

**Full description:** Download baseline snapshot images from Sentry's preprod system to a local directory.

Use --snapshot-id to download a specific snapshot, or --app-id to resolve the latest baseline (org auth tokens require --project with a project ID or slug for --app-id).

This feature only works with Sentry SaaS.

Usage:
  sentry snapshots download --snapshot-id 1234567890
  sentry snapshots download --app-id my-app --branch main
  sentry snapshots download --app-id my-app --output ./baseline/

**Flags:**
  - `--app-id` (value): App identifier (e.g. my-app) to resolve the latest baseline; mutually exclusive with --snapshot-id
  - `--snapshot-id` (value): Direct snapshot artifact ID; mutually exclusive with --app-id
  - `--branch` (value): Git branch filter (only with --app-id)
  - `--output / -o` (value): Directory for extracted images (default: ./snapshots-base/)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-o` → `--output`, `-v` → `--verbose`

---

### `sentry snapshots upload`

**Brief:** Upload snapshots to a project

**Full description:** Upload a folder of screenshot images as a snapshot for visual diffing.

Each image (PNG/JPEG) is hashed and uploaded to Sentry's object store (images already present are skipped), then a manifest is created. Companion `<image>.json` sidecar files add per-image metadata. This feature only works with Sentry SaaS.

Usage:
  sentry snapshots upload ./screenshots --app-id com.example.app
  sentry snapshots upload ./shots --app-id my-app --diff-threshold 0.01
  sentry snapshots upload ./shots --app-id my-app --selective

**Positional parameters:**
  - `<path>`: Path to the folder containing images to upload

**Flags:**
  - `--app-id` (value) **required**: The application identifier
  - `--diff-threshold` (value): Only report an image as changed when its difference exceeds this fraction (0.0–1.0, e.g. 0.01 = 1%)
  - `--selective` (boolean): This upload contains only a subset of images (removals/renames won't be detected on PRs)
  - `--all-image-file-names` (value): Comma-separated list of all image names in the full suite (for selective uploads; implies --selective)
  - `--all-image-file-names-file` (value): Path to a file listing all image names, one per line (for selective uploads; implies --selective)
  - `--head-sha` (value): VCS commit SHA (defaults to the current commit)
  - `--base-sha` (value): VCS base commit SHA (defaults to the merge-base with the base ref)
  - `--vcs-provider` (value): VCS provider (defaults to the current remote's provider)
  - `--head-repo-name` (value): Head repository name, e.g. owner/repo (defaults to the current)
  - `--base-repo-name` (value): Base repository name, e.g. owner/repo (for forks)
  - `--head-ref` (value): Head branch/reference (defaults to the current branch)
  - `--base-ref` (value): Base branch/reference (defaults to the merge-base tracking ref)
  - `--pr-number` (value): Pull request number (auto-detected in pull_request GitHub Actions runs)
  - `--force-git-metadata` (boolean): Force collecting git metadata even outside CI (conflicts with --no-git-metadata)
  - `--no-git-metadata` (boolean): Disable automatic git metadata collection
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

## `sentry sourcemap`

**Brief:** Manage sourcemaps

**Full description:** Inject debug IDs and upload sourcemaps to Sentry.

Alias: `sentry sourcemaps` → `sentry sourcemap`

### `sentry sourcemap inject`

**Brief:** Inject debug IDs into JavaScript files and sourcemaps

**Full description:** Scans a directory for .js/.mjs/.cjs files and their companion .map files, then injects Sentry debug IDs for reliable sourcemap resolution.

The injection is idempotent — files that already have debug IDs are skipped.

Exits with an error if zero JS + sourcemap pairs are discovered (typical cause: bundler not emitting .map files). Pass --allow-empty to suppress this check for directories that may legitimately be empty.

Usage:
  sentry sourcemap inject ./dist
  sentry sourcemap inject ./build --ext .js,.mjs
  sentry sourcemap inject ./out --dry-run
  sentry sourcemap inject ./maybe-empty --allow-empty

**Positional parameters:**
  - `<directory>`: Directory to scan for JS + sourcemap pairs

**Flags:**
  - `--ext` (value): Comma-separated file extensions to process (default: .js,.cjs,.mjs)
  - `--ignore` (value): Comma-separated glob patterns to exclude (gitignore-style)
  - `--ignore-file` (value): Path to a file with gitignore-style patterns to exclude
  - `--dry-run` (boolean) (default: false): Show what would be modified without writing
  - `--allow-empty` (boolean) (default: false): Exit successfully when no JS + sourcemap pairs are found (default: error out to catch silent build misconfigurations)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry sourcemap upload`

**Brief:** Upload sourcemaps to Sentry

**Full description:** Upload JavaScript sourcemaps and source files to Sentry using debug-ID-based matching.

Automatically injects debug IDs into any files that don't already have them.
Org/project are auto-detected from DSN, env vars, or config defaults.

Exits with an error if zero JS + sourcemap pairs are discovered (typical cause: bundler not emitting .map files). Pass --allow-empty to suppress this check for directories that may legitimately be empty.

Usage:
  sentry sourcemap upload ./dist
  sentry sourcemap upload ./dist --release 1.0.0
  sentry sourcemap upload ./dist --release 1.0.0 --dist 12345
  sentry sourcemap upload ./dist --url-prefix '~/static/js/'
  sentry sourcemap upload ./dist --no-rewrite
  sentry sourcemap upload ./dist --ext .js,.mjs
  sentry sourcemap upload ./maybe-empty --allow-empty

**Positional parameters:**
  - `<directory>`: Directory containing sourcemaps

**Flags:**
  - `--release` (value): Release version to associate with the upload
  - `--dist` (value): Distribution identifier to disambiguate builds within a release
  - `--url-prefix` (value) (default: "~/"): URL prefix for uploaded files (default: ~/)
  - `--ext` (value): Comma-separated file extensions to process (default: .js,.cjs,.mjs)
  - `--ignore` (value): Comma-separated glob patterns to exclude (gitignore-style)
  - `--ignore-file` (value): Path to a file with gitignore-style patterns to exclude
  - `--strip-prefix` (value): Strip a prefix from uploaded file paths (e.g. 'build/')
  - `--strip-common-prefix` (boolean) (default: false): Automatically strip the longest common path prefix from all files
  - `--no-rewrite` (boolean) (default: false): Upload files as-is without injecting debug IDs
  - `--allow-empty` (boolean) (default: false): Exit successfully when no JS + sourcemap pairs are found (default: error out to catch silent build misconfigurations)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry sourcemap resolve`

**Brief:** Resolve and report sourcemap linkage for JavaScript files

**Full description:** Read-only diagnostic that scans a directory for .js/.mjs/.cjs files and reports, for each file, how its sourcemap resolves (companion .map file, external sourceMappingURL directive, inline data: URL, or none) and whether a Sentry debug ID has been injected.

This command never modifies files. Use it to debug why `sentry sourcemap upload` may not find the expected sourcemaps.

Usage:
  sentry sourcemap resolve ./dist
  sentry sourcemap resolve ./build --ext .js,.mjs
  sentry sourcemap resolve ./out --json

**Positional parameters:**
  - `<directory>`: Directory to scan for JS files

**Flags:**
  - `--ext` (value): Comma-separated file extensions to process (default: .js,.cjs,.mjs)
  - `--ignore` (value): Comma-separated glob patterns to exclude (gitignore-style)
  - `--ignore-file` (value): Path to a file with gitignore-style patterns to exclude
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

## `sentry span`

**Brief:** List and view spans in projects or traces

**Full description:** List and explore individual spans within distributed traces or across projects.

Commands:
  list     List spans in a project or trace
  view     View details of specific spans

Alias: `sentry spans` → `sentry span list`

### `sentry span list`

**Brief:** List spans in a project or trace

**Full description:** List spans from a Sentry project, or within a specific trace.

Project mode (no trace ID):
  sentry span list                        # auto-detect from DSN or config
  sentry span list <org>/<project>        # explicit org and project
  sentry span list <project>              # find project across all orgs

A bare name (no slash) is treated as a project search. Use <org>/<project> for an explicit target.

Trace mode (provide a 32-char trace ID):
  sentry span list <trace-id>                      # auto-detect org/project
  sentry span list <org>/<project>/<trace-id>      # explicit
  sentry span list <project> <trace-id>            # find project + trace

Pagination:
  sentry span list -c next                # fetch next page (project mode)
  sentry span list -c prev                # fetch previous page
  sentry span list <trace-id> -c next     # fetch next page (trace mode)

Examples:
  sentry span list                        # List recent spans in project
  sentry span list -q "op:db"             # Find all DB spans
  sentry span list -q "duration:>100ms"   # Slow spans
  sentry span list --period 24h           # Last 24 hours only
  sentry span list --sort duration        # Sort by slowest first
  sentry span list <trace-id>             # Spans in a specific trace
  sentry span list <trace-id> -q "op:db"  # DB spans in a trace

Alias: `sentry spans` → `sentry span list`

JSON fields (use --json --fields to select):
  id (string) — Span ID
  parent_span (string | null, optional) — Parent span ID
  span.op (string | null, optional) — Span operation (e.g. http.client, db)
  description (string | null, optional) — Span description
  span.duration (number | null, optional) — Duration (ms)
  timestamp (string) — Timestamp (ISO 8601)
  project (string) — Project slug
  transaction (string | null, optional) — Transaction name
  trace (string) — Trace ID

**Positional parameters:**
  - `<org/project/trace-id...>` (optional): [<org>/<project>] or [<org>/<project>/]<trace-id>

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Number of spans (<=1000)
  - `--query / -q` (value): Filter spans (e.g., "op:db", "project:backend", "project:[cli,api]")
  - `--sort / -s` (value) (default: "date") **required**: Sort order: date, duration
  - `--period / -t` (value) (default: "7d") **required**: Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: id, parent_span, span.op, description, span.duration, timestamp, project, transaction, trace

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-t` → `--period`, `-n` → `--limit`, `-q` → `--query`, `-s` → `--sort`, `-f` → `--fresh`, `-c` → `--cursor`, `-v` → `--verbose`

---

### `sentry span view`

**Brief:** View details of specific spans

**Full description:** View detailed information about one or more spans within a trace.

Target specification:
  sentry span view <trace-id> <span-id>                        # auto-detect
  sentry span view <org>/<project>/<trace-id> <span-id>        # explicit

The first argument is the trace ID (optionally prefixed with org/project),
followed by one or more span IDs.

Examples:
  sentry span view <trace-id> a1b2c3d4e5f67890
  sentry span view <trace-id> a1b2c3d4e5f67890 b2c3d4e5f6789012
  sentry span view sentry/my-project/<trace-id> a1b2c3d4e5f67890

**Positional parameters:**
  - `<trace-id/span-id...>` (optional): [<org>/<project>/]<trace-id> <span-id> [<span-id>...] - Trace ID and one or more span IDs

**Flags:**
  - `--spans` (value) (default: "3") **required**: Span tree depth limit (number, "all" for unlimited, "no" to disable)
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-v` → `--verbose`

---

## `sentry trace`

**Brief:** View distributed traces

**Full description:** View and explore distributed traces from your Sentry projects.

Commands:
  list     List recent traces in a project
  view     View details of a specific trace
  logs     View logs associated with a trace

Alias: `sentry traces` → `sentry trace list`

### `sentry trace list`

**Brief:** List recent traces in a project

**Full description:** List recent traces from Sentry projects.

Target patterns:
  sentry trace list               # auto-detect from DSN or config
  sentry trace list <org>/<proj>  # explicit org and project
  sentry trace list <project>     # find project across all orgs

A bare name (no slash) is treated as a project search. Use <org>/<project> for an explicit target.

Examples:
  sentry trace list                     # List last 10 traces
  sentry trace list --limit 50          # Show more traces
  sentry trace list --sort duration     # Sort by slowest first
  sentry trace list --period 24h        # Last 24 hours only
  sentry trace list -q "transaction:GET /api/users"  # Filter by transaction

Alias: `sentry traces` → `sentry trace list`

JSON fields (use --json --fields to select):
  trace (string) — Trace ID
  id (string) — Event ID
  transaction (string) — Transaction name
  timestamp (string) — Timestamp (ISO 8601)
  transaction.duration (number) — Duration (ms)
  project (string) — Project slug

**Positional parameters:**
  - `<org/project>` (optional): <org>/<project> or <project> (search)

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Number of traces (1-1000)
  - `--query / -q` (value): Search query (Sentry search syntax)
  - `--sort / -s` (value) (default: "date") **required**: Sort by: date, duration
  - `--period / -t` (value) (default: "7d") **required**: Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: trace, id, transaction, timestamp, transaction.duration, project

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-t` → `--period`, `-n` → `--limit`, `-q` → `--query`, `-s` → `--sort`, `-f` → `--fresh`, `-c` → `--cursor`, `-v` → `--verbose`

---

### `sentry trace view`

**Brief:** View details of a specific trace

**Full description:** View detailed information about a distributed trace by its ID.

Target specification:
  sentry trace view <trace-id>                       # auto-detect from DSN or config
  sentry trace view <org>/<project>/<trace-id>       # explicit org and project
  sentry trace view <project> <trace-id>             # find project across all orgs

The trace ID is the 32-character hexadecimal identifier.

**Positional parameters:**
  - `<org/project/trace-id...>` (optional): [<org>/<project>/]<trace-id> - Target (optional) and trace ID (required)

**Flags:**
  - `--web / -w` (boolean) (default: false): Open in browser
  - `--full` (boolean) (default: false): Fetch full span attributes (auto-enabled with --json)
  - `--spans` (value) (default: "3") **required**: Span tree depth limit (number, "all" for unlimited, "no" to disable)
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-w` → `--web`, `-v` → `--verbose`

---

### `sentry trace logs`

**Brief:** View logs associated with a trace

**Full description:** View logs associated with a specific distributed trace.

Target specification:
  sentry trace logs <trace-id>                    # auto-detect org
  sentry trace logs <org>/<trace-id>              # explicit org
  sentry trace logs <org>/<project>/<trace-id>    # filter to project

When a project is specified, only logs from that project are shown.
Use --query 'project:[a,b]' to filter to multiple projects.

The trace ID is the 32-character hexadecimal identifier.

Examples:
  sentry trace logs abc123def456abc123def456abc123de
  sentry trace logs myorg/abc123def456abc123def456abc123de
  sentry trace logs myorg/backend/abc123def456abc123def456abc123de
  sentry trace logs --period 7d abc123def456abc123def456abc123de
  sentry trace logs --json abc123def456abc123def456abc123de

**Positional parameters:**
  - `<org/project/trace-id...>` (optional): [<org>/[<project>/]]<trace-id> - Optional org/project and required trace ID

**Flags:**
  - `--web / -w` (boolean) (default: false): Open trace in browser
  - `--period / -t` (value) (default: "14d") **required**: Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--limit / -n` (value) (default: "100") **required**: Number of log entries (<=1000)
  - `--query / -q` (value): Filter query (e.g., "severity:error", "project:backend", "project:[a,b]")
  - `--sort / -s` (value) (default: "newest") **required**: Sort order: "newest" (default) or "oldest"
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-w` → `--web`, `-t` → `--period`, `-n` → `--limit`, `-q` → `--query`, `-s` → `--sort`, `-v` → `--verbose`

---

## `sentry trial`

**Brief:** Manage product trials

**Full description:** List and start product trials for your organization.

Alias: `sentry trials` → `sentry trial list`

### `sentry trial list`

**Brief:** List product trials

**Full description:** List product trials for an organization, including available,
active, and expired trials.

Examples:
  sentry trial list
  sentry trial list my-org
  sentry trial list --json

Alias: `sentry trials` → `sentry trial list`

JSON fields (use --json --fields to select):
  category (string) — Trial category (e.g. seerUsers, seerAutofix)
  startDate (string | null) — Start date (ISO 8601)
  endDate (string | null) — End date (ISO 8601)
  reasonCode (number) — Reason code
  isStarted (boolean) — Whether the trial has started
  lengthDays (number | null) — Trial duration in days

**Positional parameters:**
  - `<org>` (optional): Organization slug (auto-detected if omitted)

**Flags:**
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: category, startDate, endDate, reasonCode, isStarted, lengthDays

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry trial start`

**Brief:** Start a product trial

**Full description:** Start a product trial for an organization.

Valid trial names: seer, replays, performance, spans, profiling, logs, monitors, uptime, plan

Use 'plan' to start a Business plan trial (opens billing page).

Examples:
  sentry trial start seer
  sentry trial start seer my-org
  sentry trial start replays
  sentry trial start plan
  sentry trial start --json seer

**Positional parameters:**
  - `<name>`: Trial name (seer, replays, performance, spans, profiling, logs, monitors, uptime, plan)
  - `<org>` (optional): Organization slug (auto-detected if omitted)

**Flags:**
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

## `sentry local`

**Brief:** Sentry for local development

**Full description:** Run a local development server to capture Sentry SDK events
from your dev stack.

Commands:
  serve      Start the server and tail events (default)
  run        Run a command with SENTRY_SPOTLIGHT auto-injected

### `sentry local serve`

**Brief:** Start the local dev server and tail events

**Full description:** Start a local development server that captures envelopes from
Sentry SDKs in your dev stack and tails them to the terminal.

If a server is already listening on the port, the command connects
as an SSE consumer and tails events from it. Otherwise it starts
its own server.

Press Ctrl-C to stop.

**Flags:**
  - `--port / -p` (value) (default: "8969") **required**: Port to listen on (default 8969)
  - `--host / -H` (value) (default: "localhost") **required**: Hostname to bind to (default localhost)
  - `--quiet / -q` (boolean) (default: false): Suppress per-envelope tail output
  - `--filter / -f` (value) (variadic): Only show items of this type (repeatable: error, transaction, log, ai)
  - `--format / -F` (value) (default: "human") **required**: Output format: human (default) or json (NDJSON)
  - `--attributes / -a` (boolean) (default: false): Show a grouped attribute table (user vs SDK) under each transaction

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-p` → `--port`, `-H` → `--host`, `-q` → `--quiet`, `-f` → `--filter`, `-F` → `--format`, `-a` → `--attributes`, `-v` → `--verbose`

---

### `sentry local run`

**Brief:** Run a command with the local dev server enabled

**Full description:** Run a command with the SENTRY_SPOTLIGHT environment variable
injected so the Sentry SDK automatically sends envelopes to the
local server.

If no server is already listening on the port, one is started
automatically and shut down when the child process exits.

The child process inherits all current env vars plus
SENTRY_SPOTLIGHT (server-side SDKs read this automatically), the
framework-prefixed client variants (NEXT_PUBLIC_, VITE_, etc.), and
SENTRY_TRACES_SAMPLE_RATE=1.

Example:
  sentry local run -- npm run dev
  sentry local run -- python manage.py runserver

**Positional parameters:**
  - `<command...>` (optional): Command to run

**Flags:**
  - `--port / -p` (value) (default: "8969") **required**: Port for the local server (default 8969)
  - `--host` (value) (default: "localhost") **required**: Hostname for the local server (default localhost)
  - `--verify / -V` (boolean) (default: false): Verify SDK sends events, then exit
  - `--timeout / -t` (value) (default: "0") **required**: Kill the child after N seconds (0 = no timeout; defaults to 30 s in --verify mode)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-p` → `--port`, `-V` → `--verify`, `-t` → `--timeout`, `-v` → `--verbose`

---

## Standalone Commands

### `sentry help`

**Brief:** Display help for a command

**Full description:** Display help information. Run 'sentry help' for an overview, or 'sentry help <command>' for detailed help on a specific command. Use --json for machine-readable output suitable for AI agents.

**Positional parameters:**
  - `<command...>` (optional): Command to get help for

**Flags:**
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry explore`

**Brief:** Query aggregate event data (Explore)

**Full description:** Query the Sentry Explore API for aggregate event data.

Supports arbitrary fields including columns (title, project),
aggregates (count(), count_unique(user), p50(transaction.duration)),
and equations. Results are returned as a table.

Datasets:
  errors   Error events (default)
  spans    Span data
  metrics  Custom metrics (tracemetrics format)
  logs     Log entries
  replays  Session replay search

Targets:
  <org>/<project>  Filter by project (auto-adds project:<slug> to query)
  <org>/           All projects in org
  <project>        Bare slug — searches across orgs
  (omitted)        Auto-detect from DSN/config

Examples:
  sentry explore my-org/cli -F title -F "count()"
  sentry explore my-org/ -F title -F "count()" -F "count_unique(user)" --period 1h
  sentry explore my-org/cli -F span.op -F "p50(span.duration)" --dataset spans
  sentry explore my-org/cli --dataset replays -F id -F user.email -F count_errors
  sentry explore -F span.op -F "count()" --dataset spans --period 1h
  sentry explore --json

Metrics (auto mode — resolves type/unit automatically):
  sentry explore my-org/ -m llm.token_usage --dataset metrics
  sentry explore my-org/seer -F gen_ai.request.model -m llm.token_usage --dataset metrics --period 7d
  sentry explore my-org/ -m cache.hit_rate --agg avg --dataset metrics

**Positional parameters:**
  - `<target>` (optional): Target: <org>/<project>, <org>/, or <project>. Auto-detected if omitted.

**Flags:**
  - `--field / -F` (value) (variadic): API field or aggregate (repeatable). E.g., title, "count()", "p50(transaction.duration)"
  - `--metric / -m` (value): Metric name for --dataset metrics. Auto-resolves type/unit via API.
  - `--agg` (value) (default: "sum") **required**: Aggregation for --metric (sum, avg, count, p50, p95, etc.)
  - `--dataset / -d` (value) (default: "errors") **required**: Dataset to query (errors, spans, metrics, logs, replays)
  - `--query / -q` (value): Search query (Sentry search syntax)
  - `--sort / -s` (value): Sort field (prefix with - for desc, e.g., "-count()")
  - `--environment / -e` (value) (variadic): Replay environment filter for --dataset replays (repeatable, comma-separated)
  - `--limit / -n` (value) (default: "25") **required**: Number of rows (1-1000)
  - `--period / -t` (value) (default: "24h") **required**: Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-t` → `--period`, `-e` → `--environment`, `-F` → `--field`, `-m` → `--metric`, `-d` → `--dataset`, `-q` → `--query`, `-s` → `--sort`, `-n` → `--limit`, `-f` → `--fresh`, `-c` → `--cursor`, `-v` → `--verbose`

---

### `sentry init`

**Brief:** Initialize Sentry in your project (experimental)

**Full description:** EXPERIMENTAL: This command may modify your source files.

Runs the Sentry setup wizard to detect your project's framework, install the SDK, and configure Sentry.

Supports org/project syntax and a directory positional. Path-like
arguments (starting with . / ~) are treated as the directory;
everything else is treated as the target.

Examples:
  sentry init
  sentry init acme/
  sentry init acme/my-app
  sentry init my-app
  sentry init acme/my-app ./my-project
  sentry init ./my-project

**Positional parameters:**
  - `<target>` (optional): <org>/<project>, <org>/, <project>, or a directory path
  - `<directory>` (optional): Project directory (default: current directory)

**Flags:**
  - `--yes / -y` (boolean) (default: false): Accept non-interactive defaults (requires --features outside a TTY)
  - `--dry-run / -n` (boolean) (default: false): Show what would happen without making changes
  - `--features` (value) (variadic): Features to enable: errors,tracing,logs,replay,metrics,profiling,sourcemaps,crons,ai-monitoring
  - `--team / -t` (value): Team slug to create the project under
  - `--app` (value): App to initialize in a monorepo (required with --yes when multiple apps are detected)
  - `--tui` (boolean) (default: true): Use the Ink-based interactive UI (default). Pass --no-tui to fall back to plain log output.

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--dry-run`, `-y` → `--yes`, `-t` → `--team`, `-v` → `--verbose`

---

### `sentry info`

**Brief:** Print configuration and verify authentication

**Full description:** Print the resolved Sentry server URL and default organization/project, and verify authentication against the server.

Use `--config-status-json` for a machine-readable status dump (for external tooling); it always exits 0. Use `--no-defaults` to verify only authentication, without requiring a default org/project.

**Flags:**
  - `--config-status-json` (boolean): Emit configuration + auth status as JSON (for external tooling); always exits 0
  - `--no-defaults` (boolean): Verify only authentication, without requiring a default org/project
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry api`

**Brief:** Make an authenticated API request

**Full description:** Make a raw API request to the Sentry API. Similar to 'gh api' for GitHub. The endpoint is relative to /api/0/ (do not include the prefix). Authentication is handled automatically using your stored credentials.

Body options:
  --data/-d '{"key":"value"}'   Inline JSON body (like curl -d)
  --input/-i file.json          Read body from file (or "-" for stdin)

Field syntax (--field/-F):
  key=value          Simple field (values parsed as JSON if valid)
  key[sub]=value     Nested object: {key: {sub: value}}
  key[]=value        Array append: {key: [value]}
  key[]              Empty array: {key: []}

Use --raw-field/-f to send values as strings without JSON parsing.

Examples:
  sentry api organizations/
  sentry api issues/123/ -X PUT -F status=resolved
  sentry api issues/123/ -X PUT -d '{"status":"resolved"}'
  sentry api projects/my-org/my-project/ -F options[sampleRate]=0.5
  sentry api teams/my-org/my-team/members/ -F user[email]=user@example.com

**Positional parameters:**
  - `<endpoint>`: API endpoint relative to /api/0/ (e.g., organizations/)

**Flags:**
  - `--method / -X` (value) (default: "GET") **required**: The HTTP method for the request
  - `--data / -d` (value): Inline JSON body for the request (like curl -d)
  - `--field / -F` (value) (variadic): Add a typed parameter (key=value, key[sub]=value, key[]=value)
  - `--raw-field / -f` (value) (variadic): Add a string parameter without JSON parsing
  - `--header / -H` (value) (variadic): Add a HTTP request header in key:value format
  - `--input` (value): The file to use as body for the HTTP request (use "-" to read from standard input)
  - `--silent` (boolean) (default: false): Do not print the response body
  - `--verbose` (boolean) (default: false): Include full HTTP request and response in the output
  - `--dry-run / -n` (boolean) (default: false): Show the resolved request without sending it
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-X` → `--method`, `-d` → `--data`, `-F` → `--field`, `-f` → `--raw-field`, `-H` → `--header`, `-n` → `--dry-run`

---

### `sentry schema`

**Brief:** Browse the Sentry API schema

**Full description:** Browse and search the Sentry API schema. Shows available resources, operations, and endpoint details. Use with --json for machine-readable output.

Examples:
  sentry schema                      List all API resources
  sentry schema issues                Show endpoints for a resource
  sentry schema issues list            Show details for one endpoint
  sentry schema --all                 Flat list of all endpoints
  sentry schema --search monitor      Search endpoints by keyword

**Positional parameters:**
  - `<resource...>` (optional): Resource name and optional operation

**Flags:**
  - `--all` (boolean) (default: false): Show all endpoints in a flat list
  - `--search / -q` (value): Search endpoints by keyword
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-q` → `--search`, `-v` → `--verbose`

---

## Hidden Routes / Backward-Compat Aliases

These are hidden from `--help` output. They are typically plural aliases that
map directly to the `list` subcommand of the singular route group.

### `sentry sourcemaps` **[HIDDEN]**

**Brief:** Manage sourcemaps
**Aliases to:** same commands as the non-hidden singular form

### `sentry events` **[HIDDEN]**

**Brief:** List events for an issue

**Full description:** List events belonging to a Sentry issue.

Issue formats:
  @latest          - Most recent unresolved issue
  @most_frequent   - Issue with highest event frequency
  <org>/ID         - Explicit org: sentry/EXTENSION-7
  <project>-suffix - Project + suffix: cli-G
  ID               - Short ID: CLI-G
  numeric          - Numeric ID: 123456789

Examples:
  sentry event list CLI-G
  sentry event list @latest --limit 50
  sentry event list 123456789 --full
  sentry event list CLI-G -q "user.email:foo@bar.com"
  sentry event list CLI-G --json

JSON fields (use --json --fields to select):
  id (string) — Internal event ID
  event.type (string) — Event type (error, default, transaction)
  groupID (string | null, optional) — Group (issue) ID
  eventID (string) — UUID-format event ID
  projectID (string, optional) — Project ID
  message (string, optional) — Event message
  title (string, optional) — Event title
  location (string | null, optional) — Source location (file:line)
  culprit (string | null, optional) — Culprit function/module
  user (object | null, optional) — User context
  tags (array, optional) — Event tags
  platform (string | null, optional) — Platform (python, javascript, etc.)
  dateCreated (string, optional) — ISO 8601 creation timestamp
  crashFile (string | null, optional) — Crash file URL
  metadata (object, optional) — Event metadata

**Positional parameters:**
  - `<issue>`: Issue: @latest, @most_frequent, <org>/ID, <org>/<project>#ID, <project>-suffix, ID, or suffix

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Number of events (1-1000)
  - `--query / -q` (value): Search query (Sentry search syntax)
  - `--full` (boolean) (default: false): Include full event body (stacktraces)
  - `--period / -t` (value) (default: "7d") **required**: Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: id, event.type, groupID, eventID, projectID, message, title, location, culprit, user, tags, platform, dateCreated, crashFile, metadata

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-t` → `--period`, `-n` → `--limit`, `-q` → `--query`, `-f` → `--fresh`, `-c` → `--cursor`, `-v` → `--verbose`

---

### `sentry send-event` **[HIDDEN]**

**Brief:** Send a Sentry event

**Full description:** Send a Sentry event to the ingest pipeline using DSN-based authentication.

No login required — provide a DSN via --dsn or the SENTRY_DSN environment variable.

## Building an event from flags

```
sentry event send -m "Something went wrong" -l error --tag env:prod
```

## Sending from a JSON file

The JSON file must be a valid serialized Sentry Event object:

```
sentry event send ./event.json
```

Use --raw to skip JSON parsing and send the file bytes directly to the ingest endpoint.
This also supports sending pre-built Sentry envelope files.

When file arguments are provided, flags like -m/--message are ignored — the event is
built entirely from the file contents.

## Common flags

| Flag | Description |
|------|-------------|
| `--dsn` | DSN to send to (overrides SENTRY_DSN) |
| `-m` / `--message` | Event message (repeat for multi-line) |
| `-l` / `--level` | Severity: debug, info, warning, error, fatal |
| `-r` / `--release` | Release version |
| `-E` / `--env` | Environment name |
| `-t` / `--tag` | Tag as KEY:VALUE (repeat for multiple) |
| `-e` / `--extra` | Extra data as KEY:VALUE |
| `-u` / `--user` | User info as KEY:VALUE (id, email, username, ip_address) |
| `-f` / `--fingerprint` | Custom fingerprint parts (repeat) |
| `--logfile` | Attach last 100 log lines as breadcrumbs |
| `--with-categories` | Parse 'CATEGORY: message' from logfile lines |


**Positional parameters:**
  - `<args...>` (optional): Path(s) to JSON event file(s) to send

**Flags:**
  - `--dsn` (value): DSN to send events to (overrides SENTRY_DSN env var)
  - `--message / -m` (value) (variadic): Event message (repeat for multi-line)
  - `--message-arg / -a` (value) (variadic): Arguments for message template (repeat for multiple)
  - `--level / -l` (enum) (default: "error"): Event severity level
  - `--release / -r` (value): Release version
  - `--dist / -d` (value): Distribution identifier
  - `--env / -E` (value): Environment name (e.g. production, staging)
  - `--platform / -p` (value): Platform identifier (default: other)
  - `--tag / -t` (value) (variadic): Tag as KEY:VALUE (repeat for multiple)
  - `--extra / -e` (value) (variadic): Extra data as KEY:VALUE (repeat for multiple)
  - `--user / -u` (value) (variadic): User info as KEY:VALUE — id, email, username, ip_address, or custom
  - `--fingerprint / -f` (value) (variadic): Custom fingerprint part (repeat for multiple)
  - `--timestamp` (value): Event timestamp (Unix epoch, ISO 8601, or RFC 2822)
  - `--no-environ` (boolean) (default: false): Do not include environment variables in the event
  - `--logfile` (value): Path to a log file — last 100 lines are attached as breadcrumbs
  - `--with-categories` (boolean) (default: false): Parse 'CATEGORY: message' prefixes from logfile breadcrumbs
  - `--raw` (boolean) (default: false): Send file contents as-is without parsing
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-m` → `--message`, `-a` → `--message-arg`, `-l` → `--level`, `-r` → `--release`, `-d` → `--dist`, `-E` → `--env`, `-p` → `--platform`, `-t` → `--tag`, `-e` → `--extra`, `-u` → `--user`, `-f` → `--fingerprint`, `-v` → `--verbose`

---

### `sentry send-envelope` **[HIDDEN]**

**Brief:** Send a Sentry envelope file (deprecated)

**Full description:** This command has been replaced by `sentry event send --raw <file>`.

Use `sentry event send --raw ./captured.envelope` instead.

**Positional parameters:**
  - `<args...>` (optional): Path(s) to envelope file(s)

**Flags:**
  - `--dsn` (value): DSN
  - `--raw` (boolean) (default: false): Raw mode
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry bash-hook` **[HIDDEN]**

**Brief:** Print a bash script for shell error reporting

**Full description:** Output a bash script snippet that, when eval'd, sets up ERR and EXIT
traps to automatically capture and report shell errors to Sentry.

Usage:
  eval "$(sentry bash-hook)"

The generated script requires SENTRY_DSN to be set in the environment.
When an error occurs, it calls back into the CLI to send the event.

**Flags:**
  - `--no-exit` (boolean) (default: false): Do not prepend 'set -e' to the script
  - `--no-environ` (boolean) (default: false): No-op (environment variables are never sent)
  - `--allow-xcode-infoplist-preprocessing` (boolean) (default: false): No-op (kept for backward compatibility with old sentry-cli scripts)
  - `--cli` (value): Override the sentry-cli command path in the generated script
  - `--tag / -t` (value) (variadic): Add a tag as KEY:VALUE to the event (repeatable)
  - `--release / -r` (value): Set the release version for the event
  - `--dsn` (value): DSN to send events to (overrides SENTRY_DSN env var)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--send-event` (boolean) (default: false) **[hidden]**: Internal: send a bash error event from traceback/log files
  - `--traceback` (value) **[hidden]**: Internal: path to the traceback file
  - `--log` (value) **[hidden]**: Internal: path to the log file
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-t` → `--tag`, `-r` → `--release`, `-v` → `--verbose`

---

### `sentry conversations` **[HIDDEN]**

**Brief:** List recent AI conversations

**Full description:** List recent AI conversations from a Sentry organization.

Examples:
  sentry conversation list                # List recent conversations
  sentry conversation list my-org         # Explicit org
  sentry conversation list --limit 50     # Show more
  sentry conversation list --period 24h   # Last 24 hours
  sentry conversation list -q "has:errors" # Filter


JSON fields (use --json --fields to select):
  conversationId (string)
  title (string | null, optional)
  flow (array)
  errors (number)
  llmCalls (number)
  toolCalls (number)
  totalTokens (number)
  totalCost (number)
  startTimestamp (number)
  endTimestamp (number)
  traceCount (number)
  traceIds (array)
  firstInput (string | null)
  lastOutput (string | null)
  user (object | null, optional)
  toolNames (array)
  toolErrors (number)

**Positional parameters:**
  - `<org>` (optional): Organization slug

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Number of conversations (1-1000)
  - `--query / -q` (value): Search query
  - `--period / -t` (value) (default: "7d") **required**: Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: conversationId, title, flow, errors, llmCalls, toolCalls, totalTokens, totalCost, startTimestamp, endTimestamp, traceCount, traceIds, firstInput, lastOutput, user, toolNames, toolErrors

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-t` → `--period`, `-n` → `--limit`, `-q` → `--query`, `-f` → `--fresh`, `-c` → `--cursor`, `-v` → `--verbose`

---

### `sentry dashboards` **[HIDDEN]**

**Brief:** List dashboards

**Full description:** List dashboards in a Sentry organization.

The optional name argument supports glob patterns for filtering by title.
Glob matching is case-insensitive. Quote patterns to prevent shell expansion.

Examples:
  sentry dashboard list                     # auto-detect org
  sentry dashboard list my-org/             # explicit org
  sentry dashboard list my-org/my-project   # org from explicit project
  sentry dashboard list 'Error*'            # filter by title glob
  sentry dashboard list my-org '*API*'      # bare org + filter
  sentry dashboard list my-org/ '*API*'     # org/ + filter
  sentry dashboard list -c next             # next page
  sentry dashboard list -c prev             # previous page
  sentry dashboard list --json              # JSON with pagination envelope
  sentry dashboard list --web

**Positional parameters:**
  - `<org/title-filter...>` (optional): [<org/project>] [<name-glob>]

**Flags:**
  - `--web / -w` (boolean) (default: false): Open in browser
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of dashboards to list
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-w` → `--web`, `-n` → `--limit`, `-f` → `--fresh`, `-c` → `--cursor`, `-v` → `--verbose`

---

### `sentry issues` **[HIDDEN]**

**Brief:** List issues in a project

**Full description:** List issues from Sentry projects.

Target patterns:
  sentry issue list               # auto-detect from DSN or config
  sentry issue list <org>/<proj>  # explicit org and project
  sentry issue list <org>/        # all projects in org (trailing / required)
  sentry issue list <project>     # find project across all orgs

The trailing slash on <org>/ is significant — without it, the argument is treated as a project name search (e.g., 'sentry' searches for a project named 'sentry', while 'sentry/' lists all projects in the 'sentry' org).

In monorepos with multiple Sentry projects, shows issues from all detected projects.

The --limit flag specifies the total number of issues to display (max 1000). When multiple projects are detected, the limit is distributed evenly across them. Projects with fewer issues than their share give their surplus to others. Use --cursor / -c next / -c prev to paginate through larger result sets.

By default, only issues with activity in the last 90 days are shown. Use --period to adjust (e.g. --period 24h, --period 14d).

Query syntax (--query flag):
  Terms are space-separated and implicitly ANDed together.
  AND/OR operators are NOT supported. Use alternatives:
    key:[val1,val2]   # in-list: matches val1 OR val2 for one key
    *term*            # wildcard matching
  Filters:  key:value, !key:value (negation), key:>N, key:<N
  Quoted:   message:"exact phrase with spaces"
  Built-in: is:unresolved, is:resolved, assigned:me, has:user
  Dates:    age:-24h (last 24h), firstSeen:+7d (older than 7d)
  Docs:     https://docs.sentry.io/concepts/search/

Alias: `sentry issues` → `sentry issue list`

JSON fields (use --json --fields to select):
  id (string) — Numeric issue ID
  shortId (string) — Human-readable short ID (e.g. PROJ-ABC)
  title (string) — Issue title
  culprit (string | null, optional) — Culprit string
  count (string, optional) — Total event count
  userCount (number, optional) — Number of affected users
  firstSeen (string | null, optional) — First occurrence (ISO 8601)
  lastSeen (string | null, optional) — Most recent occurrence (ISO 8601)
  level (string, optional) — Severity level
  status (string, optional) — Issue status
  permalink (string, optional) — URL to the issue in Sentry
  project (object, optional) — Project info
  metadata (object, optional) — Issue metadata
  assignedTo (object | null, optional) — Assigned user or team
  priority (string, optional) — Triage priority
  platform (string, optional) — Platform
  substatus (string | null, optional) — Issue substatus
  isUnhandled (boolean, optional) — Whether the issue is unhandled
  seerFixabilityScore (number | null, optional) — Seer AI fixability score (0-1)

**Positional parameters:**
  - `<org/project>` (optional): <org>/ (all projects), <org>/<project>, or <project> (search)

**Flags:**
  - `--query / -q` (value): Search query (Sentry syntax, implicit AND, no OR operator)
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of issues to list
  - `--sort / -s` (value): Sort by: recommended, date, new, freq, user (default: recommended on sentry.io, else date)
  - `--period / -t` (value) (default: "90d") **required**: Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--cursor / -c` (value): Pagination cursor (use "next" for next page, "prev" for previous)
  - `--compact` (boolean): Single-line rows for compact output (auto-detects if omitted)
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: id, shortId, title, culprit, count, userCount, firstSeen, lastSeen, level, status, permalink, project, metadata, assignedTo, priority, platform, substatus, isUnhandled, seerFixabilityScore

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--limit`, `-c` → `--cursor`, `-q` → `--query`, `-s` → `--sort`, `-t` → `--period`, `-f` → `--fresh`, `-v` → `--verbose`

---

### `sentry orgs` **[HIDDEN]**

**Brief:** List organizations

**Full description:** List organizations that you have access to.

Examples:
  sentry org list
  sentry org list --limit 10
  sentry org list --json

Alias: `sentry orgs` → `sentry org list`

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of organizations to list
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-n` → `--limit`, `-v` → `--verbose`

---

### `sentry platforms` **[HIDDEN]**

**Brief:** List all valid Sentry platform identifiers

**Full description:** List every valid Sentry platform identifier — the full set behind `sentry project create <name>:<platform>`. Use --search to filter.

Examples:
  sentry platform list                 List all valid platforms
  sentry platform list --search python  Filter by substring
  sentry platform list --json           Machine-readable output

**Flags:**
  - `--search / -q` (value): Filter platforms by substring
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-q` → `--search`, `-v` → `--verbose`

---

### `sentry projects` **[HIDDEN]**

**Brief:** List projects

**Full description:** List projects in an organization.

Target patterns:
  sentry project list                # auto-detect from DSN or config
  sentry project list <org>/         # all projects in org (paginated)
  sentry project list <org>/<proj>   # show specific project
  sentry project list <project>      # find project across all orgs

The trailing slash on <org>/ is significant — without it, the argument is treated as a project name search (e.g., 'sentry' searches for a project named 'sentry', while 'sentry/' lists all projects in the 'sentry' org). Cursor pagination (--cursor) requires the <org>/ form.

Pagination:
  sentry project list <org>/ -c next      # next page
  sentry project list <org>/ -c prev      # previous page
  sentry project list <org>/ -c <cursor>  # resume at specific cursor

Filtering and output:
  sentry project list --platform javascript  # filter by platform
  sentry project list --limit 50              # show more results
  sentry project list --json                  # output as JSON

Alias: `sentry projects` → `sentry project list`

**Positional parameters:**
  - `<org/project>` (optional): <org>/ (all projects), <org>/<project>, or <project> (search)

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of projects to list
  - `--platform / -p` (value): Filter by platform (e.g., javascript, python)
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--limit`, `-c` → `--cursor`, `-p` → `--platform`, `-f` → `--fresh`, `-v` → `--verbose`

---

### `sentry replays` **[HIDDEN]**

**Brief:** List recent Session Replays

**Full description:** List recent Session Replays from Sentry.

Target patterns:
  sentry replay list              # auto-detect org from config or DSN
  sentry replay list <org>/       # list all org replays
  sentry replay list <org>/<proj> # list replays for one project
  sentry replay list <project>    # find project across all orgs

The trailing slash on <org>/ is significant — without it, the argument is treated as a project name search (e.g., 'sentry' searches for a project named 'sentry', while 'sentry/' lists all projects in the 'sentry' org).

Examples:
  sentry replay list
  sentry replay list sentry/
  sentry replay list sentry/cli --limit 50
  sentry replay list sentry/cli --sort duration
  sentry replay list sentry/cli -q "user.email:foo@example.com"
  sentry replay list sentry/cli -e production -e canary
  sentry replay list sentry/cli --period 24h

Alias: `sentry replays` → `sentry replay list`

JSON fields (use --json --fields to select):
  activity (number | null, optional) — Replay activity score
  browser (object | null, optional) — Browser metadata
  count_dead_clicks (number | null, optional) — Dead click count
  count_errors (number | null, optional) — Associated error count
  count_infos (number | null, optional) — Info event count
  count_rage_clicks (number | null, optional) — Rage click count
  count_segments (number | null, optional) — Recording segment count
  count_urls (number | null, optional) — Visited URL count
  count_warnings (number | null, optional) — Warning event count
  device (object | null, optional) — Device metadata
  dist (string | null, optional) — Distribution
  duration (number | null, optional) — Replay duration in seconds
  environment (string | null, optional) — Environment
  error_ids (array) — Linked error IDs
  finished_at (string | null, optional) — Replay finish timestamp
  has_viewed (boolean | null, optional) — Whether the current user has viewed the replay
  id (string) — Replay ID
  info_ids (array) — Linked info event IDs
  is_archived (boolean | null, optional) — Archived flag
  os (object | null, optional) — Operating system metadata
  ota_updates (object | null, optional) — OTA update metadata
  platform (string | null, optional) — Platform
  project_id (string | null, optional) — Numeric project ID
  releases (array) — Associated releases
  sdk (object | null, optional) — SDK metadata
  started_at (string | null, optional) — Replay start timestamp
  tags (object) — Replay tags
  trace_ids (array) — Linked trace IDs
  urls (array) — Visited URLs
  user (object | null, optional) — User metadata
  warning_ids (array) — Linked warning event IDs

**Positional parameters:**
  - `<org/project>` (optional): <org>/, <org>/<project>, or <project> (search)

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Number of replays (1-1000)
  - `--query / -q` (value): Search query (Sentry replay search syntax)
  - `--environment / -e` (value) (variadic): Filter by environment (repeatable, comma-separated)
  - `--sort / -s` (value) (default: "date") **required**: Sort by: date, oldest, duration, errors, activity, or a raw replay sort field
  - `--period / -t` (value) (default: "7d") **required**: Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: activity, browser, count_dead_clicks, count_errors, count_infos, count_rage_clicks, count_segments, count_urls, count_warnings, device, dist, duration, environment, error_ids, finished_at, has_viewed, id, info_ids, is_archived, os, ota_updates, platform, project_id, releases, sdk, started_at, tags, trace_ids, urls, user, warning_ids

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-t` → `--period`, `-e` → `--environment`, `-n` → `--limit`, `-q` → `--query`, `-s` → `--sort`, `-f` → `--fresh`, `-c` → `--cursor`, `-v` → `--verbose`

---

### `sentry releases` **[HIDDEN]**

**Brief:** List releases with adoption and health metrics

**Full description:** List releases in an organization with adoption and crash-free metrics.

When run from a project directory (DSN auto-detection or explicit
<org>/<project> target), shows only releases for that project.

Sort options:
  date                 # by creation date (default)
  sessions             # by total sessions
  users                # by total users
  crash_free_sessions  # by crash-free session rate (aliases: stable_sessions, cfs)
  crash_free_users     # by crash-free user rate (aliases: stable_users, cfu)

Target specification:
  sentry release list               # auto-detect from DSN (project-scoped)
  sentry release list <org>/        # list all releases in org (paginated)
  sentry release list <org>/<proj>  # list releases for project
  sentry release list <org>         # list releases in org

Pagination:
  sentry release list <org>/ -c next  # fetch next page
  sentry release list <org>/ -c prev  # fetch previous page

Examples:
  sentry release list                         # auto-detect project
  sentry release list my-org/                  # all releases in org
  sentry release list my-org/my-proj           # project-scoped
  sentry release list --sort cfs               # sort by crash-free sessions
  sentry release list --environment production  # filter by env
  sentry release list --period 7d              # last 7 days of health data
  sentry release list --json

Alias: `sentry releases` → `sentry release list`

**Positional parameters:**
  - `<org/project>` (optional): <org>/ (all projects), <org>/<project>, or <project> (search)

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of releases to list
  - `--sort / -s` (value) (default: "date") **required**: Sort: date, sessions, users, crash_free_sessions (cfs), crash_free_users (cfu)
  - `--environment / -e` (value) (variadic): Filter by environment (repeatable, comma-separated)
  - `--period / -t` (value) (default: "90d") **required**: Health stats period (e.g., 24h, 7d, 14d, 90d)
  - `--status` (value) (default: "open") **required**: Filter by status: open (default) or archived
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--limit`, `-c` → `--cursor`, `-s` → `--sort`, `-e` → `--environment`, `-t` → `--period`, `-f` → `--fresh`, `-v` → `--verbose`

---

### `sentry repos` **[HIDDEN]**

**Brief:** List repositories

**Full description:** List repositories connected to an organization.

Target specification:
  sentry repo list               # auto-detect from DSN or config
  sentry repo list <org>/        # list all repos in org (paginated)
  sentry repo list <org>/<proj>  # list repos in org (project context)
  sentry repo list <org>         # list repos in org

Pagination:
  sentry repo list <org>/ -c next  # fetch next page
  sentry repo list <org>/ -c prev  # fetch previous page

Examples:
  sentry repo list              # auto-detect or list all
  sentry repo list my-org/      # list repositories in my-org (paginated)
  sentry repo list --limit 10
  sentry repo list --json

Alias: `sentry repos` → `sentry repo list`

JSON fields (use --json --fields to select):
  id (string) — Repository ID
  name (string) — Repository name
  url (string | null) — Repository URL
  provider (object) — Version control provider
  status (string) — Integration status
  dateCreated (string, optional) — Creation date (ISO 8601)
  integrationId (string, optional) — Integration ID
  externalSlug (string | null, optional) — External slug (e.g. org/repo)
  externalId (string | null, optional) — External ID

**Positional parameters:**
  - `<org/project>` (optional): <org>/ (all projects), <org>/<project>, or <project> (search)

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of repositories to list
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: id, name, url, provider, status, dateCreated, integrationId, externalSlug, externalId

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--limit`, `-c` → `--cursor`, `-f` → `--fresh`, `-v` → `--verbose`

---

### `sentry teams` **[HIDDEN]**

**Brief:** List teams

**Full description:** List teams in an organization.

Target specification:
  sentry team list               # auto-detect from DSN or config
  sentry team list <org>/        # list all teams in org (paginated)
  sentry team list <org>/<proj>  # list teams in org (project context)
  sentry team list <org>         # list teams in org

Pagination:
  sentry team list <org>/ -c next  # fetch next page
  sentry team list <org>/ -c prev  # fetch previous page

Examples:
  sentry team list              # auto-detect or list all
  sentry team list my-org/      # list teams in my-org (paginated)
  sentry team list --limit 10
  sentry team list --json

Alias: `sentry teams` → `sentry team list`

JSON fields (use --json --fields to select):
  id (string) — Team ID
  slug (string) — Team slug
  name (string) — Team name
  dateCreated (string | null, optional) — Creation date (ISO 8601)
  isMember (boolean, optional) — Whether you are a member
  teamRole (string | null, optional) — Your role in the team
  memberCount (number, optional) — Number of members

**Positional parameters:**
  - `<org/project>` (optional): <org>/ (all projects), <org>/<project>, or <project> (search)

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of teams to list
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: id, slug, name, dateCreated, isMember, teamRole, memberCount

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--limit`, `-c` → `--cursor`, `-f` → `--fresh`, `-v` → `--verbose`

---

### `sentry logs` **[HIDDEN]**

**Brief:** List logs from a project

**Full description:** List and stream logs from Sentry projects.

Target patterns:
  sentry log list               # auto-detect from DSN or config
  sentry log list <org>/<proj>  # explicit org and project
  sentry log list <project>     # find project across all orgs

A bare name (no slash) is treated as a project search. Use <org>/<project> for an explicit target.

Trace filtering:
  sentry log list <trace-id>           # Filter by trace (auto-detect org)
  sentry log list <org>/<trace-id>     # Filter by trace (explicit org)

Examples:
  sentry log list                    # List last 100 logs
  sentry log list -f                 # Stream logs (2s poll interval)
  sentry log list -f 5               # Stream logs (5s poll interval)
  sentry log list --limit 50         # Show last 50 logs
  sentry log list -q 'severity:error' # Filter to errors only
  sentry log list abc123def456abc123def456abc123de  # Filter by trace

Alias: `sentry logs` → `sentry log list`

JSON fields (use --json --fields to select):
  sentry.item_id (string) — Unique log entry ID
  timestamp (string) — Log timestamp (ISO 8601)
  timestamp_precise (number) — Nanosecond-precision timestamp
  message (string | null, optional) — Log message
  severity (string | null, optional) — Severity level (error, warning, info, debug)
  trace (string | null, optional) — Trace ID for correlation

**Positional parameters:**
  - `<org/project-or-trace-id...>` (optional): [<org>/[<project>/]]<trace-id>, <org>/<project>, or <project>

**Flags:**
  - `--limit / -n` (value) (default: "100") **required**: Number of log entries (1-1000)
  - `--query / -q` (value): Filter query (e.g., "severity:error", "project:backend", "project:[a,b]")
  - `--follow / -f` (value): Stream logs (optionally specify poll interval in seconds)
  - `--period / -t` (value): Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--sort / -s` (value) (default: "newest") **required**: Sort order: "newest" (default) or "oldest"
  - `--fresh` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: sentry.item_id, timestamp, timestamp_precise, message, severity, trace

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--limit`, `-q` → `--query`, `-f` → `--follow`, `-t` → `--period`, `-s` → `--sort`, `-v` → `--verbose`

---

### `sentry monitors` **[HIDDEN]**

**Brief:** List cron monitors

**Full description:** List cron monitors in an organization.

Target specification:
  sentry monitor list               # auto-detect from DSN or config
  sentry monitor list <org>/        # list all monitors in org (paginated)
  sentry monitor list <org>/<proj>  # list monitors in org (project context)
  sentry monitor list <org>         # list monitors in org

Pagination:
  sentry monitor list <org>/ -c next  # fetch next page
  sentry monitor list <org>/ -c prev  # fetch previous page

Examples:
  sentry monitor list              # auto-detect or list all
  sentry monitor list my-org/      # list monitors in my-org (paginated)
  sentry monitor list --limit 10
  sentry monitor list --json

Alias: `sentry monitors` → `sentry monitor list`

JSON fields (use --json --fields to select):
  id (string) — Monitor ID
  slug (string) — Monitor slug
  name (string) — Monitor name
  status (string) — Monitor status (e.g. active, disabled)
  isMuted (boolean, optional) — Whether the monitor is muted
  config (object, optional) — Schedule configuration
  dateCreated (string, optional) — Creation date (ISO 8601)
  project (object, optional) — Owning project

**Positional parameters:**
  - `<org/project>` (optional): <org>/ (all projects), <org>/<project>, or <project> (search)

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Maximum number of monitors to list
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: id, slug, name, status, isMuted, config, dateCreated, project

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-n` → `--limit`, `-c` → `--cursor`, `-f` → `--fresh`, `-v` → `--verbose`

---

### `sentry spans` **[HIDDEN]**

**Brief:** List spans in a project or trace

**Full description:** List spans from a Sentry project, or within a specific trace.

Project mode (no trace ID):
  sentry span list                        # auto-detect from DSN or config
  sentry span list <org>/<project>        # explicit org and project
  sentry span list <project>              # find project across all orgs

A bare name (no slash) is treated as a project search. Use <org>/<project> for an explicit target.

Trace mode (provide a 32-char trace ID):
  sentry span list <trace-id>                      # auto-detect org/project
  sentry span list <org>/<project>/<trace-id>      # explicit
  sentry span list <project> <trace-id>            # find project + trace

Pagination:
  sentry span list -c next                # fetch next page (project mode)
  sentry span list -c prev                # fetch previous page
  sentry span list <trace-id> -c next     # fetch next page (trace mode)

Examples:
  sentry span list                        # List recent spans in project
  sentry span list -q "op:db"             # Find all DB spans
  sentry span list -q "duration:>100ms"   # Slow spans
  sentry span list --period 24h           # Last 24 hours only
  sentry span list --sort duration        # Sort by slowest first
  sentry span list <trace-id>             # Spans in a specific trace
  sentry span list <trace-id> -q "op:db"  # DB spans in a trace

Alias: `sentry spans` → `sentry span list`

JSON fields (use --json --fields to select):
  id (string) — Span ID
  parent_span (string | null, optional) — Parent span ID
  span.op (string | null, optional) — Span operation (e.g. http.client, db)
  description (string | null, optional) — Span description
  span.duration (number | null, optional) — Duration (ms)
  timestamp (string) — Timestamp (ISO 8601)
  project (string) — Project slug
  transaction (string | null, optional) — Transaction name
  trace (string) — Trace ID

**Positional parameters:**
  - `<org/project/trace-id...>` (optional): [<org>/<project>] or [<org>/<project>/]<trace-id>

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Number of spans (<=1000)
  - `--query / -q` (value): Filter spans (e.g., "op:db", "project:backend", "project:[cli,api]")
  - `--sort / -s` (value) (default: "date") **required**: Sort order: date, duration
  - `--period / -t` (value) (default: "7d") **required**: Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: id, parent_span, span.op, description, span.duration, timestamp, project, transaction, trace

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-t` → `--period`, `-n` → `--limit`, `-q` → `--query`, `-s` → `--sort`, `-f` → `--fresh`, `-c` → `--cursor`, `-v` → `--verbose`

---

### `sentry traces` **[HIDDEN]**

**Brief:** List recent traces in a project

**Full description:** List recent traces from Sentry projects.

Target patterns:
  sentry trace list               # auto-detect from DSN or config
  sentry trace list <org>/<proj>  # explicit org and project
  sentry trace list <project>     # find project across all orgs

A bare name (no slash) is treated as a project search. Use <org>/<project> for an explicit target.

Examples:
  sentry trace list                     # List last 10 traces
  sentry trace list --limit 50          # Show more traces
  sentry trace list --sort duration     # Sort by slowest first
  sentry trace list --period 24h        # Last 24 hours only
  sentry trace list -q "transaction:GET /api/users"  # Filter by transaction

Alias: `sentry traces` → `sentry trace list`

JSON fields (use --json --fields to select):
  trace (string) — Trace ID
  id (string) — Event ID
  transaction (string) — Transaction name
  timestamp (string) — Timestamp (ISO 8601)
  transaction.duration (number) — Duration (ms)
  project (string) — Project slug

**Positional parameters:**
  - `<org/project>` (optional): <org>/<project> or <project> (search)

**Flags:**
  - `--limit / -n` (value) (default: "25") **required**: Number of traces (1-1000)
  - `--query / -q` (value): Search query (Sentry search syntax)
  - `--sort / -s` (value) (default: "date") **required**: Sort by: date, duration
  - `--period / -t` (value) (default: "7d") **required**: Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01"
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--cursor / -c` (value): Navigate pages: "next", "prev", "first" (or raw cursor string)
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: trace, id, transaction, timestamp, transaction.duration, project

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-t` → `--period`, `-n` → `--limit`, `-q` → `--query`, `-s` → `--sort`, `-f` → `--fresh`, `-c` → `--cursor`, `-v` → `--verbose`

---

### `sentry trials` **[HIDDEN]**

**Brief:** List product trials

**Full description:** List product trials for an organization, including available,
active, and expired trials.

Examples:
  sentry trial list
  sentry trial list my-org
  sentry trial list --json

Alias: `sentry trials` → `sentry trial list`

JSON fields (use --json --fields to select):
  category (string) — Trial category (e.g. seerUsers, seerAutofix)
  startDate (string | null) — Start date (ISO 8601)
  endDate (string | null) — End date (ISO 8601)
  reasonCode (number) — Reason code
  isStarted (boolean) — Whether the trial has started
  lengthDays (number | null) — Trial duration in days

**Positional parameters:**
  - `<org>` (optional): Organization slug (auto-detected if omitted)

**Flags:**
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported). Available: category, startDate, endDate, reasonCode, isStarted, lengthDays

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-v` → `--verbose`

---

### `sentry whoami` **[HIDDEN]**

**Brief:** Show the currently authenticated identity

**Full description:** Display the identity behind the current authentication token.

For user-scoped tokens (OAuth, personal access tokens), this fetches the user from the Sentry API. For organization auth tokens (`sntrys_`), it shows which organization the token belongs to.

**Flags:**
  - `--fresh / -f` (boolean) (default: false): Bypass cache, re-detect projects, and fetch fresh data
  - `--json` (boolean) (default: false): Output as JSON
  - `--fields` (value): Comma-separated fields to include in JSON output (dot.notation supported)

**Hidden flags (auto-injected by framework):**
  - `--log-level` (enum) **[hidden]**: Set log verbosity level
  - `--verbose / -v` (boolean) (default: false) **[hidden]**: Enable verbose (debug-level) logging output
  - `--org` (value) **[hidden]**: Organization slug
  - `--project` (value) **[hidden]**: Project slug

**Flag aliases:** `-f` → `--fresh`, `-v` → `--verbose`

---
