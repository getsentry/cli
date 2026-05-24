


## Examples

### List conversations

```bash
# List last 10 AI conversations
sentry ai-conversations list

# Explicit organization
sentry ai-conversations list my-org

# Show more, last 24 hours
sentry ai-conversations list --limit 50 --period 24h

# Filter conversations
sentry ai-conversations list -q "has:errors"

# Paginate through results
sentry ai-conversations list my-org -c next
```

### View a conversation transcript

```bash
# View full transcript
sentry ai-conversations view my-org conv-123

# JSON output
sentry ai-conversations view my-org conv-123 --json
```
