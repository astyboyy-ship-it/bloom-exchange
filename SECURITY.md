# Security

Bloom Exchange handles private negotiation limits and signs settlement receipts, so we treat these as security issues:

* any way for a counterparty, an engine prompt or a response to learn the other side's sealed limits;
* any offer sent, or certificate signed, outside either sealed mandate;
* a forged or altered certificate that `verifyCertificate` / `bloom-verify` accepts;
* a firewall bypass that lets hostile text reach an engine;
* idempotency failures that open a second enclave or mint a second certificate;
* access-key forgery or privilege escalation to operator views.

**Report privately.** Do not open a public issue. Use GitHub's private vulnerability reporting on this repository and include a minimal reproduction (a failing test in `packages/core/test` is ideal). We aim to acknowledge within three working days.

**Known limitation (by design in v0.1).** The vault runs on the provider's node, so a counterparty trusts that node's operator with its mandate. This is documented in [SPEC.md §12](SPEC.md#12-security-considerations-and-threat-model) and is not a vulnerability report, though designs that remove the trust are very welcome.
