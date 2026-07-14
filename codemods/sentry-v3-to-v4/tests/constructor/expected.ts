import SentryCli from "sentry";
// TODO(sentry-v4): verify these v3 options — they have no direct v4 SDK equivalent: org (e.g. apiKey → use `token`; url/dsn/org/project → SENTRY_* env vars; silent/customHeader/vcsRemote were dropped)
const cli = SentryCli({ token: process.env.T, org: "acme" });
