# In-app remainder return evidence

The dispute resolver now returns a closed campaign's remainder in the app. The resolver's wallet sees "Return remainder" on `/admin` and signs the `withdraw-remaining-funds` transaction itself. The server builds that transaction with one distribution, the whole on-chain balance to the escrow's on-chain funder, and submits it. It writes the remainder hash on the campaign only after the escrow reads empty. No server key signs. This page records one run on Stellar testnet. Every hash below opens on stellar.expert, and each one was read back from Horizon after the run as `successful: true`.

Run: 2026-10-20, 15:21 to 15:24 UTC · Network: Stellar testnet · Escrow: Trustless Work Core API v1 (`dev.api.trustlesswork.com`) · App: a local instance of this repository (`next dev`), commit `68840c9`, on a scratch Postgres 17 database with every migration applied through `pnpm db:migrate`. Nothing here touched proofwork.online or its database.

Story 8's escrow (`CAVDQLB…GABEE`, 0.2 USDC left) was not used. Its scratch database no longer exists, so no campaign row holds that escrow, and the return refuses an escrow that no campaign knows. A new 0.4 USDC campaign was created for this run.

## How it was run

There was no browser and no wallet extension. A script outside the repository did the following:

- signed the wallet challenge with each key
- called the routes the pages call: `/api/campaigns`, `/api/campaigns/<id>/escrow`, `/api/campaigns/<id>/payouts` (close), and the new `/api/campaigns/<id>/remainder`
- signed each transaction the app returned with the key of the wallet that would sign it in the app: the funder key for deploy, fund and close, and the resolver key for the return
- read `/admin` and the funder's campaign page as each wallet and searched the returned HTML for the stage and the hash

No submissions were taken and nothing was paid out. The campaign was closed right after funding, so the whole budget was the remainder.

| Name | Address | Where the key was | Role |
|---|---|---|---|
| Funder | [`GCWGOELY…NCCC3`](https://stellar.expert/explorer/testnet/account/GCWGOELY7A55VZHJFRZBKR7ZMKURNYPUF2K3KL37ESBB2P7MJTZNCCC3) | The operator's local environment (`FUNDER_SECRET`) | `funder`, granted with `pnpm role:grant` on the scratch database; deploy, fund and close signer |
| Dispute resolver | [`GAVJKKCJ…26FWJ`](https://stellar.expert/explorer/testnet/account/GAVJKKCJZTCMBV3ARSQSBRQXHAD57T7ZD35BIDCIGTTMEORJCUJ26FWJ) | The operator's local environment (`DISPUTE_RESOLVER_SECRET`), Proofwork's resolver key (AD-3) | `disputeResolver` on the escrow; no role in the app |
| Operator | `GDWSPD46…RIFKA` | Generated for this run, discarded after it; never on chain | `ops` on the scratch database, to read the Campaigns view |

Campaign `story-10-in-app-remainder-qj-zap`: reward 0.2 USDC, budget 0.4 USDC. Escrow [`CBDTTG7DINDIDZI6PYK4HCDJ7OG2TZ6R5PK2RO7RWVRBZDVQ2AMMZFB3`](https://stellar.expert/explorer/testnet/contract/CBDTTG7DINDIDZI6PYK4HCDJ7OG2TZ6R5PK2RO7RWVRBZDVQ2AMMZFB3).

## Every transaction

| # | Ledger time (UTC) | Step | Tx | Source account | Fee charged (XLM) |
|---|---|---|---|---|---|
| 1 | 15:21:37 | Deploy escrow | [6ecd9223554b…](https://stellar.expert/explorer/testnet/tx/6ecd9223554bd5c39eb4a132d8be1a83a3c3b00d853dff42615e087e2f7b1275) | Funder | 0.1127060 |
| 2 | 15:21:52 | Fund 0.4 USDC | [a9d8236e0fdb…](https://stellar.expert/explorer/testnet/tx/a9d8236e0fdb95371761ab6ad9cebcc5c09634ca2d10b4c9b9de3c6524081fe9) | Funder | 0.0795889 |
| 3 | 15:22:37 | Close campaign: dispute milestone 0 | [ec89cbc0e78a…](https://stellar.expert/explorer/testnet/tx/ec89cbc0e78a3b6f6b25e5070c58c48379371e85cdb9886aec2dfb43b2917d47) | Funder | 0.0007174 |
| 4 | 15:23:12 | Return remainder: `withdraw-remaining-funds` → funder | [3b7a2b91a5f4…](https://stellar.expert/explorer/testnet/tx/3b7a2b91a5f4e4d0638f38b5ddd6c455f2456201a6dc15690c7c90ce7d9bc1dd) | Dispute resolver | 0.0015282 |

## Where the money went

The escrow was read through the Trustless Work API (`get-escrow-by-contract-ids`, `validateOnChain=true`). The funder's USDC was read from Horizon.

| Point | Escrow balance | Milestone 0 | Funder USDC |
|---|---|---|---|
| Before fund | — | — | 20.116 |
| After fund (tx 2) | 0.4 | pending | 19.716 |
| After close (tx 3) | 0.4 | **disputed** | 19.716 |
| After return (tx 4) | **0** | disputed | **20.1148** |

The funder's balance rose by 0.3988 USDC: the 0.4 USDC escrow balance less the 0.3% Trustless Work protocol fee. Horizon's balance changes for tx 4 show exactly two transfers out of the escrow:

| From | To | Amount |
|---|---|---|
| Escrow `CBDTTG7D…MZFB3` | Funder `GCWGOELY…NCCC3` | 0.3988 USDC |
| Escrow `CBDTTG7D…MZFB3` | `GA6KH5VWPCHBOEF63X57SPX6T4H366YFFKKGCVDBTXT2N7JVL6PJCK7G`, where the Trustless Work protocol fee goes (see [the rehearsal](external-funder-rehearsal.md#close-and-remainder)) | 0.0012 USDC |

## What the app answered

| Time (UTC) | Wallet | Call or page | Answer |
|---|---|---|---|
| 15:22:29 | Resolver | `POST /remainder {prepare}` before close | 409, "campaign story-10-in-app-remainder-qj-zap is not closed in the app: its funder closes it there first; nothing was signed" |
| 15:22:45 | Funder | `POST /remainder {prepare}` after close | 403, "not the dispute resolver of this campaign" |
| 15:22:45 | Operator | `GET /admin`, Campaigns row | title, funder `GCWG…CCC3`, "Closed, awaiting return", deadline, waits on "Resolver" `GAVJ…6FWJ` |
| 15:22:45 | Resolver | `GET /admin` | 200: "Awaiting your return" with this campaign and "Return remainder"; no access section |
| 15:22:45 | Funder | `GET /admin` | 404 (neither the operator nor a resolver with a return waiting) |
| 15:23:03 | Resolver | `POST /remainder {prepare}` | 200, `amount: "0.4"`, `funder: GCWGOELY…NCCC3`; the unsigned transaction's source is the resolver and it holds one `invokeHostFunction` |
| 15:23:15 | Resolver | `POST /remainder {submit}` with the signed transaction | 200, tx 4's hash; the escrow read 0 before the hash was written |
| 15:23:18 | Resolver | `POST /remainder {prepare}` again | 409, "withdraw_remaining already confirmed (tx 3b7a2b91…)" |
| 15:23:35 | Funder | `GET /campaigns/<slug>` | stage "Settled", tx 4's hash on the page |
| 15:23:35 | Operator | `GET /admin`, Campaigns row | "Settled", waits on "—" |
| 15:23:35 | Resolver | `GET /admin` | 404: nothing waits on it any more |

## What the unit tests cover instead

The run above is the success path. These rows of the story's matrix were run against the fake escrow in `tests/unit/remainder-op.test.ts`, `tests/unit/remainder-return.test.ts` and `tests/unit/access.test.ts`, and not on testnet: an open payout milestone, a signed transaction that differs from the prepared one (400, nothing sent), an escrow already empty with no hash recorded (409, with the operator's `pnpm escrow:close <contract> --record <tx hash>` command), a cancelled signature, a reply lost after the return landed (recorded as landed), and a submit that failed without landing (nothing recorded).
