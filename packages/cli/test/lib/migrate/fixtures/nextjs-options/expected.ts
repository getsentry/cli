import { withSentryConfig } from "@sentry/nextjs";

export default withSentryConfig(
  { reactStrictMode: true },
  {
    org: "my-org",
    webpack: {
      autoInstrumentServerFunctions: false,
      excludeServerRoutes: ["/api/health"],
    },
    // TODO(sentry-javascript-v11): `disableLogger` replaced by `webpack.treeshake.removeDebugLogging`, which nests differently, so move it by hand
    disableLogger: true,
    project: "my-project",
  }
);
