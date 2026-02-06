import { buildRouteMap } from "@stricli/core";
import { loginCommand } from "./login.js";
import { logoutCommand } from "./logout.js";
import { refreshCommand } from "./refresh.js";
import { statusCommand } from "./status.js";
import { tokenCommand } from "./token.js";

export const authRoute = buildRouteMap({
  routes: {
    login: loginCommand,
    logout: logoutCommand,
    refresh: refreshCommand,
    status: statusCommand,
    token: tokenCommand,
  },
  docs: {
    brief: "Authenticate with Sentry",
    fullDescription:
      "Manage authentication with Sentry. Use 'sentry auth login' to authenticate, " +
      "'sentry auth logout' to remove credentials, 'sentry auth refresh' to manually refresh your token, " +
      "'sentry auth status' to check your authentication status, " +
      "and 'sentry auth token' to print your token for use in scripts.",
  },
});
