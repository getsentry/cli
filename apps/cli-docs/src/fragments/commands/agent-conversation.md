


## Examples

### List conversations

```bash
# List recent agent conversations
sentry agent-conversation list

# Explicit organization (all projects)
sentry agent-conversation list my-org/

# One project
sentry agent-conversation list my-org/my-project

# Find a project across organizations
sentry agent-conversation list my-project

# Show more, last 24 hours
sentry agent-conversation list --limit 50 --period 24h

# Filter conversations
sentry agent-conversation list -q "has:errors"

# Paginate through project results
sentry agent-conversation list my-org/my-project -c next
```

### View a conversation transcript

```bash
# View full transcript (org auto-detected)
sentry agent-conversation view conv-123

# Explicit org (slash-separated)
sentry agent-conversation view my-org/conv-123

# JSON output
sentry agent-conversation view my-org/conv-123 --json
```
