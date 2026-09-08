import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  _experiments: {
    enableMetrics: true,
    beforeSendMetric: (metric) => {
      return metric;
    },
  },
});
