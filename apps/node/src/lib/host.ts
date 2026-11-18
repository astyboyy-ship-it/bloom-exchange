import { after } from "next/server";
import { registerAfter } from "@bloom-exchange/core";

/**
 * Registers Next.js's `after` with the engine once per server instance, so a non-blocking A2A send keeps
 * negotiating after its response on serverless hosts too. Every route file imports this module first.
 */
registerAfter(after);
