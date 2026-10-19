# Selected release evidence

"Release N payouts" pays only the payouts the funder selected. This page records one run on Stellar testnet. Three payouts were approved and two were selected and released. The third was still approved and unreleased on chain after that, and was then released on its own. Every hash below opens on stellar.expert. Each one was read back from Horizon after the run as `successful: true`.

Run: 2026-10-19, 07:30 to 07:36 UTC · Network: Stellar testnet · Escrow: Trustless Work Core API v1 (`dev.api.trustlesswork.com`) · App: a local instance of this repository (`next dev`), commit `bfa6ffe`, on a scratch Postgres 17 database with every migration applied through `pnpm db:migrate`. Nothing here touched proofwork.online or its database.

## How it was run

There was no browser and no wallet extension. A script outside the repository did the following:

- signed the wallet challenge with the funder key
- called the routes the funder page calls (`/api/campaigns`, `/api/campaigns/<id>/escrow`, `/api/campaigns/<id>/payouts`)
- signed each transaction the app returned
- read the funder page five times, each a `GET /campaigns/<slug>` with the funder's session cookie. It searched the returned HTML for `Balance <strong>…</strong>` or `Balance unavailable, check on-chain` and logged what it found. Nothing else on the page was recorded.

The releases went through `releaseSelected` in `src/components/release-flow.ts`. That is the loop the funder page runs: it prepares one transaction for the selection, signs it, submits it, and repeats. The outcome lines below come from `describeRelease`, the function the page uses to build its outcome text.

Not part of this story and not run here: the contributors' submissions and the review. Three rubric-passed submissions were written straight into the scratch database, each with a `PASS` decision. Their post links (`https://x.com/proofwork_test/status/80000N`) are placeholders and point to no real post. No decision was recorded on chain. From the funder's approval onward, everything went through the app.

| Name | Address | Where the key was | Role |
|---|---|---|---|
| Funder | [`GCWGOELY…NCCC3`](https://stellar.expert/explorer/testnet/account/GCWGOELY7A55VZHJFRZBKR7ZMKURNYPUF2K3KL37ESBB2P7MJTZNCCC3) | The operator's local environment (`FUNDER_SECRET`) | `funder`, granted with `pnpm role:grant` on the scratch database; `releaseSelected` signer |
| Contributor 1 | [`GBNSU4M7…IXS5L`](https://stellar.expert/explorer/testnet/account/GBNSU4M73IBRZFUYOSWMGRY7A6X3CCOAHENGG5I5HYFQQAUNK6BIXS5L) | Generated for this run, discarded after it | Receiver of milestone 1 (submission `s8p1`) |
| Contributor 2 | [`GDLYXVWO…JEEXU`](https://stellar.expert/explorer/testnet/account/GDLYXVWOU26OJ5ILBV4V52L7ZYWH2MYAMYAN4K7NUM7NRKR4W7YJEEXU) | Generated for this run, discarded after it | Receiver of milestone 2 (submission `s8p2`) |
| Contributor 3 | [`GAADKP4W…YOFBZ`](https://stellar.expert/explorer/testnet/account/GAADKP4WACMC2J5YYVC2VBGFLVJQNYCKJOVH46LTVBJERQ4IB67YOFBZ) | Generated for this run, discarded after it | Receiver of milestone 3 (submission `s8p3`) |
| Platform admin | [`GBHJQNVVF5AENYPS3VIAPSH6R6T2PDMDPPS5LHUD56RGZNTD7SRG4PPA`](https://stellar.expert/explorer/testnet/account/GBHJQNVVF5AENYPS3VIAPSH6R6T2PDMDPPS5LHUD56RGZNTD7SRG4PPA) | The app's server environment | `platformAddress`; appended the three milestones |
| Platform ops | [`GBJZ6AF6BYYVGT6QLYBJY2PVDXIQ6IAATLLI5LYLDFPPZ6GG2EVBQMTD`](https://stellar.expert/explorer/testnet/account/GBJZ6AF6BYYVGT6QLYBJY2PVDXIQ6IAATLLI5LYLDFPPZ6GG2EVBQMTD) | The app's server environment | `serviceProvider` and `approver`; marked delivered and approved |

Campaign `story-8-selected-release-2gu3ws`: reward 0.2 USDC, budget 0.8 USDC. Escrow [`CAVDQLB2576W54P6YMWI6ZZ3QREUPPUMK7P4BRXXZXD3RGCMWCOGABEE`](https://stellar.expert/explorer/testnet/contract/CAVDQLB2576W54P6YMWI6ZZ3QREUPPUMK7P4BRXXZXD3RGCMWCOGABEE).

## Every transaction

| # | Time (UTC) | Step | Tx | Source account | Fee charged (XLM) |
|---|---|---|---|---|---|
| 1 | 07:30:17 | Deploy escrow | [7afc113f014d…](https://stellar.expert/explorer/testnet/tx/7afc113f014d65ac87653d0fd8dc43ce9597ee53d5aa087b34b68fd6b761f324) | Funder | 0.1102261 |
| 2 | 07:30:52 | Fund 0.8 USDC | [912a9d43f4fb…](https://stellar.expert/explorer/testnet/tx/912a9d43f4fb62066592e6a32fbb9848bc5dcf7fd49a58fa7db2eb2b90fe5d12) | Funder | 0.0787511 |
| 3 | 07:32:17 | Contributor 1 opens the USDC trustline | [d69d833ac2d0…](https://stellar.expert/explorer/testnet/tx/d69d833ac2d0ad881c43978c6566b05d4e2ec52bafc78eb102057022e460794b) | Contributor 1 | 0.00001 |
| 4 | 07:32:27 | Contributor 2 opens the USDC trustline | [da7761a07e74…](https://stellar.expert/explorer/testnet/tx/da7761a07e74d61647f58ec4d1386a0df5115cabceda6618e65038100362a81a) | Contributor 2 | 0.00001 |
| 5 | 07:32:42 | Contributor 3 opens the USDC trustline | [94eb852afdbe…](https://stellar.expert/explorer/testnet/tx/94eb852afdbea74f283a28cdb68a5405eb55ac1eaaac9cb92d823390a6eab09a) | Contributor 3 | 0.00001 |
| 6 | 07:33:07 | Approve 3 for payout: append milestones 1, 2, 3 in one update | [d5a58f3d0427…](https://stellar.expert/explorer/testnet/tx/d5a58f3d04278cd94f69ff798ef91abf91148e0fc71db5c90020edd39fc198d9) | Platform admin | 0.0904971 |
| 7 | 07:33:42 | Mark milestone 1 delivered | [16cd79977680…](https://stellar.expert/explorer/testnet/tx/16cd79977680524a1ddf18334b530ca27cd644bfe7f24d644cb9e754f07a318f) | Platform ops | 0.0049732 |
| 8 | 07:33:52 | Approve milestone 1 | [e4fd4e6a88ff…](https://stellar.expert/explorer/testnet/tx/e4fd4e6a88ff7e47514cc163342cd13c59de930f21c08ad0f66c4b4a2eca6a92) | Platform ops | 0.0010460 |
| 9 | 07:34:02 | Mark milestone 2 delivered | [7d5c595624de…](https://stellar.expert/explorer/testnet/tx/7d5c595624de16c2fddef70a7aeddc4f432a73409724efb69ce8c1ad5f83c6d4) | Platform ops | 0.0049869 |
| 10 | 07:34:22 | Approve milestone 2 | [16fe5b3ce221…](https://stellar.expert/explorer/testnet/tx/16fe5b3ce22195109ab670178f91149dbf7cc8689ce1f7521307693bb0185a9d) | Platform ops | 0.0010598 |
| 11 | 07:34:32 | Mark milestone 3 delivered | [c6be50ab9240…](https://stellar.expert/explorer/testnet/tx/c6be50ab9240c6a45771591380dcb5d873e9e383933db0a888dd0f907c5d42a1) | Platform ops | 0.0050006 |
| 12 | 07:34:52 | Approve milestone 3 | [4c2188a687d0…](https://stellar.expert/explorer/testnet/tx/4c2188a687d0bcc0bc058dd9d90c9539bd678f4bcd85629815fbb2e8b304b429) | Platform ops | 0.0010736 |
| 13 | 07:35:07 | Release milestone 1 (selection: `s8p1`, `s8p3`) | [98bd38de31c3…](https://stellar.expert/explorer/testnet/tx/98bd38de31c32ce944557c13475fc8937ffd5853fe5f06b38c5612234ba09e90) | Funder | 0.0012722 |
| 14 | 07:35:22 | Release milestone 3 (same selection) | [852290142afd…](https://stellar.expert/explorer/testnet/tx/852290142afd62fb36671961ade36146666c859bd1b104b7d1a871d3bfa57830) | Funder | 0.0012723 |
| 15 | 07:35:47 | Release milestone 2 (selection: `s8p2`) | [ac400e1b59b3…](https://stellar.expert/explorer/testnet/tx/ac400e1b59b3b5bb60708da478149c1befa0c34d7da840779467087431066c6a) | Funder | 0.0012722 |

A release signed by the funder cost about 0.00127 XLM.

## What the chain read back

The escrow was read through the app's Trustless Work adapter (`getEscrow`, `validateOnChain=true`) at each point. Milestone 0 is the campaign-close milestone and stayed untouched throughout. Which delivery and approval belongs to which submission was checked against the idempotency key the app stores for each operation (`deliver|<campaign>|<submission>`, `approve|<campaign>|<submission>`).

| Point | Escrow balance | Milestone 1 (`s8p1`) | Milestone 2 (`s8p2`) | Milestone 3 (`s8p3`) |
|---|---|---|---|---|
| After approve (tx 12) | 0.8 USDC | approved, not released | approved, not released | approved, not released |
| After releasing the selection `s8p1`, `s8p3` (tx 13, 14) | 0.4 USDC | **released** | approved, **not released** | **released** |
| After releasing `s8p2` (tx 15) | 0.2 USDC | released | **released** | released |

After the first release the app's payout rows showed `s8p1` and `s8p3` as `released`, with the hashes of tx 13 and 14, and `s8p2` as `approved` with no hash. After the second release, all three were `released`, and the app held one confirmed `release` operation for each milestone and no other.

Each contributor wallet held 0.1994 USDC at the end: the 0.2 reward less the 0.3% Trustless Work protocol fee. The funder wallet went from 0.916 to 0.116 USDC. The 0.2 USDC left in the escrow is the unspent budget. It stays there until the campaign is closed and the dispute resolver returns it to the funder. That was not done in this run.

## What the release loop reported

| Release | Selection | Progress shown | Outcome text |
|---|---|---|---|
| First | `s8p1`, `s8p3` | "Signing 1 of 2…", "Signing 2 of 2…" | "2 of 2 released", with the hashes of tx 13 and 14 |
| Second | `s8p2` | "Signing 1 of 1…" | "1 of 1 released", with the hash of tx 15 |

Every prepare call named the selection. The server built one release at a time, and only for the selected submissions whose payouts were still approved. After the first release, `s8p2` was approved and in the same campaign, but nothing was built for it because it was not selected.

## The balance line on the funder page

At commit `bfa6ffe` the page read the escrow balance from chain before it rendered, with a 4-second limit. Here is what the script found in the HTML each time it fetched the page (times are when the script logged the result):

| Time (UTC) | Point | Found in the HTML |
|---|---|---|
| 07:31:14 | After fund, first attempt | `Balance <strong>0.8 USDC</strong>` |
| 07:32:05 | After fund, second attempt (see [Retried step](#retried-step)) | `Balance <strong>0.8 USDC</strong>` |
| 07:35:02 | After approve, before the first release | `Balance unavailable, check on-chain` |
| 07:35:43 | After the first release | `Balance <strong>0.4 USDC</strong>` |
| 07:36:07 | After the second release | `Balance <strong>0.2 USDC</strong>` |

At 07:35:02 Trustless Work took longer than 4 seconds to answer. The page showed no figure, and the app logged `escrow balance read failed` with `balance read timed out`. The script's own reads of the same escrow took up to 15 seconds during the run. Since this run, the balance streams in after the rest of the page and the limit is 10 seconds.

## Retried step

The first attempt at the contributor step stopped when Friendbot timed out on the second wallet. By then the first wallet, [`GC536O4F…XXBR6`](https://stellar.expert/explorer/testnet/account/GC536O4FTTAFMMZQDOTK5VMPMXOTZYVMBZ3T4Q2QC5PUCTMUTA6XXBR6), had already opened its USDC trustline ([9c7ff540aa88…](https://stellar.expert/explorer/testnet/tx/9c7ff540aa8828cb2de5b29b1baee8773765aec8b3f6a5873514511e1a350d8b)). Its key was discarded and it took no further part. The step was run again with three new wallets, the contributors above. Nothing in the app was changed between the two attempts.
