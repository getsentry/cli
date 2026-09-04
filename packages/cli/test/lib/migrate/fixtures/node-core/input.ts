import { init } from "@sentry/node-core";
import { setTag } from "@sentry/node-core/light";

init({ dsn: process.env.SENTRY_DSN });
setTag("a", "b");
