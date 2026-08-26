# car-extract

Apple-Silicon-only native helper that decodes an iOS `Assets.car` asset catalog
into per-rendition PNG images using the private macOS **CoreUI** framework
(`CUICatalog`). This is the one piece that genuinely needs a Mac: CoreUI is not
available on Linux/Windows and cannot be reimplemented in portable code.

The cross-platform CLI stays pure-TypeScript for everything else; this helper is
compiled with `swiftc` during the `darwin-arm64` build (see
`packages/cli/script/build.ts`) and embedded into that binary as a Node SEA
asset. At runtime the CLI extracts it to a temp dir and runs it (see
`packages/cli/src/lib/build/asset-catalog-extract.ts`). On every other platform,
or if the helper is unavailable, the CLI falls back to the pure-TS size/geometry
manifest with no decoded images.

## Contract

```
car-extract <input.car> <output-dir>
```

- Writes one PNG per decoded rendition into `<output-dir>`.
- Prints a JSON manifest to stdout:

  ```json
  {
    "images": [
      { "name": "AppIcon", "file": "AppIcon@2x.png", "width": 120, "height": 120, "scale": 2, "bytes": 4096 }
    ]
  }
  ```

- Exit code `0` on success (including "no decodable renditions" → empty
  `images`), non-zero on a hard failure (bad catalog, CoreUI unavailable). The
  caller treats any non-zero exit as "extraction unavailable" and falls back.

## Building manually

```sh
swiftc -O -o car-extract main.swift \
  -framework Foundation -framework CoreGraphics -framework ImageIO
```

CoreUI is loaded at runtime via the Objective-C runtime (`NSClassFromString`)
rather than linked directly, so the tool builds without private SDK stubs.
