

## Examples

### Top errors (default)

```bash
# Top errors in the last 24 hours, scoped to a project
sentry explore my-org/cli

# All projects in an org
sentry explore my-org/

# Bare project slug (searches across orgs)
sentry explore cli

# Auto-detect from DSN/config
sentry explore
```

### Spike analysis

```bash
# Errors with user impact for a specific UTC window
sentry explore my-org/cli -F title -F "count()" -F "count_unique(user)" \
  --period "2024-01-15T00:00:00Z/2024-01-16T00:00:00Z"

# Filter by specific error type (combines with auto-injected project filter)
sentry explore my-org/cli -F title -F "count()" \
  -q "error.type:TypeError" --period 1h
```

### Transaction queries

```bash
# Transaction p50/p95 by endpoint
sentry explore my-org/cli -F transaction \
  -F "p50(transaction.duration)" -F "p95(transaction.duration)" \
  --dataset transactions --period 1h

# Slowest transactions
sentry explore my-org/cli -F transaction -F "avg(transaction.duration)" \
  --dataset transactions
```

### Span queries

```bash
# Span operations by count
sentry explore my-org/cli -F span.op -F "count()" \
  --dataset spans --period 1h

# Sort by count (sort is supported on spans dataset)
sentry explore my-org/cli -F span.op -F "count()" \
  --dataset spans --sort "-count()"
```

### JSON output for scripting

```bash
# Pipe to jq for filtering
sentry explore my-org/cli -F title -F "count()" --json | jq '.data[:5]'

# Get raw data for analysis
sentry explore my-org/cli -F title -F "count()" -F "count_unique(user)" \
  --json --limit 100
```

## Target Patterns

| Target | Behavior |
|--------|----------|
| `<org>/<project>` | Auto-adds `project:<slug>` to query |
| `<org>/` | All projects in org (no project filter) |
| `<project>` | Searches for project across all accessible orgs |
| (omitted) | Auto-detect from DSN/config |
