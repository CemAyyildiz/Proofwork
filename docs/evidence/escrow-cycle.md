# Escrow cycle evidence (Week 1 spike)

Run: 2026-09-23T13:37:47.534Z  ·  Network: Stellar testnet  ·  Escrow: Trustless Work v1 multi-release
Contract: `CCDKBF7H5NOMNHBLYP7DFMAPBUA4YJ2DMOLETHIDNKKMLAX2PZC33WBF`

| Step | Tx hash | Note |
|---|---|---|
| trustline GDXGFS | [23ae1b4ed440…](https://stellar.expert/explorer/testnet/tx/23ae1b4ed44031c9512a2f13cd3190a2e9d9291b44a0734e4778c8a5284b363f) |  |
| 1 deploy | [31c9dd13adca…](https://stellar.expert/explorer/testnet/tx/31c9dd13adcad008bd8b82f1a16c3b3265005faf5024c730f7b065e5de5dcff4) | CCDKBF7H5NOMNHBLYP7DFMAPBUA4YJ2DMOLETHIDNKKMLAX2PZC33WBF |
| 2 fund | [9fe69bb62061…](https://stellar.expert/explorer/testnet/tx/9fe69bb62061c736e1ed6f885803a4488c78947ba5b59348ed8966da863894ba) | 5 USDC |
| 3 append milestone post-funding | [a0a57d936860…](https://stellar.expert/explorer/testnet/tx/a0a57d9368609f09b717235ea74b765ed68170f7a3df3a63f52b84f31608c8de) | AD-2 confirmed |
| 4a mark delivered | [cc32e7c67cee…](https://stellar.expert/explorer/testnet/tx/cc32e7c67cee231c0608f834515d789bdc2cfe88165dcf8c121fb4facf147fd1) |  |
| 4b approve | [f746db8422f6…](https://stellar.expert/explorer/testnet/tx/f746db8422f6bae8505cc54aa02c8b45a3347a94f82d60eb8d5b87ef9abc8919) |  |
| 4c release | [360d69ee23f8…](https://stellar.expert/explorer/testnet/tx/360d69ee23f843dbb237bd1d7533f14b891ac47bb83fdd9d25bb62eecf20658e) | 1 USDC → contributor |
| 5a dispute close milestone | [ae5fccb27c62…](https://stellar.expert/explorer/testnet/tx/ae5fccb27c622d4797724e4928252be5b14d0f8e58a4350f5843285226121e77) |  |
| 5b withdraw remaining → funder | [650cb074d28e…](https://stellar.expert/explorer/testnet/tx/650cb074d28ee51bd5b58b37fcccf8ccb361449f6937c97bde6dd966c58935dd) | AD-4 confirmed |
| 6 decision ledger | [1be85aa3bc19…](https://stellar.expert/explorer/testnet/tx/1be85aa3bc199d8643aefe9c17b1f0ed97d8e7c05b863bb94ed541ac3a72d19e) | key=pw:spike001 hash=6a72919fdfbd4426… |

Decision ledger canonical JSON (sha256 = memo hash of step 6):
```json
{"v":1,"submission":"spike001","campaign":"spike","reviewer":"GCWGOELY7A55VZHJFRZBKR7ZMKURNYPUF2K3KL37ESBB2P7MJTZNCCC3","outcome":"PASS","reason":"R00_PASS","signals":{"account_genuine":true,"content_original":true,"task_done":true,"follows_brief":true,"single_account":true,"not_spam":true},"appealOf":null,"decidedAt":"2026-09-23T13:37:43.897Z"}
```
