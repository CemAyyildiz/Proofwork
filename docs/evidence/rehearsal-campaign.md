# Campaign evidence: Rehearsal campaign one

Generated 2026-10-13T18:23:08Z by `pnpm evidence:dump rehearsal-campaign-one-gcqziy rehearsal-campaign`. Network: Stellar testnet. This page lists what the app recorded; it makes no chain read. Each hash links to stellar.expert, where the transaction can be checked on chain.

| | |
|---|---|
| Campaign | `rehearsal-campaign-one-gcqziy` |
| Escrow contract | [`CCVVC2IBJTSIQCAZYWYAZW5VOLIECQXBAQKU74BSIXGAHY3DLFFVUOSC`](https://stellar.expert/explorer/testnet/contract/CCVVC2IBJTSIQCAZYWYAZW5VOLIECQXBAQKU74BSIXGAHY3DLFFVUOSC) |
| Funder wallet | [`GBYRWD7HPWAQYIJHTMVLQVUB26DJSVU742MZVX3M5YH55QJN46ZQANOT`](https://stellar.expert/explorer/testnet/account/GBYRWD7HPWAQYIJHTMVLQVUB26DJSVU742MZVX3M5YH55QJN46ZQANOT) |
| Budget | 5 USDC |
| Reward per approved submission | 1 USDC |
| Funded | 2026-10-13T17:21:10Z |
| Closed | 2026-10-13T17:49:05Z |

Contributors appear as submission short ID and truncated wallet. "confirmed on chain, hash not recorded" marks an op whose effect was confirmed by reading the escrow after a submit error, so its hash was never returned to the app; the escrow state itself is the proof.

## Escrow transactions

### Deploy escrow

Signed by: funder wallet.

| # | Tx | Detail | Recorded (UTC) |
|---|---|---|---|
| 1 | [5e5759254e86…](https://stellar.expert/explorer/testnet/tx/5e5759254e86e8dc08f1f5e3bfa7d3daa80fea4364e67578935ee0eae143f535) | contract CCVVC2IBJTSIQCAZYWYAZW5VOLIECQXBAQKU74BSIXGAHY3DLFFVUOSC | 2026-10-13T17:20:51Z |

### Fund budget

Signed by: funder wallet.

| # | Tx | Detail | Recorded (UTC) |
|---|---|---|---|
| 1 | [aa5f5a7fabdc…](https://stellar.expert/explorer/testnet/tx/aa5f5a7fabdca1670c090aeb57dac7c1fbe825ebde71be2cb8a609a543518ce0) | 5 USDC | 2026-10-13T17:21:10Z |

### Append reward milestones

Signed by: platform admin key.

None recorded.

### Mark delivered

Signed by: platform ops key.

None recorded.

### Approve milestone

Signed by: platform ops key.

None recorded.

### Release reward (per contributor)

Signed by: funder wallet.

None recorded.

### Dispute close milestone (campaign close)

Signed by: funder wallet.

| # | Tx | Detail | Recorded (UTC) |
|---|---|---|---|
| 1 | [543b1fd6c5e7…](https://stellar.expert/explorer/testnet/tx/543b1fd6c5e7ee68170eea975c0c1acbbc6c404ac70bae07a8d2bf05af84bf67) | milestone 0 (campaign close) | 2026-10-13T17:49:05Z |

### Withdraw remainder to funder

Signed by: dispute resolver key.

| # | Tx | Detail | Recorded (UTC) |
|---|---|---|---|
| 1 | [2df7fde33230…](https://stellar.expert/explorer/testnet/tx/2df7fde332303415e48ed3c53163a1c3e1b8e512a5a2c68facdd8a8e0286bbb1) | remaining balance, less the Trustless Work protocol fee → funder |  |

## Decision records

One classic Stellar transaction per decision from the decision ledger account: `manage_data` under the ledger key, value `v1|<outcome>|<reason>|<first 16 hex of the hash>`, and `memo_hash` = SHA-256 of the canonical decision JSON. The verify page recomputes that hash in the browser.

None recorded.
