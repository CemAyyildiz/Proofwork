# Sealed dual review (experimental)

Proofwork can optionally assign two authorized reviewer wallets to one pending submission and use a Sub Rosa Core v2 `ReceiptOnly` round to keep their rubric v2 assessments sealed until a shared Drand reveal boundary. The feature is additive and off by default.

## Enable on a preview deployment

1. Create a Neon preview branch; do not point this branch at the production database.
2. Set `DATABASE_URL` to the preview branch and run `corepack pnpm db:migrate`.
3. Set `SEALED_DUAL_REVIEW_ENABLED=true` and deploy the preview.
4. Grant two distinct wallets the existing `reviewer` role.
5. Open `/review/sealed`, choose a pending submission, assign both wallets, and create the testnet round with the manager wallet.

Migrations `0007_clammy_professor_monster.sql` and `0008_lively_typhoid_mary.sql` add the `sealed_review_status` enum, the `sealed_review` / `sealed_review_assignment` tables, and replay-protection indexes on their evidence transaction hashes. They do not alter existing campaign, submission, decision, escrow, payout, X-account, or role rows.

## Lifecycle and trust boundary

- The campaign funder or an `ops` wallet prepares an allowlisted two-person round. Both assignees must already have campaign or global reviewer access.
- The manager wallet creates the round through the published `@sub-rosa/sdk@0.3.2`. It is pinned to Stellar testnet, the SDK's canonical Core v2 contract, `ReceiptOnly`, two allowlisted participants, and fixed escrow `0`.
- Each assigned reviewer signs its own Soroban commit. Proofwork receives only the transaction hash and verifies the resulting on-chain commitment before recording it.
- Before reveal, Proofwork stores no assessment signals, reason, note, plaintext envelope, ciphertext, nonce, or wallet secret. The ciphertext lives in Sub Rosa temporary contract storage.
- Core v2 permits a participant to overwrite its own sealed payload before the commit deadline. Proofwork pins the first commitment it records and rejects a reveal or receipt if the final on-chain commitment differs. The UI also removes the commit action after the first accepted commit.
- After Drand publishes the configured round, reveal is permissionless to open. Each assigned reviewer decrypts and reveals its own payload. Clearing is allowed only after the reveal deadline; for `ReceiptOnly`, `clearV2` finalizes the contract state directly to `Settled`.
- Proofwork exports the receipt from on-chain state, calls `verifyReceiptV2`, checks the contract/network/mode/zero-escrow policy, exact allowlist, item and schema references, deadlines, operator, reviewer commitments, and every embedded Proofwork binding. Only then are the two plaintext assessments stored and displayed.
- An authorized Proofwork reviewer selects one verified assessment as the final human decision. That action calls the existing `decide` service and writes exactly one normal Proofwork decision-ledger record.

Sub Rosa does not authorize payout, custody USDC, append a Trustless Work milestone, approve a milestone, release funds, return campaign remainder, or change the funder's release authority. All existing single-review campaigns and their `/review` API remain unchanged.

## Privacy and operational limits

This is timed confidentiality, not permanent confidentiality. Anyone who obtains the ciphertext can decrypt it after the Drand boundary, and revealed payloads are public on-chain. Notes and rubric signals are intentionally stored by Proofwork only after receipt verification. Transaction hashes, reviewer wallet addresses, commitments, timing, and the public Proofwork item binding are visible before reveal.

If fewer than two valid reveals are recorded by the deadline, Proofwork marks the integration round expired and refuses finalization. If the Sub Rosa temporary seal expires before reveal, the review cannot be recovered through the normal path. A contract transaction that succeeds but whose acknowledgement never reaches Proofwork must be reconciled from the on-chain receipt; server responses never include assessment plaintext before reveal.

## Reproduce the live proof

Run:

```bash
corepack pnpm test:sealed-review:testnet
```

The harness creates three fresh testnet accounts (operator plus two reviewers), funds only their XLM fees with Friendbot, creates a real round, submits two zero-escrow sealed assessments, checks pre-reveal privacy and allowlist rejection, waits for timed reveal, reveals both in parallel, waits for the ledger-defined clear boundary, clears, exports the canonical receipt, verifies it, decodes the Proofwork bindings, and prints evidence JSON. It uses no mainnet account, token, USDC, Trustless Work call, or application secret.

The committed run is recorded in [`docs/evidence/sub-rosa-sealed-dual-review-testnet.json`](evidence/sub-rosa-sealed-dual-review-testnet.json).
