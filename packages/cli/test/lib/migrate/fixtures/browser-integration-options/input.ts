import * as Sentry from "@sentry/browser";

Sentry.init({
  dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
  integrations: [
    Sentry.browserTracingIntegration({
      ignorePerformanceApiSpans: ["third-party-mark"],
      trackFetchStreamPerformance: true,
      _experiments: {
        enableStandaloneClsSpans: true,
      },
    }),
    Sentry.breadcrumbsIntegration({ console: true }),
  ],
});
