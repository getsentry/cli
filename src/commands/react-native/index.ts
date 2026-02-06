import { buildRouteMap } from "@stricli/core";
import { gradleCommand } from "./gradle.js";
import { xcodeCommand } from "./xcode.js";

export const reactNativeRoute = buildRouteMap({
  routes: {
    gradle: gradleCommand,
    xcode: xcodeCommand,
  },
  docs: {
    brief: "Upload build artifacts for React Native projects",
    fullDescription:
      "Upload build artifacts for React Native projects.\n\n" +
      "Commands:\n" +
      "  gradle  Upload Android build artifacts\n" +
      "  xcode   Upload iOS build artifacts (macOS only)",
    hideRoute: {},
  },
});
