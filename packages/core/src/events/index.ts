/**
 * Bloom events: an opt-in, redacted lifecycle feed with a cursor store and post-event adapters.
 *
 * Built today:
 *   feed       typed BloomEvents (types.ts), projected through a whitelist (project.ts)
 *   log        MemoryEventLog (default), FileEventLog (durable local); cursor-based reads with reset detection
 *   push       EventHub.subscribe for in-process listeners; GET /api/exchange/events as SSE for remote ones
 *   poll       GET /api/exchange/events?cursor=… for harnesses that hold no stream
 *   adapters   WebhookAdapter (SSRF-guarded, HMAC-signed), JsonlSinkAdapter (local audit file),
 *              MockTriggerAdapter (dry-run post-settlement trigger)
 *
 * Not built: a shared log across node instances, and any third-party integration.
 */
export * from "./types.ts";
export { toBloomDrafts } from "./project.ts";
export { MemoryEventLog, FileEventLog, parseCursor, type EventLog } from "./log.ts";
export { AdapterRegistry, type RegistryOptions, type DeliveryOutcome, type DeadLetter } from "./registry.ts";
export { EventHub, enableEvents, disableEvents, eventHub, hubFromEnv, type EnableOptions, type Listener } from "./hub.ts";
export { WebhookAdapter, signEventBody, verifyEventSignature, type WebhookOptions } from "./adapters/webhook.ts";
export { JsonlSinkAdapter, type JsonlSinkOptions } from "./adapters/jsonl.ts";
export { MockTriggerAdapter, type MockTriggerOptions, type MockFiring } from "./adapters/mock.ts";
export { checkTarget, resolveTarget, isPrivateAddress, isLoopbackAddress, type LookupFn } from "./ssrf.ts";
