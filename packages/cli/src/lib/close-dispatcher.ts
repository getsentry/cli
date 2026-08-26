/**
 * Node's global `fetch` (undici) keeps a pool of keep-alive sockets open after
 * a command finishes its work. Those sockets keep the event loop referenced,
 * so the process lingers instead of exiting on its own (see #1237).
 *
 * Closing the global dispatcher releases the pooled sockets, letting the loop
 * drain naturally. This is the root-cause complement to the force-exit timer,
 * which stays armed as a last-resort backstop.
 */
const GLOBAL_DISPATCHER = Symbol.for("undici.globalDispatcher.1");

type ClosableDispatcher = { close?: () => Promise<void> };

export function closeGlobalDispatcher(): Promise<void> {
  const dispatcher = (globalThis as Record<PropertyKey, unknown>)[
    GLOBAL_DISPATCHER
  ] as ClosableDispatcher | undefined;

  return dispatcher?.close?.() ?? Promise.resolve();
}
