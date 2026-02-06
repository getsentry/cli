import { buildRouteMap } from "@stricli/core";
import { bundleJvmCommand } from "./bundle-jvm.js";
import { bundleSourcesCommand } from "./bundle-sources.js";
import { checkCommand } from "./check.js";
import { findCommand } from "./find.js";
import { printSourcesCommand } from "./print-sources.js";
import { uploadCommand } from "./upload.js";

export const debugFilesRoute = buildRouteMap({
  routes: {
    upload: uploadCommand,
    check: checkCommand,
    find: findCommand,
    "bundle-sources": bundleSourcesCommand,
    "bundle-jvm": bundleJvmCommand,
    "print-sources": printSourcesCommand,
  },
  docs: {
    brief: "Locate, analyze or upload debug information files",
    fullDescription:
      "Locate, analyze or upload debug information files.\n\n" +
      "Commands:\n" +
      "  upload          Upload debug information files\n" +
      "  check           Check debug files for issues\n" +
      "  find            Find debug information files\n" +
      "  bundle-sources  Bundle source files\n" +
      "  bundle-jvm      Bundle JVM debug files\n" +
      "  print-sources   Print embedded source files",
    hideRoute: {},
  },
});
