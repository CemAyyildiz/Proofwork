# Proofwork

Human-verified bounties, settled on Stellar.

A project funds a campaign budget into a [Trustless Work](https://trustlesswork.com) escrow. Contributors complete a task on X and submit a link. Every submission is reviewed against a written six-signal rubric; each decision is committed on-chain with a reason code and a hash of the full record. Approved contributors are paid in USDC from escrow, and the remainder returns to the funder at the deadline.

The platform never holds funds and never has release authority.

## Status

Stellar Instawards sprint, Stellar Türkiye chapter. **Testnet only.** One hand-run campaign; not a self-service platform.

## How it works

| Step | Who signs | What happens on-chain |
|---|---|---|
| Create campaign, deploy escrow | Funder wallet | Multi-release escrow deployed with a "campaign close" milestone |
| Fund budget | Funder wallet | USDC moves into the escrow contract |
| Submit work | Contributor wallet (login only) | Nothing; the URL is stored |
| Review | Reviewer wallet (login only) | One `manage_data` + `memo_hash` transaction per decision from the decision ledger account |
| Re-review (once) | Contributor requests, reviewer decides | Second decision, ledger key `pw:<id>:a1`, linked to the first by hash |
| Approve for payout | Platform keys | Milestone appended per approved submission, marked delivered and approved |
| Release | Funder wallet | One transaction per milestone; USDC goes to the contributor |
| Close | Funder wallet, then dispute resolver | Close milestone disputed; resolver sweeps the remainder back to the funder |

Roles on the escrow: funder = release signer; platform keys = platform address (append milestones) and service provider + approver (mark delivered, approve); a neutral key = dispute resolver. The platform keys can never move money; the funder's release signature is the final approval.

Known limit: Trustless Work v1 builds one transaction per milestone, so a campaign with N payouts needs N release signatures. v2 offers batch approve-and-release in one transaction and is the planned Month 2 upgrade.

## Stack

Next.js (App Router, TypeScript strict) · Postgres + Drizzle · Trustless Work Core API v1 (multi-release escrow) · Stellar Wallets Kit (Freighter) · `@stellar/stellar-sdk` for the decision ledger.

## Run locally

```bash
pnpm install
cp .env.example .env          # fill in; see comments in the file
pnpm keys:gen                 # testnet server keys → paste into .env
pnpm accounts:prepare         # create the accounts on testnet, open USDC trustlines
pnpm db:migrate
pnpm dev
```

Grant roles to wallets (global):

```bash
pnpm role:grant G...FUNDER funder
pnpm role:grant G...REVIEWER reviewer
```

Quality gate, enforced by the pre-commit hook and CI:

```bash
pnpm check                    # typecheck + lint + unit tests
```

## Verify the escrow cycle on testnet

```bash
pnpm spike
```

Deploys an escrow, funds it, appends a milestone after funding, marks it delivered, approves, releases, disputes the close milestone, sweeps the remainder back to the funder, and commits one decision record on-chain. Every transaction hash is written to `docs/evidence/escrow-cycle.md`. The funder key needs testnet USDC (Circle faucet, Stellar testnet).

Return a closed campaign's remainder with the resolver key:

```bash
pnpm escrow:close C...CONTRACT
```

## How a decision is verifiable

Each decision is one classic Stellar transaction from the decision ledger account:

- `manage_data` key `pw:<submission>` (or `pw:<submission>:a1` for the one-shot re-review), value `v1|PASS|R00_PASS|<hash prefix>`
- `memo_hash` = SHA-256 of the canonical decision JSON (stored in the database and shown on `/verify/<decision>`)

The verify page recomputes the hash in the browser. Compare it with the memo in any explorer. No tooling required.

## Layout

```
src/config     validated environment (server) and public constants
src/db         schema + migrations
src/domain     rubric, reason codes, submission URL rules, wallet signature check
src/escrow     EscrowPort + Trustless Work adapter + in-memory fake
src/ledger     canonical decision record + on-chain commit
src/services   auth, campaign, escrow-ops, submission, review, payout
src/app        routes: /campaigns (funder), /c/[slug] (contributor), /review, /verify/[id]
src/wallet     browser wallet layer (Wallets Kit)
scripts        key generation, account prep, spike, escrow close, role grant
tests/unit     no network
docs/evidence  tx hashes, results table
```

## Security

Server signing keys live only in server environment and sign only operations that move no money. Wallet login is a single-use signed nonce; logout revokes the session server-side. Every wallet-signed escrow operation is prepared by the server and the signed envelope must hash-match what was prepared, so the API key can never submit an arbitrary transaction. All inputs are schema-validated at the boundary. Money state is read from chain, never from the database alone.
