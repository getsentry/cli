


## Examples

```bash
# List org auth tokens
sentry token list my-org

# Create a new token
sentry token create my-org --name 'CI deploy token'

# Delete a token by ID
sentry token delete my-org 12345 --yes

# Delete a token (dry run)
sentry token delete my-org 12345 --dry-run

# Output as JSON
sentry token list --json
```
