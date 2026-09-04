import * as Sentry from "@sentry/cloudflare";

export async function query(env) {
  const db = env.DB;
  return await db.prepare("SELECT 1").all();
}

export const MyDO = Sentry.instrumentDurableObjectWithSentry(
  (env) => ({
    dsn: env.SENTRY_DSN,
    enableRpcTracePropagation: true,
  }),
  class {}
);
