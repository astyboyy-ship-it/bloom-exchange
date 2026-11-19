import type { AdapterCheck, BloomEvent, BloomEventType, DeliveryContext, DeliveryResult, EventAdapter } from "../types.ts";

/**
 * No-op / dry-run trigger (built), for local testing and demos. Records what a downstream post-settlement hook
 * would have fired on, and sends nothing anywhere. `failFirst` makes the first N deliveries fail retryably, to
 * exercise the registry's retries.
 *
 * This stands in for downstream integrations that are not built: payment-rail triggers beyond the existing
 * settlement webhook, `bloom.exchange/<agent>` link callbacks (a naming format today, with no resolver), and
 * third-party automation. None of those exist yet.
 */
export type MockTriggerOptions = { id?: string; events?: readonly BloomEventType[] | "*"; failFirst?: number };
export type MockFiring = { eventId: string; type: BloomEventType; taskId: string; certificateId: string | null; attempt: number; idempotencyKey: string };

export class MockTriggerAdapter implements EventAdapter {
  readonly id: string;
  readonly name = "Dry-run post-settlement trigger";
  readonly events: readonly BloomEventType[] | "*";
  readonly fired: MockFiring[] = [];
  attempts = 0;
  private failuresLeft: number;

  constructor(opts: MockTriggerOptions = {}) {
    this.id = opts.id ?? "dry-run";
    this.events = opts.events ?? ["negotiation.settled", "receipt.issued"];
    this.failuresLeft = Math.max(0, opts.failFirst ?? 0);
  }

  async check(): Promise<AdapterCheck> {
    return { ok: true, detail: "dry run: records firings in memory and sends nothing" };
  }

  async deliver(event: BloomEvent, ctx: DeliveryContext): Promise<DeliveryResult> {
    this.attempts++;
    if (this.failuresLeft > 0) {
      this.failuresLeft--;
      return { ok: false, retryable: true, reason: "simulated failure" };
    }
    const certificateId = event.type === "negotiation.settled" || event.type === "receipt.issued" ? event.data.certificateId : null;
    this.fired.push({ eventId: event.id, type: event.type, taskId: event.taskId, certificateId, attempt: ctx.attempt, idempotencyKey: ctx.idempotencyKey });
    return { ok: true };
  }
}
