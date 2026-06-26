// The xcode package is not typed, so we need to manually maintain this file.
// This typing is created by hand and needs to be updated when the types change.
// As most fields are from parsing Xcode project files, it is hard to tell which fields are optional.
// Therefore most fields are marked as nullable, except the ones we are certain about.

declare module "xcode" {
  interface PBXFileOptions {
    compilerFlags?: string;
    customFramework?: boolean;
    defaultEncoding?: string;
    embed?: boolean;
    explicitFileType?: string;
    group?: string;
    lastKnownFileType?: string;
    sign?: boolean;
    sourceTree?:
      | "<group>"
      | "SOURCE_ROOT"
      | "BUILT_PRODUCTS_DIR"
      | "SDKROOT"
      | "DEVELOPER_DIR"
      | string;
    weak?: boolean;
  }

  class PBXFile {
    basename?: string;
    lastKnownFileType?: string;
    group?: string;
    customFramework?: boolean;
    dirname?: string;
    path?: string;
    fileEncoding?: string;
    explicitFileType?: string;
    defaultEncoding?: string;
    sourceTree?:
      | "<group>"
      | "SOURCE_ROOT"
      | "BUILT_PRODUCTS_DIR"
      | "SDKROOT"
      | "DEVELOPER_DIR"
      | string;
    includeInIndex?: number;
    settings?: {
      ATTRIBUTES?: string[];
      COMPILER_FLAGS?: string;
    };

    constructor(filepath: string, opt?: PBXFileOptions);
  }

  export interface PBXBuildFile {
    fileRef?: string;
    fileRef_comment?: string;
    isa: "PBXBuildFile";
    productRef?: string;
    productRef_comment?: string;
    settings?: {
      ATTRIBUTES?: string[];
      COMPILER_FLAGS?: string;
    };
  }

  interface PBXWriterOptions {
    omitEmptyValues?: boolean;
  }

  class PBXWriter {
    constructor(contents: string, options: PBXWriterOptions);

    write(output: string): void;
    writeFlush(output: string): void;
    writeSync(): string;
    writeHeadComment(): void;
    writeProject(): void;
    writeObject(object: Record<string, Array | object | string | number>): void;
    writeObjectsSections(
      objects: Record<string, Array | object | string | number>
    ): void;
    writeArray(
      arr: Array<
        | {
            value?: string;
            comment?: string;
          }
        | Record<string, Array | object | string | number>
      >,
      name: string
    ): void;

    writeSectionComment(name: string, begin: boolean): void;
    writeSection(
      section: Record<string, Array | object | string | number>
    ): void;
    writeInlineObject(
      name: string,
      comment: string,
      object: Record<string, Array | object | string | number>
    ): void;
  }

  export interface PBXNativeTarget {
    buildConfigurationList?: string;
    buildConfigurationList_comment?: string;
    buildPhases?: {
      value: string;
      comment?: string;
    }[];
    buildRules?: {
      [key: string]: unknown;
    }[];
    dependencies?: {
      [key: string]: unknown;
    }[];
    fileSystemSynchronizedGroups?: {
      value: string;
      comment?: string;
    }[];
    isa: "PBXNativeTarget";
    name: string;
    packageProductDependencies?: {
      value: string;
      comment: string;
    }[];
    productName?: string;
    productReference?: string;
    productReference_comment?: string;
    productType: string;
    productType?: '"com.apple.product-type.application"' | string;
  }

  export interface XCConfigurationList {
    buildConfigurations?: {
      value: string;
      comment?: string;
    }[];
    defaultConfigurationIsVisible?: number;
    defaultConfigurationName?: string;
    isa: "XCConfigurationList";
  }

  export interface PBXGroup {
    children?: {
      value: string;
      comment?: string;
    }[];
    isa: "PBXGroup";
    path?: string;
    sourceTree?:
      | "<group>"
      | "SOURCE_ROOT"
      | "BUILT_PRODUCTS_DIR"
      | "SDKROOT"
      | "DEVELOPER_DIR"
      | string;
  }

  interface PBXCopyFilesBuildPhase {
    [key: string]: unknown;
  }

  export interface XCBuildConfiguration {
    buildSettings?: {
      [key: string]: string;
    };
    isa: "XCBuildConfiguration";
    name?: string;
  }

  export interface PBXFrameworksBuildPhase {
    buildActionMask?: number;
    files?: {
      value: string;
      comment?: string;
    }[];
    isa: "PBXFrameworksBuildPhase";
    runOnlyForDeploymentPostprocessing?: number;
  }

  interface XCRemoteSwiftPackageReference {
    isa: "XCRemoteSwiftPackageReference";
    repositoryURL: string;
    requirement: {
      kind: string;
      minimumVersion: string;
    };
  }

  interface XCSwiftPackageProductDependency {
    isa: "XCSwiftPackageProductDependency";
    package: string;
    package_comment?: string;
    productName: string;
  }

  export interface PBXShellScriptBuildPhase {
    buildActionMask?: number;
    files?: {
      value: string;
      comment?: string;
    }[];
    inputFileListPaths?: string[];
    inputPaths?: string[];
    isa: "PBXShellScriptBuildPhase";
    outputFileListPaths?: string[];
    outputPaths?: string[];
    runOnlyForDeploymentPostprocessing?: number;
    shellPath?: string;
    shellScript?: string;
  }

  export interface PBXSourcesBuildPhase {
    buildActionMask?: number;
    files?: {
      value: string;
      comment?: string;
    }[];
    isa: "PBXSourcesBuildPhase";
    runOnlyForDeploymentPostprocessing?: number;
  }

  export interface PBXFileSystemSynchronizedRootGroup {
    exceptions?: {
      value: string;
      comment?: string;
    }[];
    isa: "PBXFileSystemSynchronizedRootGroup";
    path: string;
    sourceTree:
      | "<group>"
      | "SOURCE_ROOT"
      | "BUILT_PRODUCTS_DIR"
      | "SDKROOT"
      | "DEVELOPER_DIR"
      | string;
  }

  export interface PBXFileReference {
    isa: "PBXFileReference";
    lastKnownFileType?: "sourcecode.swift" | string;
    path: string;
    sourceTree:
      | "<group>"
      | "SOURCE_ROOT"
      | "BUILT_PRODUCTS_DIR"
      | "SDKROOT"
      | "DEVELOPER_DIR"
      | string;
  }
  export interface PBXFileSystemSynchronizedBuildFileExceptionSet {
    isa: "PBXFileSystemSynchronizedBuildFileExceptionSet";
    membershipExceptions?: string[];
    target: string;
    target_comment?: string;
  }

  export interface PBXObjects {
    mainGroup: string;
    PBXBuildFile?: {
      [key: string]: PBXBuildFile | string;
    };
    PBXCopyFilesBuildPhase?: {
      [key: string]: PBXCopyFilesBuildPhase | string;
    };
    PBXFileReference?: {
      [key: string]: PBXFileReference | string;
    };
    PBXFileSystemSynchronizedBuildFileExceptionSet?: {
      [key: string]: PBXFileSystemSynchronizedBuildFileExceptionSet | string;
    };
    PBXFileSystemSynchronizedRootGroup?: {
      [key: string]: PBXFileSystemSynchronizedRootGroup | string;
    };
    PBXFrameworksBuildPhase?: {
      [key: string]: PBXFrameworksBuildPhase | string;
    };
    PBXGroup?: {
      [key: string]: PBXGroup | string;
    };
    PBXNativeTarget?: {
      [key: string]: PBXNativeTarget | string;
    };
    PBXProject?: {
      [key: string]: PBXProject | string;
    };
    PBXShellScriptBuildPhase?: {
      [key: string]: PBXShellScriptBuildPhase | string;
    };
    PBXSourcesBuildPhase?: {
      [key: string]: PBXSourcesBuildPhase | string;
    };
    packageReferences?: {
      value: string;
      comment?: string;
    }[];

    XCBuildConfiguration?: {
      [key: string]: XCBuildConfiguration | string;
    };
    /**
     * The XCConfigurationList is not always present in the project file.
     *
     * If the configuration list is not present, Xcode will declare the project as damaged.
     */
    XCConfigurationList?: {
      [key: string]: XCConfigurationList | string;
    };
    XCRemoteSwiftPackageReference?: {
      [key: string]: XCRemoteSwiftPackageReference | string;
    };
    XCSwiftPackageProductDependency?: {
      [key: string]: XCSwiftPackageProductDependency | string;
    };
  }

  export interface PBXProject {
    attributes?: {
      BuildIndependentTargetsInParallel?: number;
      LastSwiftUpdateCheck?: number;
      LastUpgradeCheck?: number;
      TargetAttributes?: {
        [key: string]: {
          CreatedOnToolsVersion?: string;
        };
      };
    };
    buildConfigurationList?: string;
    buildConfigurationList_comment?: string;
    developmentRegion?: string;
    hasScannedForEncodings?: number;
    isa: "PBXProject";
    knownRegions?: string[];
    mainGroup?: string;
    minimizedProjectReferenceProxies?: number;
    preferredProjectObjectVersion?: number;
    productRefGroup?: string;
    productRefGroup_comment?: string;
    projectDirPath?: string;
    projectRoot?: string;
    targets?: {
      value: string;
      comment?: string;
    }[];
  }

  export interface PBXResourcesBuildPhase {
    buildActionMask?: number;
    files?: {
      value: string;
      comment?: string;
    }[];
    isa: "PBXResourcesBuildPhase";
    runOnlyForDeploymentPostprocessing?: number;
  }

  export class Project extends import("events").EventEmitter {
    hash: {
      project: {
        objects: PBXObjects;
      };
    };

    filepath: string;

    constructor(filename: string);

    parse(cb: (err: Error | null) => void): void;
    parseSync(): void;

    writeSync(options?: PBXWriterOptions): string;
    allUuids(): string[];
    generateUuid(): string;

    addPluginFile(path: string, opt?: PBXFileOptions): void;
    removePluginFile(path: string, opt?: PBXFileOptions): void;

    addProductFile(targetPath: string, opt?: PBXFileOptions): void;
    removeProductFile(path: string, opt?: PBXFileOptions): void;

    addSourceFile(path: string, opt?: PBXFileOptions, group?: string): void;
    removeSourceFile(path: string, opt?: PBXFileOptions, group?: string): void;

    addHeaderFile(path: string, opt?: PBXFileOptions, group?: string): void;
    removeHeaderFile(path: string, opt?: PBXFileOptions, group?: string): void;

    addResourceFile(path: string, opt?: PBXFileOptions, group?: string): void;
    removeResourceFile(
      path: string,
      opt?: PBXFileOptions,
      group?: string
    ): void;

    addFramework(fpath: string, opt?: PBXFileOptions): void;
    removeFramework(fpath: string, opt?: PBXFileOptions): void;

    addCopyfile(fpath: string, opt?: PBXFileOptions): void;
    removeCopyfile(fpath: string, opt?: PBXFileOptions): void;

    pbxCopyfilesBuildPhaseObj(target: string): PBXObjects;
    addToPbxCopyfilesBuildPhase(file: PBXObjects): void;
    removeFromPbxCopyfilesBuildPhase(file: PBXObjects): void;

    addStaticLibrary(
      path: string,
      opt: {
        plugin?: boolean;
        target?: string;
      }
    ): void;

    addToPbxBuildFileSection(file: PBXFile): void;
    removeFromPbxBuildFileSection(file: PBXFile): void;

    addPbxGroup(
      filePathsArray: string[],
      name: string,
      path: string,
      sourceTree: string
    ): void;
    removePbxGroup(name: string): void;

    addToPbxProjectSection(target: PBXNativeTarget): void;
    addToPbxNativeTargetSection(target: PBXNativeTarget): void;
    addToPbxFileReferenceSection(file: PBXFile): void;

    removeFromPbxFileReferenceSection(file: PBXFile): void;

    addToXcVersionGroupSection(file: PBXFile): void;

    addToPluginsPbxGroup(file: PBXFile): void;
    removeFromPluginsPbxGroup(file: PBXFile): void;

    addToResourcesPbxGroup(file: PBXFile): void;
    removeFromResourcesPbxGroup(file: PBXFile): void;

    addToFrameworksPbxGroup(file: PBXFile): void;
    removeFromFrameworksPbxGroup(file: PBXFile): void;

    addToProductsPbxGroup(file: PBXFile): void;
    removeFromProductsPbxGroup(file: PBXFile): void;

    addToPbxSourcesBuildPhase(file: PBXFile): void;
    removeFromPbxSourcesBuildPhase(file: PBXFile): void;

    addToPbxResourcesBuildPhase(file: PBXFile): void;
    removeFromPbxResourcesBuildPhase(file: PBXFile): void;

    addToPbxFrameworksBuildPhase(file: PBXFile): void;
    removeFromPbxFrameworksBuildPhase(file: PBXFile): void;

    addXCConfigurationList(
      configurationObjectsArray: string[],
      defaultConfigurationName: string,
      comment: string
    ): void;

    addTargetDependency(target: string, dependencyTargets: string[]): void;

    addBuildPhase(
      filePathsArray: string[],
      buildPhaseType: "PBXShellScriptBuildPhase",
      comment: string,
      target: string | null,
      optionsOrFolderType:
        | {
            inputPaths?: string[];
            outputPaths?: string[];
            inputFileListPaths?: string[];
            outputFileListPaths?: string[];
            shellPath: string;
            shellScript: string;
          }
        | string,
      subfolderPath?: string
    ): void;

    pbxProjectSection(): PBXObjects;
    pbxBuildFileSection(): PBXObjects;
    pbxXCBuildConfigurationSection(): PBXObjects;
    pbxFileReferenceSection(): PBXObjects;
    pbxNativeTargetSection(): PBXObjects;
    xcVersionGroupSection(): PBXObjects;

    pbxXCConfigurationList(): PBXObjects;
    pbxGroupByName(name: string): PBXObjects;
    pbxTargetByName(name: string): PBXNativeTarget | undefined;
    findTargetKey(name: string): string;

    pbxItemByComment(name: string, pbxSectionName: string): PBXObjects;
    pbxSourcesBuildPhaseObj(target: string): PBXObjects;
    pbxResourcesBuildPhaseObj(target: string): PBXObjects;
    pbxFrameworksBuildPhaseObj(target: string): PBXObjects;
    pbxEmbedFrameworksBuildPhaseObj(target: string): PBXObjects;

    buildPhase(group: string, target: string): PBXObjects;
    buildPhaseObject(name: string, group: string, target: string): PBXObjects;

    addBuildProperty(prop: string, value: string, build_name: string): void;
    removeBuildProperty(prop: string, build_name: string): void;

    updateBuildProperty(
      prop: string,
      value: string,
      build: string,
      targetName: string
    ): void;

    updateProductName(name: string): void;
    removeFromFrameworkSearchPaths(file: string): void;

    addToFrameworkSearchPaths(file: string): void;
    removeFromLibrarySearchPaths(file: string): void;

    addToLibrarySearchPaths(file: string): void;
    removeFromHeaderSearchPaths(file: string): void;

    addToHeaderSearchPaths(file: string): void;
    addToOtherLinkerFlags(flag: string): void;
    removeFromOtherLinkerFlags(flag: string): void;

    addToBuildSettings(buildSetting: string, value: string): void;
    removeFromBuildSettings(buildSetting: string): void;

    readonly productName: string;

    hasFile(filePath: string): boolean;

    addTarget(
      name: string,
      type: string,
      subfolder: string,
      bundleId: string
    ): void;

    getFirstProject(): {
      uuid: string;
      firstProject: PBXObjects;
    };
    getFirstTarget(): {
      uuid: string;
      firstTarget: PBXObjects;
    } | null;
    getTarget(productType: string): {
      uuid: string;
      target: PBXObjects;
    } | null;

    addToPbxGroupType(file: string, groupKey: string, groupType: string): void;
    addToPbxVariantGroup(file: string, groupKey: string): void;
    addToPbxGroup(file: string, groupKey: string): void;

    pbxCreateGroupWithType(
      name: string,
      pathName: string,
      groupType: string
    ): void;
    pbxCreateVariantGroup(name: string): void;
    pbxCreateGroup(name: string, pathName: string): void;

    removeFromPbxGroupAndType(
      file: string,
      groupKey: string,
      groupType: string
    ): void;
    removeFromPbxGroup(file: string, groupKey: string): void;
    removeFromPbxVariantGroup(file: string, groupKey: string): void;

    getPBXGroupByKeyAndType(key: string, groupType: string): PBXObjects;
    getPBXGroupByKey(key: string): PBXObjects;
    getPBXVariantGroupByKey(key: string): PBXObjects;

    findPBXGroupKeyAndType(
      criteria: {
        path?: string;
      },
      groupType: string
    ): string;

    findPBXGroupKey(criteria: { path?: string }): string;

    findPBXVariantGroupKey(criteria: { path?: string }): string;

    addLocalizationVariantGroup(name: string): void;

    addKnownRegion(name: string): void;
    removeKnownRegion(name: string): void;

    hasKnownRegion(name: string): boolean;

    getPBXObject(name: string): PBXObjects;

    addFile(path: string, group: string, opt?: PBXFileOptions): void;
    removeFile(path: string, group: string, opt?: PBXFileOptions): void;

    getBuildProperty(prop: string, build: string, targetName: string): string;
    getBuildConfigByName(name: string): PBXObjects;

    addDataModelDocument(
      filePath: string,
      group: string,
      opt?: PBXFileOptions
    ): void;
    addTargetAttribute(prop: string, value: string, target: string): void;
    removeTargetAttribute(prop: string, target: string): void;
  }

  export const project: (filename: string) => Project;

  export default {
    project,
  };
}

declare module "xcode/lib/parser/pbxproj" {
  import type { Project } from "xcode";
  export function parse(content: string): Project["hash"];
}
