---
name: sentry-cli-replay
version: 0.32.0-dev.0
description: Search and inspect Session Replays
requires:
  bins: ["sentry"]
  auth: true
---

# Replay Commands

Search and inspect Session Replays

### `sentry replay event list <replay-target...>`

List normalized events from a Session Replay

**Flags:**
- `-k, --kind <value>... - Event kind filter (navigation, click, tap, input, focus, blur, scroll, viewport, mutation, dom-snapshot, breadcrumb, network, console, error, span, web-vital, memory, video, mobile, unknown)`
- `--path <value> - Filter events by parsed URL pathname`
- `-q, --search <value> - Filter events by text in labels, messages, URLs, selectors, or data`
- `--around <value> - Show an evidence window around this replay offset`
- `-n, --limit <value> - Number of events (1-1000) - (default: "200")`
- `--raw - Include raw source frame payloads in JSON output`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**JSON Fields** (use `--json --fields` to select specific fields):

| Field | Type | Description |
|-------|------|-------------|
| `replayId` | string | Replay ID |
| `segmentIndex` | number | Zero-based recording segment index |
| `frameIndex` | number | Zero-based frame index within segment |
| `offsetMs` | number \| null | Milliseconds from replay start to the event |
| `timestamp` | string \| null | Event timestamp as ISO 8601 when available |
| `kind` | string | Normalized event kind |
| `category` | string | Broad event category |
| `label` | string \| null | Short event label |
| `message` | string \| null | Message or summary |
| `url` | string \| null | Current or target URL |
| `urlPath` | string \| null | Parsed URL pathname when available |
| `urlQuery` | string \| null | Parsed URL query string when available |
| `selector` | string \| null | CSS selector or target selector when available |
| `nodeId` | unknown \| null | rrweb node ID when available |
| `rawType` | string \| null | Source frame type |
| `rawSource` | string \| null | Source frame subtype |
| `data` | unknown | Kind-specific normalized fields |
| `raw` | unknown | Raw source frame, only present when requested |

### `sentry replay list <org/project>`

List recent Session Replays

**Flags:**
- `-n, --limit <value> - Number of replays (1-1000) - (default: "25")`
- `-q, --search <value> - Search query (Sentry replay search syntax)`
- `-e, --environment <value>... - Filter by environment (repeatable, comma-separated)`
- `-s, --sort <value> - Sort by: date, oldest, duration, errors, warnings, rage, dead, activity, or a raw replay sort field - (default: "date")`
- `-t, --period <value> - Time range: "7d", "2026-04-01..2026-05-01", ">=2026-04-01" - (default: "7d")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

**JSON Fields** (use `--json --fields` to select specific fields):

| Field | Type | Description |
|-------|------|-------------|
| `activity` | number \| null | Replay activity score |
| `browser` | object \| null | Browser metadata |
| `count_dead_clicks` | number \| null | Dead click count |
| `count_errors` | number \| null | Associated error count |
| `count_infos` | number \| null | Info event count |
| `count_rage_clicks` | number \| null | Rage click count |
| `count_segments` | number \| null | Recording segment count |
| `count_urls` | number \| null | Visited URL count |
| `count_warnings` | number \| null | Warning event count |
| `device` | object \| null | Device metadata |
| `dist` | string \| null | Distribution |
| `duration` | number \| null | Replay duration in seconds |
| `environment` | string \| null | Environment |
| `error_ids` | array | Linked error IDs |
| `finished_at` | string \| null | Replay finish timestamp |
| `has_viewed` | boolean \| null | Whether the current user has viewed the replay |
| `id` | string | Replay ID |
| `info_ids` | array | Linked info event IDs |
| `is_archived` | boolean \| null | Archived flag |
| `os` | object \| null | Operating system metadata |
| `ota_updates` | object \| null | OTA update metadata |
| `platform` | string \| null | Platform |
| `project_id` | string \| null | Numeric project ID |
| `releases` | array | Associated releases |
| `sdk` | object \| null | SDK metadata |
| `started_at` | string \| null | Replay start timestamp |
| `tags` | object | Replay tags |
| `trace_ids` | array | Linked trace IDs |
| `urls` | array | Visited URLs |
| `user` | object \| null | User metadata |
| `warning_ids` | array | Linked warning event IDs |

**Examples:**

```bash
# List recent replays for a project
sentry replay list my-org/frontend

# Search across all projects in an org
sentry replay list my-org/ --search "environment:production"

# Change the time window and sort
sentry replay list my-org/frontend --period 24h --sort errors

# Find recent sessions with replay search syntax
sentry replay list my-org/frontend \
  --search "url:*signup* count_errors:>0" --json

# Paginate through results
sentry replay list my-org/frontend -c next
sentry replay list my-org/frontend -c prev

# Output machine-readable data
sentry replay list my-org/frontend --json
```

### `sentry replay summarize <replay-id-or-url...>`

Summarize Session Replay behavior

**Flags:**
- `--path <value> - Focus summary on events from this URL pathname`
- `--limit-signals <value> - Maximum friction signals to include (0-50) - (default: "10")`
- `--limit-events <value> - Maximum notable events to include (0-50) - (default: "12")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**JSON Fields** (use `--json --fields` to select specific fields):

| Field | Type | Description |
|-------|------|-------------|
| `replayId` | string | Replay ID |
| `org` | string | Organization slug |
| `project` | string \| null | Project slug |
| `platform` | string \| null | Replay platform |
| `sdkName` | string \| null | Replay SDK name |
| `sdkVersion` | string \| null | Replay SDK version |
| `replayType` | string \| null | Replay type |
| `startedAt` | string \| null | Replay start time |
| `durationSeconds` | number \| null | Replay duration in seconds |
| `entryUrl` | string \| null | First replay URL |
| `exitUrl` | string \| null | Last replay URL |
| `focusPath` | string \| null | Optional route path used to focus the summary |
| `counts` | object | Normalized event counts |
| `recording` | object | Downloaded recording and parser stats |
| `timings` | object | Key timing observations |
| `routes` | array | Route timeline |
| `signals` | array | Detected non-error and error friction signals |
| `notableEvents` | array | Representative events useful for agent narrative |

**Examples:**

```bash
# Summarize route flow, event counts, timings, and friction signals
sentry replay summarize my-org/346789a703f6454384f1de473b8b9fcc --json

# Focus the summary on a particular route path
sentry replay summarize my-org/346789a703f6454384f1de473b8b9fcc \
  --path /signup --json
```

### `sentry replay view <replay-id-or-url...>`

View a Session Replay

**Flags:**
- `-w, --web - Open in browser`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**JSON Fields** (use `--json --fields` to select specific fields):

| Field | Type | Description |
|-------|------|-------------|
| `activity` | array | Summarized replay activity |
| `browser` | object \| null | Browser metadata |
| `count_dead_clicks` | number \| null | Dead click count |
| `count_errors` | number \| null | Associated error count |
| `count_infos` | number \| null | Info event count |
| `count_rage_clicks` | number \| null | Rage click count |
| `count_segments` | number \| null | Recording segment count |
| `count_urls` | number \| null | Visited URL count |
| `count_warnings` | number \| null | Warning event count |
| `device` | object \| null | Device metadata |
| `dist` | string \| null | Distribution |
| `duration` | number \| null | Replay duration in seconds |
| `environment` | string \| null | Environment |
| `error_ids` | array | Linked error IDs |
| `finished_at` | string \| null | Replay finish timestamp |
| `has_viewed` | boolean \| null | Whether the current user has viewed the replay |
| `id` | string | Replay ID |
| `info_ids` | array | Linked info event IDs |
| `is_archived` | boolean \| null | Archived flag |
| `os` | object \| null | Operating system metadata |
| `ota_updates` | object \| null | OTA update metadata |
| `platform` | string \| null | Platform |
| `project_id` | string \| null | Numeric project ID |
| `releases` | array | Associated releases |
| `sdk` | object \| null | SDK metadata |
| `started_at` | string \| null | Replay start timestamp |
| `tags` | object | Replay tags |
| `trace_ids` | array | Linked trace IDs |
| `urls` | array | Visited URLs |
| `user` | object \| null | User metadata |
| `warning_ids` | array | Linked warning event IDs |
| `clicks` | array | Replay click summaries |
| `replay_type` | string \| null | Replay type |
| `org` | string | Organization slug |
| `relatedIssues` | array | Replay-related issues |
| `relatedTraces` | array | Replay-related traces |

**Examples:**

```bash
# View a replay by ID using auto-detected org/project context
sentry replay view 346789a703f6454384f1de473b8b9fcc

# View a replay with an explicit org
sentry replay view my-org/346789a703f6454384f1de473b8b9fcc

# View a replay with explicit org/project context
sentry replay view my-org/frontend/346789a703f6454384f1de473b8b9fcc

# Open a replay in the browser
sentry replay view my-org/346789a703f6454384f1de473b8b9fcc --web
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
