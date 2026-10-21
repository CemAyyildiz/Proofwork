# Evidence index, Month 2

Proofwork · Stellar Instawards, Stellar Türkiye chapter · Month 2 sprint, Oct 1 to Nov 1, 2026 · Stellar testnet only.

Month 1 ran one campaign that Proofwork set up and operated itself; its evidence is in the [Month 1 index](README.md). Month 2 is about a team other than Proofwork running its own campaign. This page maps every deliverable row of the Month 2 Statement of Work, and every evidence row of the Customer Development Plan, to what shows it: a document, a link or a transaction hash. A row that has nothing yet is marked **open**, with who provides it. Every transaction hash opens on [stellar.expert](https://stellar.expert/explorer/testnet).

Last updated 2026-10-13. On that day the code for Deliverable 1 and for the X and warning parts of Deliverable 2 was built and tested, and the external-funder path had been rehearsed on testnet. No team interview, pilot campaign, recording or rubric revision existed yet.

| Shared evidence | Where |
|---|---|
| GitHub repo | [README](../../README.md) · the repository is meant to be published, and everything on this page is written to be read by anyone · public URL: **open** · Cem |
| Demo video, Month 2 | **open** · Cem |
| Live app | [proofwork.online](https://proofwork.online) (Stellar testnet) |
| External-funder rehearsal, every step and transaction | [external-funder-rehearsal.md](external-funder-rehearsal.md) · what the app recorded for its campaign: [rehearsal-campaign.md](rehearsal-campaign.md) |
| Pilot campaign, every transaction and the funding team's wallet | `pilot-campaign.md`, written by `pnpm evidence:dump <slug> pilot-campaign` · **open** until the pilot has run · Cem |
| Customer development records and their format | [customer-development/](customer-development/README.md) |
| Findings: what the records support or contradict in the plan's hypotheses | `customer-development/findings.md` ([what it holds](customer-development/README.md#findings)) · **open** · Cem, after the records |
| Technical summary | [technical-summary.md](../technical-summary.md) · how a team-run campaign differs: [Team-run campaigns](../technical-summary.md#team-run-campaigns) |
| Review rubric | [rubric.md](../rubric.md), v1 today |
| Hosting, deployment and operator commands | [deployment.md](../deployment.md) |

## Deliverable 1: funder access without the operator

*A team connects a wallet, asks for funder access in the app and is approved or rejected by the operator on an admin page. Every grant and revocation is logged, each funder is capped, and the wallet is checked before it funds.*

| SOW row | Evidence | Status |
|---|---|---|
| Team connects a wallet and requests funder access | [funder-access.md](funder-access.md): request form, pending state, second request refused, rate limit · on testnet wallets: [rehearsal → Request to approval](external-funder-rehearsal.md#request-to-approval) · code: `src/services/access.ts`, `src/app/api/access/requests/route.ts` | recorded, on a local instance |
| Operator approves or rejects on an admin page | [funder-access.md](funder-access.md): approve, reject, revoke, the `ops` gate · [rehearsal → Request to approval](external-funder-rehearsal.md#request-to-approval) and [Revoked after funding](external-funder-rehearsal.md#revoked-after-funding) · code: `src/app/(workspace)/admin/`, `src/app/api/admin/access/route.ts` | recorded, on a local instance |
| Every grant and revocation is logged | Access log read back after each run: [funder-access.md → Run 2](funder-access.md#run-2-local-app) (six changes, six rows) and [rehearsal → Revoked after funding](external-funder-rehearsal.md#revoked-after-funding) (three changes, three rows) · one function writes roles and the log together: [technical summary → Funder access](../technical-summary.md#funder-access) | recorded, on a local instance |
| Cap on open campaigns and on budget per funder | [funder-readiness.md](funder-readiness.md): both caps, at create, at deploy and at submit · on a real escrow: [rehearsal → Limits and abandon](external-funder-rehearsal.md#limits-and-abandon) (2 of 2 reached, third deploy refused, abandon frees the place) | recorded, on testnet |
| Readiness check before funding (USDC trustline and balance) | [funder-readiness.md → Run 2](funder-readiness.md#run-2-one-testnet-read-per-wallet-state): one testnet read per wallet state · one wallet going from not ready to ready and then deploying and funding: [rehearsal → Not ready, then ready](external-funder-rehearsal.md#not-ready-then-ready) · deploy [5e5759254e86…](https://stellar.expert/explorer/testnet/tx/5e5759254e86e8dc08f1f5e3bfa7d3daa80fea4364e67578935ee0eae143f535), fund [aa5f5a7fabdc…](https://stellar.expert/explorer/testnet/tx/aa5f5a7fabdca1670c090aeb57dac7c1fbe825ebde71be2cb8a609a543518ce0) | recorded, on testnet |
| Evidence: demo video | Request, approve, create and fund sections of the Month 2 demo video | **open** · Cem |
| Evidence: repo | [README](../../README.md) and the code paths in the rows above | recorded |
| Evidence: screenshots | Request form, pending state, admin page, readiness panel, funded campaign | **open** · Cem |
| Evidence: grant visible in the access log | From the rehearsal, the funder grant by the operator's wallet at 15:37:01 UTC on 2026-10-13: [rehearsal → Revoked after funding](external-funder-rehearsal.md#revoked-after-funding) · on proofwork.online, for the pilot team's wallet | rehearsal recorded · proofwork.online **open** · Cem |

Still open for Deliverable 1 on proofwork.online: migration `0006`, the operator's `ops` grant, and one request approved there ([funder-access.md → Not recorded yet](funder-access.md#not-recorded-yet)). Owner: Cem.

What the readiness check covers, and what it does not: it asks for 1 XLM free above the reserves, which is for the deploy and the fund only. The team's wallet also signs one release for each approved submission and the close. The close cost 0.0014066 XLM in the rehearsal. No release signed by a funder other than the operator has been run, so its fee has not been measured, and nothing checks the wallet's XLM before a release or a close.

## Deliverable 2: rubric v2, X account verification, multi-account warnings

*The rubric is revised from the Month 1 results. A contributor connects an X account and can submit only a post that account wrote. The reviewer is warned when wallets in one campaign share a funding source. Month 1 contributors are asked for feedback.*

| SOW row | Evidence | Status |
|---|---|---|
| Revise the rubric from the Month 1 results table, reason for each change | `docs/results.md` and rubric v2 in [rubric.md](../rubric.md), neither of which exists yet. The results table needs the Month 1 campaign closed and its review log exported (`pnpm results`); the revision follows from it | **open** · Cem (results table), then the rubric change |
| Follows from changing the rubric: each decision records the rubric version it was scored under, and v1 decisions stay verifiable | Built together with rubric v2 | **open** · with rubric v2 |
| Contributors connect X (Sign in with X) before submitting | [x-connect.md](x-connect.md): tests and local runs against a fake X · [technical summary → X account connection](../technical-summary.md#x-account-connection) | built and tested · against X itself **open** · Cem provides the X developer app |
| Post author looked up by post ID through the X API and must match; another account's post is rejected | [x-connect.md](x-connect.md) · [technical summary → Post author check](../technical-summary.md#post-author-check) · operator check of the lookup: [`pnpm x:check`](../deployment.md#checking-the-lookup) | built and tested · against X itself **open** ([x-connect.md → Run 5](x-connect.md#run-5-live-against-x)) · Cem |
| One X account linked to only one wallet | [x-connect.md](x-connect.md): the second wallet is refused, and the database holds the rule in two unique keys | built and tested · against X itself **open** · Cem |
| Only the X account ID is stored; post text is not read | [technical summary → X account connection](../technical-summary.md#x-account-connection), "What is stored" · [Post author check](../technical-summary.md#post-author-check), "What X returns and what is kept" · the bundle scan in [x-connect.md](x-connect.md) | built and tested |
| Follows from the author check: one post is submitted once, whatever handle or host its link carries | [x-connect.md](x-connect.md): the post ID under a unique index, and the backfill of earlier rows | built and tested |
| Warnings in the review queue: wallets that received first funds from the same Stellar account, excluding Friendbot and faucets | [funding-source.md](funding-source.md): four testnet wallets, their creating transactions and the count each review card shows · [technical summary → Shared funding source warning](../technical-summary.md#shared-funding-source-warning) | recorded, on testnet |
| Short feedback from Month 1 contributors | `customer-development/contributor-feedback.md` in the [record format](customer-development/README.md) | **open** · Cem (form, outreach and summary) |
| Evidence: rubric v2 doc | [rubric.md](../rubric.md) once revised | **open** · as the first row |
| Evidence: repo | [README](../../README.md) and `src/x/`, `src/services/x-account.ts`, `src/services/submission.ts`, `src/services/review.ts` | recorded |
| Evidence: screenshots | Connect X step, an accepted and a rejected submission, a review card with a warning | **open** · Cem |
| Evidence: demo of connect, accept and reject | Month 2 demo video, on a deployment with the X credentials set | **open** · Cem |
| Evidence: warnings | [funding-source.md](funding-source.md) · a review card with a warning in the demo video | testnet read recorded · on video **open** · Cem |
| Evidence: feedback summary | As the feedback row above | **open** · Cem |

## Deliverable 3: team interviews and an external pilot campaign

*At least five Stellar teams are interviewed. One team creates and funds a testnet campaign through Deliverable 1, gives the final approval, releases the payouts and gets its remainder back, and is interviewed afterwards.*

| SOW row | Evidence | Status |
|---|---|---|
| Interview at least five Stellar teams (how they run campaigns, what goes wrong with farming, what they check before paying) | Five records, `customer-development/interview-<nn>-<team>.md`, in the [record format](customer-development/README.md) | **open** · Cem |
| One testnet campaign created and funded by a team through Deliverable 1 | The path, run by Proofwork with a wallet that never had a role: [external-funder-rehearsal.md](external-funder-rehearsal.md) · the pilot team's own campaign: `pilot-campaign.md` | rehearsal recorded · pilot **open** · Cem and the pilot team |
| Team gives final approval and releases the payouts | Release rows of `pilot-campaign.md`. Not rehearsed: a submission needs X ([rehearsal → Not run](external-funder-rehearsal.md#not-run)) | **open** · Cem and the pilot team |
| Remainder returns to the team at the deadline | Rehearsed with a funder that is not the operator: dispute [543b1fd6c5e7…](https://stellar.expert/explorer/testnet/tx/543b1fd6c5e7ee68170eea975c0c1acbbc6c404ac70bae07a8d2bf05af84bf67), withdrawal [2df7fde33230…](https://stellar.expert/explorer/testnet/tx/2df7fde332303415e48ed3c53163a1c3e1b8e512a5a2c68facdd8a8e0286bbb1), 4.985 of 5 USDC back to the funding wallet after the 0.3% protocol fee ([rehearsal → Close and remainder](external-funder-rehearsal.md#close-and-remainder)) · returned in the app by the resolver's own wallet, no server key: [in-app-remainder.md](in-app-remainder.md), return [3b7a2b91a5f4…](https://stellar.expert/explorer/testnet/tx/3b7a2b91a5f4e4d0638f38b5ddd6c455f2456201a6dc15690c7c90ce7d9bc1dd) · the pilot's own: `pilot-campaign.md` | rehearsal and in-app return recorded · pilot **open** · Cem (the resolver stays Proofwork's key) |
| Debrief interview | `customer-development/debrief-<team>.md` in the [record format](customer-development/README.md): what the team would change and what it would pay for. Linked from here only if the team agreed to be named and to its wallet and campaign page being shown as the pilot's ([Consent](customer-development/README.md#consent)) | **open** · Cem |
| Evidence: interview summaries | As the first row | **open** · Cem |
| Evidence: campaign page | `https://proofwork.online/c/<pilot slug>` | **open** · Cem and the pilot team |
| Evidence: testnet tx hashes | `pilot-campaign.md`: deploy, fund, milestones, releases, close, remainder, decisions | **open** · Cem, by running the dump on the pilot campaign |
| Evidence: funding team's wallet | The "Funder wallet" row at the top of `pilot-campaign.md`; the same wallet is the source account of the deploy and fund transactions. Shown for the rehearsal in [rehearsal-campaign.md](rehearsal-campaign.md) | **open** · Cem, same dump |
| Evidence: debrief notes | As the debrief row | **open** · Cem |

## Customer Development Plan evidence rows

| Row | Evidence | Status |
|---|---|---|
| Loom recording of a product demo with a potential customer | A link in the interview or debrief record it belongs to ([record format](customer-development/README.md): Recording) | **open** · Cem, during an interview or the pilot |
| User testing recording or UX session video | One contributor or funder session, linked here | **open** · Cem |
| Website traffic report | A screenshot of the site's traffic report, linked here | **open** · Cem |
| Customer interview summary or feedback documentation | The records in [customer-development/](customer-development/README.md): five interviews, the contributor feedback summary, the debrief; and `customer-development/findings.md`, which sets them against the plan's hypotheses | format recorded · records and findings **open** · Cem |
| Other: live campaign and on-chain evidence | Month 1: the [Month 1 index](README.md) · the rehearsal: [external-funder-rehearsal.md](external-funder-rehearsal.md) · the pilot: its campaign page and `pilot-campaign.md` | rehearsal recorded · pilot **open** · Cem |

## Privacy

The repository is meant to be published, so every page here is written as public. Customer development records name teams that agreed to be named and never a person: no name, contact detail, handle or wallet of an individual. Screenshots show the testnet badge and contain no secrets, emails or private data; contributor wallets appear truncated. A funding team's wallet is shown in full, because it is the evidence that the team funded its own campaign; the pilot team is asked for that before the pilot, and a debrief from a team that did not agree is kept under a neutral label and not linked to the pilot pages. No list of planted submissions is in the app database or in this repository.
