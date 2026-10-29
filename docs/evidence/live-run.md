# Live run on proofwork.online

On 2026-10-29 the whole Month 2 path ran once on [proofwork.online](https://proofwork.online), Stellar testnet, through the app's own pages and three Freighter wallets. No script or database change was used between the access request and the payout. The Month 2 demo video is made from this run.

## Who signed what

| Name | Address | Role at the start |
|---|---|---|
| Team | [`GCGPQPQ4FHXLO2R6H3HIVSCVYFGQAULTDC7OO5NTLAVCW4GBV544WAP2`](https://stellar.expert/explorer/testnet/account/GCGPQPQ4FHXLO2R6H3HIVSCVYFGQAULTDC7OO5NTLAVCW4GBV544WAP2) | none; created for this run with Friendbot |
| Operator | `GASK…772Z` | `ops` and `reviewer`, granted once in the database before the run (two access-log rows marked `script`) |
| Contributor | `GCVX…6LLB` | none; created for this run with Friendbot |

The team wallet's 5 testnet USDC came from Proofwork's Week 1 spike wallet `GCWG…CCC3` ([a1431872…](https://stellar.expert/explorer/testnet/tx/a143187250c9cb723dab1c95e8e90289761a7754811563cf4ca0d7ad54e43a52)), after the team added its USDC trustline in the app.

## Steps

| Time (UTC) | Who | Step | What the page showed |
|---|---|---|---|
| 11:08 | Team | Requests funder access ("Demo Team" and a short plan) | Funder access requested, Pending ([screenshot](screenshots/live-01-request-pending.jpg)) |
| 11:13 | Operator | Approves on `/admin` | Funders lists Demo Team; the access log shows the grant by `GASK…772Z` ([screenshot](screenshots/live-02-admin-approved.jpg)) |
| 11:15 | Team | Creates the campaign: 1 USDC reward, 3 USDC budget, 3 days, same session as the request | Your limits: 0 of 2 campaigns, 0 of 100 USDC ([screenshot](screenshots/live-03-limits.jpg)) |
| 11:15 | Team | Readiness check | Not ready: no USDC trustline, 0 of 3 USDC ([screenshot](screenshots/live-04-not-ready.jpg)) |
| 11:15–11:16 | Team | Adds the trustline in the app, receives 5 USDC, Check again | Ready: 5 USDC to spend ([screenshot](screenshots/live-05-ready.jpg)) |
| 11:16 | Team | Deploys the escrow | Contract `CBB3VU…BSALO2` |
| 11:20 | Team | Funds the budget | Balance 3 USDC, read from Stellar ([screenshot](screenshots/live-06-funded.jpg)) |
| before 11:25 | Contributor | Adds the USDC trustline, presses Connect X, authorizes the Proofwork app on X (read-only scopes `users.read tweet.read`) | Returns to `?x=connected`, "X account connected" ([screenshot](screenshots/live-07-sign-in-with-x.jpg)) |
| 11:25 | Contributor | Submits a post written by another X account | "this post was written by another X account"; nothing recorded ([screenshot](screenshots/live-08-other-account-refused.jpg)) |
| 11:25 | Contributor | Submits a post written by the connected account | Submitted, In review ([screenshot](screenshots/live-09-own-post-accepted.jpg)) |
| 11:25–11:28 | Operator | Reviews on `/review`: six signals pass, note, Record PASS on-chain | Decision [`dec_rkKU9cVIsC-L1GJKPdmVDw`](https://proofwork.online/verify/dec_rkKU9cVIsC-L1GJKPdmVDw) ([screenshot](screenshots/live-10-review.jpg)) |
| 11:28 | Team | Selects the submission, Approve 1 for payout | "1 payout approved on chain; no money moved" |
| 11:29 | Team | Release 1 payout | Paid, "1 of 1 released" ([screenshot](screenshots/live-11-paid.jpg)) |

The contributor's wallet then held 0.997 USDC: the 1 USDC reward less the 0.3% Trustless Work fee.

## Every transaction

| Step | Transaction |
|---|---|
| Escrow deployed | [53fe7061…](https://stellar.expert/explorer/testnet/tx/53fe70612b9de4a4d24f611843aaa6ecc4dae39f49d910646c47705360ab0c92) |
| Budget funded | [ec3205b8…](https://stellar.expert/explorer/testnet/tx/ec3205b82b0c6c588d00ca6bad46b7fef92aaf98cf09150a075eae68b9a69327) |
| Review decision written | [e2002f4f…](https://stellar.expert/explorer/testnet/tx/e2002f4f0fc9d098023095075a7eeb4d61a3a14548efa9d40b425dd25231281c) |
| Payout milestone added | [8985571d…](https://stellar.expert/explorer/testnet/tx/8985571d631d9941e7587a6410ebdeb6bbe9a7b47d78217ce34cae714d28eab1) |
| Payout marked delivered | [ac32b4b0…](https://stellar.expert/explorer/testnet/tx/ac32b4b0342175f103ac7d4927ccf7fbdef90697cb7e294b300d4b2e5fc26360) |
| Payout approved | [55ef924d…](https://stellar.expert/explorer/testnet/tx/55ef924ddb36faf1950a6bbdda756931cbd97760b465de04c290b13623e78573) |
| Payout released | [4367ab0a…](https://stellar.expert/explorer/testnet/tx/4367ab0aa588449ac6da294d6a60e8375e8f2417ee0240d56c0cbc16af67c852) |

The funder page lists the same operations under On-chain activity ([screenshot](screenshots/live-12-on-chain-activity.jpg)).

## What went wrong

The first Fund budget attempt failed with "trustless work 400 on /helper/send-transaction" and nothing reached the chain: the team wallet still held 5 USDC. The signature had been given about three minutes after the transaction was prepared. Pressing Fund budget again and signing at once succeeded. The likely cause is the prepared transaction's time bound running out; it was not confirmed from the logs.

## Not in this run

- The multi-account warning: both new wallets were created by Friendbot, which the check leaves out, so no warning was shown. The warning itself is recorded in [funding-source.md](funding-source.md).
- Closing the campaign and the remainder return: the campaign runs until 1 Nov 2026, 11:15 UTC. Both are recorded in [external-funder-rehearsal.md](external-funder-rehearsal.md#close-and-remainder) and [in-app-remainder.md](in-app-remainder.md).
