import { buildRouteMap } from "../../lib/route-map.js";
import { runCommand } from "./run.js";
import { serverCommand } from "./server.js";

export const localRoute = buildRouteMap({
  routes: {
    server: serverCommand,
    run: runCommand,
  },
  defaultCommand: "server",
  docs: {
    brief: "Run a local Spotlight server for development",
    fullDescription:
      "Run a local Spotlight-compatible server to capture Sentry SDK\n" +
      "events from your dev stack.\n\n" +
      "Commands:\n" +
      "  server     Start the server and tail events (default)\n" +
      "  run        Run a command with SENTRY_SPOTLIGHT auto-injected",
  },
});
