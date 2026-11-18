import { A2A_HEADERS, callerFor } from "../gateway.ts";
import { getStandingMandate, setStandingMandate } from "../store.ts";
import { InitiatorMandateSchema } from "../types.ts";


const refuse = (status: number, message: string, details?: unknown) => Response.json({ error: { message, details } }, { status, headers: A2A_HEADERS });

/** The provider's standing mandate: the private guardrails every production enclave negotiates under. Operator key only. */
export async function GET(req: Request) {
  const caller = await callerFor(req);
  if (!caller.operator) return refuse(403, "The standing mandate is visible to the Operator access key only.");
  return Response.json(await getStandingMandate(), { headers: A2A_HEADERS });
}

export async function PUT(req: Request) {
  const caller = await callerFor(req);
  if (!caller.operator) return refuse(403, "Only the Operator access key can change the standing mandate.");
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return refuse(400, "Body must be valid JSON.");
  }
  const parsed = InitiatorMandateSchema.safeParse(raw);
  if (!parsed.success) return refuse(422, "Invalid mandate.", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  await setStandingMandate(parsed.data);
  return Response.json({ mandate: parsed.data, configured: true }, { headers: A2A_HEADERS });
}
