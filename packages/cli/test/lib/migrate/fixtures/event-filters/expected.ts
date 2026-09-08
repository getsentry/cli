import * as Sentry from "@sentry/browser";
import { eventFiltersIntegration } from "@sentry/browser";

Sentry.init({
  dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
  integrations: (integrations) =>
    integrations.filter((integration) => integration.name !== "EventFilters"),
});

const filters = eventFiltersIntegration({ ignoreErrors: ["boom"] });
const other = Sentry.eventFiltersIntegration();
