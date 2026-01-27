import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

// Allow base path override via environment variable for PR previews
const base = process.env.DOCS_BASE_PATH || "/cli";

export default defineConfig({
  site: "https://getsentry.github.io",
  base,
  integrations: [
    starlight({
      title: "Sentry CLI",
      favicon: "/favicon.png",
      logo: {
        src: "./src/assets/logo.svg",
        replacesTitle: true,
      },
      social: {
        github: "https://github.com/getsentry/cli",
      },
      expressiveCode: {
        themes: ["github-dark"],
        styleOverrides: {
          frames: {
            frameBoxShadowCssValue: "none",
            editorActiveTabIndicatorTopColor: "transparent",
            editorActiveTabIndicatorBottomColor: "transparent",
            editorTabBarBorderBottomColor: "transparent",
            editorTabBarBackground: "transparent",
            terminalTitlebarBorderBottomColor: "transparent",
            terminalTitlebarBackground: "rgba(255, 255, 255, 0.03)",
            terminalBackground: "#0a0a0f",
          },
          borderRadius: "12px",
          borderColor: "rgba(255, 255, 255, 0.1)",
          codeBackground: "#0a0a0f",
        },
      },
      components: {
        Header: "./src/components/Header.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
      },
      head: [
        // Force dark mode - runs before page renders
        {
          tag: "script",
          content: `document.documentElement.dataset.theme = 'dark';`,
        },
        // Add fonts
        {
          tag: "link",
          attrs: {
            rel: "preconnect",
            href: "https://fonts.googleapis.com",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "preconnect",
            href: "https://fonts.gstatic.com",
            crossorigin: true,
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
          },
        },
      ],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "" },
            { label: "Installation", slug: "getting-started" },
          ],
        },
        {
          label: "Commands",
          autogenerate: { directory: "commands" },
        },
        {
          label: "Resources",
          items: [{ label: "Contributing", slug: "contributing" }],
        },
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
