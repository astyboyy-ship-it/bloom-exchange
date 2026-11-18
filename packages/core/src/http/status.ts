import { exchangeKeys } from "../crypto.ts";
import { A2A_HEADERS, callerFor } from "../gateway.ts";
import { runtime } from "../platform/provider.ts";


/** What THIS caller's negotiations would get: live or simulated, sandbox or production, operator or not. */
export async function GET(req: Request) {
  const caller = await callerFor(req);
  const rt = runtime(caller.own, caller.decision.serverKey);
  const keys = exchangeKeys();
  return Response.json(
    {
      source: rt.mode === "live" ? "live" : "simulated",
      provider: rt.provider,
      environment: caller.operator ? "operator" : caller.licensed ? "production" : "sandbox",
      licensed: caller.licensed,
      operator: caller.operator,
      notice: caller.decision.notice,
      kid: keys.jwk.kid,
      keyOrigin: keys.origin,
    },
    { headers: A2A_HEADERS },
  );
}
