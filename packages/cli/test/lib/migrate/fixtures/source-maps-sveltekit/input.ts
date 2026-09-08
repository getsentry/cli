import { sentrySvelteKit } from "@sentry/sveltekit";
import { sveltekit } from "@sveltejs/kit/vite";

export default {
  plugins: [
    sentrySvelteKit({
      autoUploadSourceMaps: true,
      sourceMapsUploadOptions: {
        org: "my-org",
        project: "my-project",
        url: "https://my-sentry.example.com",
        sourcemaps: {
          assets: ["./build/**/*"],
        },
      },
    }),
    sveltekit(),
  ],
};
