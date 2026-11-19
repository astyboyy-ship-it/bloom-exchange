import { concat, fromHex, sha256Bytes, toHex } from "./bytes.ts";

/**
 * The relay's append-only receipt ledger as an RFC 6962 / RFC 9162 Merkle tree over receipt hashes:
 *   leaf = SHA-256(0x00 || receiptHash)     node = SHA-256(0x01 || left || right)
 * Anyone holding a receipt, its leaf index, the tree size and the audit path can recompute the root offline.
 * (A root proves inclusion in the tree the relay reports. Detecting a relay that shows different roots to
 * different readers needs published, signed tree heads, which this ledger does not yet have.)
 */
const LEAF = new Uint8Array([0]);
const NODE = new Uint8Array([1]);

export async function merkleLeaf(receiptHashHex: string): Promise<Uint8Array<ArrayBuffer>> {
  return sha256Bytes(concat(LEAF, fromHex(receiptHashHex)));
}

const node = (l: Uint8Array, r: Uint8Array) => sha256Bytes(concat(NODE, l, r));
const split = (n: number) => 2 ** Math.floor(Math.log2(n - 1)); // largest power of two below n (n >= 2)

async function mth(leaves: Uint8Array[]): Promise<Uint8Array<ArrayBuffer>> {
  if (leaves.length === 0) return sha256Bytes(new Uint8Array(0));
  if (leaves.length === 1) return new Uint8Array(leaves[0]);
  const k = split(leaves.length);
  return node(await mth(leaves.slice(0, k)), await mth(leaves.slice(k)));
}

async function path(m: number, leaves: Uint8Array[]): Promise<Uint8Array[]> {
  if (leaves.length <= 1) return [];
  const k = split(leaves.length);
  return m < k ? [...(await path(m, leaves.slice(0, k))), await mth(leaves.slice(k))] : [...(await path(m - k, leaves.slice(k))), await mth(leaves.slice(0, k))];
}

/** Root (hex) of the tree over these receipt hashes, in ledger order. */
export async function merkleRoot(receiptHashes: string[]): Promise<string> {
  return toHex(await mth(await Promise.all(receiptHashes.map(merkleLeaf))));
}

/** Audit path (hex, leaf to root) for the receipt at `index`. */
export async function inclusionProof(receiptHashes: string[], index: number): Promise<string[]> {
  if (!Number.isInteger(index) || index < 0 || index >= receiptHashes.length) throw new Error("inclusionProof: index out of range");
  return (await path(index, await Promise.all(receiptHashes.map(merkleLeaf)))).map(toHex);
}

/** RFC 9162 §2.1.3.2: does `proof` put this receipt at `index` in a tree of `treeSize` with this `root`? */
export async function verifyInclusion(receiptHashHex: string, index: number, treeSize: number, proof: string[], rootHex: string): Promise<boolean> {
  try {
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(treeSize) || index < 0 || index >= treeSize) return false;
    let fn = index;
    let sn = treeSize - 1;
    let r = await merkleLeaf(receiptHashHex);
    for (const p of proof) {
      const pb = fromHex(p);
      if (pb.length !== 32 || sn === 0) return false;
      if (fn % 2 === 1 || fn === sn) {
        r = await node(pb, r);
        if (fn % 2 === 0) while (fn % 2 === 0 && fn !== 0) {
          fn = Math.floor(fn / 2);
          sn = Math.floor(sn / 2);
        }
      } else r = await node(r, pb);
      fn = Math.floor(fn / 2);
      sn = Math.floor(sn / 2);
    }
    return sn === 0 && toHex(r) === rootHex;
  } catch {
    return false;
  }
}
