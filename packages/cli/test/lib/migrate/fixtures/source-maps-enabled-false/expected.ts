import { sentryReactRouter } from "@sentry/react-router";

export const config = sentryReactRouter({
  // TODO(sentry-javascript-v11): `sourceMapsUploadOptions` was removed: move these to the top level, and replace `enabled` with `sourcemaps: { disable: … }` (the sense is inverted)
  sourceMapsUploadOptions: {
    enabled: false,
    org: "my-org",
  },
});
