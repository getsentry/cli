## Examples

```bash
# Read-only health check
sentry doctor

# Machine-readable report (every result, including passes)
sentry doctor --json

# Send a test event and confirm ingest (a write)
sentry doctor --send-test-event
```

`--json` is this run's results (`id`, `status`, `detail`, optional `evidence` / `remediation`) plus `capture` and `server`. It is not a catalog of what each check means.

`skip` = could not tell. `warn` never fails the run. Only `fail` exits 1.

## Checks

### Server (what Sentry knows)

| Check | Means |
|---|---|
| `dsn.present` | A DSN exists somewhere in the project |
| `dsn.placeholder` | That DSN is not the docs example |
| `dsn.conflict` | More than one distinct DSN — events may split |
| `dsn.resolves` | The DSN maps to a project you can access |
| `project.first_event` | That project has received at least one event, ever |
| `project.last_event` | Recent activity (warns if last issue is >30 days old) |
| `project.key_active` | This DSN's key still exists and is enabled |
| `project.environments` | Events are tagged with an environment |
| `release.attribution` | Events are tied to a release |
| `artifacts.uploaded` | Source maps / debug files exist on the project |

### Local (what the repo says)

| Check | Means |
|---|---|
| `init.present` | An init call (or platform auto-init) exists |
| `config.dsn_set` | That init actually sets a DSN |
| `config.environment` | `environment` is set (else local + prod mix) |
| `config.debug` | `debug: true` is not hardcoded on |
| `config.sample_rate` | Trace sample rate isn't 0 or 1.0 |
| `build.upload_configured` | A bundler / dSYM / Proguard upload plugin is present |
| `capture.complete` | Doctor finished scanning the tree |

### Opt-in / extra

| Check | Means |
|---|---|
| `live.roundtrip` | `--send-test-event`: ingest accepted it, and (if DSN resolved) search found it |
| `judge.*` | LLM pass over captured config; skip if no model |
