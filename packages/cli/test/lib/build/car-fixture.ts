/**
 * In-memory builder for a minimal but real `Assets.car` (BOM asset catalog),
 * shared by the parser and normalization tests so neither commits a binary.
 *
 * It assembles the pieces the parser reads: a 32-byte BOM header, a block
 * table, a vars table naming `RENDITIONS`, and a single-leaf B-tree whose leaves
 * point at little-endian CSI rendition value blobs.
 */

/** A rendition to embed in a synthetic catalog. */
export type FakeRendition = {
  name: string;
  width: number;
  height: number;
  scale: number;
  pixelFormat: string;
  /** Extra padding bytes appended after the fixed CSI header. */
  payload: number;
};

/** Byte length of the fixed CSI rendition header. */
const CSI_HEADER_LENGTH = 168;

/** Build a little-endian CSI rendition value blob. */
function buildCsi(r: FakeRendition): Uint8Array {
  const buf = new Uint8Array(CSI_HEADER_LENGTH + r.payload);
  const view = new DataView(buf.buffer);
  buf.set([0x43, 0x54, 0x53, 0x49], 0); // "CTSI"
  view.setUint32(12, r.width, true);
  view.setUint32(16, r.height, true);
  view.setUint32(20, r.scale * 100, true);
  buf.set(new TextEncoder().encode(r.pixelFormat), 24);
  buf.set(new TextEncoder().encode(r.name), 40); // NUL-padded by default
  return buf;
}

/** Assemble a minimal valid BOM asset catalog containing `renditions`. */
export function buildFakeCar(renditions: FakeRendition[]): Uint8Array {
  const blocks: Uint8Array[] = [new Uint8Array(0)]; // index 0 = null block

  const csiIndices: number[] = [];
  const keyIndices: number[] = [];
  for (const r of renditions) {
    keyIndices.push(blocks.push(new Uint8Array([0, 0])) - 1);
    csiIndices.push(blocks.push(buildCsi(r)) - 1);
  }

  // Leaf node: isLeaf=1, count, forward=0, backward=0, then (value,key) pairs.
  const leaf = new Uint8Array(12 + renditions.length * 8);
  const leafView = new DataView(leaf.buffer);
  leafView.setUint16(0, 1); // isLeaf
  leafView.setUint16(2, renditions.length); // count
  for (let i = 0; i < renditions.length; i++) {
    leafView.setUint32(12 + i * 8, csiIndices[i] as number);
    leafView.setUint32(16 + i * 8, keyIndices[i] as number);
  }
  const leafIndex = blocks.push(leaf) - 1;

  // Tree block: "tree", version, child(=leaf), then trailing fields.
  const tree = new Uint8Array(21);
  tree.set(new TextEncoder().encode("tree"), 0);
  new DataView(tree.buffer).setUint32(8, leafIndex);
  const treeIndex = blocks.push(tree) - 1;

  // Pack block bodies after the 32-byte header, recording addresses.
  let cursor = 32;
  const addresses: number[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const bytes = blocks[i] as Uint8Array;
    addresses[i] = bytes.length === 0 ? 0 : cursor;
    cursor += bytes.length;
  }

  // Block table: count, then (address, length) per block.
  const blockTable = new Uint8Array(4 + blocks.length * 8);
  const btView = new DataView(blockTable.buffer);
  btView.setUint32(0, blocks.length);
  for (let i = 0; i < blocks.length; i++) {
    btView.setUint32(4 + i * 8, addresses[i] as number);
    btView.setUint32(8 + i * 8, (blocks[i] as Uint8Array).length);
  }
  const blockTableOffset = cursor;
  cursor += blockTable.length;

  // Vars table: count, then (index, nameLength, name) — just "RENDITIONS".
  const varName = "RENDITIONS";
  const vars = new Uint8Array(4 + 5 + varName.length);
  const vView = new DataView(vars.buffer);
  vView.setUint32(0, 1);
  vView.setUint32(4, treeIndex);
  vars[8] = varName.length;
  vars.set(new TextEncoder().encode(varName), 9);
  const varsOffset = cursor;
  cursor += vars.length;

  const out = new Uint8Array(cursor);
  const outView = new DataView(out.buffer);
  out.set(new TextEncoder().encode("BOMStore"), 0);
  outView.setUint32(8, 1); // version
  outView.setUint32(12, blocks.length);
  outView.setUint32(16, blockTableOffset);
  outView.setUint32(20, blockTable.length);
  outView.setUint32(24, varsOffset);
  outView.setUint32(28, vars.length);
  for (let i = 0; i < blocks.length; i++) {
    const bytes = blocks[i] as Uint8Array;
    if (bytes.length > 0) {
      out.set(bytes, addresses[i] as number);
    }
  }
  out.set(blockTable, blockTableOffset);
  out.set(vars, varsOffset);
  return out;
}
