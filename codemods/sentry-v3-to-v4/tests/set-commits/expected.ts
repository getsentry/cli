import SentryCli from "sentry";
const cli = SentryCli();
// TODO(sentry-v4): verify set-commits options (repo/commit/auto → commit/auto/local)
await cli.release["set-commits"]({ orgVersion: "1.0.0", auto: true });
