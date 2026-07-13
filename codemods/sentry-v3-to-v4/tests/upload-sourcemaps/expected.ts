import SentryCli from "sentry";
const cli = SentryCli();
// TODO(sentry-v4): sourcemaps are debug-ID-first: map `include` → the `directory` positional and review options
await cli.sourcemap.upload({ release: "1.0.0", include: ["./dist"] });
