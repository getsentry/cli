import * as Sentry from "@sentry/node";

Sentry.init({
  beforeSendMetric: (metric) => {
    return metric;
  },
  dsn: process.env.SENTRY_DSN,
});
