import { createClient } from "@hey-api/openapi-ts";

createClient({
  input:
    "https://raw.githubusercontent.com/getsentry/sentry-api-schema/refs/heads/main/openapi-derefed.json",
  output: "src/client",
});
