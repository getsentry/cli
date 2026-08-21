import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enableLogs: true,
  tracesSampleRate: 1.0,
});

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  _experiments: {
    enableLogs: true,
  },
});
