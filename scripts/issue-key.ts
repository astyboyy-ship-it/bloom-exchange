// Issues a Bloom access key signed with LICENSE_SIGNING_SECRET (from the shell, .env.local or .env).
//
//   npm run key:issue -- --role operator   --holder "Acme Treasury"
//   npm run key:issue -- --role enterprise --holder "Northwind Procurement" --days 365
//   npm run key:issue -- --role eval       --holder "Pilot" --days 14 --out keys/pilot.key
//
// Roles: operator (stress tests, server ledger, standing mandate, node telemetry), enterprise / agency (licensed
// production clearing), eval (read-only preview). Without a secret it signs a development key and says so.
import { randomUUID } from "node:crypto";
import { relative } from "node:path";
import { parseArgs } from "node:util";
import { ROLE_DEFAULTS, ROLE_TIER, type KeyRole, type UnsignedBloomPayload } from "../packages/core/src/licensing/types.ts";
import { issueAndSave, loadEnv } from "./key-common.ts";

const ROLES: KeyRole[] = ["operator", "enterprise", "agency", "eval"];
const { values } = parseArgs({ options: { role: { type: "string", default: "enterprise" }, holder: { type: "string" }, days: { type: "string" }, out: { type: "string" } } });
const role = values.role as KeyRole;
if (!ROLES.includes(role)) {
  console.error(`--role must be one of: ${ROLES.join(", ")}`);
  process.exit(2);
}
if (!values.holder) {
  console.error('--holder "Name" is required');
  process.exit(2);
}
loadEnv();

const base = ROLE_DEFAULTS[role];
const days = values.days ? Number(values.days) : null;
const payload: UnsignedBloomPayload = {
  keyId: `${role.slice(0, 3)}_${randomUUID()}`,
  holderName: values.holder,
  role,
  tier: ROLE_TIER[role],
  unlockedEngines: base.unlockedEngines,
  themeConfig: base.theme,
  permissions: base.permissions,
  issuedAt: new Date().toISOString(),
  expiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
};
const out = values.out ?? `keys/${role}-${payload.keyId.slice(4, 12)}.key`;
const issued = await issueAndSave(payload, out);

console.log(`
  BLOOM EXCHANGE // ACCESS KEY ISSUED${issued.dev ? " (development secret)" : ""}

  holder    ${issued.verified.holderName}
  role      ${issued.verified.role}
  key id    ${issued.verified.keyId}
  expires   ${issued.verified.expiresAt ?? "never"}
  saved     ${relative(process.cwd(), issued.path)}

${issued.key}
`);
