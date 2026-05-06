
## Examples

### List replays

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

### View a replay

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

### Summarize behavior

```bash
# Summarize route flow, event counts, timings, and friction signals
sentry replay summarize my-org/346789a703f6454384f1de473b8b9fcc --json

# Focus the summary on a particular route path
sentry replay summarize my-org/346789a703f6454384f1de473b8b9fcc \
  --path /signup --json
```

### Inspect replay events

```bash
# List normalized replay events for agent-readable inspection
sentry replay events my-org/346789a703f6454384f1de473b8b9fcc --json

# Focus on user actions and failures on a page
sentry replay events my-org/346789a703f6454384f1de473b8b9fcc \
  /signup --kind click,network,console,error --json

# Pull an evidence window around a timestamp
sentry replay events my-org/346789a703f6454384f1de473b8b9fcc \
  --around 01:23 --json
```
