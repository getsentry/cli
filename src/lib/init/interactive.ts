/**
 * Interactive Dispatcher
 *
 * Handles interactive prompts from the remote workflow.
 * Supports select, multi-select, and confirm prompts.
 * Respects --yes flag for non-interactive mode.
 */

import type { WizardOptions, InteractivePayload } from "./types.js";

export async function handleInteractive(
  payload: InteractivePayload,
  options: WizardOptions,
): Promise<Record<string, unknown>> {
  const { kind } = payload;

  switch (kind) {
    case "select":
      return handleSelect(payload, options);
    case "multi-select":
      return handleMultiSelect(payload, options);
    case "confirm":
      return handleConfirm(payload, options);
    default:
      return { cancelled: true };
  }
}

async function handleSelect(
  payload: InteractivePayload,
  options: WizardOptions,
): Promise<Record<string, unknown>> {
  const apps = (payload.apps as Array<{ name: string; path: string; framework?: string }>) ?? [];
  const items = (payload.options as string[]) ?? apps.map((a) => a.name);

  if (items.length === 0) {
    return { cancelled: true };
  }

  // --yes: auto-pick if exactly one option
  if (options.yes) {
    if (items.length === 1) {
      return { selectedApp: items[0] };
    }
    options.stderr.write(
      "Error: --yes requires exactly one option for selection, but found " +
        `${items.length}. Run interactively to choose.\n`,
    );
    return { cancelled: true };
  }

  options.stdout.write(`\n${payload.prompt}\n`);
  for (let i = 0; i < items.length; i++) {
    const app = apps[i];
    const extra = app?.framework ? ` (${app.framework})` : "";
    options.stdout.write(`  ${i + 1}. ${items[i]}${extra}\n`);
  }

  const answer = await readLine(options, `Choose [1-${items.length}]: `);
  const idx = Number.parseInt(answer.trim(), 10) - 1;

  if (idx >= 0 && idx < items.length) {
    return { selectedApp: items[idx] };
  }

  options.stderr.write("Invalid selection.\n");
  return { cancelled: true };
}

async function handleMultiSelect(
  payload: InteractivePayload,
  options: WizardOptions,
): Promise<Record<string, unknown>> {
  const available =
    (payload.availableFeatures as string[]) ??
    (payload.options as string[]) ??
    [];

  if (available.length === 0) {
    return { features: [] };
  }

  // --yes: select all available features
  if (options.yes) {
    return { features: available };
  }

  options.stdout.write(`\n${payload.prompt}\n`);
  for (let i = 0; i < available.length; i++) {
    options.stdout.write(`  ${i + 1}. ${available[i]}\n`);
  }

  const answer = await readLine(
    options,
    `Choose (comma-separated, or "all") [1-${available.length}]: `,
  );

  if (answer.trim().toLowerCase() === "all") {
    return { features: available };
  }

  const indices = answer
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10) - 1)
    .filter((i) => i >= 0 && i < available.length);

  const selected = [...new Set(indices.map((i) => available[i]))];
  return { features: selected };
}

async function handleConfirm(
  payload: InteractivePayload,
  options: WizardOptions,
): Promise<Record<string, unknown>> {
  // --yes: auto-confirm
  if (options.yes) {
    // For "add example trigger" → default to true
    // For "verification issues" → default to continue
    if (payload.prompt.includes("example")) {
      return { addExample: true };
    }
    return { action: "continue" };
  }

  options.stdout.write(`\n${payload.prompt} [Y/n] `);

  const answer = await readLine(options, "");
  const confirmed =
    answer.trim() === "" ||
    answer.trim().toLowerCase() === "y" ||
    answer.trim().toLowerCase() === "yes";

  // Determine which field to set based on the prompt
  if (payload.prompt.includes("example")) {
    return { addExample: confirmed };
  }
  return { action: confirmed ? "continue" : "stop" };
}

function readLine(
  options: WizardOptions,
  prompt: string,
): Promise<string> {
  return new Promise((resolve) => {
    if (prompt) {
      options.stdout.write(prompt);
    }

    const { stdin } = options;
    const wasRaw = stdin.isRaw;

    // Handle piped stdin (non-TTY)
    if (!stdin.isTTY) {
      let data = "";
      const onData = (chunk: Buffer) => {
        data += chunk.toString();
        if (data.includes("\n")) {
          stdin.removeListener("data", onData);
          resolve(data.split("\n")[0] ?? "");
        }
      };
      stdin.on("data", onData);
      stdin.resume();
      return;
    }

    // TTY mode: read a line
    stdin.setRawMode?.(false);
    stdin.resume();
    stdin.setEncoding("utf-8");

    const onData = (chunk: string) => {
      stdin.removeListener("data", onData);
      stdin.pause();
      if (wasRaw !== undefined) stdin.setRawMode?.(wasRaw);
      resolve(chunk.trim());
    };

    stdin.once("data", onData);
  });
}
