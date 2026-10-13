# Funder limits and funding readiness evidence

Each funder is capped on open campaigns and open budget, and before an escrow is deployed or funded the funder's wallet is read on Stellar and shown as ready or not, with what is missing. A deployed campaign that was never funded can be abandoned so that it stops counting ([technical summary → Funder limits and funding readiness](../technical-summary.md#funder-limits-and-funding-readiness)). This page records what has been checked: the unit tests, one testnet read per wallet state with the app's own code, and a run through a local instance of the app. No escrow was deployed or funded in these runs; that is listed as open at the end. Runs 2 and 3 were made before the changes that review asked for; Run 2 was read again afterwards, Run 3 was not, and each says what that means for it.

## Run 1: unit tests

Run: 2026-10-13 · `pnpm vitest run` on the five files the last changes touch: `tests/unit/campaign.test.ts` (66 tests), `tests/unit/onboarding.test.ts` (52), `tests/unit/access.test.ts` (87), `tests/unit/escrow-ops.test.ts` and `tests/unit/payout.test.ts` (66 together) · 271 tests pass. `tests/unit/env.test.ts` (53) was not touched by them. The whole suite last ran at commit `b2af8c5`, before the changes that review asked for: 722 tests in 31 files.

The service tests run on an in-process Postgres with every migration applied and the in-memory escrow. The route and page tests call the real route handlers and server components with a signed session cookie; only the database, the escrow provider and Horizon (a fetch stub) are swapped. The stub answers the account read for a G-address and fails on any other request. Those tests set the caps in the environment to 3 campaigns and 250 USDC, with the environment and the modules loaded fresh for each test, so a page or a message that shows those numbers read them from there.

| Scenario | What the tests assert |
|---|---|
| Under both caps | With one deployed open campaign of 40 USDC, a campaign of 50 is created |
| Campaign cap | With 2 deployed open campaigns a third is refused with 409; the message names the cap (2) and the usage (2); no campaign row is written |
| Budget cap | With 80 USDC open, 30 more is refused; the message names 100 and 80. 20.0000001 is refused and 20 is accepted |
| Budget above the cap alone | With nothing open, 150 is refused on the budget cap and 100 is accepted |
| Both caps at once | One refusal names both |
| Drafts pile up | Three campaigns are saved with usage still at zero; two deploy; the third deploy is refused on the campaign cap before the wallet is read, with no escrow operation recorded for it |
| Budget at deploy | Two saved campaigns of 60 USDC: the first deploys, the second deploy is refused with "60 of 100 USDC in use, which leaves no room for a 60 USDC campaign" |
| Caps at submit | Three deploys are requested while nothing is open, so each passes; two are submitted; the third signed deploy is refused with 409 before it is sent: the network is reached twice, its record stays `intent`, the campaign has no contract. The same for the budget cap, and through the route with four deploys under a cap of 3 |
| A confirmed deploy is replayed first | A deploy is confirmed but the campaign's contract id is cleared, as after a lost write. Requesting the deploy again with caps of 1 campaign and 1 USDC and a wallet with no account answers "deploy already confirmed", restores the contract id, and reads the wallet zero times |
| Limit shown on the campaign page | A saved campaign of a funder at 3 of 3 shows the refusal on its page with the deploy button off although the wallet reads as ready; once another campaign is abandoned the line is gone and the button is on. The same for the budget cap |
| Abandon | A deployed, never funded campaign is closed by its owner: nothing is sent to the network, usage drops, and a new campaign is created and deployed. A new fund request and the submit of a fund prepared before the abandon are both refused with "campaign is closed", and the escrow balance stays 0 |
| Abandon refused | For a funded campaign; when the campaign's fund record is `submitted`, `failed` or `confirmed`; for a campaign without an escrow; for a wallet that does not own it (403 with and without the funder role); and a second time |
| Abandon on the page | The control shows on a deployed campaign and not on a draft, a funded campaign, a closed one, or a deployed one whose fund was already sent |
| Close without submissions | A funded campaign with no submissions shows Close campaign, enabled; the close is prepared and submitted through the payouts route |
| Rate limits | The 21st save in ten minutes from one wallet answers 429 and stores nothing; another wallet has its own count. The 31st request for an escrow transaction answers 429 without a Horizon read |
| Closed frees the cap | After one of two open campaigns is funded and closed through the close service, a new campaign is created and deployed |
| Each funder on its own | Another funder's open campaigns do not count |
| Caps follow configuration | With limits of 1 and 25 the check and the message use 1 and 25; through the routes with 3 and 250 in the environment, the new-campaign page shows "of 3" and "of 250 USDC", a 300 USDC campaign is refused naming 250, and a 150 USDC one is accepted |
| Caps shown | The new-campaign page shows both limits and the usage; a saved campaign changes nothing, a deploy does. With the campaign limit reached, and with the budget used up while a campaign slot is free, the page says a new campaign cannot be created and the save button is off |
| Environment values | Unset or empty gives 2 and 100. `0`, `-1`, `1.5`, `2e1`, `two`, `+2`, `10000` and `0x2` are refused as the campaign count; `0`, `0.0`, `-5`, `1e2`, `100 USDC`, `1,5`, `.5` and an eighth decimal are refused as the budget |
| Ready | The deploy and the fund transactions are built, each after one read of the funder's wallet; the page shows "Ready" and the deploy button is on |
| No account | Deploy refused with 409; all four missing items are in one answer; no operation recorded |
| No trustline | Deploy refused: the trustline and the USDC are named |
| Short of USDC | Deploy and fund refused; the message gives the balance, the budget and Circle's faucet; the page shows the same and the fund button is off |
| Short of XLM | Deploy refused with the amount needed. Deploy needs 1 XLM free and fund 0.5. On the page, a deployed campaign whose wallet has 0.7 XLM free reads as ready with the fund button on, and the same wallet on a draft is short |
| Trustline reserve | A wallet with 2.2 XLM and no trustline has 1.2 XLM free; before deploy it needs 1.5, so the trustline, the USDC and the XLM are all listed. With the line in place 1.2 XLM free is enough |
| A fault in the rules | A budget that is not an amount makes the readiness check throw a validation error; it is not reported as "not checked" and nothing is logged as a failed read |
| Every missing item at once | For a wallet with no account the campaign page lists the account, the trustline, the USDC and the XLM in one render |
| Horizon down | A 503, a timeout, a body that is not an account: readiness is "not checked" with a retry on the page, deploy and fund answer 502 with "couldn't check your wallet on Stellar, try again", nothing is recorded, and one line is logged per failed read |
| The wallet read | Balances, subentries and selling liabilities are read from one request to `/accounts/<wallet>` at the configured host. Spendable XLM is checked for 0 and 5 subentries, selling and buying liabilities, sponsoring and sponsored entries, and never goes below zero. A USDC line from another issuer, or one the issuer has not authorised, is no line. Anything that is not a G-address is refused before a URL is built |
| Amounts | Compared to the stroop: 49.9999999 against 50 is short, and a value past what a float holds exactly is still compared exactly |
| A fund already on chain | A fund that landed while its record stayed `submitted` is confirmed and the campaign becomes funded without the wallet being read, although the wallet now holds 0 USDC. The page keeps the fund button on in that state and the panel says the button stays on so the fund can be read back from the escrow, also when Horizon cannot be read; it does not say that deploy and fund stay off |
| A fund that failed without landing | It is rebuilt only for a wallet that is ready; for one that is not, the record stays `failed` |
| After funding | A funded campaign whose funder has 4 of 3 campaigns and 400 of 250 USDC open, and whose wallet has no account: approve, release and close each answer 200, the campaign page shows no readiness panel, and Horizon is not asked once |

The tests were also run against deliberately broken code, twice. First: the readiness check moved in front of the chain read in the fund step, the cap check removed from the deploy request, and the fund button always off for a wallet that is not ready; six tests failed. Then: the cap check removed from the deploy submit, the closed check removed from the fund submit, and the trustline reserve left out; seven tests failed. Both times the tests written for those rules were among them.

## Run 2: one testnet read per wallet state

Run: 2026-10-13T10:16:12Z, read again at 2026-10-13T14:36:46Z after the trustline reserve was added to the rule; the balances were the same both times and the table shows the second read · Network: Stellar testnet · Horizon: `https://horizon-testnet.stellar.org` · USDC issuer: `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`

Five freshly generated keypairs stood in for funder wallets; their secrets were never in the repository and were discarded after the runs. Each was read with the app's own `readFunderAccount` (`src/wallet/onboarding.ts`) and judged with `assessFunding` (`src/domain/funding-readiness.ts`) for a campaign budget of 50 USDC before deploy, which needs 1 XLM free, or 1.5 XLM while the trustline is missing.

How each wallet got into its state:

| Wallet | Setup | Transactions |
|---|---|---|
| A [`GBYURNYS…Y4UB3`](https://stellar.expert/explorer/testnet/account/GBYURNYSESGOK6H4XD76F2VBNWXGDBBOBKX3IM3BEGQQQN63D6EY4UB3) | Never created | none |
| B [`GBFETLFM…PYAYH`](https://stellar.expert/explorer/testnet/account/GBFETLFMYU4HCX2W5B7YMTZ4A65GL5HTW3TKAKBZPFHTRL675UFPYAYH) | Friendbot | create [e73892700dc6…](https://stellar.expert/explorer/testnet/tx/e73892700dc6a3379616d5d7e9253b47dc6b8137c831757e95c55b404e88e6a6) |
| C [`GCYNBGP6…SFU65`](https://stellar.expert/explorer/testnet/account/GCYNBGP6TGF4N7SBOK5ZK7RHWWLZMAX4A3E26HGQEOKS5B6DNHFSFU65) | Friendbot, USDC trustline | create [77787a231b27…](https://stellar.expert/explorer/testnet/tx/77787a231b27b9b0e49a97da8735253ecf0b7544259ca47108014c022eb34ba7) · trustline [91190809aea7…](https://stellar.expert/explorer/testnet/tx/91190809aea7088711215a07bfe2d5b15d105b27fe988f150c798bb5032a7dc2) |
| D [`GDAIWCKL…QWFJU`](https://stellar.expert/explorer/testnet/account/GDAIWCKLPOVQ5HVJ7TPRR5LLDR3U4Y2DJN7N2R7SJV7B4TYEYWIQWFJU) | Friendbot, USDC trustline, 120 USDC bought with XLM on the testnet order book | create [ff6e6a7a4c51…](https://stellar.expert/explorer/testnet/tx/ff6e6a7a4c51e1afd909351ffd477c4b0e30adfa1c3fb7a7030a43f91f233b9c) · trustline [9e1388291103…](https://stellar.expert/explorer/testnet/tx/9e13882911035dff59b08a88f6830836b3a71747a77f66f550df50b1db4f4295) · buy [6fe03fd4455a…](https://stellar.expert/explorer/testnet/tx/6fe03fd4455a8a240fb164d8317a50b1328718484af8304ce8ce3daa6f5ae4a4) |
| E [`GA5EQ33I…YFD44`](https://stellar.expert/explorer/testnet/account/GA5EQ33I5G4KCP3MG2ILLMLMSZ4RITZDO5W2FCDJ3VPLWY42UY5YFD44) | Created by D with 2 XLM, USDC trustline, 55 USDC sent by D | create [3cd255b9405c…](https://stellar.expert/explorer/testnet/tx/3cd255b9405c8da09c2d43bf2b26b146dade6d29c9383afd0de8a9e1714700b4) · trustline [cf027993353f…](https://stellar.expert/explorer/testnet/tx/cf027993353faf03711fd3ffa92a85e8f5d1f3b26f5ddb5c0af69dfade164dcf) · USDC [1f520cc9ba46…](https://stellar.expert/explorer/testnet/tx/1f520cc9ba4641eae7a3f993fb77b8785d4b67d0eb727f1306f6d998d5ee747a) |

The USDC for D came from the testnet order book and not from Circle's faucet, which needs a browser. It is the same asset from the same issuer.

What the app read and concluded:

| State | Wallet | Read from Horizon | Spendable | Result for a 50 USDC budget, before deploy |
|---|---|---|---|---|
| No account | A | 404 | 0 USDC, 0 XLM | Not ready: account, trustline, USDC (0 of 50), XLM (0 of 1.5) |
| No trustline | B | 10000 XLM, 0 subentries, no USDC line | 0 USDC, 9999 XLM | Not ready: trustline, USDC (0 of 50). XLM is enough: 9999 of 1.5 |
| Short of USDC | C | 9999.99999 XLM, 1 subentry, 0 USDC | 0 USDC, 9998.49999 XLM | Not ready: USDC (0 of 50) |
| Ready | D | 9868.509548 XLM, 1 subentry, 65 USDC | 65 USDC, 9867.009548 XLM | Ready |
| Short of XLM | E | 1.99999 XLM, 1 subentry, 55 USDC | 55 USDC, 0.49999 XLM | Not ready: XLM (0.49999 of 1) |

Spendable XLM is the balance minus the reserve, 1 XLM plus 0.5 XLM per subentry: 10000 − 1 for B, 9999.99999 − 1.5 for C, 1.99999 − 1.5 for E. Before fund, E is still short: it needs 0.5 XLM free and has 0.49999.

To check a row yourself, read the same record the app reads:

```
curl "https://horizon-testnet.stellar.org/accounts/GA5EQ33I5G4KCP3MG2ILLMLMSZ4RITZDO5W2FCDJ3VPLWY42UY5YFD44"
```

`balances`, `subentry_count` and the `selling_liabilities` of each balance are the fields used. The accounts are live testnet accounts, so their balances can differ from this table if anything is sent to them later.

The fee floor comes from the Week 1 escrow transactions ([escrow-cycle.md](escrow-cycle.md)), read on Horizon on 2026-10-13:

| Transaction | Fee bid (`max_fee`) | Fee charged |
|---|---|---|
| deploy [31c9dd13adca…](https://stellar.expert/explorer/testnet/tx/31c9dd13adcad008bd8b82f1a16c3b3265005faf5024c730f7b065e5de5dcff4) | 0.0444693 XLM | 0.0380569 XLM |
| fund [9fe69bb62061…](https://stellar.expert/explorer/testnet/tx/9fe69bb62061c736e1ed6f885803a4488c78947ba5b59348ed8966da863894ba) | 0.0698270 XLM | 0.0298443 XLM |

The floor is 0.5 XLM per transaction still to sign, about seven times the larger bid.

## Run 3: local app

Run: 2026-10-13, 11:22 to 13:07 UTC · App: a local instance of this repository (`next dev`) with the working tree of this change, on a scratch Postgres 17 database with every migration applied through `pnpm db:migrate`. Throwaway server keys. Horizon was the real testnet host; the Trustless Work host pointed at a closed local port, so no escrow request left the machine. The five wallets of Run 2 signed in with the wallet challenge and were given the funder role with `pnpm role:grant` against the scratch database.

This run has not been repeated since the changes that review asked for, and the wallets' keys are gone. The tables show what the app answered at the time. Four outputs read differently now: the budget refusal ends "which leaves no room for a 150 USDC campaign" where it said "and this campaign adds 150 USDC"; the limits box says "50 USDC left" and words the rule as in the technical summary; the notice at a limit reads "You have reached the open-campaign limit, so a new campaign can't be created"; and wallet A is told it needs 1.5 XLM, not 1. The behaviour added after the run is covered by Run 1 only: the cap check at submit, the refusal shown on a saved campaign's page, the abandon action, Close on a funded campaign without submissions, and the two rate limits.

Each wallet saved a 50 USDC campaign, opened its page and asked for the deploy transaction:

| Wallet | New-campaign page | Readiness panel on the campaign page | Deploy button | `prepare deploy` |
|---|---|---|---|---|
| A, no account | 0 of 2 campaigns, 0 of 100 USDC | Not ready: account, trustline, USDC 0 of 50, XLM 0 of 1, with Activate, Add trustline and the faucet link | off | 409, the same four items in one message |
| B, no trustline | same | Not ready: trustline, USDC 0 of 50 | off | 409, the same two items |
| C, short of USDC | same | Not ready: "The wallet has 0 USDC to spend and the budget is 50 USDC", with the faucet | off | 409, the same item |
| D, ready | same | Ready: "65 USDC to spend and 9867.009548 XLM free for network fees" | on | 502 `ESCROW`, "trustless work unreachable": the caps and the wallet check passed and the request stopped at the provider this run did not reach |
| E, short of XLM | same | Not ready: "0.49999 XLM free for network fees and needs 1 XLM" | off | 409, the same item |

After these five requests the scratch database held five campaigns, none deployed, and no escrow operation.

The caps, as wallet D. The provider was not reachable, so a campaign was marked deployed, and later closed, by writing `escrow_contract_id` and `closed_at` in the scratch database; those two writes are the only steps not made through the app.

| Step | Result |
|---|---|
| Save a 150 USDC campaign with nothing open | 409 "open-budget limit exceeded: this wallet has 0 of 100 USDC in use and this campaign adds 150 USDC" |
| Save a 30 USDC draft | saved |
| The 50 USDC campaign marked deployed; new-campaign page | "1 of 2 in use", "50 USDC of 100 USDC in use, 50 USDC left for this campaign" |
| Save 60 USDC | 409 "…50 of 100 USDC in use and this campaign adds 60 USDC" |
| Save 40 USDC | saved |
| The 40 USDC campaign marked deployed; new-campaign page | "2 of 2 in use", "90 USDC of 100 USDC in use", "You are at the open-campaign limit", save button off |
| Save 10 USDC | 409 "open-campaign limit reached: this wallet has 2 of 2 open campaigns in use, close one first" |
| Ask for the deploy of the 30 USDC draft | 409 naming both caps: 2 of 2 campaigns, and 90 of 100 USDC with 30 to add |
| The 40 USDC campaign marked closed; new-campaign page | "1 of 2 in use", "50 USDC of 100 USDC in use" |
| Ask for the deploy of the 30 USDC draft again | past the caps and the wallet check; 502 at the unreachable provider |
| Save 10 USDC | saved |

No escrow operation was recorded for any refused deploy.

The app was then restarted with `FUNDER_MAX_OPEN_CAMPAIGNS=3`, `FUNDER_MAX_OPEN_BUDGET=250` and `HORIZON_URL` set to an `https` address on a closed port:

| Step | Result |
|---|---|
| New-campaign page | "1 of 3 in use", "50 USDC of 250 USDC in use, 200 USDC left for this campaign" |
| Save 300 USDC | 409 "…50 of 250 USDC in use and this campaign adds 300 USDC" |
| Save 150 USDC | saved |
| Campaign page of the 30 USDC draft | "Not checked", "Stellar testnet didn't answer, so this wallet hasn't been checked", a Retry button, deploy button off |
| Ask for its deploy | 502 `LEDGER` "couldn't check your wallet on Stellar, try again"; no escrow operation recorded |
| Server log | one `funder wallet read failed` line per read, with the wallet, the step and "Stellar testnet did not answer" |

A first attempt at this last part used an `http://` address for Horizon. The create and deploy routes then answered 500: the Stellar SDK that the escrow routes load refuses a plain `http` Horizon host before any of this code runs. That is how the app already behaved and is noted in [deployment](../deployment.md#funder-limits); the `https` address above is what a real outage looks like to the app.

## What this does not show

- **A ready wallet deploying and funding through Trustless Work.** Not recorded yet. Steps: on a deployment with a Trustless Work key, a wallet shown as ready deploys and funds a campaign from the campaign page; record the two transaction hashes and the fees charged against the 0.5 XLM floor.
- **The panel's buttons in a browser.** Activate, Add USDC trustline, Check again, the faucet link and the abandon confirm step were rendered and the first two use the contributor page's helpers, but nobody has clicked them with a wallet extension.
- **Abandon on a real escrow.** Covered against the in-memory escrow and through the route in tests only. It has not been run in the local app or on a campaign whose escrow exists on testnet, and it never reads the escrow: that nothing is in it rests on the app's own records.
- **Two submits at the same moment.** The tests run on a database with one connection, so a deploy submit is always checked after the one before it finished. Two handled at once are not covered and can both pass the caps.
- **A fund reconciled on testnet with an emptied wallet.** Covered against the in-memory escrow only.
- **Run on proofwork.online.** Not recorded yet. No migration is needed; the two variables are optional.
