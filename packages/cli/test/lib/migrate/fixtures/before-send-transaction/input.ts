import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  sendDefaultPii: true,
  beforeSendTransaction: (event) => {
    if (event.transaction === "GET /internal") {
      return null;
    }
    return event;
  },
});
