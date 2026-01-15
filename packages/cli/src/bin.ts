#!/usr/bin/env bun
import { run } from "@stricli/core";
import { app } from "./app.js";
import { buildContext } from "./context.js";
import { maybeRefreshTokenInBackground } from "./lib/token-refresh.js";

// Fire-and-forget: proactively refresh token if expiring soon
// Runs in parallel with the command, never throws, never blocks
maybeRefreshTokenInBackground();

run(app, process.argv.slice(2), buildContext(process));
