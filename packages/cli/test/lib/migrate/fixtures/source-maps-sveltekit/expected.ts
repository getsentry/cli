import { sentrySvelteKit } from "@sentry/sveltekit/vite";
import { sveltekit } from "@sveltejs/kit/vite";

export default {
  plugins: [
    sentrySvelteKit({
      autoUploadSourceMaps: true,
      org: "my-org",
      project: "my-project",
      sentryUrl: "https://my-sentry.example.com",
      sourcemaps: {
        assets: ["./build/**/*"],
      },
    }),
    sveltekit(),
  ],
};
