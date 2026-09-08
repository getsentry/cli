import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // TODO(sentry-javascript-v11): `sendDefaultPii: true` matched the v11 `dataCollection` default, so the option was removed. Set `dataCollection` explicitly if you want to narrow what is collected.
});
