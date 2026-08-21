import { init } from "@sentry/node";
// TODO(sentry-javascript-v11): `@sentry/node-core` was removed. Move this to `@sentry/node`, but check that the `/light` subpath exists there
import { setTag } from "@sentry/node-core/light";

init({ dsn: process.env.SENTRY_DSN });
setTag("a", "b");
