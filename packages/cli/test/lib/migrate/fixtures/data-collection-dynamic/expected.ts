import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // TODO(sentry-javascript-v11): `sendDefaultPii` was replaced by `dataCollection`. Pick the per-category controls that match this value
  sendDefaultPii: process.env.NODE_ENV !== "production",
});
