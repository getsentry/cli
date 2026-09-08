import { instrumentOpenAiClient } from "@sentry/server-utils";
import { setTag } from "@sentry/core";
import { addVercelAiProcessors } from "@sentry/server-utils";
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
});

setTag("ai", "yes");
export const client = instrumentOpenAiClient({});
addVercelAiProcessors();
