/**
 * Workaround for a Bun single-file-binary issue where TTY fds inherited via
 * shell redirection (e.g. `curl | bash` → `exec "$sentry_bin" init </dev/tty`
 * in install.sh) report as TTYs and accept `setRawMode(true)` but never
 * deliver keypress events. A freshly-opened `/dev/tty` fd from inside the
 * process works correctly — so we open one and forward its data events onto
 * the existing `process.stdin` object that clack has already captured via
 * `import { stdin } from "node:process"`.
 *
 * We patch `process.stdin` in place rather than replacing it because
 * `Object.defineProperty(process, "stdin", ...)` does not propagate to the
 * `node:process` ESM binding (clack's `stdin` import is a snapshot of the
 * original object). But the original `process.stdin` object IS the same
 * reference clack holds, so patching listeners + setRawMode on it reaches
 * clack transparently.
 */

import { openSync } from "node:fs";
import { isatty, ReadStream } from "node:tty";

/**
 * Mutable subset of `process.stdin` that the TTY-forwarding workaround
 * temporarily patches while the init wizard is running.
 */
type StdinHandle = {
  setRawMode: (mode: boolean) => NodeJS.ReadStream;
  pause: () => NodeJS.ReadStream;
  resume: () => NodeJS.ReadStream;
  _read: (size: number) => void;
};

/**
 * State captured when the init wizard installs fresh `/dev/tty` forwarding.
 * Stored so teardown can release the temporary TTY handle and restore
 * `process.stdin` to its original behavior.
 */
type InstalledState = {
  fresh: ReadStream;
  dataListener: (chunk: Buffer) => void;
  errorListener: () => void;
  original: {
    setRawMode: StdinHandle["setRawMode"];
    pause: StdinHandle["pause"];
    resume: StdinHandle["resume"];
    read: StdinHandle["_read"];
  };
  backfilledIsTty: boolean;
};

let installedState: InstalledState | null = null;

/**
 * Open a fresh `/dev/tty` fd and wire it up to feed `process.stdin`'s event
 * listeners. Returns `true` if the forwarding was installed, `false` if
 * there's no TTY available or `/dev/tty` can't be opened.
 *
 * Safe to call unconditionally at interactive-command entry: if `isatty(0)`
 * is false we skip (non-interactive piped input should stay as-is so
 * `--yes`/non-TTY guards keep working). Idempotent — repeated calls after
 * the first successful install are no-ops, so callers don't duplicate the
 * data listener (which would cause clack to receive each keystroke twice)
 * or leak additional `/dev/tty` fds.
 */
export function forwardFreshTtyToStdin(): boolean {
  if (installedState) {
    return true;
  }
  if (!isatty(0)) {
    return false;
  }

  let fd: number;
  try {
    fd = openSync("/dev/tty", "r");
  } catch {
    return false;
  }

  const fresh = new ReadStream(fd);
  const stdinHandle = process.stdin as unknown as StdinHandle;
  const original = {
    setRawMode: stdinHandle.setRawMode,
    pause: stdinHandle.pause,
    resume: stdinHandle.resume,
    read: stdinHandle._read,
  };

  // Bun's compiled binary can leave `process.stdin.isTTY === undefined` on
  // inherited-via-redirect fds even when `isatty(0)` is true. Clack gates
  // its internal `setRawMode(true)` call on `input.isTTY`, so without this
  // backfill the patched setRawMode below is never invoked and the fresh
  // fd stays in canonical mode (line-buffered, no keypresses).
  let backfilledIsTty = false;
  if (process.stdin.isTTY === undefined) {
    (process.stdin as { isTTY?: boolean }).isTTY = true;
    backfilledIsTty = true;
  }

  // Forward keystrokes from the working fd onto process.stdin so any
  // listeners clack attaches (readline's 'data', emitKeypressEvents'
  // 'keypress') fire as expected.
  const dataListener = (chunk: Buffer): void => {
    process.stdin.emit("data", chunk);
  };
  fresh.on("data", dataListener);

  // A ReadStream without an `error` listener crashes the process when it
  // emits (e.g. terminal disconnected, SSH dropped). The wizard can't
  // recover from a dead TTY, so silently drop — the next operation that
  // actually needs input will fail with a more meaningful error.
  const errorListener = (): void => {
    // intentionally empty
  };
  fresh.on("error", errorListener);

  // setRawMode issues a TCSETS ioctl on the underlying TTY device. The device
  // is shared between the broken fd 0 and the fresh fd, but the broken fd's
  // ioctl path may be the root cause — so route raw-mode toggles through the
  // fresh fd, which we know works.
  stdinHandle.setRawMode = (mode: boolean): NodeJS.ReadStream => {
    fresh.setRawMode(mode);
    return process.stdin;
  };

  // Prevent the stream machinery from touching the broken fd. Clack closes
  // each prompt with `input.unpipe()` and opens the next one by attaching
  // new listeners — that triggers Readable's `pause()`/`resume()` hooks,
  // which on Bun call kqueue against fd 0 and fail with EINVAL on the
  // second transition. We deliver bytes via `emit('data', …)` from the
  // fresh fd, so the fd-level flow machinery is dead weight here.
  const noop = (): NodeJS.ReadStream => process.stdin;
  stdinHandle.pause = noop;
  stdinHandle.resume = noop;
  stdinHandle._read = (_size: number): void => {
    // intentionally empty — see comment above
  };

  // Put the fresh stream into flowing mode so the OS delivers bytes to it and
  // our 'data' handler fires.
  fresh.resume();

  installedState = {
    fresh,
    dataListener,
    errorListener,
    original,
    backfilledIsTty,
  };

  return true;
}

/**
 * Tear down the fresh `/dev/tty` forwarding installed by
 * {@link forwardFreshTtyToStdin}.
 *
 * Must be safe on every wizard exit path, including when forwarding was never
 * installed. Destroying the temporary `ReadStream` releases the TTY handle so
 * the process can exit naturally once the wizard is done.
 */
export function closeFreshTtyForwarding(): void {
  if (!installedState) {
    return;
  }

  const { fresh, dataListener, errorListener, original, backfilledIsTty } =
    installedState;
  installedState = null;

  fresh.off("data", dataListener);
  fresh.off("error", errorListener);
  // Pause before destroy so no queued read callback tries to deliver bytes
  // after the stream has been torn down.
  fresh.pause();
  fresh.destroy();

  const stdinHandle = process.stdin as unknown as StdinHandle;
  stdinHandle.setRawMode = original.setRawMode;
  stdinHandle.pause = original.pause;
  stdinHandle.resume = original.resume;
  stdinHandle._read = original.read;

  if (backfilledIsTty) {
    (process.stdin as { isTTY?: boolean }).isTTY = undefined;
  }
}
