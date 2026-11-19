import { createServer as createNetServer } from "node:net";
import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { createRelay } from "../apps/relay/src/app.ts";
import { MemoryNonceStore } from "../apps/relay/src/nonce.ts";
import { MemoryStore } from "../apps/relay/src/store/memory.ts";
import type { Store } from "../apps/relay/src/store/types.ts";

/** Boots a real relay (HTTP + WebSocket) on a free local port with the zero-config memory stores. */
export async function bootRelay(opts: { now?: () => Date; store?: Store } = {}) {
  const port = await new Promise<number>((resolve, reject) => {
    const s = createNetServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
  const url = `http://127.0.0.1:${port}`;
  const store = opts.store ?? new MemoryStore();
  const nonces = new MemoryNonceStore();
  const relay = createRelay({ store, nonces, publicUrl: url, verifierUrl: "https://bloom-exchange-verify.vercel.app", now: opts.now });
  const server = await new Promise<Server>((resolve) => {
    const s = serve({ fetch: relay.app.fetch, port, hostname: "127.0.0.1" }, () => resolve(s as Server)) as Server;
  });
  relay.attach(server);
  return {
    url,
    store,
    relay,
    close: () =>
      new Promise<void>((resolve) => {
        relay.close();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
