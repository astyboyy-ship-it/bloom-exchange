# Contributing

Thanks for helping build the clearing layer.

1. `npm install`, then `npm test` (all tests run offline: in-memory store, deterministic engines, no keys).
2. Keep the invariants: a change to the vault, clamp, firewall, canonical encoding or certificate format needs a test that fails without it. Changes to anything a signature or hash covers are protocol changes: update [SPEC.md](SPEC.md) in the same pull request.
3. Copy lives in `apps/node/src/components/exchange/*copy.ts` in English and Spanish; the parity test fails if a string is missing in either.
4. `npm run typecheck && npm test && npm run build` must pass.

By contributing you agree that your contributions are licensed under the Apache License 2.0.
