# Report: development on Claude Code, a picture on every post, research first

2026-10-14, the second session of the day. The engine, the website, the tests and
the docs are in this public repository; the three real accounts, their research,
their launch set and their own report are in `$OF_HOME` (`./private/`), its own
private repository. Nothing in this repository names them, and `npm run
check:public` refuses anything that does. Nothing was published. **No API money
was spent**: every model call of the session went through the Claude Code CLI, and
nothing tried the API (the refusal log was never written).

The accounts are called A (a sport), B (people making AI products) and C (a combat sport)
below; the private report has their names.

## What was asked, and where it stands

| Asked for | Where it stands |
|---|---|
| No API calls while developing | Done. `OF_ENV=dev` (the default) sends every call to the Claude Code CLI: headless, JSON, one turn, no tools, a fresh session each time, the same model per task as production, one call at a time across processes. The API is refused without `--allow-api`, and each refusal is logged. Usage limits are waited out, never answered by the API. Tested with a mock CLI: success, bad JSON (one retry with the error, then a failure), a usage limit, a missing CLI, a timeout (`test/llm.test.js`) |
| One account retargeted to Israelis building AI products | Done, in the private folder: config, sources, a topic bank, docs |
| Display names and bios | Done, in each pack; the logo is drawn small on the first and last slide as soon as its PNG is in `brand/` |
| No text-only posts | Done: graphics the engine draws from each slide's own facts (`src/render/visuals.js`), photographs matched to their slide by name and by a vision check, at least half the slides with a visual and the cover always, every license logged and credited in the caption, every template tested right to left with mixed text and numbers at both sizes |
| Deeper sources | Done: a research step reads the articles the outline names and keeps a post only with three sourced details; the review checks every detail against its source (`src/sources/research.js`) |
| The flagged facts, two sources each | Done: four fixed, one confirmed (private report) |
| The launch set again, three blind reviewers a post, up to four rounds, six of nine | After four rounds: A **7 of 9** (6 distinct stories), B **4 of 9**, C **5 of 9**. Only A reached six. Below |
| The cost calibration through the API | Skipped: `ANTHROPIC_WORKSPACE_ID` is not set. The forecast is from the CLI's real token counts at the API's prices |
| Tests, check:public, a clean clone, screenshots, both repositories committed | 202 tests pass; `check:public` passes; a fresh clone's whole history holds none of the accounts' names, handles or keys; 38 screenshots regenerated; the public repository is pushed, the private one committed (it has no remote) |

## The launch set

Nine posts per account, made by the engine's own pipeline end to end on the CLI,
with no hand edits and no extra turns. Each post was read by three fresh Claude
Code subagents that saw only the slides, both captions and the source list. A post
passes when two of the three would stop on it, swipe to the end, and save, send
or comment. When posts failed, the engine was changed and the failed posts made
again; a passed post stayed.

| Account | Round 1 | Round 2 | Round 3 | Round 4 | Passed |
|---|---|---|---|---|---|
| A | 3 of 9 | 1 of 6 | 2 of 5 | 1 of 3 | **7 of 9** |
| B | 1 of 9 | 1 of 8 | 1 of 7 | 1 of 6 | **4 of 9** |
| C | 1 of 9 | 1 of 8 | 2 of 6 | 1 of 3 (2 more stopped by the checks) | **5 of 9** |

A round's "of" counts the posts it made: a post the engine's own checks stopped
after three attempts was not made, and a passed post was not made again.

**Why two accounts stopped short of six**, after the fourth round the brief allows:

- **B (AI products)** never shows another company's logo or screenshot, as asked,
  so its covers are type and drawn graphics; the readers failed most of them as
  "a colour block" in the first second. Its failures were also in the content: a
  price comparison whose slides repeated one card, myths nobody holds, a
  tool's own demo numbers, a free-tier take every developer already agrees with.
  The rules that answer these came in rounds 3 and 4, and the last round of each
  post had them; the covers are the open problem.
- **C (a combat sport)**: the fight-week head-to-head never passed the checks,
  because the sources for a coming fight rarely hold three numbers both fighters
  share, and the ranking was stopped twice in the last round. A guess-who failed
  on a clue that gave the answer away, a fight story on a cover with no photograph
  (the fighter has no licensed one). One passing post is about a boxer, George
  Foreman: the readers liked it, but it is off the account's subject.
- **A (a sport)** passed seven, but two of them tell the same story: each round ran
  on its own database and did not know what the last one had passed. The launch
  harness now carries the passed posts into each new round (round 4 ran with it).

## What changed in the engine

Every failure was fixed in the engine, never in a post (decisions.md has each one
with its cause):

- **Research before drafting.** The outline names the articles that tell the
  moment; a details step pulls who, when, the minute and the quote out of them,
  each checked against its source. A topic without three such details is skipped.
- **Pictures.** Thirteen kinds of graphic drawn from the slide's own facts (a scoreboard,
  bars, a timeline, a price table, a fight record and more), each number held to
  the quotes like the slide's text. Photographs from Wikimedia Commons only when
  the file's own title names the person, then a Claude Haiku vision check that it
  shows them as the story knew them (the face, the club, the event for an action
  shot, in focus). A ranking's cover never shows number one; a guess-who blurs
  its answer and needs one.
- **The kinds.** Rules from the reviews: an angle on a famous story, a cover that
  leads with a concrete detail but never the payoff, a head-to-head only of things
  still argued, a hot take people would argue with, a ranking that shows its
  numbers, a fresh story for a fast-moving niche, forecasts named as forecasts.
- **Rendering.** Nothing inside a graphic may be cut, words never break mid-word,
  Latin runs and command flags keep their order in Hebrew lines.
- **The checks.** The redraft sees its own last draft; a second rewrite pass for
  what the first refused; numbers in product names (GPT-4o) are not claims.

## Which calls use the API in production, and why

In production (`OF_ENV=prod`, set by the service unit) every model call goes
through the Anthropic API: the outline, the research details, the slides, the
review and the rewrite on Claude Sonnet 5.5, and the image check on Claude Haiku.
The daily drafts go through the Message Batches API (half price) with each
account's rules cached. The API, not the CLI, because the server runs unattended
on a schedule: the CLI's usage limits would stall a day's posts, and only the API
returns the usage the ledger needs to hold the $15 cap call by call.

## Cost

Measured on the launch set from the CLI's real token counts, priced at the API's
batched and cached rates (`docs/costs.md`):

| | Per post made, stopped attempts included | 180 posts |
|---|---|---|
| Expected | $0.15 | about $27 |
| Worst round | $0.20 | about $36 |
| The vision checks alone | under $0.004 | under $0.70 |

**180 posts a month does not fit in $15.** The planner cuts volume, never quality:
it now cuts in half-post steps and keeps about **86 posts a month** at the expected
cost (one a day per account), 71 in the worst case. Zernio is on its own line, $6 a
month.

## Uncertainties

1. **The blind reviewers are models playing viewers.** Fresh each round and strict
   by instruction; their verdicts on the same kind of post swing. The passing posts
   are good evidence, not proof.
2. **The forecast is from the CLI.** Its framing adds about 1,000 tokens a call, so
   it runs a few percent high; a live day through the API would settle it.
3. **Photographs depend on Commons.** Many people in these niches have no licensed
   photograph; then the slide gets a graphic.

## What I need from you

1. **Push the private repository** to a private remote of your own.
2. **Register the six handles** (in the private report), and switch the TikTok
   accounts to Business.
3. **Instagram**: in the Meta app's *Instagram API with Instagram Login* setup,
   generate a token for each account, put it in `private/.env` as
   `IG_TOKEN_<PACK>`, the account id in `pack.json`, then `npm run instagram:check`
   (README, *Instagram*).
4. **Zernio**: connect the three TikTok accounts, run `npm run zernio:check`, then
   send one private test post.
5. **`OF_USER_AGENT`** with your contact, before the engine reads sources on a
   schedule.
6. **Photographs** for the combat-sport account's events, and **logo PNGs** in
   each pack's `brand/`.
7. **`ANTHROPIC_WORKSPACE_ID`**, if you want the calibration run through the API.
