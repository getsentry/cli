import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = resolve(docsRoot, "dist");
const indexHtml = await readFile(resolve(distRoot, "index.html"), "utf8");
const stylesheetHrefs = [...indexHtml.matchAll(/href="([^"]+\.css)"/g)].map(
  ([, href]) => href
);

for (const href of stylesheetHrefs) {
  const pathname = new URL(href, "https://cli.sentry.dev").pathname;
  const assetsMarker = "/_astro/";
  const markerIndex = pathname.indexOf(assetsMarker);
  if (markerIndex === -1) {
    continue;
  }

  const assetPath = resolve(distRoot, pathname.slice(markerIndex + 1));
  const stylesheet = await readFile(assetPath, "utf8");
  const hasScopedInstallBox = stylesheet.includes(".install-box:where(.astro-");
  const hasScopedDropdown = stylesheet.includes(".dropdown-menu:where(.astro-");
  if (hasScopedInstallBox && hasScopedDropdown) {
    process.exit(0);
  }
}

throw new Error(
  "The landing page does not link its generated styles. Check the Astro/Vite version compatibility."
);
