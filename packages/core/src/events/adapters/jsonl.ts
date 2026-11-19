import { constants } from "node:fs";
import { access, appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AdapterCheck, BloomEvent, BloomEventType, DeliveryResult, EventAdapter } from "../types.ts";

/**
 * Local JSONL audit and receipt sink (built). Appends one line per redacted event:
 * `{"deliveredAt": "...", "event": {...}}`. `receipt.issued` lines carry the receipt reference (certificate id,
 * digest, signing key id, issuer card URL), enough to fetch and verify the receipt later with
 * `npx @bloom-exchange/sdk verify`. No mandate, margin or free text is ever written, because events carry none.
 */
export type JsonlSinkOptions = { path: string; id?: string; events?: readonly BloomEventType[] | "*" };

export class JsonlSinkAdapter implements EventAdapter {
  readonly id: string;
  readonly name = "Local JSONL audit and receipt sink";
  readonly events: readonly BloomEventType[] | "*";
  readonly path: string;

  constructor(opts: JsonlSinkOptions) {
    this.path = resolve(opts.path);
    this.id = opts.id ?? "jsonl";
    this.events = opts.events ?? "*";
  }

  async check(): Promise<AdapterCheck> {
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await access(dirname(this.path), constants.W_OK);
      return { ok: true, detail: `${this.path} is writable; nothing was written.` };
    } catch (err) {
      return { ok: false, detail: `cannot write to ${dirname(this.path)}: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async deliver(event: BloomEvent): Promise<DeliveryResult> {
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, `${JSON.stringify({ deliveredAt: new Date().toISOString(), event })}\n`, "utf8");
      return { ok: true };
    } catch (err) {
      return { ok: false, retryable: true, reason: `write failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
