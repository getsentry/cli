import { instrumentOpenAiClient, setTag } from "@sentry/core";
import { addVercelAiProcessors } from "@sentry/core";
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enableTruncation: false,
  streamGenAiSpans: true,
});

setTag("ai", "yes");
export const client = instrumentOpenAiClient({});
addVercelAiProcessors();
