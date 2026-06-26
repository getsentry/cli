/**
 * Adds the sentry-cocoa Swift Package Manager dependency to an Xcode
 * project.pbxproj. Ported verbatim from the retired server step
 * (steps/shared/ios-spm.ts): editing a .pbxproj by hand is fragile, so this
 * deterministic transform parses and rewrites it with the `xcode` parser and a
 * vendored writer. Returns the new file content, or null when sentry-cocoa is
 * already present (idempotent) or on any parse error.
 */

import type { PBXFrameworksBuildPhase, PBXNativeTarget } from "xcode";
import parser from "xcode/lib/parser/pbxproj";
import PBXWriter from "./pbxWriter.vendor.mjs";

function generateUuid(): string {
  return crypto.randomUUID().replace(/-/g, "").toUpperCase().slice(0, 24);
}

function writeSync(hash: ReturnType<typeof parser.parse>): string {
  const writer = new PBXWriter(hash);
  return writer.writeSync();
}

/** Returns the rewritten project.pbxproj content, or null if no change/parse error. */
export function buildPbxprojCodemod(
  pbxprojContent: string,
  pbxprojRelativePath: string
): { content: string; filePath: string } | null {
  if (
    pbxprojContent.includes("sentry-cocoa") ||
    pbxprojContent.includes("Sentry in Frameworks")
  ) {
    return null;
  }

  try {
    const hash = parser.parse(pbxprojContent);
    const objects = hash.project.objects;

    const fwUUID = generateUuid();
    const depUUID = generateUuid();
    const pkgUUID = generateUuid();

    if (!objects.PBXBuildFile) {
      objects.PBXBuildFile = {};
    }
    objects.PBXBuildFile[fwUUID] = {
      isa: "PBXBuildFile",
      productRef: depUUID,
      productRef_comment: "Sentry",
    };
    objects.PBXBuildFile[`${fwUUID}_comment`] = "Sentry in Frameworks";

    if (!objects.PBXFrameworksBuildPhase) {
      objects.PBXFrameworksBuildPhase = {};
    }
    for (const [key, phase] of Object.entries(
      objects.PBXFrameworksBuildPhase
    )) {
      if (key.endsWith("_comment") || typeof phase === "string") {
        continue;
      }
      const p = phase as PBXFrameworksBuildPhase;
      if (!p.files) {
        p.files = [];
      }
      p.files.push({ value: fwUUID, comment: "Sentry in Frameworks" });
    }

    if (!objects.PBXNativeTarget) {
      objects.PBXNativeTarget = {};
    }
    for (const [key, target] of Object.entries(objects.PBXNativeTarget)) {
      if (key.endsWith("_comment") || typeof target === "string") {
        continue;
      }
      const t = target as PBXNativeTarget;
      if (t.productType !== '"com.apple.product-type.application"') {
        continue;
      }
      if (!t.packageProductDependencies) {
        t.packageProductDependencies = [];
      }
      t.packageProductDependencies.push({ value: depUUID, comment: "Sentry" });
    }

    const pbxProject = objects.PBXProject ?? {};
    const projectKey = Object.keys(pbxProject).find(
      (k) => !k.endsWith("_comment")
    );
    if (!projectKey) {
      throw new Error("PBXProject section not found in pbxproj");
    }
    const xcProject = pbxProject[projectKey] as {
      packageReferences?: { value: string; comment: string }[];
    };
    if (!xcProject.packageReferences) {
      xcProject.packageReferences = [];
    }
    xcProject.packageReferences.push({
      value: pkgUUID,
      comment: 'XCRemoteSwiftPackageReference "sentry-cocoa"',
    });

    if (!objects.XCRemoteSwiftPackageReference) {
      objects.XCRemoteSwiftPackageReference = {};
    }
    objects.XCRemoteSwiftPackageReference[pkgUUID] = {
      isa: "XCRemoteSwiftPackageReference",
      repositoryURL: '"https://github.com/getsentry/sentry-cocoa/"',
      requirement: {
        kind: "upToNextMajorVersion",
        minimumVersion: "8.0.0",
      },
    };
    objects.XCRemoteSwiftPackageReference[`${pkgUUID}_comment`] =
      'XCRemoteSwiftPackageReference "sentry-cocoa"';

    if (!objects.XCSwiftPackageProductDependency) {
      objects.XCSwiftPackageProductDependency = {};
    }
    objects.XCSwiftPackageProductDependency[depUUID] = {
      isa: "XCSwiftPackageProductDependency",
      package: pkgUUID,
      package_comment: 'XCRemoteSwiftPackageReference "sentry-cocoa"',
      productName: "Sentry",
    };
    objects.XCSwiftPackageProductDependency[`${depUUID}_comment`] = "Sentry";

    return { content: writeSync(hash), filePath: pbxprojRelativePath };
  } catch (err) {
    console.warn("[ios-spm] Failed to modify project.pbxproj:", err);
    return null;
  }
}
