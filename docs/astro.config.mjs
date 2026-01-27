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
        PageTitle: "./src/components/PageTitle.astro",
      },
      head: [
        // Force dark mode - runs before page renders
        {
          tag: "script",
          content: `document.documentElement.dataset.theme = 'dark';`,
        },
        // Overscroll easter egg - bottom of page, only on /cli route
        {
          tag: "script",
          content: `
            (function() {
              let overscrollEl;
              let pullDistance = 0;
              let touchStartY = 0;
              let isAtBottom = false;
              
              function isLandingPage() {
                const path = window.location.pathname;
                return path === '/cli' || path === '/cli/';
              }
              
              function checkAtBottom() {
                const scrollTop = window.scrollY || document.documentElement.scrollTop;
                const scrollHeight = document.documentElement.scrollHeight;
                const clientHeight = document.documentElement.clientHeight;
                return scrollTop + clientHeight >= scrollHeight - 5;
              }
              
              function createOverscrollMessage() {
                if (!isLandingPage()) return;
                overscrollEl = document.createElement('div');
                overscrollEl.className = 'overscroll-message';
                overscrollEl.innerHTML = '<span>You made it to the end. Might as well give it a try → <code>npx sentry@latest</code></span>';
                document.body.appendChild(overscrollEl);
              }
              
              function updateOverscroll(distance) {
                if (!overscrollEl) return;
                const clampedDistance = Math.min(Math.max(distance, 0), 50);
                const opacity = Math.min(clampedDistance / 15, 1);
                const translateY = Math.min(clampedDistance * 2.5, 120);
                overscrollEl.style.opacity = opacity;
                overscrollEl.style.transform = 'translateX(-50%) translateY(-' + translateY + 'px)';
              }
              
              function handleTouchStart(e) {
                if (!isLandingPage()) return;
                touchStartY = e.touches[0].clientY;
                isAtBottom = checkAtBottom();
              }
              
              function handleTouchMove(e) {
                if (!isLandingPage() || !isAtBottom) return;
                const touchY = e.touches[0].clientY;
                pullDistance = touchStartY - touchY;
                if (pullDistance > 0 && checkAtBottom()) {
                  updateOverscroll(pullDistance);
                }
              }
              
              function handleTouchEnd() {
                pullDistance = 0;
                updateOverscroll(0);
              }
              
              function handleWheel(e) {
                if (!isLandingPage()) return;
                if (checkAtBottom() && e.deltaY > 0) {
                  pullDistance = Math.min(pullDistance + e.deltaY * 0.8, 50);
                  updateOverscroll(pullDistance);
                  clearTimeout(window.overscrollTimeout);
                  window.overscrollTimeout = setTimeout(function() {
                    pullDistance = 0;
                    updateOverscroll(0);
                  }, 300);
                }
              }
              
              document.addEventListener('DOMContentLoaded', function() {
                createOverscrollMessage();
                document.addEventListener('touchstart', handleTouchStart, { passive: true });
                document.addEventListener('touchmove', handleTouchMove, { passive: true });
                document.addEventListener('touchend', handleTouchEnd, { passive: true });
                document.addEventListener('wheel', handleWheel, { passive: true });
              });
            })();
          `,
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
