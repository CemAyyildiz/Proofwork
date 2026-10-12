# Shared funding source evidence

The review card warns when submissions in one campaign come from wallets that were first funded by the same Stellar account, or when one of the wallets created the other. Public sources (Friendbot, configured faucets) are left out. This page records the Horizon read behind that warning on testnet: four fresh accounts, the transactions that created them, and the creating account the app read back for each.

## Run 1: scripted, fresh keypairs

Run: 2026-10-12T17:17:04Z · Network: Stellar testnet · Horizon: `https://horizon-testnet.stellar.org`
Friendbot account: [`GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR`](https://stellar.expert/explorer/testnet/account/GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR)

Freshly generated keypairs stood in for contributor wallets and were discarded after the run. Wallets P and D were activated with Friendbot; P then created B and C with one `create_account` each. The sources were read back with the app's own `readFundingSource` (`src/wallet/onboarding.ts`), the call `createSubmission` makes: `GET /accounts/<wallet>/operations?order=asc&limit=1`, taking `funder` from the `create_account` record.

| Wallet | Created by | Creation tx | Transaction source account | Source read back by the app |
|---|---|---|---|---|
| P [`GCE46DWN…TBW47`](https://stellar.expert/explorer/testnet/account/GCE46DWNWNCZNQ4GQXT5S5AD6XE6OEAWF2NTAJVFP43AFKNVPVITBW47) | Friendbot | [64a28cb008a1…](https://stellar.expert/explorer/testnet/tx/64a28cb008a1d4c29d5fa394b91730437781381294e2fb0e629af9367bf4c095) | `GAD4EW6Z…QD42D` (Friendbot minion) | `GAIH3ULL…JZNSR` (Friendbot) |
| D [`GB3KTG5A…WG7YJ`](https://stellar.expert/explorer/testnet/account/GB3KTG5AUAUMBIT43MTMZRFDUIYNNNXEZQDXNWOAYAGFFCB2RWPWG7YJ) | Friendbot | [36fbaa68c955…](https://stellar.expert/explorer/testnet/tx/36fbaa68c955861280238b3b551eabba5f8d51d4bf2476feffe156e77acf2421) | `GAW4JGB2…LVQTG` (Friendbot minion) | `GAIH3ULL…JZNSR` (Friendbot) |
| B [`GDNQWQD3…XWE6J`](https://stellar.expert/explorer/testnet/account/GDNQWQD3IKQGOPAMIPOQKKVGZ4ZZLZRVTVHYBZL4YHAIXTNINLXXWE6J) | P | [0141a497d7d3…](https://stellar.expert/explorer/testnet/tx/0141a497d7d3d0c855cdd5bb2ee16f8842dbf9379676a734d6834355723b9733) | P | P `GCE46DWN…TBW47` |
| C [`GAZSHSCR…Z6NME`](https://stellar.expert/explorer/testnet/account/GAZSHSCRUB4RLL524FJQC4CHIHSS4J6HNFGL3B346G2IB5JWLJJZ6NME) | P | [7e8b9d1c4a66…](https://stellar.expert/explorer/testnet/tx/7e8b9d1c4a6604203425c57a5e53cac09cc12ebbc68092f04b65bcd4a6fc5596) | P | P `GCE46DWN…TBW47` |

What the run confirms:

- The first operation of every account was its own `create_account`, and its `funder` field named the creating account.
- Friendbot sent the two transactions from two different minion accounts, and `funder` was the Friendbot account both times. Excluding that one account is enough to leave Friendbot-created wallets out.
- A fifth keypair that was never created on the network answered 404; `readFundingSource` threw `unreachable`. In `createSubmission` that is the "lookup failed" path: the submission is accepted with an unknown source and the card says "Funding source not checked".

The same sources, put through the app's link rule (`sharedFundingCounts` in `src/services/review.ts`) with Friendbot as the only public source, give the counts the review card would show:

| Submissions in one campaign | Count on each card | Card |
|---|---|---|
| B and C (same creator P) | B 1, C 1 | both warn "1 other submission" |
| P and B (P created B) | P 1, B 1 | both warn "1 other submission" |
| P and D (both from Friendbot) | P 0, D 0 | no warning |
| P, B, C and D | P 2, B 2, C 2, D 0 | P, B and C warn "2 other submissions"; D does not |
| B in one campaign, C in another | B 0, C 0 | no warning |
| B and C, with P listed in `PUBLIC_FUNDING_SOURCES` | B 0, C 0 | no warning |

To check a row yourself, open the creation tx on stellar.expert, or read the same record the app reads:

```
curl "https://horizon-testnet.stellar.org/accounts/GDNQWQD3IKQGOPAMIPOQKKVGZ4ZZLZRVTVHYBZL4YHAIXTNINLXXWE6J/operations?order=asc&limit=1"
```

The `funder` of the single record returned is wallet P.

## Run 2: through the app, to the review card and the review log

Run: 2026-10-12T17:21:27Z · Network: Stellar testnet · App: a local instance of this repository on a scratch database, reading Horizon testnet and writing decisions with a development ledger key.

Four fresh wallets, each with a USDC trustline, signed in with the wallet challenge and submitted to one campaign through `POST /api/submissions`. P and D were activated with Friendbot; P created B and C. A fifth submission was inserted without a funding source, as rows stored before this feature are. A reviewer wallet then opened `/review`.

| Submission | Wallet | Creation tx | Source the app stored | Review card |
|---|---|---|---|---|
| `cy3vartf` | P [`GCJXBYXU…NYOTG`](https://stellar.expert/explorer/testnet/account/GCJXBYXUNUNEN5DTZRXL4QTUM4F2LCQJQ4444DO5KVGD6MMDJNKNYOTG) | [6fece30c1c90…](https://stellar.expert/explorer/testnet/tx/6fece30c1c90c4b34923ce0ee93e5cdc39d82590aea09ce0b7f6a229dea06cd2) | Friendbot | Shared funding source: 2 other submissions in this campaign. |
| `3q88j4uj` | B [`GCKVBQDE…USYYU`](https://stellar.expert/explorer/testnet/account/GCKVBQDEEBWZTWKSTXFADGMJCMAUVV5E7RATJE6O7KMXYDYVG33USYYU) | [5c05b3d6887e…](https://stellar.expert/explorer/testnet/tx/5c05b3d6887e53bc4750fce514e0841da1024b3b951d64db54cedff0b1d78bcb) | P | Shared funding source: 2 other submissions in this campaign. |
| `csvd6trx` | C [`GDU2LTZ6…XDFDA`](https://stellar.expert/explorer/testnet/account/GDU2LTZ6FESB35ZTQWBNOGQLAUJCVCIIHRWMENVMY2APR7ZD2EAXDFDA) | [22cab3ae4159…](https://stellar.expert/explorer/testnet/tx/22cab3ae41593f2fa72be86143185ce1619da5eb7d3ffea5377598bd2a3aa53a) | P | Shared funding source: 2 other submissions in this campaign. |
| `pscsgzjh` | D [`GCS6YTS5…KI2HA`](https://stellar.expert/explorer/testnet/account/GCS6YTS5UPWTC3O4LIG7OB46TVN2JGOXKV4ENPEPKKFW3VE6HIIKI2HA) | [5ad2935abd9b…](https://stellar.expert/explorer/testnet/tx/5ad2935abd9b424d62a189a467bdd35b706939a1fd7e430cd372591a9af10fb2) | Friendbot | no note |
| `m1run8f0` | stored without a source | none | none | Funding source not checked. |

On every card all six signals were checked when the page loaded. None of the five wallet addresses, and no source address, appeared anywhere in the `/review` response.

Three of the submissions were then passed with all six signals. The decision transactions carry the usual `manage_data` entry and `memo_hash`; each memo equals the SHA-256 of the stored canonical JSON, whose fields are the same nine as before. The review log exported from the app afterwards:

| Submission | Decision tx | Outcome | `shared_funding_count` in the review log |
|---|---|---|---|
| `3q88j4uj` (B) | [0fd08f6fd25c…](https://stellar.expert/explorer/testnet/tx/0fd08f6fd25cedc2234d2dc27509db0026f82bb7d358fae0936aa21fe5048775) | PASS | `2` |
| `pscsgzjh` (D) | [2dafdcf9c5b4…](https://stellar.expert/explorer/testnet/tx/2dafdcf9c5b4bbbb506f1bc3f3bf1a4ebf6e900d2b495124dbe389fe706ef113) | PASS | `0` |
| `m1run8f0` | [a6fb721aca66…](https://stellar.expert/explorer/testnet/tx/a6fb721aca6629e13f9550182d031351b6f5c4ca58609168ee73163775a728eb) | PASS | empty |

## Run 3: on proofwork.online

Not recorded yet. Steps: after the migration and deployment, repeat Run 2 on a funded campaign on the live app and record the submission short IDs, the note each card shows, and the `shared_funding_count` cells of the exported review log.
