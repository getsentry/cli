import * as Sentry from "@sentry/node";
import { eventFiltersIntegration } from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // TODO(sentry-javascript-v11): `ignoreSpans` matches every span, not only root spans. If child spans share this name, narrow it with the object form (`{ name, attributes }`)
  ignoreSpans: ["GET /health"],
  integrations: [eventFiltersIntegration()],
});
