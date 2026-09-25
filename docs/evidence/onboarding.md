# Contributor wallet onboarding evidence

A brand-new testnet wallet is taken from "does not exist" to "can receive USDC" by the same browser code the contributor page runs (`src/wallet/onboarding.ts`): Horizon account read → Friendbot → unsigned `changeTrust` for USDC → wallet signature → Horizon submit → re-read. The server-side gate in `createSubmission` uses the same Horizon read and refuses a submission until the trustline exists.

## Run 1: scripted, fresh keypair

Run: 2026-09-26T15:20:45Z · Network: Stellar testnet · USDC issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`
Account: [`GCN7FQMYXUNZ6MPGKMUMOFLQZXR2DMPUWQSTCQQJJEEKOQNYC6SIY2M4`](https://stellar.expert/explorer/testnet/account/GCN7FQMYXUNZ6MPGKMUMOFLQZXR2DMPUWQSTCQQJJEEKOQNYC6SIY2M4)

A freshly generated keypair stood in for the wallet's signature; every other call is the page's own code against the live hosts.

| Step | Account state read from Horizon | Server gate (`hasUsdcTrustline`) | Tx hash |
|---|---|---|---|
| 0 before onboarding | `no-account` (404) | refuse | none |
| 1 activate with Friendbot | `no-trustline` | refuse | [8212c2e7d159…](https://stellar.expert/explorer/testnet/tx/8212c2e7d159796fd8b4330971d6f1e4fc36d2b284891b777d0f1495cf432e24) |
| 2 `changeTrust` USDC, signed by the account | `ready` | allow | [4c6ea31c82be…](https://stellar.expert/explorer/testnet/tx/4c6ea31c82be7c2e6a2abae5de1d22a25204c8a9aa4228c8713770961603db44) |

## Run 2: Freighter in the browser, through to a submission

Not recorded yet. Steps: install Freighter, create a new testnet account, open `/c/<slug>` of a funded campaign, connect, "Activate testnet account", "Add USDC trustline" (sign in Freighter), submit a post link. Record the Friendbot tx, the trustline tx shown on the page and the submission short ID here.
