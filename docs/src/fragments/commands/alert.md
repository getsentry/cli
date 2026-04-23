

## Examples

### List issue alert rules

```bash
# List issue alert rules for a project
sentry alert issues list my-org/my-project

# Filter rules by name
sentry alert issues list my-org/my-project --query "spike"
```

### View an issue alert rule

```bash
# View by ID
sentry alert issues view my-org/my-project/12345

# View by name
sentry alert issues view my-org/my-project/"Error Spike"
```

### List metric alert rules

```bash
# List metric alert rules for an organization
sentry alert metrics list my-org/
```

### View a metric alert rule

```bash
# View by ID
sentry alert metrics view my-org/67890

# View by name
sentry alert metrics view my-org/"P95 latency alert"
```
