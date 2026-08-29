// car-extract — decode an iOS Assets.car into per-rendition PNGs via CoreUI.
//
// CoreUI (CUICatalog/CUINamedImage) is a private macOS framework, so it is
// resolved dynamically at runtime through the Objective-C runtime rather than
// linked against a private SDK. If CoreUI can't be loaded, or the catalog can't
// be opened, the tool exits non-zero and the CLI falls back to the pure-TS
// size-only manifest.
//
// Usage: car-extract <input.car> <output-dir>
// stdout: {"images":[{"name","file","width","height","scale","bytes"}, ...]}

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// One decoded rendition, serialized into the JSON manifest.
struct DecodedImage: Encodable {
  let name: String
  let file: String
  let width: Int
  let height: Int
  let scale: Int
  let bytes: Int
}

struct Manifest: Encodable {
  let images: [DecodedImage]
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("car-extract: \(message)\n".utf8))
  exit(1)
}

let args = CommandLine.arguments
guard args.count == 3 else {
  fail("usage: car-extract <input.car> <output-dir>")
}
let catalogPath = args[1]
let outputDir = args[2]

try? FileManager.default.createDirectory(
  atPath: outputDir, withIntermediateDirectories: true)

// CoreUI is a private framework, so it isn't linked at build time and its
// classes aren't registered in the process until the dylib is loaded.
// dlopen it first; NSClassFromString only finds already-registered classes and
// would otherwise return nil even on a system that has CoreUI.
let coreUIPaths = [
  "/System/Library/PrivateFrameworks/CoreUI.framework/CoreUI",
  "/System/Library/PrivateFrameworks/CoreUI.framework/Versions/A/CoreUI",
]
if !coreUIPaths.contains(where: { dlopen($0, RTLD_LAZY) != nil }) {
  fail("could not load the CoreUI private framework")
}

// CUICatalog(URL:error:) opens the catalog; allImageNames() lists renditions;
// imagesWithName: returns CUINamedImage instances (one per scale/idiom).
guard let catalogClass = NSClassFromString("CUICatalog") as? NSObject.Type else {
  fail("CoreUI (CUICatalog) is unavailable on this system")
}

let catalogURL = URL(fileURLWithPath: catalogPath)
let catalog = catalogClass.init()
let initSelector = NSSelectorFromString("initWithURL:error:")
guard catalog.responds(to: initSelector) else {
  fail("CUICatalog does not respond to initWithURL:error:")
}

// Invoke -[CUICatalog initWithURL:error:] via NSInvocation-free perform. The
// private API returns a freshly-initialized catalog or nil on error.
typealias InitFn = @convention(c) (NSObject, Selector, NSURL, UnsafeMutableRawPointer?) -> NSObject?
let initImp = catalog.method(for: initSelector)
let initCall = unsafeBitCast(initImp, to: InitFn.self)
guard let openedCatalog = initCall(catalog, initSelector, catalogURL as NSURL, nil) else {
  fail("could not open asset catalog at \(catalogPath)")
}

let allNamesSelector = NSSelectorFromString("allImageNames")
guard openedCatalog.responds(to: allNamesSelector),
  let names = openedCatalog.perform(allNamesSelector)?.takeUnretainedValue() as? [String]
else {
  fail("CUICatalog does not expose allImageNames")
}

let imagesSelector = NSSelectorFromString("imagesWithName:")
typealias ImagesFn = @convention(c) (NSObject, Selector, NSString) -> NSArray?
guard openedCatalog.responds(to: imagesSelector) else {
  fail("CUICatalog does not respond to imagesWithName:")
}
let imagesImp = openedCatalog.method(for: imagesSelector)
let imagesCall = unsafeBitCast(imagesImp, to: ImagesFn.self)

/// Write a CGImage to PNG on disk, returning the byte size written.
func writePng(_ image: CGImage, to path: String) -> Int? {
  let url = URL(fileURLWithPath: path) as CFURL
  let type = UTType.png.identifier as CFString
  guard let dest = CGImageDestinationCreateWithURL(url, type, 1, nil) else {
    return nil
  }
  CGImageDestinationAddImage(dest, image, nil)
  guard CGImageDestinationFinalize(dest) else {
    return nil
  }
  let attrs = try? FileManager.default.attributesOfItem(atPath: path)
  return (attrs?[.size] as? Int) ?? 0
}

/// Sanitize a rendition name into a filesystem-safe basename.
func safeName(_ name: String) -> String {
  let allowed = CharacterSet(charactersIn:
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-")
  return String(name.unicodeScalars.map { allowed.contains($0) ? Character($0) : "_" })
}

var decoded: [DecodedImage] = []
var usedFiles = Set<String>()

for name in names {
  guard let namedImages = imagesCall(openedCatalog, imagesSelector, name as NSString) else {
    continue
  }
  for case let named as NSObject in namedImages {
    // CUINamedImage exposes -image (CGImageRef) and -scale (CGFloat).
    let imageSelector = NSSelectorFromString("image")
    guard named.responds(to: imageSelector) else { continue }
    typealias ImageFn = @convention(c) (NSObject, Selector) -> CGImage?
    let imageImp = named.method(for: imageSelector)
    let imageCall = unsafeBitCast(imageImp, to: ImageFn.self)
    guard let cgImage = imageCall(named, imageSelector) else { continue }

    var scale = 1
    let scaleSelector = NSSelectorFromString("scale")
    if named.responds(to: scaleSelector) {
      typealias ScaleFn = @convention(c) (NSObject, Selector) -> CGFloat
      let scaleImp = named.method(for: scaleSelector)
      let scaleCall = unsafeBitCast(scaleImp, to: ScaleFn.self)
      let raw = scaleCall(named, scaleSelector)
      if raw > 0 { scale = Int(raw.rounded()) }
    }

    var file = "\(safeName(name))@\(scale)x.png"
    var counter = 1
    while usedFiles.contains(file) {
      file = "\(safeName(name))@\(scale)x-\(counter).png"
      counter += 1
    }
    usedFiles.insert(file)

    let outPath = (outputDir as NSString).appendingPathComponent(file)
    guard let bytes = writePng(cgImage, to: outPath) else { continue }
    decoded.append(
      DecodedImage(
        name: name,
        file: file,
        width: cgImage.width,
        height: cgImage.height,
        scale: scale,
        bytes: bytes))
  }
}

decoded.sort { $0.file < $1.file }

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
guard let json = try? encoder.encode(Manifest(images: decoded)) else {
  fail("failed to encode manifest")
}
FileHandle.standardOutput.write(json)
