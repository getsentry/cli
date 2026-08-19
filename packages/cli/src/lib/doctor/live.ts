import type { Capture, CheckResult, ServerFacts } from "./types.js";

export async function liveRoundtripCheck(
  _capture: Capture,
  _server: ServerFacts
): Promise<CheckResult> {
  await Promise.resolve();
  return {
    id: "live.roundtrip",
    status: "skip",
    detail: "Live round-trip is not implemented yet.",
  };
}
