/** Byte helpers on Web Crypto and the platform's base64, so they run in Node 20+, Deno, Bun and browsers. */
const enc = new TextEncoder();

export const utf8 = (s: string): Uint8Array<ArrayBuffer> => {
  const b = enc.encode(s);
  const out = new Uint8Array(new ArrayBuffer(b.length));
  out.set(b);
  return out;
};

export function toB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("not base64url");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex)) throw new Error("not lowercase hex");
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256Bytes(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

/** SHA-256 of a string's UTF-8 bytes (or of raw bytes), as lowercase hex. */
export async function sha256HexOf(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(await sha256Bytes(typeof data === "string" ? utf8(data) : data));
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const randomHex = (bytes = 32): string => toHex(crypto.getRandomValues(new Uint8Array(bytes)));
