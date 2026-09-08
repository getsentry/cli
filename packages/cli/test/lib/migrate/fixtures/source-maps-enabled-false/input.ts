import { sentryReactRouter } from "@sentry/react-router";

export const config = sentryReactRouter({
  sourceMapsUploadOptions: {
    enabled: false,
    org: "my-org",
  },
});
