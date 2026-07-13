import SentryCli from "sentry";
const cli = SentryCli();
// TODO(sentry-v4): release.deploy: fold env/name into the positional (org/version/env/name via `orgVersionEnvironmentName`); re-add url/started/finished/time from your v3 options — v4 has no `env`/`name` option keys
await cli.release.deploy({ orgVersionEnvironmentName: "1.0.0" });
