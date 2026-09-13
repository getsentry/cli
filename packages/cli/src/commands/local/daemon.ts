/**
 * Durable discovery state for the singleton Local control-plane daemon.
 *
 * Telemetry never lives here: this file only lets independently invoked CLI
 * processes authenticate to the currently running loopback daemon.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import type { Server } from "node:http";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { getConfigDir } from "../../lib/db/index.js";
import { logger } from "../../lib/logger.js";
import {
  CONTROL_PLANE_PREFIX,
  createLocalControlPlane,
} from "./control-plane.js";
import { DEFAULT_PORT, isLoopbackHost, tryListen } from "./server.js";

export const LOCAL_DAEMON_STATE_FILENAME = "local-control-plane.json";
export const LOCAL_DAEMON_PROTOCOL_VERSION = 1;
export const LOCAL_DAEMON_IDLE_GRACE_MS = 30_000;

export type LocalDaemonState = {
  readonly host: string;
  readonly pid: number;
  readonly port: number;
  readonly token: string;
  readonly version: number;
};

export type LocalDaemonSession = {
  readonly cwd: string;
  readonly id: string;
  readonly ingestUrl: string;
  readonly label: string;
  readonly streamUrl: string;
};

function statePath(directory: string): string {
  return join(directory, LOCAL_DAEMON_STATE_FILENAME);
}

function startupLockPath(directory: string): string {
  return join(directory, "local-control-plane.lock");
}

function shutdownServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

/** Read daemon discovery metadata, treating absent or malformed files as stale. */
export async function readLocalDaemonState(
  directory: string
): Promise<LocalDaemonState | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(statePath(directory), "utf8")
    ) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as LocalDaemonState).host !== "string" ||
      typeof (parsed as LocalDaemonState).pid !== "number" ||
      typeof (parsed as LocalDaemonState).port !== "number" ||
      typeof (parsed as LocalDaemonState).token !== "string" ||
      typeof (parsed as LocalDaemonState).version !== "number"
    ) {
      return;
    }
    return parsed as LocalDaemonState;
  } catch (error) {
    logger.debug("Could not read Local daemon state", error);
    return;
  }
}

/** Atomically persist the current daemon's discovery state with owner-only access. */
export async function writeLocalDaemonState(
  directory: string,
  state: LocalDaemonState
): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = statePath(directory);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(temporaryPath, 0o600).catch((error: unknown) => {
    logger.debug("Could not protect Local daemon state", error);
  });
  await rename(temporaryPath, path);
  await chmod(path, 0o600).catch((error: unknown) => {
    logger.debug("Could not protect Local daemon state", error);
  });
}

/** Remove discovery state after a clean shutdown or stale-daemon recovery. */
export async function removeLocalDaemonState(directory: string): Promise<void> {
  await rm(statePath(directory), { force: true });
}

function daemonBaseUrl(state: LocalDaemonState): string {
  const host = state.host.includes(":") ? `[${state.host}]` : state.host;
  return `http://${host}:${state.port}`;
}

async function daemonResponds(state: LocalDaemonState): Promise<boolean> {
  try {
    const response = await fetch(`${daemonBaseUrl(state)}/health`, {
      signal: AbortSignal.timeout(500),
    });
    return response.ok;
  } catch (error) {
    logger.debug("Local daemon health check failed", error);
    return false;
  }
}

/** Return a usable daemon state, removing stale discovery information first. */
export async function getRunningLocalDaemon(): Promise<
  LocalDaemonState | undefined
> {
  const directory = getConfigDir();
  const state = await readLocalDaemonState(directory);
  if (!state) {
    return;
  }
  if (
    state.version !== LOCAL_DAEMON_PROTOCOL_VERSION ||
    !(await daemonResponds(state))
  ) {
    await removeLocalDaemonState(directory);
    return;
  }
  return state;
}

/** Start the daemon child and wait until its authenticated discovery state is available. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: startup locking must cover spawn and recovery together.
export async function ensureLocalDaemon({
  host = "localhost",
  port = DEFAULT_PORT,
}: {
  host?: string;
  port?: number;
} = {}): Promise<LocalDaemonState> {
  if (!isLoopbackHost(host)) {
    throw new Error("The Local control-plane host must be loopback-only.");
  }
  if (port === 0) {
    throw new Error("The Local control-plane port must be non-zero.");
  }
  const running = await getRunningLocalDaemon();
  if (running) {
    return running;
  }
  const directory = getConfigDir();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  try {
    lock = await open(startupLockPath(directory), "wx", 0o600);
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error) ||
      error.code !== "EEXIST"
    ) {
      throw error;
    }
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await sleep(125);
      const state = await getRunningLocalDaemon();
      if (state) {
        return state;
      }
    }
    await removeLocalDaemonState(directory);
    await rm(startupLockPath(directory), { force: true });
    return ensureLocalDaemon({ host, port });
  }
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    await lock.close();
    await rm(startupLockPath(directory), { force: true });
    throw new Error(
      "Could not determine the Sentry CLI entrypoint for Local daemon startup."
    );
  }
  try {
    const child: ChildProcess = spawn(
      process.execPath,
      [
        ...process.execArgv,
        entrypoint,
        "local",
        "daemon",
        "start",
        "--foreground",
        "--host",
        host,
        "--port",
        String(port),
      ],
      { detached: true, env: process.env, stdio: "ignore" }
    );
    child.unref();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await sleep(125);
      const state = await getRunningLocalDaemon();
      if (state) {
        return state;
      }
    }
  } finally {
    await lock.close();
    await rm(startupLockPath(directory), { force: true });
  }
  throw new Error("Timed out while starting the Sentry Local control plane.");
}

/** Run the daemon until an explicit control-plane stop request or process signal arrives. */
export async function runLocalDaemonForeground({
  host = "localhost",
  port = DEFAULT_PORT,
}: {
  host?: string;
  port?: number;
} = {}): Promise<void> {
  if (!isLoopbackHost(host)) {
    throw new Error("The Local control-plane host must be loopback-only.");
  }
  const directory = getConfigDir();
  const token = randomBytes(32).toString("base64url");
  let stop: (() => void) | undefined;
  const stopRequested = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const controlPlane = createLocalControlPlane({
    controlToken: token,
    host,
    port,
    onStop: () => stop?.(),
  });
  const listening = await tryListen(controlPlane.app, port, host);
  const state: LocalDaemonState = {
    host,
    pid: process.pid,
    port: listening.port,
    token,
    version: LOCAL_DAEMON_PROTOCOL_VERSION,
  };
  await writeLocalDaemonState(directory, state);

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const pruneSessions = () => {
    controlPlane.sessionStore.pruneExpired();
    if (controlPlane.sessionStore.list().length > 0) {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
      return;
    }
    idleTimer ??= setTimeout(() => {
      if (controlPlane.sessionStore.list().length === 0) {
        stop?.();
      }
    }, LOCAL_DAEMON_IDLE_GRACE_MS);
  };
  const pruneTimer = setInterval(pruneSessions, 60_000);
  pruneSessions();

  const onSignal = () => stop?.();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    await stopRequested;
  } finally {
    clearInterval(pruneTimer);
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
    }
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await shutdownServer(listening.server);
    await removeLocalDaemonState(directory);
  }
}

/** Call an authenticated Local daemon endpoint. */
export function requestLocalDaemon(
  state: LocalDaemonState,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${state.token}`);
  return fetch(`${daemonBaseUrl(state)}${CONTROL_PLANE_PREFIX}${path}`, {
    ...init,
    headers,
  });
}

/** Create a session and return its separate ingestion and read capabilities. */
export async function createLocalDaemonSession({
  clientId,
  cwd,
  host,
  label,
  port,
}: {
  readonly clientId?: string;
  readonly cwd: string;
  readonly host?: string;
  readonly label: string;
  readonly port?: number;
}): Promise<LocalDaemonSession> {
  const state = await ensureLocalDaemon({ host, port });
  const response = await requestLocalDaemon(state, "/sessions", {
    body: JSON.stringify({ clientId, cwd, label }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `Could not create Local session (HTTP ${response.status}).`
    );
  }
  return (await response.json()) as LocalDaemonSession;
}

/** Release a foreground session lease while retaining telemetry for queries. */
export async function retainLocalDaemonSession(
  sessionId: string
): Promise<void> {
  const state = await getRunningLocalDaemon();
  if (!state) {
    return;
  }
  await requestLocalDaemon(
    state,
    `/sessions/${encodeURIComponent(sessionId)}/close`,
    {
      method: "POST",
    }
  );
}
