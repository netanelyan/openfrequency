# Report: open-frequency after phase 2, live on $15 a month

2026-10-13. The engine, the website, the tests and the docs are in this public
repository; the real packs, the comparison files and the keys are in `$OF_HOME`
(`./private/`), its own private repository. Nothing was published and the
project's Anthropic key was not spent: the owner asked mid-session that nothing
Claude Code can do go on the key, and the key was in any case refused by the API
(it is not scoped to a workspace, and `ANTHROPIC_WORKSPACE_ID` is empty).

## The definition of done

| Asked for | Where it stands |
|---|---|
| `docs/costs.md`: fixed costs with sources, per post before and after each change, the month at 180 posts at or under $15 without Zernio, Zernio on its own | Done. Fixed costs inside the cap: $0 (every other service is free at this volume). Per post, estimated: **$0.081 to $0.131 before**, **$0.021 to $0.036 per published post after**. At 180 posts: **$3.80 to $6.50 a month** expected, $9.90 to $14.80 if neither batching nor caching worked. Zernio: $6 a month for the 3 TikTok accounts alone, more with other projects' accounts (table in costs.md) |
| Instagram through the official Graph API, TikTok through Zernio, chosen per pack | Done: `"publishers": { "tiktok": "zernio", "instagram": "instagram" }` in each real pack. Carousels, the long-lived token and its refresh, insights (reach, views, saves, shares, likes, comments) into the metrics. README section *Instagram* |
| The budget cap in code, and tested | Done. `OF_BUDGET_MONTHLY_USD=15`; every call reserves its worst case first; a test bills every call at its worst case (one by one, concurrently, through batches, after a fallback to the dearest model) and the cap holds. Shares, cuts weakest first, 80% warning, 100% stop, the Settings panel |
| Quality comparison files for review | `private/cost-compare/`: one file per topic with every version side by side, `summary.md` |
| The money pack makes varied posts from official sources and the facts file | Done: 7 of 8 dry-run posts rendered, each from a different source (the school grant from the facts file, fuel excise, the Accountant General's rates, controlled milk prices, the average wage, housing prices, maternity pay) |
| Holidays blocked and tested | Done: Shabbat and every yom tov from candle lighting the evening before to nightfall, tested against Hebcal for Oct 2026 to Oct 2028 |
| `npm test` and `npm run check:public` pass | 127 tests and `check:public` (on everything staged), all passing |
| This report | This file |

## What changed

**The budget** (`src/budget/`). The cap moved from a website setting ($60) to
`OF_BUDGET_MONTHLY_USD` in `.env` ($15); the website can lower it, never raise
it. Every paid call reserves the most it could cost (the prompt's bytes and
`max_tokens`, at the dearest rate it can be billed at) against the cap and the
account's share, in one transaction, and the real cost from the API's usage
block replaces the reservation. The month is planned before each day's drafting:
spent, held, the slots still to draft (Shabbat and festivals excluded) times the
measured cost per post. If it does not fit, the weakest account drops to one post
a day first, and every page says so. 80% warns; 100% stops drafting until the
next month. The Settings page shows the spend, the forecast and the posts left.

**Cheaper posts** (`src/llm/`, `src/pipeline/`):
- Model roles: Claude Sonnet 5.5 drafts and rewrites, Sonnet 5.5 reviews, Claude
  Haiku 5.5 (released 7 October) scores sources and reads trends. Opus is not used:
  the comparison found nothing it did that Sonnet did not.
- A day's posts are drafted the day before through the Message Batches API, all
  of them in one batch per step, at half price. A batch that a restart interrupts
  is still recorded.
- Prompts are built for the cache: the pack's voice, rules and formats first (one
  cached block shared by the outline, slides and rewrite calls), then the task,
  then only what changes.
- Documents are narrowed to their content in code (37% fewer characters sent).
- Punctuation tells are fixed in code instead of by a redraft; a generic closing
  question ("ידעתם את זה?") is dropped in code; the slides get one redraft at
  most; the review runs after every code check passed; the lines it flags get
  one rewrite; anything still wrong drops the post.
- The reviewer's "says more than its facts" finding, ignored since phase 1, now
  sends the line to the rewrite and blocks the post if it is not fixed. This is
  the only check of the sentence around a quoted number.
- Source discovery and trend searches are cached (30 and 7 days).

**Publishing** (`src/publish/`). Instagram goes out through Meta's Graph API:
the network door allows exactly two Graph writes (a media container, publishing
it) and refuses every comment, mention, tag, message, hashtag and other-account
edge by name. Each platform publishes on its own and is never sent twice; an
Instagram throttle waits for the next tick. `npm run instagram:token`,
`npm run instagram:check`, `npm run zernio:check`.

**Sources** (`src/sources/`). A CSV reader, data.gov.il's CKAN API, the Bank of
Israel's series API, the CBS APIs, Hebrew labels for coded columns, and
hand-checked facts (`facts/` in a pack) that expire and are edited on the website.

**Schedule** (`src/schedule/hebrew.js`). The Hebrew calendar and Israel's festivals.

**Deploy** (`deploy/test/`). The README's VPS steps rewritten in full and run in
a clean Ubuntu 24.04 container with systemd: Node 24 and Caddy from their
repositories, both repositories cloned, `npm ci`, Chromium, `.env`, the unit, the
site through Caddy over HTTPS (and refused over plain HTTP under its public name),
the media host, the backup and its timer, Hebrew slides rendered as the service
user, a restart.

## The measured costs

`docs/costs.md` has the full tables and the method. In short: every configuration
answered the same 15 topics (5 recorded documents per pack), written by Claude
Code subagents on the matching model, with the engine's checks replayed and
every call priced from its token counts. Estimates, not bills: tokens are counted
from characters and thinking is given as a range. `npm run live-day` measures the
real thing.

| | Per post | Queued of 15 |
|---|---|---|
| Before: Opus 5.5 everywhere | $0.081 to $0.131 | 15, two of them with a false sentence the review found and the engine ignored |
| Model routing only | $0.025 to $0.039 | 13 |
| Plus the new prompts, batch, cache | $0.011 to $0.018 | 13 (with a review too lenient to trust) |
| After, as built (Sonnet review, rewrites, fact problems acted on) | **$0.017 to $0.027** | 11; with the date fix 12. The rest rightly stopped, or a document that could not carry its format (the engine tries the next one) |

## What needs a key

| Part | Key | Without it |
|---|---|---|
| Drafting, the review, rewrites, judging | `ANTHROPIC_API_KEY`, and `ANTHROPIC_WORKSPACE_ID` for the current key | Drafts come from recordings |
| TikTok | `ZERNIO_API_KEY`, `PUBLISH_MODE=live`, each pack's `zernio.accounts.tiktok` | Dry |
| Instagram | `META_APP_ID`, `META_APP_SECRET`, each pack's token (`IG_TOKEN_<PACK>`) and `instagram.userId`, `PUBLISH_MODE=live` | Dry |
| Slides for both | `MEDIA_PUBLIC_BASE_URL` (Caddy's media host) | Nothing can publish |
| Discovery, trends, photos | `BRAVE_API_KEY`, `YOUTUBE_API_KEY`, `PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY` | Skipped, said so |

New variables, all in `.env.example`: `OF_BUDGET_MONTHLY_USD`, `OF_BATCH`,
`MODEL_REWRITE`, `META_APP_ID`, `META_APP_SECRET`, `GRAPH_API_VERSION`, and one
`IG_TOKEN_<PACK>` per Instagram account.

## Uncertainties

1. **Live costs are unmeasured.** Thinking length and Hebrew token counts are the
   two unknowns. The worst case in costs.md (no batch, no cache) still fits, and
   the planner cuts volume before the cap is reached.
2. **The reviewer's strictness varies.** Two Sonnet runs on nearly the same drafts
   disagreed on slide titles (one flagged almost all of them). The fact problems
   and the stock captions were found consistently. The live run will show which is
   typical; a too-strict reviewer costs rewrites, not quality.
3. **Haiku for judging is unmeasured.** It is used where little rides on it
   (scoring candidate sources for the owner to approve, reading a trend's shape).
4. **The comparison is not the API.** A subagent standing in for a model is close,
   not identical, and the `haiku` alias may not be Haiku 5.5. Every limit is
   listed in costs.md.
5. **Instagram is untested against Meta.** The flow follows Meta's documentation
   and is tested against a stub behind the real network rules; whether a
   Standard Access app must be switched to Live mode to publish is not documented.
   `instagram:check` will say.
6. **The Bank of Israel's terms** could not be read (bot protection). Its numbers
   are facts, quoted with the source named, but the owner should read the terms.
7. **Inherited from phase 1:** the fact gate proves traceability, not truth (the
   review now covers more of that gap); the investment-advice check is patterns.

## What I need from you

1. **`ANTHROPIC_WORKSPACE_ID`** in `private/.env` (console.anthropic.com > Settings
   > Workspaces, `wrkspc_...`), or a key scoped to a workspace. Without it every
   live call is refused.
2. Then **`npm run live-day -- --confirm`** once: one day of posts on real calls (a
   few tens of cents), in Approve mode. It prints the real cost per post; approve
   or reject the six posts on the website. Send me the numbers if they differ from
   costs.md and I will adjust the planner's default.
3. **Read `private/cost-compare/`** (start with `summary.md`, then any topic file)
   and say whether the "after" posts hold the quality bar for you.
4. **Confirm or delete the two seeded fact topics** on the website (*Sources* >
   *עובדות שנבדקו ביד*): copied word for word from Bituach Leumi by Claude, marked
   "checked by Claude", expiring 2026-12-31.
5. **Instagram**, per account: the professional account linked to a Page, the Meta
   app, then `npm run instagram:token` and `npm run instagram:check` (README).
6. **Zernio**: connect the three TikTok accounts, put their ids in each
   `pack.json` (`zernio.accounts.tiktok`), run `npm run zernio:check`, then one
   private post with `--send-private --confirm` before anything goes public.
7. **One decision to confirm**: a post gets one redraft of its slides *and*, after
   the review, one rewrite of the flagged lines, then it is dropped. Without the
   second step half the posts a strong reviewer flagged were lost (decisions.md).
   If you want strictly one model call to fix a post, say so: it is one line.
8. Push `private/` to its private remote, add the remaining keys, deploy with the
   README's steps, approve the first posts.
