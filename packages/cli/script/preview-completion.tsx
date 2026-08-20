/**
 * Preview the interactive completion (exit) screen without running the whole
 * wizard. Renders the Ink `App` in the completion state with sample data and
 * prints the settled frame.
 *
 *   pnpm exec tsx script/preview-completion.tsx            # "not yet verified"
 *   pnpm exec tsx script/preview-completion.tsx --verified # "first event received"
 */

import { Readable, Writable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { render } from "ink";
import { createElement } from "react";
import { App } from "../src/lib/init/ui/ink-app.js";
import type { WizardCompletion } from "../src/lib/init/ui/types.js";
import { WizardStore } from "../src/lib/init/ui/wizard-store.js";

const verified = process.argv.includes("--verified");
const columns = 100;
const rows = 32;

const completion: WizardCompletion = {
  projectName: "my-app",
  features: ["Errors", "Tracing", "Session Replay"],
  featureBlurbs: [
    {
      label: "Error Monitoring",
      blurb: "Captures unhandled exceptions as they happen.",
    },
    {
      label: "Tracing",
      blurb: "Measures how long each request and query takes.",
    },
    {
      label: "Session Replay",
      blurb: "Records sessions so you can watch a bug unfold.",
    },
  ],
  changedFileCount: 4,
  issuesUrl: "https://acme.sentry.io/issues/?project=4507",
  verification: verified
    ? {
        received: true,
        eventUrl: "https://acme.sentry.io/issues/?query=event.id:a1b2c3d4",
      }
    : { received: false },
  mcp: {
    url: "https://mcp.sentry.dev/mcp/acme/my-app",
    orgSlug: "acme",
    projectSlug: "my-app",
  },
  agentInstallCommand: "npx @sentry/ai install",
  startCommand: "pnpm dev",
  projectDir: "/tmp/my-app",
};

const store = new WizardStore({
  layout: "workflow",
  cliVersion: "1.2.3",
  summary: { fields: [], completion },
  outroState: {
    kind: "success",
    message: "Sentry SDK installed successfully!",
    dismiss: () => {
      /* preview only */
    },
    actions: {
      openUrl: () => {
        /* preview only */
      },
      writeMcpConfig: () => Promise.resolve(true),
    },
  },
});

class CaptureStream extends Writable {
  frames: string[] = [];
  columns = columns;
  rows = rows;
  isTTY = true;
  _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this.frames.push(chunk.toString());
    cb();
  }
}

function makeStdin(): Readable {
  const s = new Readable({
    read() {
      // pull-driven; nothing to push
    },
  });
  Object.assign(s, {
    isTTY: true,
    setRawMode: () => s,
    resume: () => s,
    pause: () => s,
    ref: () => s,
    unref: () => s,
  });
  return s;
}

const out = new CaptureStream();
const instance = render(createElement(App, { store }), {
  stdout: out as unknown as NodeJS.WriteStream,
  stderr: out as unknown as NodeJS.WriteStream,
  stdin: makeStdin() as unknown as NodeJS.ReadStream,
  patchConsole: false,
  exitOnCtrlC: false,
});

await sleep(150);
// Print the last redraw frame verbatim (ANSI intact so colours show).
const all = out.frames.join("");
const CURSOR_TO_LINE_START = "[G";
const start = all.lastIndexOf(CURSOR_TO_LINE_START);
process.stdout.write(start === -1 ? all : all.slice(start));
process.stdout.write("\n");
instance.unmount();
process.exit(0);
