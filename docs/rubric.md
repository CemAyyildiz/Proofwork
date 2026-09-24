# Proofwork review rubric (v1)

**Purpose.** Every submission to a Proofwork campaign is checked by a human reviewer against the same six yes/no signals before any money can move. Each signal asks one question about the submission. The reviewer ticks each signal as pass or fail, the rubric turns that into an outcome, and the outcome is written to the Stellar ledger with a reason code, so anyone can check afterwards what was decided and why.

**The gate.** A submission passes when **at least 4 of 6** signals pass. With 3 or fewer it fails. A pass only makes the submission eligible: the funder's approval is the final human check before a reward is paid.

## The six signals

### 1. Account genuine · fail code `R01_ACCOUNT`
*Question: is this a real, established account rather than a throwaway?*

| Counts as pass | Counts as fail |
|---|---|
| Account has a history of its own posts from before the campaign. *E.g. two-year-old account posting regularly about dev tools.* | Created just before or during the campaign, no post history, default avatar or throwaway handle pattern. *E.g. account made yesterday, zero earlier posts, handle like `user84736291`.* |

### 2. Content original · fail code `R02_ORIGINAL`
*Question: did this person write this themselves?*

| Counts as pass | Counts as fail |
|---|---|
| Wording is the author's own, not shared with other submissions. *E.g. a post describing the setup in the author's own words.* | Near-duplicate of another submission, or visibly pasted template text. *E.g. same three sentences as another submission with one word swapped.* |

### 3. Task actually done · fail code `R03_TASK`
*Question: does the post show the person really used the product?*

| Counts as pass | Counts as fail |
|---|---|
| Contains specifics only someone who tried it would know. *E.g. "Funding took two wallet prompts; the release showed up in about 5 s."* | No specifics; could have been written without trying the product. *E.g. "Just tried it, amazing product, highly recommend!"* |

### 4. Follows the brief · fail code `R04_BRIEF`
*Question: does the post contain everything the campaign brief asked for?*

| Counts as pass | Counts as fail |
|---|---|
| Every required element of the brief is present. *E.g. brief asks for a screenshot and a link; both are there.* | A required element is missing: no product mention, wrong link or wrong format. *E.g. brief asks for a link to the docs; the post links somewhere else.* |

### 5. Single-account check · fail code `R05_MULTI`
*Question: is this one person submitting once, not one person behind several accounts?*

| Counts as pass | Counts as fail |
|---|---|
| Nothing links this account to another submission in the same campaign. *E.g. distinct voice, posted at an unrelated time, wallet funded independently.* | Writing style, timing pattern or wallet funding source links it to another submission. *E.g. two submissions minutes apart, same phrasing, wallets funded from the same source.* |

### 6. Not spam / farming · fail code `R06_SPAM`
*Question: is this a genuine contribution rather than reward farming?*

| Counts as pass | Counts as fail |
|---|---|
| Says something specific about the product. *E.g. names one thing that worked and one that did not.* | Generic praise with no detail, or phrasing that matches known farming patterns. *E.g. "Great project! To the moon! #airdrop"* |

## Reason codes

- A **PASS** always carries `R00_PASS`.
- A **FAIL** carries the code of the primary failed signal, chosen by the reviewer from the signals that actually failed (`R01_ACCOUNT`, `R02_ORIGINAL`, `R03_TASK`, `R04_BRIEF`, `R05_MULTI`, `R06_SPAM`). Using the code of a signal that passed is rejected by the app.
- Every decision also carries one line of note the contributor can act on.

## One-shot re-review

A contributor whose submission failed can ask for exactly one re-review. It is scored with the same six signals and recorded the same way, under its own ledger key `pw:<id>:a1`. The re-review record includes the hash of the first decision, so the two are linked and the first one cannot be quietly replaced.

## What goes on-chain per decision

Each decision is one Stellar transaction from the decision ledger account:

- `manage_data` key `pw:<id>` (first pass) or `pw:<id>:a1` (re-review), value `v1|<outcome>|<code>|<hash prefix>`, for example `v1|FAIL|R03_TASK|9f2c…`.
- `memo_hash` set to the SHA-256 hash of the full decision record (submission, campaign, reviewer, outcome, reason code, all six signal answers, time and, for a re-review, the first decision's hash).

The `/verify/<decision>` page recomputes that hash from the stored record, so anyone can compare it with the memo in a Stellar explorer.
