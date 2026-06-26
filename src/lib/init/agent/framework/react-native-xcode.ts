/**
 * Patches a bare React Native project.pbxproj for Sentry: wraps the
 * "Bundle React Native code and images" phase with sentry-xcode.sh and adds an
 * "Upload Debug Symbols to Sentry" build phase. Ported verbatim from the
 * retired server step (steps/shared/react-native-xcode.ts).
 *
 * Returns the rewritten file content, or null when this is not a bare RN
 * project, Expo is detected, both patches already exist, or on any error.
 */

import type { PBXNativeTarget } from "xcode";
import parser from "xcode/lib/parser/pbxproj";
import PBXWriter from "./pbxWriter.vendor.mjs";

const RN_BUNDLE_PHASE_DETECT_RE = /\/(react-native|sentry)-xcode\.sh/i;
const RN_XCODE_SCRIPT_RE = /\/scripts\/react-native-xcode\.sh/i;
const SENTRY_DEBUG_UPLOAD_RE = /sentry-cli\s+(upload-dsym|debug-files upload)/i;
const EXPO_DETECT_RE = /\bexpo\b/i;

function generateUuid(): string {
  return crypto.randomUUID().replace(/-/g, "").toUpperCase().slice(0, 24);
}

function writeSync(hash: ReturnType<typeof parser.parse>): string {
  const writer = new PBXWriter(hash);
  return writer.writeSync();
}

function patchBundlePhaseScript(phase: Record<string, unknown>): boolean {
  const rawScript = phase.shellScript as string | undefined;
  if (!rawScript?.match(RN_XCODE_SCRIPT_RE)) {
    return false;
  }

  const parsed = JSON.parse(rawScript) as string;
  const patched = parsed
    .replaceAll("REACT_NATIVE_XCODE", "SENTRY_XCODE")
    .replace(
      "react-native/scripts/react-native-xcode.sh",
      "@sentry/react-native/scripts/sentry-xcode.sh"
    )
    .replace(
      "$REACT_NATIVE_PATH/scripts/react-native-xcode.sh",
      "$REACT_NATIVE_PATH/../@sentry/react-native/scripts/sentry-xcode.sh"
    );

  phase.shellScript = JSON.stringify(patched);
  return true;
}

function addDebugSymbolsPhase(
  shellScriptPhases: Record<string, unknown>,
  nativeTargets: Record<string, unknown>
): void {
  const debugPhaseUUID = generateUuid();

  shellScriptPhases[debugPhaseUUID] = {
    isa: "PBXShellScriptBuildPhase",
    buildActionMask: 2_147_483_647,
    files: [],
    inputFileListPaths: [],
    inputPaths: [],
    outputFileListPaths: [],
    outputPaths: [],
    runOnlyForDeploymentPostprocessing: 0,
    shellPath: "/bin/sh",
    shellScript: JSON.stringify(
      "/bin/sh ../node_modules/@sentry/react-native/scripts/sentry-xcode-debug-files.sh\n"
    ),
    name: '"Upload Debug Symbols to Sentry"',
  };
  shellScriptPhases[`${debugPhaseUUID}_comment`] =
    "Upload Debug Symbols to Sentry";

  for (const [key, target] of Object.entries(nativeTargets)) {
    if (key.endsWith("_comment") || typeof target === "string") {
      continue;
    }
    const t = target as PBXNativeTarget;
    if (t.productType !== '"com.apple.product-type.application"') {
      continue;
    }
    if (!t.buildPhases) {
      t.buildPhases = [];
    }
    t.buildPhases.push({
      value: debugPhaseUUID,
      comment: "Upload Debug Symbols to Sentry",
    });
  }
}

function isDebugUploadScript(rawScript: string | undefined): boolean {
  if (!rawScript) {
    return false;
  }
  let content = rawScript;
  try {
    content = JSON.parse(rawScript) as string;
  } catch {
    // fall back to the raw form for the includes() check
  }
  return (
    content.includes("sentry-xcode-debug-files.sh") ||
    SENTRY_DEBUG_UPLOAD_RE.test(content)
  );
}

function isDebugPhaseWiredToTarget(
  shellScriptPhases: Record<string, unknown>,
  nativeTargets: Record<string, unknown>
): boolean {
  const sentryDebugUUIDs = new Set<string>();

  for (const [key, val] of Object.entries(shellScriptPhases)) {
    if (key.endsWith("_comment")) {
      continue;
    }
    const phase = val as unknown as Record<string, unknown>;
    if (!phase.isa) {
      continue;
    }
    if (isDebugUploadScript(phase.shellScript as string | undefined)) {
      sentryDebugUUIDs.add(key);
    }
  }

  if (sentryDebugUUIDs.size === 0) {
    return false;
  }

  for (const [key, target] of Object.entries(nativeTargets)) {
    if (key.endsWith("_comment") || typeof target === "string") {
      continue;
    }
    const t = target as PBXNativeTarget;
    if (t.productType !== '"com.apple.product-type.application"') {
      continue;
    }
    if (t.buildPhases?.some((phase) => sentryDebugUUIDs.has(phase.value))) {
      return true;
    }
  }

  return false;
}

/** Returns the rewritten project.pbxproj content, or null if no change/not applicable. */
export function patchReactNativeXcode(pbxprojContent: string): string | null {
  try {
    const hash = parser.parse(pbxprojContent);
    const objects = hash.project.objects;
    const shellScriptPhases = objects.PBXShellScriptBuildPhase ?? {};
    const nativeTargets = objects.PBXNativeTarget ?? {};

    let bundlePhase: Record<string, unknown> | null = null;
    for (const [key, val] of Object.entries(shellScriptPhases)) {
      const phase = val as unknown as Record<string, unknown>;
      if (key.endsWith("_comment") || !phase.isa) {
        continue;
      }
      const rawScript = phase.shellScript as string | undefined;
      if (rawScript?.match(RN_BUNDLE_PHASE_DETECT_RE)) {
        bundlePhase = phase;
        break;
      }
    }

    if (!bundlePhase) {
      return null;
    }

    const parsedBundleScript = JSON.parse(
      bundlePhase.shellScript as string
    ) as string;
    if (EXPO_DETECT_RE.test(parsedBundleScript)) {
      return null;
    }

    let anythingChanged = false;

    if (patchBundlePhaseScript(bundlePhase)) {
      anythingChanged = true;
    }

    if (!isDebugPhaseWiredToTarget(shellScriptPhases, nativeTargets)) {
      addDebugSymbolsPhase(shellScriptPhases, nativeTargets);
      anythingChanged = true;
    }

    if (!anythingChanged) {
      return null;
    }

    return writeSync(hash);
  } catch (err) {
    console.warn("[react-native-xcode] Failed to modify project.pbxproj:", err);
    return null;
  }
}
