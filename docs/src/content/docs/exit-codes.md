---
title: Exit Codes
description: Exit code reference for scripting and automation with the Sentry CLI
---

The CLI uses semantic exit codes so scripts, CI pipelines, and AI agents can
react to failure categories without parsing stderr.

## Exit Code Ranges

| Range | Category | Description |
|-------|----------|-------------|
| 0 | Success | Command completed successfully |
| 1 | General | Unexpected or unclassified error |
| 10–19 | Auth | Authentication and authorization failures |
| 20–29 | Input | Configuration, validation, and resolution errors |
| 30–39 | API | Sentry API and network errors |
| 40–49 | Feature | Feature availability and billing issues |
| 50–59 | Operations | Upgrade and OAuth flow errors |
| 60–69 | Command | Command-specific non-standard exits |

## Complete Reference

| Code | Name | Description |
|------|------|-------------|
| 0 | Success | Command completed successfully |
| 1 | General Error | Unexpected error or unclassified failure |
| 10 | Not Authenticated | No credentials found — run `sentry auth login` |
| 11 | Token Expired | Auth token expired — re-authenticate |
| 12 | Token Invalid | Auth token rejected by the server |
| 13 | Host Scope | Request blocked — credentials don't match the target host |
| 20 | Config Error | Configuration or DSN problem |
| 21 | Validation Error | Invalid input (malformed ID, bad flag value, etc.) |
| 22 | Missing Context | Required context (org, project) could not be determined |
| 23 | Not Found | A user-provided identifier could not be resolved |
| 30 | API Error | Sentry API returned an error response |
| 31 | Timeout | Operation exceeded its time limit |
| 40 | Seer Not Enabled | Seer is not enabled for the organization |
| 41 | Seer No Budget | Seer requires a paid plan |
| 42 | AI Disabled | AI features disabled by organization admin |
| 50 | Upgrade Error | CLI upgrade operation failed |
| 51 | Device Flow Error | OAuth device authorization flow failed |
| 60 | Output Error | Command produced output but the operation failed |
| 61 | Wizard Error | Interactive setup wizard encountered an error |

## Scripting Examples

### Bash

```bash
sentry issue list my-org/
code=$?

case $code in
  0)   echo "Success" ;;
  1?)  echo "Auth problem (code $code) — run: sentry auth login" ;;
  2?)  echo "Input/config problem (code $code)" ;;
  3?)  echo "API/network error (code $code)" ;;
  4?)  echo "Feature not available (code $code)" ;;
  *)   echo "Failed with exit code $code" ;;
esac
```

### Python

```python
import subprocess

result = subprocess.run(["sentry", "issue", "list", "my-org/"], capture_output=True)

if result.returncode == 0:
    print("Success")
elif 10 <= result.returncode <= 19:
    print("Auth error — run: sentry auth login")
elif 20 <= result.returncode <= 29:
    print("Input/config error")
elif result.returncode == 30:
    print("API error")
```

## Notes

- Exit codes below 128 are safe from collision with Unix signal exits (128+N).
- The `sentry init` wizard uses its own exit codes (10, 20, 30, 50) for
  remote workflow step failures. These are internal to the wizard and wrapped
  into exit code 61 (Wizard Error) before reaching the process exit.
- [Stricli](https://bloomberg.github.io/stricli/) (the CLI framework) uses
  negative exit codes (-5 to -1) for framework-level errors like unknown
  commands or invalid arguments. These appear as 251–255 in unsigned form.
