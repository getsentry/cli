import * as Sentry from "@sentry/astro";

Sentry.init({
  dsn: "https://2aca5fe97c71868bc3aa7fb48620dc39@o1.ingest.us.sentry.io/4510798755856384",
  sendDefaultPii: true,
  enableLogs: true,
  tracesSampleRate: 1.0,
  // Enable in all environments (including development)
  enabled: true,
});
