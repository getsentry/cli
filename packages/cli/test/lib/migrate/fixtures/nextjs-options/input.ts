import { withSentryConfig } from "@sentry/nextjs";

export default withSentryConfig(
  { reactStrictMode: true },
  {
    org: "my-org",
    autoInstrumentServerFunctions: false,
    excludeServerRoutes: ["/api/health"],
    disableLogger: true,
    project: "my-project",
  }
);
