/**
 * Work that should continue after a response is sent (a non-blocking A2A send keeps negotiating in the
 * background). Hosts register their platform primitive once at startup, e.g. Next.js:
 *
 *   import { after } from "next/server";
 *   import { registerAfter } from "@bloom-exchange/core";
 *   registerAfter(after);
 *
 * Without a registration the task runs on the event loop, which is correct for long-lived Node servers
 * (Docker, Kubernetes, `next start`) and for tests.
 */
type AfterFn = (task: () => unknown) => void;

let impl: AfterFn = (task) => {
  queueMicrotask(() => void Promise.resolve().then(task).catch(() => undefined));
};

export function registerAfter(fn: AfterFn): void {
  impl = fn;
}

export function after(task: () => unknown): void {
  impl(task);
}
