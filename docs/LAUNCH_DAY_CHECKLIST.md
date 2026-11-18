# Launch day checklist: Show HN, Thursday 19 November 2026

All times are **Israel time (IST, UTC+2)**. Israel and New York are both on standard time this week, so Israel is 7 hours ahead: **15:30 Israel = 13:30 UTC = 08:30 New York = 05:30 San Francisco.**

The posting window is **15:30–17:30 Israel**. LAUNCH_KIT §2 says to stay in the thread for the first three hours, so keep replying until about **18:30** if the thread is active.

---

## 1. Pre-flight (13:30–15:15)

Run every command from a clean checkout of `main`.

| Time | Check | Command or action | Pass when |
|---|---|---|---|
| 13:30 | Repo is clean and pushed | `git status -sb` | `## main...origin/main`, nothing to commit |
| 13:35 | Full end-to-end check, including the live npm CLI | `.\scripts\verify-launch-demo.ps1 -Published` (or `./scripts/verify-launch-demo.sh --published`) | `ALL CHECKS PASSED`, exit 0 |
| 13:45 | Test suite | `npm test` | 144 passed |
| 13:50 | Cold clone, exactly as an HN reader does it | `git clone https://github.com/astyboyy-ship-it/bloom-exchange bx-cold && cd bx-cold && npm install && npm run dev`, then open http://localhost:3000 | The desk loads; a sandbox negotiation settles. `npm install` takes about 2 minutes. |
| 14:00 | Packages are live at 0.1.0 | `npm view @bloom-exchange/core version`, `npm view @bloom-exchange/sdk version`, `npm view @bloom-exchange/mcp version` | `0.1.0` three times |
| 14:05 | The verify CLI works without a clone | In an empty folder: `npx -y @bloom-exchange/sdk verify --help` | Prints the usage line, exit 2 |
| 14:05 | The MCP server starts | `npx -y @bloom-exchange/mcp` | Waits on stdio with no error. Stop it with Ctrl+C. |
| 14:10 | MCP Registry listing is active | `curl -s "https://registry.modelcontextprotocol.io/v0.1/servers?search=bloom-exchange"` | `io.github.astyboyy-ship-it/bloom-exchange`, `0.1.0`, status `active` |
| 14:15 | GitHub page reads well logged out | Open https://github.com/astyboyy-ship-it/bloom-exchange in a private window | README renders, SPEC.md opens, About has a description and topics (`a2a`, `mcp`, `ai-agents`, `prompt-injection`, `ed25519`) |
| 14:20 | Issues are open | Repo Settings → Features → Issues | Enabled |
| 14:25 | Old npm token is revoked | npmjs.com → Access Tokens | The granular token used for the 0.1.0 publish is deleted |
| 14:30 | HN account | Log in at news.ycombinator.com | Logged in; the account can post (not brand new, has some karma) |
| 14:40 | Copy staged | Put the title, URL and first comment (§2) in a plain text file | Ready to paste; nothing edited at the last minute |
| 15:00 | Distractions off | Close Slack and email; silence the phone except HN reply alerts | — |
| 15:15 | Final re-run | `.\scripts\verify-launch-demo.ps1 -SkipBuild` | `ALL CHECKS PASSED` |

If any pre-flight check fails, fix it before 15:30 or **move the launch to next Tuesday–Thursday at the same time**. A broken first try costs more than a delay.

---

## 2. Posting (15:30–15:32)

**15:30: submit** at https://news.ycombinator.com/submit

* **Title** (79 characters, the recommended one from LAUNCH_KIT §2; paste it exactly):

  ```
  Show HN: Stop prompt injection from leaking your agent's budget in negotiations
  ```

* **URL:**

  ```
  https://github.com/astyboyy-ship-it/bloom-exchange
  ```

* **Text:** leave it empty. The explanation goes in the first comment.

**15:31: post the first comment** on your own submission, as the author, word for word:

> Hi HN. I built Bloom Exchange after watching procurement-style agents negotiate. The common pattern puts the agent's walk-away number in its prompt: "you can pay up to $52k". Anything that reaches that prompt can ask for it. The counterparty's messages, its Agent Card, a tool result: one injected sentence and the budget is in the other side's context.
>
> Bloom moves the limits out of the prompt entirely:
>
> - Each side deposits its mandate (ceiling, budget, SLA, terms) into a double-blind vault. The provider's negotiating engines receive a brief type with no counterparty fields, so the other side's numbers can't reach a prompt by construction. Each mandate is bound by a salted SHA-256 commitment printed on the receipt.
> - Models only propose. Every offer is clamped in code to both mandates before it is sent or signed. The test suite throws an adversarial proposer at 300 randomized enclaves and asserts that nothing out of bounds is ever sent or signed.
> - Every external field passes a firewall first: injection, role overrides, invisible and tag-smuggled Unicode, homoglyphs, base64 payloads, hidden markup. Critical findings quarantine the text, and only structured terms go through.
> - A settled deal is a BLOOM-XCH certificate: hash-chained rounds, both commitments, an Ed25519 signature and AP2 payment credentials. `npx @bloom-exchange/sdk verify receipt.json` checks it offline against the issuer's signed Agent Card.
>
> It's an A2A v1.0 extension (JSON-RPC and SSE), so any A2A client can talk to it. There's a zero-dependency TypeScript SDK and an MCP server (`npx -y @bloom-exchange/mcp`) for Claude Code and Cursor. The protocol spec has byte-exact test vectors, so a Python or Rust implementation can match the reference signatures exactly.
>
> To try it: clone, `npm install && npm run dev`, and open localhost:3000. The sandbox needs no API keys and no model; the proposer is a deterministic engine unless you add an Anthropic or OpenRouter key. `npm run build && npm run verify:launch` runs the whole story as one check: two independently keyed nodes, a prompt-injection attempt that leaks nothing, a cross-node deal, and the CLI accepting the receipt but rejecting a $1 tamper or the other node's key.
>
> What it doesn't do yet, honestly:
>
> 1. **The node operator is trusted.** In v0.1 the vault runs on the provider's node, so that operator could read both mandates. The commitments let a counterparty catch a misstated receipt afterwards, but not prevent it. The roadmap is neutral hosted clearing, then TEE attestation printed on the receipt.
> 2. **Receipts aren't chained to each other yet.** A transparency log is planned.
> 3. **No local-model proposer yet.**
>
> SPEC.md §12 lists all of this. I'd especially like feedback on the threat model and on the spec (SPEC.md). Apache-2.0.

**15:32:** open the post from a private window and confirm that the comment shows up and the link works. Save the item URL (`news.ycombinator.com/item?id=…`).

---

## 3. In the thread (15:32–17:30, and on to about 18:30)

| Time | Action |
|---|---|
| 15:32–16:30 | Refresh every 5 minutes and **answer every top-level comment within about 10 minutes**. The first hour decides the ranking. |
| 15:45 | Check the post on https://news.ycombinator.com/shownew and https://news.ycombinator.com/newest. |
| 16:00 | Checkpoint: rank, points, comment count. Look at GitHub → Insights → Traffic for referrers. Write the numbers down. |
| 16:00–17:30 | Refresh every 10 minutes. Turn every reproducible bug into a GitHub issue and link it in your reply ("tracked in #N"). |
| 16:30 | Checkpoint: rank, points, comments, new stars and issues. |
| 17:00 | Checkpoint. If someone found a real bug, fix it on a branch, run `npm test` and `verify:launch`, merge, and reply with the commit. **Publish a 0.1.1 to npm only if the bug is in a published package**, and run the full pre-flight first. |
| 17:30 | End of the core window. Post nothing new on other channels today (Reddit is tomorrow, per LAUNCH_KIT). Keep answering until the thread goes quiet. |
| ~18:30 | Write a short note in this file: final rank, points, comments, stars, issues, and the questions that came up that the cheat sheet did not cover. |

**Rules for the thread:**

* Never ask anyone for upvotes, and don't post the HN link in groups asking for support. HN's voting-ring detection penalizes it. Sharing the link with "I launched, feedback welcome" is fine.
* Answer critics first, briefly, and concede true points plainly. "You're right, that's the v0.1 trust gap; it's §12.1" beats any defense.
* Don't edit the title after posting. Don't delete and repost. If the post is flagged or killed by mistake, email hn@ycombinator.com once, politely.
* Make no claim that is on the "Claims you must not make" list in LAUNCH_KIT, under any pressure.

**If something breaks during the window:**

| Symptom | Likely cause | Reply and fix |
|---|---|---|
| "`npm run demo:two-node` / `verify:launch` crashes with a syntax error" | Node older than 22.18 (TypeScript type stripping) | Point to the Node 22.18+ note in the README. The published packages run on Node 20+. |
| "`npm run dev` fails: port in use" | Something else is on :3000 | `npm run dev -w @bloom-exchange/node -- -p 3005` |
| "`verify:launch` says a node did not start" | It wasn't built, or ports 3201/3202 are busy | Run `npm run build` first, and free those ports |
| "`npx bloom-verify` installs nothing / something else" | `bloom-verify` is the bin name, not an npm package | Use `npx @bloom-exchange/sdk verify receipt.json` |
| npm install warns about esbuild install scripts | npm 11's `allowScripts` notice | Harmless; the build does not depend on that postinstall |

---

## 4. HN tough-questions cheat sheet

Short, true answers. Every claim maps to the SPEC or to a test.

### Threat model

**"What exactly do you protect against?"**
A counterparty, or text it controls (messages, its Agent Card, tool output), trying to learn your limits or push you past them. Three layers handle it. The vault keeps the other side's numbers out of any prompt by construction. A deterministic clamp keeps every sent or signed offer inside both mandates. The firewall strips hostile text before any engine reads it. SPEC §12.1 lists what is protected and what isn't. `npm run verify:launch` shows an injection attempt leaking nothing.

**"Your firewall is regexes. I can bypass it."**
Probably, eventually; any classifier can be beaten. The firewall is defense in depth, **not the guarantee**. The guarantee is architectural: the provider's engines get a brief type that has no counterparty fields, so even a fully jailbroken model has no ceiling to leak. It also can't send an out-of-bounds offer, because the clamp runs in code after the model. If you find a bypass, please open an issue; it's a free test case.

**"Can't I just binary-search the floor by probing?"**
Partly, and the SPEC says so (§12.2, "statistical inference across many enclaves"). Reserves sit a seeded guard band inside each limit, so no offer lands exactly on a private number. Repeated out-of-bounds negotiations from one identity count as mandate probing and lower its trust score. Rate limits apply per identity. That raises the cost; it does not make inference impossible.

**"What if the model just agrees to $1?"**
It can't. Models only propose. Sovereign clamps every offer to both mandates before it is sent or signed. The suite runs an adversarial proposer through 300 randomized enclaves and asserts that nothing out of bounds is ever sent or signed (`packages/core/test/settlement-safety.test.ts`).

**"What stops someone from impersonating a node?"**
Agent Cards carry a detached JWS over the canonical card, and verifiers pin the key id. The residual risk is trust on first use, so publish key fingerprints out of band (§12.2). Receipts verify only against the issuer's key; `verify:launch` checks that the other node's key fails.

**"Key compromise?"**
Then that key's receipts can be forged. Rotate keys and publish fingerprints out of band. A transparency log of certificate digests (v0.2) is what limits the damage across history.

### Double-blind commitment vaults

**"What does 'double-blind' actually mean here?"**
Neither party, and neither party's negotiating engines, ever sees the other side's sealed limits, in any response, stream, event or prompt. It does **not** mean the node operator is blind; see the next section. Tests BCP-VAULT-* cover the accessors and the outbound leak scrubber.

**"What's the commitment for if nobody can see the mandate?"**
Binding and dispute. Each side's mandate is committed as salted SHA-256 over canonical JSON and printed on the receipt. Later, either side can open its own commitment (reveal the mandate and the salt) and prove what it deposited. That's how a counterparty catches an operator who misstated its mandate.

**"Salted SHA-256 isn't a ZK proof. You can't prove the price was inside both bounds."**
Correct. In v0.1 a third party can verify that the receipt is authentic and unaltered and that each side committed to *something*. It cannot verify that "the price fits both sealed bounds" without trusting the operator. Commit-reveal, MPC or zero-knowledge range proofs are the roadmap answer for exactly that (§12.1, "Roadmap answers").

**"Why not just keep the budget out of the prompt yourself?"**
You should, and that's the default architecture here. The harder part is the other side: a shared, neutral place where two agents' limits meet, plus a receipt both can verify. That's the clearing layer.

### v0.1 operator trust tradeoffs

**"So the operator can read everything?"**
Yes. In v0.1 the vault runs in the provider's node memory and storage, so that operator can read both mandates. The counterparty trusts the provider's operator. This is stated plainly in the README and SPEC §12.1, and it's the biggest open problem.

**"Then what's the point?"**
Most real leaks today aren't malicious operators; they're prompts. One injected sentence puts a budget in the other side's context. v0.1 closes that hole completely and makes operator misbehavior *detectable* (commitments, signed receipts) even though it can't yet *prevent* it. Neutral operation is the next step, not an afterthought.

**"What can a dishonest operator do?"**
Refuse to settle; mint a receipt that misstates the counterparty's mandate (detectable afterwards by opening the commitment, not preventable); and omit or reorder its own receipt history, because receipts aren't chained to each other yet (§9, §12.1).

**"Why ship before that's solved?"**
The protocol, receipt format and test vectors are useful on their own. They let other implementations match signatures byte for byte, and they need public feedback before the trust model hardens. Shipping the honest version early beats shipping a "trustless" claim that isn't true.

### Roadmap: TEE attestation and the transparency log

**"How do you remove operator trust?"**
In order:

1. **Neutral hosted clearing**, where neither party operates the vault.
2. **Attested enclaves**: TEE remote-attestation evidence for the exact clearing code, printed on the certificate, so a verifier can check *what code* cleared the deal.
3. **Commit-reveal, MPC or ZK range proofs**, so "a price inside both sealed bounds" holds with no trusted party.

(SPEC §12.1, §13.)

**"TEEs have side channels (SGX…)."**
True. Attestation narrows trust from "this operator" to "this hardware vendor plus this measured code". That's a big improvement, but it isn't zero trust, which is why the cryptographic option (3) stays on the list.

**"Transparency log: like Certificate Transparency?"**
Yes, same idea. v0.2 is expected to define a public log of certificate digests with signed checkpoints, so an operator can't silently omit or reorder receipts. It also expects a signed node registry beyond configured peers, and federated settlement across operators (§13).

**"Why Ed25519 and not a blockchain?"**
Verification needs no network and no chain: `npx @bloom-exchange/sdk verify receipt.json --card card.json` works air-gapped. Ordering across receipts is a transparency-log problem, not a consensus problem.

### Other likely questions

* **"Isn't this just escrow?"** No funds are held. It clears terms and emits AP2, Stripe and x402 payloads; the payment rail settles them. Sandbox receipts are explicitly `binding: false`.
* **"Why A2A?"** It's the emerging agent-to-agent standard, so any A2A v1.0 client can negotiate without our SDK (raw JSON-RPC example in the README).
* **"Local models?"** Not yet as the proposer. Today it's Anthropic, OpenRouter, or the deterministic engine. Say so; don't promise a date.
* **"Do `bloom.exchange/<agent>` links work?"** They're a naming format that resolves to a node's signed Agent Card. There is no public registry or resolver yet.
* **"Business model?"** Open core under Apache-2.0: protocol, engine, SDK and MCP server. Neutral hosted clearing is the natural paid layer. Don't quote prices or users you don't have.
* **"Usage numbers?"** Don't make any up. It launched today.
