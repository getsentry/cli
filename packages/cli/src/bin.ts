#!/usr/bin/env bun
import { run } from "@stricli/core";
import { app } from "./app.js";
import { buildContext } from "./context.js";
import { maybeRefreshTokenInBackground } from "./lib/token-refresh.js";

// Fire-and-forget: proactively refresh token if expiring soon
// This runs in parallel with the actual command and never blocks
maybeRefreshTokenInBackground().catch(() => {
  // Silently ignore - user will see auth error on next expired request
});

run(app, process.argv.slice(2), buildContext(process));
