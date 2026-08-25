/**
 * Pure-TypeScript parser for iOS `Assets.car` asset catalogs.
 *
 * A `.car` file is a CoreUI asset catalog stored in Apple's BOM ("Bill of
 * Materials") container format. The legacy Rust CLI expanded it into per-asset
 * images by linking against private macOS CoreUI frameworks, which gated iOS
 * upload to Apple Silicon. The new CLI ships on all platforms, so instead of
 * decoding pixels we parse the BOM container directly to enumerate each
 * rendition and its on-disk size and geometry. That per-asset breakdown is what
 * preprod size analysis needs; actual image extraction (which still requires
 * CoreUI) remains out of scope.
 *
 * Format references: the BOM header/block-table/vars layout and the CoreUI
 * `RENDITIONS` B-tree plus the `CTSI` rendition header. Only the fields needed
 * for a size breakdown are read; unknown regions are skipped by offset.
 */

/** One parsed rendition from an asset catalog. */
export type AssetCatalogEntry = {
  /** Rendition name from the CSI header (e.g. `"AppIcon"`). */
  name: string;
  /** On-disk size in bytes of the rendition's stored value blob. */
  size: number;
  /** Whether the rendition is a vector (PDF/SVG) asset. */
  vector: boolean;
  /** Pixel width, when present in the CSI header. */
  width: number | null;
  /** Pixel height, when present in the CSI header. */
  height: number | null;
  /** Scale factor (1, 2, 3), when present in the CSI header. */
  scale: number | null;
};

/** BOM container magic (`"BOMStore"`). */
const BOM_MAGIC = "BOMStore";

/** CSI rendition-header magic bytes (`"CTSI"`). */
const CSI_MAGIC = [0x43, 0x54, 0x53, 0x49];

/**
 * Byte offsets of the fields we read from a `CTSI` rendition header. Unlike the
 * enclosing BOM container (big-endian), the CSI header stores its integers
 * little-endian. The fixed header runs `name` (40) + `nameLength` (128) = 168
 * bytes, which is the minimum a value blob must have to be a valid rendition.
 */
const CSI = {
  width: 12,
  height: 16,
  scaleFactor: 20,
  pixelFormat: 24,
  name: 40,
  nameLength: 128,
  headerLength: 168,
} as const;

/** Whether a value blob begins with the `CTSI` rendition-header magic. */
function hasCsiMagic(buf: Uint8Array, address: number): boolean {
  return CSI_MAGIC.every((byte, i) => buf[address + i] === byte);
}

/** FourCC pixel-format codes for vector (non-raster) renditions. */
const VECTOR_PIXEL_FORMATS = new Set(["PDF ", "SVG "]);

/** A block-table pointer into the BOM file: byte address and length. */
type BomPointer = { address: number; length: number };

/**
 * Read and validate the BOM block table, returning the block pointers indexed
 * by block id (index 0 is the reserved null block).
 */
function readBlockTable(view: DataView, buf: Uint8Array): BomPointer[] {
  const indexOffset = view.getUint32(16);
  const count = view.getUint32(indexOffset);
  const pointers: BomPointer[] = [];
  let cursor = indexOffset + 4;
  for (let i = 0; i < count; i++) {
    if (cursor + 8 > buf.length) {
      throw new Error("BOM block table is truncated");
    }
    pointers.push({
      address: view.getUint32(cursor),
      length: view.getUint32(cursor + 4),
    });
    cursor += 8;
  }
  return pointers;
}

/** Map each named BOM variable to the block id it points at. */
function readVars(view: DataView, buf: Uint8Array): Map<string, number> {
  const varsOffset = view.getUint32(24);
  const count = view.getUint32(varsOffset);
  const vars = new Map<string, number>();
  let cursor = varsOffset + 4;
  const decoder = new TextDecoder("utf-8");
  for (let i = 0; i < count; i++) {
    const index = view.getUint32(cursor);
    const nameLength = view.getUint8(cursor + 4);
    const nameStart = cursor + 5;
    if (nameStart + nameLength > buf.length) {
      throw new Error("BOM vars table is truncated");
    }
    const name = decoder.decode(buf.subarray(nameStart, nameStart + nameLength));
    vars.set(name, index);
    cursor = nameStart + nameLength;
  }
  return vars;
}

/** A leaf entry of the CoreUI `RENDITIONS` tree: pointers to key and value. */
type TreeLeaf = { keyIndex: number; valueIndex: number };

/**
 * Walk a BOM B-tree from its root var block, collecting every leaf entry.
 *
 * Branch nodes are descended recursively; leaf nodes yield `(key, value)` block
 * pointer pairs. A visited set guards against cyclic or self-referential blocks
 * in a malformed catalog.
 */
function collectTreeLeaves(
  view: DataView,
  blocks: BomPointer[],
  treeBlockId: number
): TreeLeaf[] {
  const tree = blocks[treeBlockId];
  if (!tree) {
    return [];
  }
  const rootNodeId = view.getUint32(tree.address + 8);
  const leaves: TreeLeaf[] = [];
  const visited = new Set<number>();

  const walk = (nodeId: number): void => {
    if (visited.has(nodeId)) {
      return;
    }
    visited.add(nodeId);
    const node = blocks[nodeId];
    if (!node) {
      return;
    }
    // BOMPaths: isLeaf (u16), count (u16), forward (u32), backward (u32), then
    // the index entries. The forward/backward sibling links are skipped.
    const isLeaf = view.getUint16(node.address);
    const count = view.getUint16(node.address + 2);
    let cursor = node.address + 12;
    for (let i = 0; i < count; i++) {
      const valueIndex = view.getUint32(cursor);
      const keyIndex = view.getUint32(cursor + 4);
      cursor += 8;
      if (isLeaf) {
        leaves.push({ keyIndex, valueIndex });
      } else {
        walk(valueIndex);
      }
    }
  };

  walk(rootNodeId);
  return leaves;
}

/** Read the NUL-terminated rendition name from a `CTSI` value blob. */
function readRenditionName(buf: Uint8Array, start: number): string {
  const nameStart = start + CSI.name;
  const nameEnd = nameStart + CSI.nameLength;
  const slice = buf.subarray(nameStart, Math.min(nameEnd, buf.length));
  const terminator = slice.indexOf(0);
  const bytes = terminator === -1 ? slice : slice.subarray(0, terminator);
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Parse an `Assets.car` asset catalog into per-rendition size metadata.
 *
 * Returns one {@link AssetCatalogEntry} per rendition, sorted by name for a
 * deterministic manifest. Throws if the bytes are not a recognizable BOM
 * container; callers treat parse failures as non-fatal and fall back to
 * uploading the raw `.car`.
 *
 * @param content - The raw `.car` file bytes.
 */
export function parseAssetCatalog(content: Uint8Array): AssetCatalogEntry[] {
  if (content.length < 32) {
    throw new Error("File is too small to be an asset catalog");
  }
  const magic = new TextDecoder("latin1").decode(content.subarray(0, 8));
  if (magic !== BOM_MAGIC) {
    throw new Error("Not a BOM asset catalog (bad magic)");
  }

  const view = new DataView(
    content.buffer,
    content.byteOffset,
    content.byteLength
  );
  const blocks = readBlockTable(view, content);
  const vars = readVars(view, content);

  const renditionsBlockId = vars.get("RENDITIONS");
  if (renditionsBlockId === undefined) {
    return [];
  }

  const entries: AssetCatalogEntry[] = [];
  for (const leaf of collectTreeLeaves(view, blocks, renditionsBlockId)) {
    const value = blocks[leaf.valueIndex];
    if (!value || value.length < CSI.headerLength) {
      continue;
    }
    if (!hasCsiMagic(content, value.address)) {
      continue;
    }
    // CSI header integers are little-endian (the BOM container is big-endian);
    // the pixel format is a four-character code stored in file order.
    const pfStart = value.address + CSI.pixelFormat;
    const pixelFormat = new TextDecoder("latin1").decode(
      content.subarray(pfStart, pfStart + 4)
    );
    const width = view.getUint32(value.address + CSI.width, true);
    const height = view.getUint32(value.address + CSI.height, true);
    const scaleFactor = view.getUint32(value.address + CSI.scaleFactor, true);
    entries.push({
      name: readRenditionName(content, value.address),
      size: value.length,
      vector: VECTOR_PIXEL_FORMATS.has(pixelFormat),
      width: width > 0 ? width : null,
      height: height > 0 ? height : null,
      scale: scaleFactor > 0 ? Math.round(scaleFactor / 100) : null,
    });
  }

  entries.sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.size - b.size
  );
  return entries;
}
