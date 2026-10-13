# External funder rehearsal

Before a team other than Proofwork runs a campaign, the path it will take was run once on Stellar testnet with a wallet that never had a role: request funder access, get approved on the admin page, pass the readiness check, create, deploy and fund a campaign, lose funder access, close the campaign, and get the remainder back from the dispute resolver. A second campaign was deployed and abandoned without being funded.

This page records what happened, including the two steps that failed on the first try and the result that differs from what was expected: the remainder came back less the 0.3% Trustless Work protocol fee, not whole. The submission, review and payout steps were not run; they are listed at the end with what they need.

Run: 2026-10-13, 15:21 to 17:52 UTC · Network: Stellar testnet · Escrow: Trustless Work Core API v1 (`dev.api.trustlesswork.com`) · App: a local instance of this repository (`next dev`) on a scratch Postgres 17 database with every migration applied through `pnpm db:migrate`. Nothing here touched proofwork.online or its database.

The app ran the code of commit `732a612`. Nothing in the app was changed for the run. From 17:48 UTC the file `src/services/payout.ts` also held two functions that the close script calls and no route does; they were committed after the run as `6cd97c5`. The close script changed during the run, and again after it: [What the run changed in the close script](#what-the-run-changed-in-the-close-script) gives the order and the commits.

The machine running the app was on battery and kept going to sleep. Four of those sleeps, of about 15 minutes each, began in the middle of a step: at 15:21, 15:37, 15:53 and 17:28 UTC (the system's power log has them). That explains the gaps in the times below and caused the two failed steps. Nothing was done between 16:10 and 17:16 except reading the chain to find out what the failed deploy had left behind.

## Who signed what

| Name | Address | Where the key was | Role |
|---|---|---|---|
| Funder | [`GBYRWD7HPWAQYIJHTMVLQVUB26DJSVU742MZVX3M5YH55QJN46ZQANOT`](https://stellar.expert/explorer/testnet/account/GBYRWD7HPWAQYIJHTMVLQVUB26DJSVU742MZVX3M5YH55QJN46ZQANOT) | Generated for this run, discarded after it | No role at the start. Got funder access through the request and the approval below, and no other way |
| Operator | [`GCMDAWXJVBDLOVAOPVYZMBMCKYF4WGLZBD5NF6M3AUP3RYDTL6VRHVFE`](https://stellar.expert/explorer/testnet/account/GCMDAWXJVBDLOVAOPVYZMBMCKYF4WGLZBD5NF6M3AUP3RYDTL6VRHVFE) | Generated for this run, discarded after it | `ops`, granted once with `pnpm role:grant` as the [deployment doc](../deployment.md#roles) says |
| Dispute resolver | [`GAVJKKCJZTCMBV3ARSQSBRQXHAD57T7ZD35BIDCIGTTMEORJCUJ26FWJ`](https://stellar.expert/explorer/testnet/account/GAVJKKCJZTCMBV3ARSQSBRQXHAD57T7ZD35BIDCIGTTMEORJCUJ26FWJ) | The operator's local environment (`DISPUTE_RESOLVER_SECRET`) | `disputeResolver` on both escrows; signed the sweep |
| Platform admin | `GBHJQNVVF5AENYPS3VIAPSH6R6T2PDMDPPS5LHUD56RGZNTD7SRG4PPA` | The app's server environment | `platformAddress` on the escrows; signed nothing in this run |
| Platform ops | `GBJZ6AF6BYYVGT6QLYBJY2PVDXIQ6IAATLLI5LYLDFPPZ6GG2EVBQMTD` | The app's server environment | `serviceProvider` and `approver`; signed nothing in this run |

The funder is not the key in the operator's environment (`FUNDER_SECRET`), which is the Week 1 spike funder `GCWGOELY…NCCC3` and took no part.

There was no browser and no wallet extension. A script outside the repository held the two generated keys, signed the wallet challenge with them, called the same routes the pages call, and signed each transaction the app returned. It read the pages as HTML with the session cookie. No secret was written to the repository, a log or this page.

## Every transaction

Read back from Horizon after the run: the source account, the fee bid (`max_fee`) and the fee charged.

| # | Step | Tx | Source account (signer) | Fee bid (XLM) | Fee charged (XLM) |
|---|---|---|---|---|---|
| 1 | Operator wallet created by Friendbot | [65fa18360a70…](https://stellar.expert/explorer/testnet/tx/65fa18360a70090159e3a698531718fd2a9322f896389b29a2ff31792e0ab53c) | Friendbot | | |
| 2 | Funder wallet created by Friendbot | [7c4c9d2de2a9…](https://stellar.expert/explorer/testnet/tx/7c4c9d2de2a9a76ae29f80e4e6d494d6045ccec6a8ff06e2eef83dbf1d1776a0) | Friendbot | | |
| 3 | Funder opens the USDC trustline | [edaa5e9396aa…](https://stellar.expert/explorer/testnet/tx/edaa5e9396aa0035f367f7f2016e5f274cd8ddf33a277fbfe821ad0e838ddb93) | Funder | 0.00001 | 0.00001 |
| 4 | Funder buys 10 USDC with its own XLM on the testnet order book | [905304514c24…](https://stellar.expert/explorer/testnet/tx/905304514c24e2f9d44d4fffc4c2a54a52caf1484f429c8698c30affe527efd3) | Funder | 0.00001 | 0.00001 |
| 5 | Deploy escrow, campaign one, first attempt. Landed on chain; the app recorded it as failed (see [The deploy that landed unseen](#the-deploy-that-landed-unseen)) | [3cb22c4d8c48…](https://stellar.expert/explorer/testnet/tx/3cb22c4d8c48efb4cd318d155ceadd985ace8e79b73a29cef956edf1a5bdcd9f) | Funder | 0.1073584 | 0.0927511 |
| 6 | Deploy escrow, campaign one, second attempt | [5e5759254e86…](https://stellar.expert/explorer/testnet/tx/5e5759254e86e8dc08f1f5e3bfa7d3daa80fea4364e67578935ee0eae143f535) | Funder | 0.1083558 | 0.0936184 |
| 7 | Fund campaign one with 5 USDC | [aa5f5a7fabdc…](https://stellar.expert/explorer/testnet/tx/aa5f5a7fabdca1670c090aeb57dac7c1fbe825ebde71be2cb8a609a543518ce0) | Funder | 0.1586494 | 0.0684730 |
| 8 | Deploy escrow, campaign two (never funded) | [4c45e70c178c…](https://stellar.expert/explorer/testnet/tx/4c45e70c178c491650abfdfe93db960b1cadf526f3f77522fda88d03c34cbe0f) | Funder | 0.1087375 | 0.0939504 |
| 9 | Close campaign one: dispute the close milestone, after funder access was revoked | [543b1fd6c5e7…](https://stellar.expert/explorer/testnet/tx/543b1fd6c5e7ee68170eea975c0c1acbbc6c404ac70bae07a8d2bf05af84bf67) | Funder | 0.0049026 | 0.0014066 |
| 10 | Withdraw the remainder of campaign one | [2df7fde33230…](https://stellar.expert/explorer/testnet/tx/2df7fde332303415e48ed3c53163a1c3e1b8e512a5a2c68facdd8a8e0286bbb1) | Dispute resolver | 0.0082297 | 0.0030341 |

Escrow contracts:

| Escrow | Campaign | State at the end, read through the app's adapter at 17:52 UTC |
|---|---|---|
| [`CCVVC2IBJTSIQCAZYWYAZW5VOLIECQXBAQKU74BSIXGAHY3DLFFVUOSC`](https://stellar.expert/explorer/testnet/contract/CCVVC2IBJTSIQCAZYWYAZW5VOLIECQXBAQKU74BSIXGAHY3DLFFVUOSC) | one, `rehearsal-campaign-one-gcqziy` (tx 6, 7, 9, 10) | balance 0, close milestone disputed |
| [`CB2FLQGD7APRAOYVJ3Q3SM57UHSN3GTZHSKVFQM3XYO3ESDQNW3S3QUE`](https://stellar.expert/explorer/testnet/contract/CB2FLQGD7APRAOYVJ3Q3SM57UHSN3GTZHSKVFQM3XYO3ESDQNW3S3QUE) | two, `rehearsal-campaign-two-mnas2-` (tx 8) | balance 0, never funded, abandoned in the app |
| [`CCCSKITIVPKRDPNWZOMGVWZKEFGI5A5GF56YSJJMW77UMA6KGGV7QR5D`](https://stellar.expert/explorer/testnet/contract/CCCSKITIVPKRDPNWZOMGVWZKEFGI5A5GF56YSJJMW77UMA6KGGV7QR5D) | one, from the first deploy attempt (tx 5) | balance 0, never funded, unknown to the app |

All three name the funder above as `releaseSigner` and the dispute resolver above as `disputeResolver`. What the app itself recorded for campaign one is in [rehearsal-campaign.md](rehearsal-campaign.md), written by `pnpm evidence:dump`.

**The fee floor.** The readiness check asks for 0.5 XLM free for each escrow transaction still to sign: 1 XLM before deploy, 0.5 XLM before fund ([technical summary](../technical-summary.md#funder-limits-and-funding-readiness)). The largest bid in this run was 0.1586494 XLM, for the fund, so the floor was a little over three times the largest bid. That is less room than on 2026-09-23, when the Week 1 deploy and fund bid 0.0444693 and 0.0698270 XLM: the bids have more than doubled since. The floor still held for every transaction.

## Request to approval

The funder wallet signed in with the wallet challenge. Times are UTC.

| Time | Who | Step | Answer | What the page showed |
|---|---|---|---|---|
| 15:21:15 | Operator's machine | `pnpm role:grant <operator> ops` against the scratch database | `granted ops for GCMD…HVFE; access log entry written` | |
| 15:21:25 | Funder | Sign in | 200, roles `[]` | |
| 15:36:36 | Funder | `GET /campaigns` | 200 | "Request funder access" with the form; no "New campaign" |
| 15:36:36 | Funder | `POST /api/campaigns` | 403 "requires funder role" | |
| 15:36:37 | Funder | `POST /api/access/requests` (team "Rehearsal Team" and a note) | 200, `status: pending` | |
| 15:36:37 | Funder | the same again | 409 "a request from this wallet is already pending" | |
| 15:36:38 | Funder | `GET /campaigns` | 200 | "Funder access requested", "Pending", the team name; no form |
| 15:36:38 | Funder | `GET /admin` | 404 | Neither the requests nor the log |
| 15:36:39 | Operator | `GET /admin` | 200 | "Pending requests" with Rehearsal Team, the wallet, the note, Approve and Reject; "No wallet has funder access"; the access log with the operator's own grant |
| 15:37:00 | Funder | `POST /api/admin/access` approve, with the real request ID | 403 "requires ops role" | |
| 15:37:01 | Operator | `POST /api/admin/access` approve | 200, `status: approved` | |
| 15:37:01 | Operator | approve again | 409 "this request has already been decided" | |
| 15:37:01 | Operator | `GET /admin` | 200 | Funders: the wallet, "Rehearsal Team", granted 15:37 UTC, Revoke. Access log: the funder grant, by the operator's wallet |
| 15:37:01 | Funder | `GET /api/auth/me`, same session as before the approval | 200, roles `["funder"]` | |
| 15:37:02 | Funder | `POST /api/campaigns` (campaign one: 5 USDC budget, 1 USDC reward), same session | 200, campaign `rehearsal-campaign-one-gcqziy` | |

No database script ran between the request and the first campaign. The only script was the operator's own `ops` grant, before the funder had signed in.

## Not ready, then ready

The wallet came from Friendbot with 10000 XLM, no USDC trustline and no USDC.

| Time | Wallet held | Campaign page of campaign one | `prepare deploy` |
|---|---|---|---|
| 15:37:12 | 10000 XLM, no trustline | "Wallet readiness: Not ready. This wallet can't deploy the escrow and fund the budget yet. What is missing: The account has no USDC trustline. … The wallet has 0 USDC to spend and the budget is 5 USDC." with Add USDC trustline and the faucet link | 409 "your wallet is not ready to deploy the escrow. The account has no USDC trustline. … The wallet has 0 USDC to spend and the budget is 5 USDC. …", `missing: trustline, usdc (0 of 5)` |
| 15:52:46 | 9999.99999 XLM, trustline open (tx 3), 0 USDC | "Not ready … The wallet has 0 USDC to spend and the budget is 5 USDC." The trustline line is gone | 409, `missing: usdc (0 of 5)` |
| 15:53:14 | 9988.8628669 XLM, 10 USDC (tx 4) | "Wallet readiness: Ready. This wallet can deploy the escrow and fund the budget: 10 USDC to spend and 9987.3628669 XLM free for network fees." | built (next section) |

After the two refusals the database held no escrow operation: a refused deploy records nothing.

The USDC was bought with the wallet's own XLM on the testnet order book (about 11.14 XLM for 10 USDC), because Circle's faucet needs a browser. It is the same asset from the same issuer, `GBBD47IF…FLA5`.

## Create, deploy, fund

| Time | Step | Answer |
|---|---|---|
| 15:53:16 | `GET /campaigns/new` | "Open campaigns 0 of 2 in use", "Open budget 0 USDC of 100 USDC in use, 100 USDC left" |
| 15:53:27 | `prepare deploy`, campaign one | 200, an unsigned transaction |
| 15:53:32 | The signed deploy reaches the chain (tx 5) | |
| 16:10:06 | `submit deploy` answers | **502 "trustless work unreachable: /helper/send-transaction"**. The operation is recorded as `failed`; the campaign has no contract |
| 17:20:44 | `prepare deploy` again | 200, a new unsigned transaction on the same operation record |
| 17:20:51 | `submit deploy` | 200, tx 6, contract `CCVVC2IB…VUOSC` |
| 17:20:59 | Campaign page | "Contract CCVVC2IBJT…FVUOSC", "Ready. This wallet can fund the budget: 10 USDC to spend and 9987.1764974 XLM free for network fees", "2 · Fund budget", "Abandon this campaign instead" |
| 17:21:04 | `prepare fund` | 200 |
| 17:21:10 | `submit fund` | 200, tx 7. Horizon shows 5 USDC moving from the funder to the escrow contract |
| 17:27:44 | Funder wallet | 5 USDC, 9988.6080244 XLM |

### The deploy that landed unseen

The machine went to sleep with the first deploy's `send-transaction` request in flight. The transaction had already been accepted: it is in ledger 5176645, five seconds after it was prepared. The app never got the reply, read the failure as a failed submit, and marked the operation `failed`.

For any other operation the next `prepare` asks the chain whether the earlier attempt landed and confirms it instead of building a second transaction. A deploy is not checked that way yet: the check needs the new escrow's contract ID, and the app takes it only from the reply it did not receive. The ID is not lost: it is the transaction's return value, and it was read for this page from Soroban RPC with the hash the app had recorded when it prepared the deploy. The app does not make that read. So the second `prepare` built a new deploy, and the funder paid a second deploy fee (0.0936184 XLM) for a second escrow. The first escrow, `CCCSKITI…QR5D`, exists on chain with the campaign's slug as its engagement ID, holds nothing, and is not known to the app.

No money was at risk: an escrow that was only deployed holds no funds, and the campaign was funded once, into the escrow the app knows. There is nothing for an operator to undo: an escrow cannot be removed, and this one is left as it is, empty. What an operator does is keep the first transaction's hash, as here, so the orphan can be told apart from the campaign's escrow by anyone who finds two contracts with the same engagement ID. The limit is recorded in the [technical summary](../technical-summary.md#known-limits). It is not specific to an outside funder.

## Limits and abandon

| Time | Step | Answer |
|---|---|---|
| 17:27:44 | Save campaign two (3 USDC) and campaign three (2 USDC) | 200 each |
| 17:27:45 | `GET /campaigns/new` | "1 of 2 in use", "5 USDC of 100 USDC in use, 95 USDC left": the two saved campaigns count for nothing |
| 17:27:56 | `prepare deploy`, campaign two | 200 |
| 17:28:06 | `submit deploy` | 200, tx 8, contract `CB2FLQGD…3QUE` |
| 17:28:17 | `GET /campaigns/new` | "2 of 2 in use", "8 USDC of 100 USDC in use", "You have reached the open-campaign limit, so a new campaign can't be created. Close a campaign first." |
| 17:28:17 | `prepare deploy`, campaign three | 409 "open-campaign limit reached: this wallet has 2 of 2 open campaigns in use, close one first" |
| 17:28:18 | Campaign three's page | "This campaign can't be deployed while a limit is reached: open-campaign limit reached … Deploy stays off until it fits.", with the wallet shown as Ready |
| 17:28:18 | Campaign two's page | "deployed", the contract, "2 · Fund budget", "Abandon this campaign instead" |
| 17:44:17 | `abandon`, campaign two, first try | **502 "couldn't read the escrow, try again"**. The machine had slept with the escrow read in flight. The campaign stayed open; the server logged `escrow read failed before abandon` |
| 17:44:20 | `abandon` again | 200, `closedAt` set. The escrow was read and held nothing. Nothing was signed or sent |
| 17:44:20 | `prepare fund`, campaign two | 409 "campaign is closed" |
| 17:44:21 | `GET /campaigns/new` | "1 of 2 in use", "5 USDC of 100 USDC in use, 95 USDC left": the abandoned campaign no longer counts |

The first abandon is the guarded case working as written: without a read that shows an empty escrow, the campaign is not closed.

## Revoked after funding

At 17:45:49 the operator revoked the funder's access on the admin route, with campaign one funded and holding 5 USDC.

| Step | Answer | What the page showed |
|---|---|---|
| Operator: `POST /api/admin/access` revoke | 200, `changed: true` | |
| Operator: revoke again | 200, `changed: false` | |
| Funder: `GET /api/auth/me`, same session | 200, roles `[]` | |
| Funder: `POST /api/campaigns` | 403 "requires funder role" | |
| Funder: `prepare deploy`, campaign three (saved, never deployed) | 403 "requires funder role" | |
| Funder: `prepare fund`, campaign three | 403 "requires funder role" | |
| Funder: `GET /campaigns/<campaign one>` | 200 | "funded", the contract, "Funded. Contributors can submit.", "Close campaign" |
| Funder: `GET /campaigns/<campaign three>` | 404 | |
| Funder: `GET /campaigns` | 200 | "Funder access removed" with the request form; campaign one listed as funded; no "New campaign" |
| Operator: `GET /admin` | 200 | "No wallet has funder access"; the revoke entry at the top of the log |

`access_log` at the end of the run, read with `psql`, oldest first:

| Time (UTC) | Wallet | Role | Action | Acting wallet | Via | Has a request |
|---|---|---|---|---|---|---|
| 15:21:15 | `GCMD…HVFE` | ops | grant | none | script | no |
| 15:37:01 | `GBYR…ANOT` | funder | grant | `GCMD…HVFE` | admin | yes |
| 17:45:49 | `GBYR…ANOT` | funder | revoke | `GCMD…HVFE` | admin | no |

Three changes, three rows. The second revoke, the refused approval and the second approval left none.

## Close and remainder

The funder closed campaign one with no funder role, and the dispute resolver swept the remainder with `pnpm escrow:close`.

| Time | Who | Step | Answer |
|---|---|---|---|
| 17:46 to 17:48 | Operator's machine | `pnpm escrow:close <contract>` before the funder had closed, with the script as committed and again with the rewritten one | exit 1 both times, "close milestone not disputed yet: the funder must close the campaign in the app first". Nothing signed |
| 17:48:59 | Funder (revoked) | `prepare close` on the payouts route | 200 |
| 17:49:05 | Funder (revoked) | `submit close` | 200, tx 9. The campaign is closed in the app |
| 17:49 | Operator's machine | `pnpm escrow:close <contract>` with `DATABASE_URL` set to a migrated database that does not hold the campaign | exit 1, "no campaign with this escrow in 127.0.0.1:54329/proofwork_other; nothing was signed. …" |
| 17:49:21 | | Escrow read through the app's adapter | balance 5, close milestone disputed |
| 17:49:42 | Operator's machine | `pnpm escrow:close <contract>` with `FUNDER_SECRET` empty and the app's database | exit 0, tx 10, "balance after: 0 USDC", "recorded remainder on campaign rehearsal-campaign-one-gcqziy" |
| 17:50:03 | Funder | `GET /campaigns/<campaign one>` | 200: "closed", "Remainder returned: 2df7fde33230…", and deploy, fund and dispute listed as confirmed |
| 17:50:09 | Signed out | `GET /c/<campaign one>` | 200: "Closed", "Remainder returned to funder 2df7fd…86bbb1" |
| 17:50 | Operator's machine | `pnpm escrow:close <contract>` once more | exit 0, "nothing to sweep" |

**Where the money went.** Horizon lists two transfers out of the escrow in tx 10:

| To | Amount |
|---|---|
| The funder, `GBYRWD7H…QANOT` | 4.9850000 USDC |
| `GA6KH5VWPCHBOEF63X57SPX6T4H366YFFKKGCVDBTXT2N7JVL6PJCK7G` | 0.0150000 USDC |

The funder's wallet held 5 USDC before the sweep and 9.985 USDC after it. So the remainder returned to the wallet that funded the campaign, and to no other wallet of this project, but it did not return whole: 0.3% of the swept balance went to the second address. That address is where Trustless Work's protocol fee goes. The Week 1 run shows the same split, which was not noticed at the time: its sweep ([650cb074d28e…](https://stellar.expert/explorer/testnet/tx/650cb074d28ee51bd5b58b37fcccf8ccb361449f6937c97bde6dd966c58935dd)) sent 3.988 USDC to the funder and 0.012 USDC to the same address, and its release ([360d69ee23f8…](https://stellar.expert/explorer/testnet/tx/360d69ee23f843dbb237bd1d7533f14b891ac47bb83fdd9d25bb62eecf20658e)) sent 0.003 USDC of a 1 USDC reward there.

A team that funds 5 USDC and pays nobody gets 4.985 USDC back. The app's own wording said "the whole remaining balance"; the technical summary now says what the chain shows.

### What the run changed in the close script

The script that swept is not the script that was in the repository when the run began, and not the one that is there now. In order:

| When (UTC) | Script | What was run | Result |
|---|---|---|---|
| 17:46 | As committed, `732a612` | `pnpm escrow:close <contract>`, before the funder had closed | exit 1, "close milestone not disputed yet: the funder must close the campaign in the app first" |
| 17:46 | As committed, `732a612` | the same with `FUNDER_SECRET` empty | A stack trace: `ZodError … "FUNDER_SECRET" … "invalid secret seed"`. The script demanded the operator's own funder key although the escrow's funder was another wallet and that key could sign nothing for it |
| 17:46 to 17:48 | | The script was rewritten and `recordRemainder` changed, with unit tests that passed at 17:48. This version was committed after the run as `6cd97c5` | |
| 17:48 | Rewritten, `6cd97c5` | before the funder had closed: once as is, once with `FUNDER_SECRET` empty, once against a database without the campaign | exit 1 three times: the "not disputed yet" refusal twice, then "no campaign with this escrow in …; nothing was signed" |
| 17:49:05 | | The funder closed the campaign in the app (tx 9) | |
| 17:49 | Rewritten, `6cd97c5` | against a database without the campaign, now with the close milestone disputed | exit 1, "no campaign with this escrow in …; nothing was signed" |
| 17:49:42 | Rewritten, `6cd97c5` | the sweep, with `FUNDER_SECRET` empty and the app's database | exit 0, tx 10, recorded on the campaign |
| 17:50 | Rewritten, `6cd97c5` | once more | exit 0, "nothing to sweep" |

So the sweep on this page was signed by the version at `6cd97c5`, written during the run and before the funder closed. Reading the committed script had shown a second problem that could not be tried without spending the one sweep an escrow gets: it wrote the remainder hash with its own SQL after the sweep, and when `DATABASE_URL` pointed at a database without the campaign it updated no row and said nothing. The operator's `.env` points at a local database, so sweeping a team's campaign from that machine would have returned the money and left the campaign page without the remainder hash. The rewritten version made `FUNDER_SECRET` optional, looked the campaign up before signing, and recorded the hash through `recordRemainder` only after the escrow read back empty.

After the run, a review of that version changed the script again (`c583266`): the flow moved into `src/services/remainder.ts` with tests, the sweep's hash is taken before it is sent, a campaign that is not closed in the app or already has a remainder is refused before signing, recording is skipped only with `--no-record`, `--record <tx hash>` writes the hash of a sweep made elsewhere, and the platform keys are no longer read ([deployment → Returning a remainder](../deployment.md#returning-a-remainder)). **That version has not signed a transaction on testnet.** At 18:20 UTC it was run against the two escrows of this rehearsal in the ways that sign nothing:

| Run with the current script (`c583266`) | Result |
|---|---|
| campaign one's escrow, the app's database | exit 0, "nothing to sweep: remainder 2df7fde3…86bbb1 is already recorded" |
| the same with `--no-record`, and with the funder and platform keys empty | exit 0, "nothing to sweep: the escrow is empty" |
| the same against a database without the campaign | exit 1, "no campaign with this escrow in the database; nothing was signed" |
| the same with no `DATABASE_URL` and no flag | exit 2, "DATABASE_URL is not set, so the sweep could not be recorded on its campaign. …" |
| `--record` with the hash of tx 10, and with no signing key in the environment at all | exit 0, "recorded remainder 2df7fde3…86bbb1 on campaign rehearsal-campaign-one-gcqziy" (the same hash again, so nothing changed) |
| `--record` with another hash | exit 1, "another remainder transaction is already recorded for this campaign" |
| campaign two's escrow (abandoned, never funded), at that time | exit 3, "the escrow is empty and campaign rehearsal-campaign-two-mnas2- has no remainder recorded". A last change in the same commit made a campaign that was never funded read as "nothing to sweep" instead; that case is covered by a unit test and was not run again on testnet |

A sweep by the current script, a sweep with `--no-record` followed by `--record`, and a lost reply are covered by unit tests against the in-memory escrow only.

`pnpm evidence:dump` changed after the run as well: it names the funder's wallet (`e8edb16`), takes an optional file name (`cbbd8b3`), and replaces a page only with a dump of the same campaign (`3f892ad`). [rehearsal-campaign.md](rehearsal-campaign.md) was written by that last version at 18:23 UTC from the rehearsal's database, which had not changed since the run.

## Not run

**Submission, review, final approval and release.** Not run. A submission is accepted only after X names the contributor's connected account as the post's author, and this deployment has no X credentials; with none, every submission is refused. No fake X was put into the running app to get past that. What it needs: an X developer app with an OAuth 2.0 client and a plan that includes post lookup, a test X account with a public post, and a reviewer wallet. Owner: Cem. Review under rubric v2 also waits for the Month 1 results table.

Steps, once the four `X_*` variables are set ([deployment → Sign in with X](../deployment.md#sign-in-with-x)):

1. `pnpm x:check <post id> <account id>` with a post of the test account. It must print "post found" and "author matches the expected account" ([deployment → Checking the lookup](../deployment.md#checking-the-lookup)).
2. From a funder wallet that got access through a request, create, deploy and fund a campaign as above.
3. With a second wallet that has a USDC trustline, connect the test X account on the campaign page and submit a post that account wrote. Record the submission's short ID.
4. With a reviewer wallet (`pnpm role:grant <wallet> reviewer`), decide the submission as a pass in the review queue. Record the decision's transaction hash and open its verify page.
5. As the funder, select the submission for payout: the platform keys append its milestone, mark it delivered and approve it. Record the three hashes from the campaign page.
6. As the funder, release. Record the release hash and the contributor's USDC balance: the reward less the 0.3% protocol fee.
7. Revoke the funder on `/admin` before step 5 or 6 in one run, to record a release by a revoked funder. This run covered close after revocation, not release.
8. As the funder, close; as the resolver, `pnpm escrow:close <contract>`. Record both hashes.
9. `pnpm evidence:dump <slug> <file-name>` and link the page from the [Month 2 index](month-2.md).

**In a browser with a wallet extension.** Not run. Every request here was sent by a script with a session cookie, and every transaction was signed by that script. The buttons (Request, Approve, Revoke, Deploy, Fund, Abandon, Close) have not been pressed with Freighter signed in. Owner: Cem, during the pilot or its recording.

**On proofwork.online.** Not run, on purpose: this run made no call to the live site and did not read or write its database. Migration `0006` and the operator's `ops` grant are still to be applied there. Owner: Cem.

**With the pilot's resolver.** The sweep was signed by the resolver key in the operator's environment. Who holds the resolver key for the pilot campaign is still open. A resolver who is not the operator runs `pnpm escrow:close <contract> --no-record` with that key and a Trustless Work key, and needs neither the platform keys nor the database; the operator then records the hash with `--record`. That split has not been run on testnet. Owner: Cem.

**Rate limits against Upstash.** The local app used the in-memory limiter.
