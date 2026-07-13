import SentryCli from "sentry";
const cli = SentryCli();
// TODO(sentry-v4): release.deploy: move env/name into the positional target (org/version/env/name) — they are NOT options; url/started/finished/time stay as options
await cli.release.deploy({ orgVersionEnvironmentName: "1.0.0", env: "prod", url: "https://x" });
