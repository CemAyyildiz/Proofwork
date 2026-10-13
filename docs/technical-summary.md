# Technical summary

Proofwork runs a paid campaign on Stellar testnet: a project funds a budget into a Trustless Work escrow, contributors submit a post on X, a human reviewer scores each submission against a six-signal rubric, every decision is written to the Stellar ledger, approved contributors are paid in USDC from the escrow, and what is left returns to the funder. The platform never holds the money and cannot release it.

## Architecture

```
                 ┌──────────────────────── Next.js app (proofwork.online) ────────────────────────┐
 Funder wallet ──┤ /campaigns        create · deploy · fund · approve · release · close            │
 Contributor  ───┤ /c/<slug>         wallet · USDC trustline · connect X · submit own post URL     │
 Reviewer     ───┤ /review           blind queue · six signals · reason code · one re-review       │
 Anyone       ───┤ /verify/<id>      canonical record + SHA-256 recomputed in the browser          │
 Operator     ───┤ /admin            funder access: approve · reject · revoke · access log         │
                 │                                                                                │
                 │ services (zod at every boundary, role + ownership check on every mutation)     │
                 │   ├─ escrow-ops: intent → submitted → confirmed, idempotency key per write     │
                 │   ├─ EscrowPort ── TrustlessWorkAdapter ──► Trustless Work Core API v1         │
                 │   └─ DecisionLedger ── @stellar/stellar-sdk ──► Horizon (classic tx)           │
                 │ Postgres (Neon): campaigns, submissions, decisions, payouts, escrow ops,       │
                 │   roles, access requests, access log                                           │
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

Month 1 knew a contributor only by a wallet, so nothing tied the wallet to the X account whose post it submitted. A signed-in wallet can now connect its X account with Sign in with X. A submission is accepted only from a wallet with a connected account, and only for a post that account wrote (see [Post author check](#post-author-check)).

- **Flow.** OAuth 2.0 authorization code with PKCE (S256), with Proofwork as a confidential client. `GET /api/x/connect?slug=<campaign>` sends the session wallet to X's authorize page; X sends the contributor back to `GET /api/x/callback`. The server trades the code for an access token at `api.x.com/2/oauth2/token`, reads the account from `api.x.com/2/users/me`, keeps the numeric account ID and drops the token. Those two hosts and `x.com` are fixed in code. A redirect from either API call is treated as a failure, not followed.
- **What is asked of X.** The scopes `users.read tweet.read`, the least X accepts for that one lookup. No `offline.access`, so there is no refresh token. With the contributor's token the app reads no posts and can post nothing.
- **What is stored.** One row in `x_account`: wallet public key, X account ID, time connected. The wallet is the primary key and the account ID is unique, so the database itself holds the rule of one X account per wallet and one wallet per X account. The access token, authorization code, PKCE verifier, handle and display name are never written and never logged; the adapter does not parse the handle or name out of X's reply. There is no unlink.
- **Flow state.** `state`, the PKCE verifier, the wallet that started the flow, the campaign to return to and a 10-minute expiry travel in an httpOnly, SameSite=Lax cookie sent only to `/api/x`. It is signed with a key derived from the session secret for this purpose alone, so neither cookie verifies as the other. The callback binds only when the cookie is intact and unexpired, its `state` equals the one X returned, and the session wallet is the wallet that started the flow. Otherwise X is not called. A flow is spent by clearing the cookie on every callback, so the same callback URL opened again in that browser finds no flow state. The server keeps no record of used flows: a concurrent or replayed request that still carries the cookie would pass these checks and reach X, where the single-use authorization code stops it.
- **Outcomes.** Both routes are reached by navigation and always answer with a redirect, never JSON: to `/c/<slug>?x=<outcome>#submit`, where the slug matches a fixed alphabet (never a URL), or to `/explore?x=<outcome>` when nothing says which campaign the attempt started on, as when X sends the contributor back to another browser. The outcome is one of a fixed list: connected, X account already on another wallet, wallet already has an X account, cancelled on X, try again, sign in first, X did not answer, not available, too many attempts. An unexpected failure in either route is logged by kind and shown as "X did not answer". The page shows "X account connected" from the database, never from the URL.
- **Logs.** A bind or a refused bind leaves one line with the wallet and the outcome. A failed call to X leaves the step and HTTP status; an error X returns on the authorize step is logged only when it is one of the OAuth error codes. No line carries the X account ID, a handle, a token, the code or the verifier.
- **Without credentials.** `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI` and `X_BEARER_TOKEN` are optional as a set of four. A deployment without them shows the step as "Not available yet", with nothing to press, says that submissions are not possible, and refuses every submission on the server.
- **Review stays blind.** The X account ID is used only on the server. It is not shown on the campaign page, and the review queue shows neither it nor a handle.

What the tests cover, and the live run that is still open, are in [x-connect.md](evidence/x-connect.md).

## Post author check

A submission enters the review queue only when the submitted post was written by the X account connected to the submitting wallet. The check decides acceptance and nothing else: it sets no signal, outcome or reason code, and every decision stays with the reviewer.

- **Rule.** The wallet must have a connected X account, and the author ID X reports for the post must equal that account's ID. The handle in the link decides nothing: identity comes from the post ID and the author ID. The stored link keeps the handle as the contributor typed it.
- **Lookup.** One request per submission: `GET https://api.x.com/2/tweets/<post id>?expansions=author_id`, sent with the app-only Bearer Token (`X_BEARER_TOKEN`), never a contributor's token. The host is fixed in code and the only variable is the numeric post ID parsed from the validated link: 1 to 19 digits with no leading zero, so one post has one spelling. The submitted URL itself is never fetched, and a redirect from X is a failure, not followed.
- **What X returns and what is kept.** X's reply always carries the post's text, and the expansion adds the author's handle and display name. The adapter reads `data.author_id` through a schema that strips every other field, so nothing else can reach the service, the database or a log line. The author ID is compared with the wallet's stored account ID and then dropped. The only new value stored is the post ID, which was already part of the link.
- **Nothing is accepted unverified.** Every refusal is a typed error and writes no submission row:

  | Case | Answer |
  |---|---|
  | The wallet has no connected X account | 409, "connect your X account first". X is not asked |
  | The post is already submitted, under any handle or host | 409, "this post has already been submitted". X is not asked |
  | X names another account as the author | 403, "this post was written by another X account" |
  | X reports the post as missing, deleted or not visible to the app (a protected account) | 404, "this post could not be found on X, it must be public" |
  | X gives no usable answer: timeout, 429, 5xx, the app's token refused, an unexpected body; or the deployment has no X credentials | 502, "couldn't check the post with X, try again" |

- **Order.** Campaign checks, the link, the duplicate checks, the X account, the wallet's USDC trustline, and only then X. Quota at X is spent only on a submission that could otherwise be accepted. The submit endpoint is rate limited by IP and wallet together and by wallet alone (5 requests in 10 minutes each), so a wallet cannot spend the quota by changing IPs.
- **One post, one submission.** `submission.post_id` holds the post ID under a unique index, so the same post cannot be stored twice across the app whatever handle spelling or host (`x.com`, `twitter.com`) the link carries. Two requests racing for one post both pass the check; the database refuses the second and it gets the same "already submitted" answer. Migration `0005` added the column and filled it for earlier rows from their link. Where two earlier rows carry the same post ID (one post stored under two handle spellings) neither gets one, so the migration cannot fail on existing data. A row without a post ID is matched by the ID that ends its stored link, so its post still counts under any handle or host.
- **Logs.** A failed lookup leaves one line: campaign, wallet, the failed step, the reason, the HTTP status and, on a 429, when X's limit resets. No body, token, author ID or handle. The other refusals are not logged.
- **Page.** The submit form stays locked until the wallet has a connected X account, and the X step says the post must be written by that account. The lock is a convenience; the rule is enforced in the service on every submission.
- **Earlier decisions.** The check touches only new submissions. The migration changes no decision row, so Month 1 decisions keep their canonical JSON, hash, signals and outcome, and the review log export has the same columns.

The request shape comes from X's OpenAPI document (v2.170, read 2026-10-13) and has not been sent to X yet. What the tests and a local run cover, and the live rows still open, are in [x-connect.md](evidence/x-connect.md).

## Funder access

In Month 1 a wallet became a funder only when the operator ran a database script, and a role could be granted or removed without a trace. A team now asks for funder access in the app, the operator decides on an admin page, and every change of a role is written to a log.

- **Request.** Every signed-in wallet has a `/campaigns` item in the navigation, labelled "Run a campaign" until it has campaigns of its own there. A wallet without the funder role sees a form on that page: a team name and a short note, and no email or other contact field. A reviewer sees the same, with a link to the review queue. `POST /api/access/requests` stores the request as pending. A wallet has at most one pending request, held by a partial unique index, so the second of two requests is refused by the database even when they arrive together. A wallet that already has funder access is refused too. The endpoint is rate limited three ways: by IP and wallet together and by wallet alone (5 requests an hour each), and by IP alone (20 an hour), so neither a changing address nor a fresh keypair per request gets past it.
- **What the wallet sees afterwards.** Its request as pending; as not approved, with the form again; or "Funder access removed", with the form again. That last state is read from the access log, not from the requests: the wallet's last funder entry is a revocation, whether the role came from an approval or from the script.
- **Decision.** `/admin` lists pending requests, the wallets that hold the funder role, and the access log. Approve and Reject act on a request; Revoke, behind a confirm step, removes funder access. Nothing is approved, rejected or revoked automatically. Approval takes effect on the wallet's next request with the session it already has, because roles are read from the database on every request and never from the cookie. A request that is no longer pending cannot be decided again. The page reads the 100 oldest pending requests and the 200 newest log entries and says so when a list is cut. `POST /api/admin/access` is rate limited per session wallet (60 calls in 10 minutes).
- **Who is the operator.** The wallet that holds the `ops` role. The page and its mutations check that role in the service against the session wallet. Any other signed-in wallet gets the not-found page and a 403 from `POST /api/admin/access`. The first `ops` grant is made once with `pnpm role:grant` ([deployment](deployment.md#roles)). Reviewer and ops roles cannot be requested in the app.
- **One path for role changes.** `changeRole` in `src/services/access.ts` is the only code that inserts into or deletes from `role_grant`; a test searches the source for any other write. It changes the role and writes the log entry in one database transaction, so a change that fails leaves no entry and an entry never exists without its change. Approval runs in the same transaction as the request's status change. Granting a role already held, or revoking one not held, changes nothing and writes nothing. `pnpm role:grant` calls the same function, one role at a time, and its entries are marked `script`.
- **Access log.** `access_log` holds one row per grant or revocation: wallet, role, action, the ops wallet that acted (empty for the script), `admin` or `script`, the campaign a scoped grant belongs to, the request behind an approval, and the time. No code updates or deletes a row. A rejection is recorded on the request, not in the log: the log is the history of roles, and a rejection changes none.
- **Revocation and money already in escrow.** Two rules, each in one place.
  - *After funding, ownership decides.* `canManageCampaign` is true for the campaign's owner when it holds the funder role or the campaign is funded. The payouts route (final approval, release, close), the campaign page, the campaign list and the review log all ask it, and the payout and close services check ownership again on every call. So a revoked funder keeps everything it needs to pay out and close what it funded, and revoking access never strands money in an escrow.
  - *Before funding, the role decides, with one exception.* Creating a campaign, deploying an escrow and a first fund ask for the funder role. The exception is a fund already sent to the network: if its record is `submitted`, `failed` or `confirmed` while the campaign is not yet marked funded, the budget may already be in the escrow, and the campaign's owner may call the fund step without the role (`fundSubmitted`, checked in the escrow route). That call reads the chain. If the budget is there, the operation is confirmed and the campaign becomes funded, which puts it under the first rule. If it is not, the operation is rebuilt and is back at its first state, where submitting it needs the role again, so no new money can go in.

A local run of the whole flow, and what the tests cover, are in [funder-access.md](evidence/funder-access.md).

## Funder limits and funding readiness

Once a team can become a funder without the operator, two things are checked before its campaign costs anything: how much the funder already has open, and whether its wallet can pay.

- **What counts.** A campaign counts against its funder from the moment its escrow is deployed until the campaign is closed: `escrow_contract_id` set and `closed_at` empty. A draft without an escrow counts for nothing, so an abandoned draft never blocks anyone. A deployed campaign that was never funded counts until it is closed.
- **The two caps.** Open campaigns and the sum of their budgets. Defaults are 2 campaigns and 100 USDC, set through `FUNDER_MAX_OPEN_CAMPAIGNS` and `FUNDER_MAX_OPEN_BUDGET` in the validated server environment ([deployment](deployment.md#funder-limits)). The same values apply to every funder. The 49-reward limit of one campaign is separate and unchanged.
- **Where they are enforced.** In `src/services/campaign.ts`, twice: when a campaign is created, and again when its deploy transaction is requested, where the campaign being deployed is added to what the funder's other campaigns use. The check at creation is the early warning; the one at deploy is the one that holds, because drafts do not count. A refusal is a 409 that names the cap, the limit and the current usage, for example "open-budget limit exceeded: this wallet has 80 of 100 USDC in use and this campaign adds 30 USDC". A campaign that breaks both caps gets both named. A refused create stores no campaign, and a refused deploy records no escrow operation.
- **Shown before creating.** The new-campaign page shows both limits and the wallet's current usage above the form. At a cap it says so and the save button is off.
- **Ready means four things.** The account exists; it has an authorised USDC trustline from the configured issuer; the USDC it can spend covers the campaign budget; and it has enough spendable XLM for the fees ahead. Spendable XLM is the balance minus the minimum reserve (two base reserves of 0.5 XLM plus one per subentry, adjusted for sponsored entries) minus selling liabilities. Spendable USDC is the balance minus selling liabilities. All amounts are compared as stroops, never as floats.
- **The fee floor.** 0.5 XLM for each escrow transaction still to sign: 1 XLM before deploy, which is followed by fund, and 0.5 XLM before fund. The Week 1 deploy and fund transactions bid 0.0444693 and 0.0698270 XLM and were charged 0.0380569 and 0.0298443; the hashes are next to the constant in `src/domain/funding-readiness.ts`.
- **One read.** `readFunderAccount` in `src/wallet/onboarding.ts` asks Horizon for the session wallet's account, at the configured host, with the public key as the only variable. Nothing is cached.
- **On the campaign page.** While a campaign is a draft or deployed but not funded, a readiness panel shows the result of a server-side read that waits at most four seconds. Every missing item is listed at once, each with what to do: activate the account, add the trustline, where testnet USDC comes from (Circle's faucet, Stellar Testnet), or how much XLM is needed. The deploy and fund buttons are off while the wallet is not ready. "Check again" asks the server for a fresh read. Activating with Friendbot and adding the trustline run in the funder's browser and wallet, as on the contributor page; Proofwork sends nothing to the funder and signs nothing for it.
- **On the server.** The deploy and fund transactions are not built for a wallet that is not ready: a 409 listing the same missing items. When Horizon answers with an error or not at all, the page shows the wallet as not checked with a retry, the server answers 502 "couldn't check your wallet on Stellar, try again", builds nothing, and logs one line with the wallet and the reason.
- **A fund already on chain is never blocked.** The readiness check sits where a transaction is built, after the escrow has been asked about a fund that was already sent. If that fund landed, the operation is confirmed and the campaign becomes funded without the wallet being read; by then the budget has left the wallet and it would read as short of USDC. The page keeps the fund button on in that state for the same reason.
- **Nothing after funding depends on either check.** Approval, release and close never read the caps or the wallet. A funder that is over a cap, or whose wallet is empty, can still pay out and close what it funded.

The testnet reads for each wallet state and a local run of the pages and routes are in [funder-readiness.md](evidence/funder-readiness.md).

## Security model

- **No custody by the app.** The platform keys cannot move funds; release needs the funder's wallet, the remainder needs the dispute resolver (see Known limits for who holds that key in Month 1).
- **Money state comes from chain.** Every escrow write is recorded as intent → submitted → confirmed with an idempotency key, and confirmed only after the escrow is read back and shows the effect. A retry never submits a second transaction. Nothing is shown as paid from a database write alone.
- **Wallet login.** Single-use signed nonce with expiry; httpOnly, Secure, SameSite=Lax session cookie; logout revokes server-side.
- **X.** Only the X account ID is kept from Sign in with X, and nothing from the post-author lookup. Tokens, codes, the PKCE verifier, handles and post text are never stored or logged, and the X credentials are server environment only (see X account connection and Post author check).
- **Authorization** is checked in the service layer on every mutation against the caller's wallet, role and campaign ownership. Roles change only through one function that logs the change in the same transaction (see Funder access).
- **Input.** Every route and server action validates with zod. Submission URLs must be `https://x.com/<handle>/status/<id>` (or twitter.com); the server never fetches them. It asks X's API, on a fixed host, about the numeric post ID alone.
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
- **The X checks are not proven live.** Connecting an account and checking a post's author have run against a fake and a fetch stub only; the runs against X itself need an X developer app whose plan includes post lookup. The lookup's request shape is taken from X's OpenAPI document, and the first live call has to confirm it.
- **Every submission depends on X.** While X is down, the app's lookup quota is used up, or the X credentials are missing, nobody can submit: the server refuses and asks to try again. Nothing is queued for a later check.
- **The author check says who posted, not what.** It reads no content, so whether a post is original work stays a rubric signal for the reviewer. It runs once, at submission: a post deleted or made private afterwards is not noticed by the app.
- **Reposts are not confirmed.** A repost has its own post ID, and X may report the account that reposted as its author. If it does, a contributor could submit their repost of someone else's post and pass the author check, and only the reviewer's originality signal would stand in the way. What X answers for a repost's ID has not been observed; the open live run in [x-connect.md](evidence/x-connect.md) records it.
- **Some earlier rows have no post ID.** Rows the migration could not fill, and any row the previous release stores after the migration, are matched by the ID that ends their link instead. One spelling escapes that: a link stored with a leading zero in its ID, which the link rule accepted before this release, is not matched to the same number without the zero.
- **The X access token is dropped, not revoked.** The app forgets it as soon as the account ID is read and never calls X's revoke endpoint, so the token stays valid at X until it expires on its own, about two hours after it was issued. No refresh token exists.
- **A connect flow is single-use only in the browser that ran it.** The callback clears the flow cookie; the server has no used-flow record. A copy of the cookie replayed inside its 10 minutes would get as far as X, which refuses a second use of the authorization code.
- **An X connection is permanent.** There is no unlink or relink: a wallet that connects the wrong account, or a contributor who loses a wallet, has no way to move the X account in the app.
- **The authorization code appears in the request URL.** X returns it as a query parameter, so the hosting platform's request log holds it. It is single use, expires 30 seconds after X issues it, and is useless without the client secret and the PKCE verifier. The app's own logs carry only the failed step and HTTP status.
- **Roles granted before the access log existed have no entry.** The log starts with migration `0006`. Wallets that already held a role appear under Funders on the admin page, marked as granted with the script, with nothing in the log until their role next changes.
- **The access log is append-only by code, not by the database.** No code path updates or deletes a row and a test checks that, but the application's database user could. Nothing in Postgres forbids it.
- **A team is not told about a decision.** No contact detail is collected, so there is nothing to send: the team opens `/campaigns` again to see whether the request was approved.
- **Revocation freezes a campaign that is not funded.** Its owner can no longer deploy, fund, approve, release or close it and no longer sees its page; with no fund submitted, no money is in that escrow. Granting access again restores it.
- **A fund in flight at revocation is finished by a request, not on a page.** The owner can still call the fund step, which reconciles a fund that landed, but the campaign page stays a not-found page until the campaign is marked funded, so nothing in the app offers the button. Until that call is made, or the operator grants access again, the budget sits in the escrow with the campaign shown as unfunded.
- **The admin lists are cut, not paged.** Past 100 pending requests the newer ones appear only as older ones are decided, and log entries beyond the newest 200 are read from the database, not the page.
- **The request limit by address counts everyone behind it.** Twenty requests an hour from one IP is shared by all wallets on that network.
- **X only, USDC only.** Submissions are X posts and payouts are USDC; no other platform or asset is supported.
- **The caps can be passed by a funder racing itself.** A deploy is checked when its transaction is requested, not when the signed transaction comes back. A funder that requests deploys for several drafts before submitting any of them passes the check each time and can send them all. The campaign page prepares, signs and submits in one step, so this takes several pages or direct requests at once, and it is accepted for the sprint.
- **Drafts are not limited.** Only deployed campaigns count, so a funder can save any number of drafts.
- **A cap is freed at close, not at the remainder return.** A campaign stops counting when the funder's close is confirmed, which can be before the resolver has swept the remainder back.
- **Readiness is a reading, not a reservation.** The wallet is read when the page renders and again when a transaction is requested. If the balance changes between that read and the signature, the transaction fails in the wallet as it did before this check existed.
- **The fee floor is a constant.** It comes from two testnet transactions. If network fees rise past it, a wallet shown as ready could still fail to pay; the constant has to be raised by hand.
- **Short of XLM has no button.** Friendbot only creates accounts and does not top up one that exists, so a wallet short of XLM is told how much it needs and has to get it elsewhere.
- **A trustline the issuer has not authorised reads as no trustline.** The advice to add one is then wrong. Testnet USDC does not require authorisation, so this has not been seen.
- **The ready path has not been run against Trustless Work.** A wallet read as ready has not yet deployed and funded an escrow through the app in a recorded run; see the open rows in [funder-readiness.md](evidence/funder-readiness.md).

## Month 2 next steps

- Move to Trustless Work v2 batch approve-and-release so one signature pays every approved contributor.
- Replace the classic-transaction decision record with a small Soroban contract queryable by submission ID.
- In-app second-reviewer mode, so agreement is measured on every campaign rather than a subset.
- Self-service campaign creation and a scheduled close reminder.
- Tighten the rubric signals the [results](results.md) show as weak, then run a larger campaign before any mainnet step.
