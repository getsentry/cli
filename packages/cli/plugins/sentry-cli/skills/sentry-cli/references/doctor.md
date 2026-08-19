---
name: sentry-cli-doctor
version: 0.43.0-dev.0
description: Check whether Sentry is correctly set up and actually working
requires:
  bins: ["sentry"]
  auth: true
---

# Doctor Commands

Check whether Sentry is correctly set up and actually working

### `sentry doctor`

Run a health check against an existing Sentry installation. Doctor scans the
project's source files, queries the Sentry API, and reports what is configured,
what is broken, and what to fix. It never modifies files.

**Flags:**
- `--send-test-event - Send a synthetic event to the configured DSN and confirm it arrives`
- `--fix - After reporting, run the setup wizard in dry-run mode to produce a fix plan`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.

**Examples:**

```bash
# Basic health check
sentry doctor

# JSON output for programmatic consumption
sentry doctor --json

# Verify end-to-end event delivery
sentry doctor --send-test-event

# Health check + dry-run fix plan
sentry doctor --fix

# Pipe JSON to a file for support
sentry doctor --json > sentry-doctor-report.json
```

**Exit codes:**
- `0` — all checks passed or were skipped (healthy)
- `1` — at least one check failed (action needed)

Warnings never cause exit code 1.

### Check IDs

Each result carries an `id` that names what was checked. Use these to
understand what doctor found and what action to take.

**Tier 1 — Server truth** (requires API access; skipped when offline):

| ID | What it checks |
|---|---|
| `dsn.present` | At least one DSN was found in the project |
| `dsn.placeholder` | The DSN is not a placeholder / example value |
| `dsn.conflict` | Only one distinct DSN is configured (no split traffic) |
| `dsn.resolves` | The DSN matches a real project you can access |
| `project.first_event` | The project has received at least one event |
| `project.last_event` | An event arrived recently (not stale) |
| `project.key_active` | The DSN's client key is enabled |
| `project.environments` | The project has environment data |
| `release.attribution` | A release is associated with the project |
| `artifacts.uploaded` | Source maps or debug files have been uploaded |

**Tier 2 — Local / ecosystem** (runs offline from captured source):

| ID | What it checks |
|---|---|
| `init.present` | A `Sentry.init()` call (or equivalent) exists |
| `config.dsn_set` | The init call sets a DSN |
| `config.environment` | The init call sets an environment |
| `config.debug` | Debug mode is not left on |
| `config.sample_rate` | Trace sample rate is set and reasonable |
| `build.upload_configured` | Build plugin is configured for artifact upload |
| `capture.complete` | The file scan was not truncated |

**Tier 3 — LLM judgement** (requires `ANTHROPIC_API_KEY`; skipped otherwise):

| ID | What it checks |
|---|---|
| `judge.*` | Configuration patterns the rule-based checks do not cover |
| `judge.handoff` | Skipped: an agent is present and can read the report directly |
| `judge.unavailable` | Skipped: no API key available |

**Live check** (only with `--send-test-event`):

| ID | What it checks |
|---|---|
| `live.roundtrip` | A test event was sent and confirmed in Sentry's search index |

### JSON output

`sentry doctor --json` outputs a `DoctorReport` object:

```json
{
  "schema_version": 1,
  "cli_version": "0.43.0",
  "timestamp": "2026-08-19T10:00:00.000Z",
  "elapsed_ms": 1234,
  "results": [
    {
      "id": "dsn.present",
      "status": "pass",
      "detail": "DSN found in src/instrument.ts"
    },
    {
      "id": "config.sample_rate",
      "status": "warn",
      "detail": "tracesSampleRate is 1.0 — full tracing in production may be expensive",
      "evidence": [{"file": "src/instrument.ts", "line": 5}],
      "remediation": "Set tracesSampleRate to a value between 0 and 1 for production."
    }
  ],
  "capture": { ... },
  "server": { ... }
}
```

Each result has:
- `id` — the check ID from the tables above
- `status` — `"pass"`, `"fail"`, `"warn"`, or `"skip"`
- `detail` — human-readable explanation
- `evidence` (optional) — `[{file, line?}]` pointing to the relevant source
- `remediation` (optional) — what to do about a failure

**For agents:** use `--json`, read `results`, act on entries where
`status === "fail"`. The `remediation` field contains actionable instructions.
Entries with `status === "skip"` mean the check could not run (reason in
`detail`) — they are not failures.
