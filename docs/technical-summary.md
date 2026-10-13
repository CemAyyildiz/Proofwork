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

## Shared funding source warning

The rubric asks whether one person is behind several accounts. To give the reviewer something to judge that by, the app records which Stellar account created each submitting wallet and warns when submissions in the same campaign are linked.

- **Capture.** When a submission is accepted, the server reads the first operation of the contributor's wallet from Horizon (`/accounts/<wallet>/operations?order=asc&limit=1`) and stores the `funder` of its `create_account`. The host comes from config and the session wallet's public key is the only variable in the URL. If the read fails or the account has no creation record, the submission is still accepted and the source stays unknown.
- **Link rule.** Two submissions are linked when they are in the same campaign and either both wallets were created by the same account, or one wallet created the other. Public sources never link: Friendbot's testnet account is always excluded, and more faucets can be listed in `PUBLIC_FUNDING_SOURCES`. The raw creator is stored and the exclusion is applied when the queue is read, so adding a faucet clears earlier warnings without touching data. Submissions with an unknown source are shown as "Funding source not checked" and are never counted as a link. Nothing is compared across campaigns.
- **What the reviewer sees.** A count only: "Shared funding source: N other submissions in this campaign". No wallet address, no source address and no ID of a linked submission reaches the queue. The warning informs and decides nothing: all six signals start as they do on any other card, and no outcome or reason code is derived from it.
- **What is kept.** The review card posts the count it showed together with the decision. That count is stored beside the review time as posted, not recomputed, and exported as `shared_funding_count` in the review log (above 0: warned; 0: source read, no link found; empty: not checked). It is not part of the canonical decision JSON, so decision hashes and the on-chain record format are unchanged and Month 1 decisions verify as before.

Read back on testnet in [funding-source.md](evidence/funding-source.md).

## X account connection

Month 1 knew a contributor only by a wallet, so nothing tied the wallet to the X account whose post it submitted. A signed-in wallet can now connect its X account with Sign in with X. Connecting is not yet required to submit; that check is a later step.

- **Flow.** OAuth 2.0 authorization code with PKCE (S256), with Proofwork as a confidential client. `GET /api/x/connect?slug=<campaign>` sends the session wallet to X's authorize page; X sends the contributor back to `GET /api/x/callback`. The server trades the code for an access token at `api.x.com/2/oauth2/token`, reads the account from `api.x.com/2/users/me`, keeps the numeric account ID and drops the token. Those two hosts and `x.com` are fixed in code. A redirect from either API call is treated as a failure, not followed.
- **What is asked of X.** The scopes `users.read tweet.read`, the least X accepts for that one lookup. No `offline.access`, so there is no refresh token. The app reads no posts and can post nothing.
- **What is stored.** One row in `x_account`: wallet public key, X account ID, time connected. The wallet is the primary key and the account ID is unique, so the database itself holds the rule of one X account per wallet and one wallet per X account. The access token, authorization code, PKCE verifier, handle and display name are never written and never logged; the adapter does not parse the handle or name out of X's reply. There is no unlink.
- **Flow state.** `state`, the PKCE verifier, the wallet that started the flow, the campaign to return to and a 10-minute expiry travel in an httpOnly, SameSite=Lax cookie sent only to `/api/x`. It is signed with a key derived from the session secret for this purpose alone, so neither cookie verifies as the other. The callback binds only when the cookie is intact and unexpired, its `state` equals the one X returned, and the session wallet is the wallet that started the flow. Otherwise X is not called. The cookie is cleared on every callback, so the same callback URL opened twice finds no flow state the second time.
- **Outcomes.** Both routes answer with a redirect to `/c/<slug>?x=<outcome>`, where the slug matches a fixed alphabet (never a URL) and the outcome is one of a fixed list: connected, X account already on another wallet, wallet already has an X account, cancelled on X, try again, sign in first, X did not answer, not available, too many attempts. The page shows "X account connected" from the database, never from the URL.
- **Without credentials.** `X_CLIENT_ID`, `X_CLIENT_SECRET` and `X_REDIRECT_URI` are optional as a set. A deployment without them shows the step and answers "X sign-in is not available right now".
- **Review stays blind.** The X account ID is used only on the server. It is not shown on the campaign page, and the review queue shows neither it nor a handle.

What the tests cover, and the live run that is still open, are in [x-connect.md](evidence/x-connect.md).

## Security model

- **No custody by the app.** The platform keys cannot move funds; release needs the funder's wallet, the remainder needs the dispute resolver (see Known limits for who holds that key in Month 1).
- **Money state comes from chain.** Every escrow write is recorded as intent → submitted → confirmed with an idempotency key, and confirmed only after the escrow is read back and shows the effect. A retry never submits a second transaction. Nothing is shown as paid from a database write alone.
- **Wallet login.** Single-use signed nonce with expiry; httpOnly, Secure, SameSite=Lax session cookie; logout revokes server-side.
- **X sign-in.** Only the X account ID is kept. Tokens, codes, the PKCE verifier and handles are never stored or logged, and the X credentials are server environment only (see X account connection).
- **Authorization** is checked in the service layer on every mutation against the caller's wallet, role and campaign ownership.
- **Input.** Every route and server action validates with zod. Submission URLs must be `https://x.com/<handle>/status/<id>` (or twitter.com); the server never fetches them.
- **Secrets** live only in server environment, validated at startup, never logged and never in the client bundle. Security headers (CSP, HSTS, nosniff, Referrer-Policy, frame-ancestors none) on every response; public write endpoints are rate limited.
- **Blind review.** The queue shows no contributor identity beyond the post URL, in a stable non-chronological order. The shared-funding warning adds a count, never an address. The list of planted fakes was never stored in the app database; it was joined to the exported review log only after scoring ([results](results.md)).

## Known limits

- **One campaign, one reviewer.** The results are a directional first signal, not a validated fraud benchmark. The sample is in the tens, so a single submission moves each rate by several points.
- **Reviewer is also the builder.** Mitigated by having a second person write and submit the planted fakes from separate accounts and keep the list outside the app, but not eliminated.
- **Trustless Work v1 builds one transaction per release.** A campaign with N payouts needs N funder signatures.
- **Manual close.** The remainder returns only when the funder closes and the resolver sweeps; there is no timer.
- **The operator holds the dispute resolver key in Month 1.** `pnpm escrow:close` runs with `DISPUTE_RESOLVER_SECRET` from the operator's environment, not from a Chapter Lead wallet. The resolver chooses the destination of `withdraw-remaining-funds`; the script sends the balance to the escrow's funder, but the key itself could send it elsewhere. The sweep tx on stellar.expert shows where the remainder went.
- **Testnet only.** Testnet USDC has no value; the server keys are sprint keys.
- **The funding warning is a hint.** It sees only the account that created a wallet. Wallets each activated straight from Friendbot, which is what the app's own onboarding does, never link, so a count of 0 means no link was found, not that the accounts are independent. A link that appears after a decision is not added to that decision: its log row keeps the count the reviewer saw. Unrelated wallets created by the same exchange, or by a faucet that is not on the public list, are flagged together; wallets one person funds through separate intermediate accounts are not; and a wallet whose first Horizon record is not its creation is not checked at all.
- **The X connection is not yet enforced or proven live.** A wallet can still submit without connecting, and the app does not yet check that a submitted post was written by the connected account. The flow has run against a fake and a fetch stub only; the run against X itself needs an X developer app.
- **An X connection is permanent.** There is no unlink or relink: a wallet that connects the wrong account, or a contributor who loses a wallet, has no way to move the X account in the app.
- **The authorization code appears in the request URL.** X returns it as a query parameter, so the hosting platform's request log holds it. It is single use, expires 30 seconds after X issues it, and is useless without the client secret and the PKCE verifier. The app's own logs carry only the failed step and HTTP status.
- **X only, USDC only**, and the campaign is created and run by hand; this is not a self-service platform.

## Month 2 next steps

- Move to Trustless Work v2 batch approve-and-release so one signature pays every approved contributor.
- Replace the classic-transaction decision record with a small Soroban contract queryable by submission ID.
- In-app second-reviewer mode, so agreement is measured on every campaign rather than a subset.
- Self-service campaign creation and a scheduled close reminder.
- Tighten the rubric signals the [results](results.md) show as weak, then run a larger campaign before any mainnet step.
