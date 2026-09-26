# Technical summary

Proofwork runs a paid campaign on Stellar testnet: a project funds a budget into a Trustless Work escrow, contributors submit a post on X, a human reviewer scores each submission against a six-signal rubric, every decision is written to the Stellar ledger, approved contributors are paid in USDC from the escrow, and what is left returns to the funder. The platform never holds the money and cannot release it.

## Architecture

```
                 ┌──────────────────────── Next.js app (proofwork.online) ────────────────────────┐
 Funder wallet ──┤ /campaigns        create · deploy · fund · approve · release · close            │
 Contributor  ───┤ /c/<slug>         connect or create wallet · USDC trustline · submit post URL   │
 Reviewer     ───┤ /review           blind queue · six signals · reason code · one re-review       │
 Anyone       ───┤ /verify/<id>      canonical record + SHA-256 recomputed in the browser          │
                 │                                                                                │
                 │ services (zod at every boundary, role + ownership check on every mutation)     │
                 │   ├─ escrow-ops: intent → submitted → confirmed, idempotency key per write     │
                 │   ├─ EscrowPort ── TrustlessWorkAdapter ──► Trustless Work Core API v1         │
                 │   └─ DecisionLedger ── @stellar/stellar-sdk ──► Horizon (classic tx)           │
                 │ Postgres (Neon): campaigns, submissions, decisions, payouts, escrow ops        │
                 └────────────────────────────────────────────────────────────────────────────────┘
                                   │                                   │
                        Soroban escrow contract              decision ledger account
                        (USDC, multi-release)               (manage_data + memo_hash)
                                   └────────── Stellar testnet ────────┘
```

Wallet-signed operations (deploy, fund, release, close) are built by the server, signed in the user's wallet, and only accepted if the signed envelope hashes to exactly what the server prepared. Server keys sign only operations that move no money.

## Escrow shape (AD-2, AD-3)

One Trustless Work **multi-release** escrow per campaign.

- Deployed with a single "campaign close" milestone (receiver = funder, 0.0000001 USDC), because v1 needs at least one milestone at deploy.
- Funded once with the whole budget by the funder.
- For every approved submission, one milestone is appended after funding (amount = reward, receiver = contributor wallet). Appending to a funded escrow was verified on testnet in the Week 1 spike ([escrow-cycle.md](evidence/escrow-cycle.md), step 3).
- Roles: funder = release signer; platform admin key = platform address (appends milestones); platform ops key = service provider and approver (marks delivered, approves); a separate key = dispute resolver (held by the operator in Month 1, see Known limits). Approval moves no money. Only the funder's release signature pays a contributor, and that signature is the funder's final approval.
- Trustless Work deducts a 0.3% protocol fee at release, on testnet too (1 USDC reward → 0.997 USDC received).

## Remainder return (AD-4)

Trustless Work has no time-based auto-return. At the deadline:

1. The funder closes the campaign in the app, which disputes the "campaign close" milestone (v1 treats a disputed milestone as processed).
2. The dispute resolver runs `pnpm escrow:close <contract>`, which calls `withdraw-remaining-funds` and sends the whole remaining balance to the funder in one transaction. The tx hash is stored on the campaign and shown on its page.

Verified on testnet in the spike (steps 5a and 5b). The close is manual: someone has to press it.

## Decision record (AD-5)

One classic Stellar transaction per decision, from a dedicated decision ledger account:

| Field | Content |
|---|---|
| `manage_data` key | `pw:<submission short id>`; the one-shot re-review writes `pw:<id>:a1` |
| `manage_data` value | `v1|<PASS or FAIL>|<reason code>|<first 16 hex of the record hash>` |
| `memo_hash` | SHA-256 of the canonical decision JSON |

The canonical JSON holds the submission and campaign reference, reviewer key, the six signal answers, outcome, reason code, the hash of the decision it re-reviews (if any) and the timestamp, with keys in a fixed order. It is stored with the decision and shown on `/verify/<decision id>`, where the browser hashes it again with WebCrypto. Anyone can compare that hash with the transaction memo on stellar.expert. The decision is written when it is made, not batched at close. Reason codes: `R00_PASS`, `R01_ACCOUNT`, `R02_ORIGINAL`, `R03_TASK`, `R04_BRIEF`, `R05_MULTI`, `R06_SPAM` ([rubric](rubric.md)).

## Security model

- **No custody by the app.** The platform keys cannot move funds; release needs the funder's wallet, the remainder needs the dispute resolver (see Known limits for who holds that key in Month 1).
- **Money state comes from chain.** Every escrow write is recorded as intent → submitted → confirmed with an idempotency key, and confirmed only after the escrow is read back and shows the effect. A retry never submits a second transaction. Nothing is shown as paid from a database write alone.
- **Wallet login.** Single-use signed nonce with expiry; httpOnly, Secure, SameSite=Lax session cookie; logout revokes server-side.
- **Authorization** is checked in the service layer on every mutation against the caller's wallet, role and campaign ownership.
- **Input.** Every route and server action validates with zod. Submission URLs must be `https://x.com/<handle>/status/<id>` (or twitter.com); the server never fetches them.
- **Secrets** live only in server environment, validated at startup, never logged and never in the client bundle. Security headers (CSP, HSTS, nosniff, Referrer-Policy, frame-ancestors none) on every response; public write endpoints are rate limited.
- **Blind review.** The queue shows no contributor identity beyond the post URL, in a stable non-chronological order. The list of planted fakes was never stored in the app database; it was joined to the exported review log only after scoring ([results](results.md)).

## Known limits

- **One campaign, one reviewer.** The results are a directional first signal, not a validated fraud benchmark. The sample is in the tens, so a single submission moves each rate by several points.
- **Reviewer is also the builder.** Mitigated by having a second person write and submit the planted fakes from separate accounts and keep the list outside the app, but not eliminated.
- **Trustless Work v1 builds one transaction per release.** A campaign with N payouts needs N funder signatures.
- **Manual close.** The remainder returns only when the funder closes and the resolver sweeps; there is no timer.
- **The operator holds the dispute resolver key in Month 1.** `pnpm escrow:close` runs with `DISPUTE_RESOLVER_SECRET` from the operator's environment, not from a Chapter Lead wallet. The resolver chooses the destination of `withdraw-remaining-funds`; the script sends the balance to the escrow's funder, but the key itself could send it elsewhere. The sweep tx on stellar.expert shows where the remainder went.
- **Testnet only.** Testnet USDC has no value; the server keys are sprint keys.
- **X only, USDC only**, and the campaign is created and run by hand; this is not a self-service platform.

## Month 2 next steps

- Move to Trustless Work v2 batch approve-and-release so one signature pays every approved contributor.
- Replace the classic-transaction decision record with a small Soroban contract queryable by submission ID.
- In-app second-reviewer mode, so agreement is measured on every campaign rather than a subset.
- Self-service campaign creation and a scheduled close reminder.
- Tighten the rubric signals the [results](results.md) show as weak, then run a larger campaign before any mainnet step.
