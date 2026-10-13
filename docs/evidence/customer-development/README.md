# Customer development records

What Proofwork learned from talking to people is kept here as written records: one per team interview, one summary of the Month 1 contributors' feedback, and one for the debrief with the team that ran the pilot campaign. All three use the same format, below, so they can be read side by side. What the records add up to goes on a separate findings page.

This folder holds the format and, once they are written, the records. No record is in it yet: nothing here is filled in until the conversation it describes has taken place.

## Pages to write

| Page | How many | File name | Status |
|---|---|---|---|
| Team interview | at least five | `interview-<nn>-<team>.md`, for example `interview-01-<team>.md` | open · Cem |
| Month 1 contributor feedback, one summary of all answers | one | `contributor-feedback.md` | open · Cem |
| Pilot debrief | one | `debrief-<team>.md` | open · Cem |
| Findings: what the records support or contradict | one | `findings.md` | open · Cem, after the records |

When a page is added, link it from the [Month 2 evidence index](../month-2.md) and change its row here.

## Rules

- **Teams are named, people are not.** A record gives the person's role and nothing that identifies or reaches them: no name, no email, phone number, handle, wallet address or link to a profile.
- **Consent comes first, and it is written down.** These records are written to be public: the repository is meant to be published, so treat every record as readable by anyone from the day it is committed. Each record says who agreed, to what, and when ([Consent](#consent)).
  - Not agreed to be named: use a neutral label (`Team A`, `Team B`) in the text and in the file name, and leave out anything that would give the team away.
  - Not agreed to be quoted: write what was said in your own words and write "none, not agreed" under Quotes.
- **The pilot team is public whatever the debrief says.** Its campaign page, its escrow and its funding wallet are on chain and in the pilot's evidence page, and its campaign carries the title it chose. So before the pilot the team is asked whether its wallet and its campaign page may be shown as the pilot's. If it agrees to that and to being named, the debrief names it and links to the pilot pages. If it does not agree to both, the debrief is written under a neutral label and is **not linked to or from the pilot pages**: nothing in the index or in the record may connect the label with the campaign.
- **Only what was said.** A record describes a conversation that happened. No answer is filled in from memory of another conversation, guessed, or tidied into something the person did not say. A question that was not asked or not answered is written as "not asked" or "not answered".
- **Conclusions go on the findings page, not in a record.** A record holds what one team or group said. What that means for the plan is written once, in `findings.md` ([Findings](#findings)).
- **Quotes are exact or absent.** Words between quotation marks are the person's own, in the language they used, with a translation after them if that helps. A paraphrase is not put in quotation marks.
- **A recording is linked, not described.** If the conversation was recorded and the team agreed to the recording being linked, the link goes in the record's first table. No link is written before the recording exists.
- **Contributor feedback is one summary.** It counts answers and does not single out a contributor: no wallet, no handle, no submission ID, and no quote that could only have come from one known person.

## The format

Copy everything inside the block into a new file and fill it in. Keep every heading, also when its answer is "not asked".

```markdown
# <Kind>: <team or label>

| | |
|---|---|
| Kind | interview · contributor feedback · debrief (keep one) |
| Date | YYYY-MM-DD (for contributor feedback: the dates the form was open) |
| Team | <team name, or a neutral label when the team did not agree to be named> |
| Role of the person | <for example: community lead, founder, developer relations. No name> |
| How it was held | <call, chat, in person, form> · <length, or number of answers out of number asked> |
| Recording | <link, when one exists and its linking was agreed> · none |

| Consent | |
|---|---|
| Given by | <see the Consent table for this kind of record> |
| To the team being named | yes · no · not applicable |
| To being quoted | yes · no · <n> of <m> respondents |
| To its wallet and campaign page being shown as the pilot's | yes · no · not applicable (debrief only) |
| Given on | YYYY-MM-DD |

## What they do today

## What goes wrong

## What they check before paying

## What they would change, and what they would pay for

## Quotes
```

## Consent

What goes in the consent table depends on the kind of record:

| Row | Team interview | Contributor feedback | Pilot debrief |
|---|---|---|---|
| Given by | The role of the person who agreed for the team, for example "the founder who was interviewed" | "Each respondent, on the form": the form asks every contributor whether their answers may be quoted without their name | The role of the person who agreed for the team |
| To the team being named | yes or no | not applicable: no respondent is named | yes or no |
| To being quoted | yes or no | The count, for example "6 of 9 respondents". Only words of respondents who agreed appear under Quotes | yes or no |
| To its wallet and campaign page being shown as the pilot's | not applicable | not applicable | yes or no. With "no" here, or "no" to being named, the record is not linked to the pilot pages |
| Given on | The date the person agreed | The dates the form was open | The date the person agreed, which must be before the record is committed |

A record without a filled consent table is not committed.

## What goes under each heading

The headings are the same for the three kinds of record. What they ask differs:

| Heading | Team interview | Contributor feedback | Pilot debrief |
|---|---|---|---|
| What they do today | How the team runs paid campaigns or bounties now: where, how often, how big, who decides, how it pays | How contributors found the campaign and what they did to take part: getting a wallet, adding the USDC trustline, posting, submitting the link | How the team ran its campaign on Proofwork: what it set up, how long each step took, who did it |
| What goes wrong | What farming and fake submissions look like for them, what it costs, what they tried against it | Where contributors got stuck or gave up: the wallet, the trustline, submitting, waiting for a decision | What got in the team's way: requesting access, the readiness check, funding, approving, releasing, closing, getting the remainder back |
| What they check before paying | What the team looks at before it pays someone, and how long that takes per submission | Being paid or rejected, from the contributor's side. Paid: did the reward arrive, how long after submitting, and was the amount what they expected. Rejected: did they understand the reason, did they open the decision's verify page, did they ask for the re-review and was its answer clear | What the team looked at before it released each payout, and whether the review and its reasons were enough for it |
| What they would change, and what they would pay for | What they would want from a tool for this, and whether and how they pay for anything like it today | What contributors would change about taking part. They are not asked about paying | What the team would change, and what it would pay for |
| Quotes | Their own words, when they agreed | Words of respondents who agreed, with no way to tell who said them | Their own words, when they agreed |

Month 1 contributors did not connect an X account: that step was added in Month 2, so the feedback form does not ask about it. For the contributor feedback record, "Team" is the group that was asked ("Month 1 contributors") and "Role of the person" is "contributor".

## Findings

`findings.md` is the one page where conclusions are drawn. It is written after the records, by Cem, and has not been started.

It takes each hypothesis of the Customer Development Plan by its number (H1 to H7) and says, for each: which records support it, which contradict it, which say nothing about it, and what Proofwork does as a result. Every statement in it points to the record it rests on. A hypothesis no record speaks to is written as "not tested", not left out. The page names no person, and names a team only where that team's record does.
