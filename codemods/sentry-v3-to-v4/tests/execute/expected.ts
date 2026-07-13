import SentryCli from "sentry";
const cli = SentryCli();
// TODO(sentry-v4): run(...) passes raw CLI args verbatim; remap v3 command names to v4 (releases→release, new→create, login→auth login, …) and verify flags
await cli.run("releases", "new", version);
