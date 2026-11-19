/**
 * Runs once when the Next.js server starts. A set but invalid BLOOM_EXCHANGE_PUBLIC_URL stops the node here,
 * before it can sign a malformed URL into a receipt; every other configuration problem surfaces per request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertPublicUrlConfig } = await import("@bloom-exchange/core");
  try {
    assertPublicUrlConfig();
  } catch (err) {
    console.error(`[bloom] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
