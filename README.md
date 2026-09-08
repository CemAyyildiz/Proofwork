# Proofwork

Human-verified bounties, settled on Stellar.

A project funds a campaign budget into a [Trustless Work](https://trustlesswork.com) escrow. Contributors complete a task on X and submit a link. Every submission is reviewed against a written six-signal rubric; each decision is committed on-chain with a reason code and a hash of the full record. Approved contributors are paid in USDC from escrow, and the remainder returns to the funder at the deadline.

The platform never holds funds and never has release authority.

## Status

Stellar Instawards sprint, Stellar Türkiye chapter. **Testnet only.** One hand-run campaign; not a self-service platform.

## Stack

Next.js (App Router, TypeScript strict) · Postgres (Neon) + Drizzle · Trustless Work Core API v2 (multi-release escrow) · Stellar Wallets Kit · `@stellar/stellar-sdk` for the decision ledger.

## Run

```bash
pnpm install
cp .env.example .env         # fill in; see comments in the file
pnpm keys:gen                # testnet server keys → paste into .env
pnpm db:generate && pnpm db:migrate
pnpm dev
```

Quality gate, run before every commit:

```bash
pnpm check                   # typecheck + lint + unit tests
```

## Verify the escrow cycle on testnet

```bash
pnpm spike
```

Deploys an escrow, funds it, appends a milestone after funding, marks it delivered, approves, releases, sweeps the remainder back to the funder, and commits one decision record on-chain. Every transaction hash is written to `docs/evidence/escrow-cycle.md`. The funder key needs testnet USDC (Circle faucet, Stellar testnet).

## How a decision is verifiable

Each decision is one classic Stellar transaction from the decision ledger account:

- `manage_data` key `pw:<submission>` (or `pw:<submission>:a1` for the one-shot re-review), value `v1|PASS|R00_PASS|<hash prefix>`
- `memo_hash` = SHA-256 of the canonical decision JSON (stored in the database and shown on the public verify page)

Recompute the hash from the JSON, compare with the memo in any explorer. No tooling required.

## Layout

```
src/config     validated environment (server) and public constants
src/db         schema + migrations
src/domain     rubric, reason codes, submission URL rules
src/escrow     EscrowPort + Trustless Work adapter + in-memory fake
src/ledger     canonical decision record + on-chain commit
src/services   auth, campaign, submission, review, payout
src/app        routes
scripts        key generation, testnet spike
tests/unit     no network
tests/testnet  opt-in, needs keys
docs/evidence  tx hashes, results table
```

## Security

Server signing keys live only in server environment and sign only operations that move no money. Wallet login is a single-use signed nonce. All inputs are schema-validated at the boundary. Money state is read from chain, never from the database alone. See `docs/technical-summary.md` once the campaign has run.
