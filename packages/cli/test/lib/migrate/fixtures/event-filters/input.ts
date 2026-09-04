import * as Sentry from "@sentry/browser";
import { inboundFiltersIntegration } from "@sentry/browser";

Sentry.init({
  dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
  integrations: (integrations) =>
    integrations.filter((integration) => integration.name !== "InboundFilters"),
});

const filters = inboundFiltersIntegration({ ignoreErrors: ["boom"] });
const other = Sentry.inboundFiltersIntegration();
