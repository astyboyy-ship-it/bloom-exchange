import { A2A_HEADERS, callerFor } from "../gateway.ts";
import { ownIntents } from "../intent-store.ts";


/** The caller's own injected intents, newest first. Never another caller's: intents carry user-written goals. */
export async function GET(req: Request) {
  const caller = await callerFor(req);
  return Response.json({ intents: await ownIntents(caller) }, { headers: A2A_HEADERS });
}
