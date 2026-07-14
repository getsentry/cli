import SentryCli from "sentry";
// TODO(sentry-v4): verify these v3 options — they have no direct v4 SDK equivalent: apiKey, silent (e.g. apiKey → use `token`; url/dsn/org/project → SENTRY_* env vars; silent/customHeader/vcsRemote were dropped)
const cli = SentryCli({ apiKey: process.env.KEY, silent: true });
