# Report: open-frequency with three real accounts

2026-10-14. The engine, the website, the tests, the docs and the demo pack are in
this public repository. The three real accounts live in `$OF_HOME` (`./private/`),
its own private repository: their packs, research, launch set, account decisions
(`decisions.md`) and their own report (`REPORT.md`). Nothing in this repository
names them, and `npm run check:public` refuses anything that does. Nothing was
published and no money was spent. The project's Anthropic key was not spent (the
owner's instruction: nothing Claude Code can do goes on the key), and it is still
refused by the API without `ANTHROPIC_WORKSPACE_ID`, checked again today with a
model listing that bills nothing.

## The definition of done

| Asked for | Where it stands |
|---|---|
| Three packs, complete | Done, in the private folder. Each pack has its brand, theme, voice (more than 10 lines it would write and 10 it never would), rules, formats, sources and schedule. One pack also has hand-checked tax and national-insurance figures (`facts/`), and one has an event calendar, a fight-week rhythm and the owner's photos with where each came from. The two retired accounts are archived, not deleted |
| The ten formats, tested | Done. Story, what-happened, on-this-day, guess-who, head-to-head, ranking, iceberg, hot-take, myth-fact and meme are each a shape checked in code (`src/formats/kinds.js`). The demo pack has one format of every kind, and `test/formats.test.js` builds each of them through the real pipeline and renders it |
| Every post: 5 to 8 slides, the payoff last, keywords in Hebrew and English, a varied call to action, a long TikTok caption and a short Instagram one | Done, and checked in code: the shape, the caption lengths (TikTok 200 to 900 characters, Instagram up to 260, led by the cover line), keywords in both languages, the call to action rotated by the code. The tell checks still run on every text |
| About 60% entertaining, moved by the results within 40% to 80%; results per format and per cover pattern; 70/30 proven and trial; a format dropped after 3 losses in a row; the Results page in plain words | Done (`src/formats/rotation.js`, `src/metrics/collect.js`, the Results page's learning panel); tested with synthetic results, since there are no real ones yet |
| The cap enforced; the month at 180 posts at or under $15 without Zernio, Zernio on its own line | The cap: done in phase 2, verified. The forecast, measured again on the launch set with the engine's review and rewrite and the share of posts the checks stop (`docs/costs.md`): **$7.20 to $12.20** expected at 180 posts, inside $15. The worst cases are not (a tokenizer that counts Hebrew 35% higher: up to $16.50; no batching or caching: about $26); the cap still holds, and the planner publishes fewer posts. Zernio: $6 a month for the three TikTok accounts |
| Instagram through the Graph API, TikTok through Zernio, per pack | Done in phase 2 and verified (`publishers` in each `pack.json`). New: an Instagram post can be deleted through the Graph API, for a takedown |
| Holidays, the takedown log, the violent-image check: working and tested | Holidays: phase 2, tested against Hebcal for Oct 2026 to Oct 2028. Takedowns and the image screen: new, tested in `test/content.test.js` (a notice, a delete, a second notice pausing the account; refusing words, the red share, a person's review, publishing refused until then) |
| `npm test`, `npm run check:public`, a fresh clone with nothing about the accounts | 159 tests pass; `check:public` passes on everything staged and now also refuses a current pack id written as a word in any Markdown file; a fresh clone of the committed repository has none of the accounts' handles, names or ids |
| Fresh screenshots from the demo pack | Done: 38 screenshots of the website on the demo pack, phone and desktop, light and dark (`docs/screenshots/`) |
| The launch set: 9 posts per account, both platforms, a blind review | Done, in the private folder (`out/launch/<pack>/`): 27 posts, each with 7 or 8 kinds of post per account and at least 6 entertaining, rendered for TikTok and Instagram, both captions, sources, cost, the engine's review and the blind reviewer's notes. Three rounds of blind review; in the last, 3 of 27 passed a deliberately strict bar (stop the scroll, swipe to the end, a reason to save, send or comment). The reviews found more than 20 engine and design faults, all fixed with tests (decisions.md); the rest of what they found is content, written down per post for the owner |
| This report, the private report, the session log | This file, `private/REPORT.md`, `docs/session-log/2026-10-14.md` |

## What works

- **Drafting to rendering**, for every kind: the outline, the fact gate, the
  slides, the checks in code, the review, one redraft, rendering for TikTok
  (1080×1920) and Instagram (1080×1350). The same pipeline built the launch set
  from recorded documents.
- **The schedule**: two posts a day per account, none on Shabbat or a festival.
  The fight-week slots work too: the tale of the tape three days before a card,
  the prediction the day before, the recap the morning after, drafted only once a
  document has the result.
- **Learning**: each post is scored at 72 hours, with results kept per format and
  per cover pattern. The rotation is 70/30 between proven and trial, a format is
  dropped after 3 losses in a row, and the mix shifts between entertaining and
  number posts.
- **Publishing**, dry until the keys are in: TikTok through Zernio and Instagram
  through the Graph API, each one chosen per pack.
- **Takedowns** and **the image screen**: both are visible on the website. A
  post's page has a takedown panel and a button to confirm a photo, and every
  page shows a banner when something is waiting for a person.
- **Sources**: Wikipedia sections through the REST HTML, with tables. Also
  Wikidata by date, CSV, JSON, data.gov.il, the CBS and the Bank of Israel's
  series, and hand-checked facts.

## What is not automatic, by design or by the platforms

- **TikTok has no delete** for a third party, neither through Zernio nor through
  TikTok's APIs. A takedown on TikTok is listed for the owner, who confirms it
  once the post is deleted by hand.
- **Photos the screen cannot clear** wait for a person. Without a live key that
  means every photo with a large share of deep red; with one, Claude Haiku looks
  first.
- **The launch set was not drafted by the API.** Claude Code subagents answered
  the engine's exact requests. The live drafting path is tested against stubs and
  recordings, and has not yet run against the real API (it needs the workspace
  ID).

## What needs a key, and where to get it

| Variable | What it does | Where to get it | Without it |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | drafting, the review, rewrites, judging | console.anthropic.com > API keys | drafts come from recordings |
| `ANTHROPIC_WORKSPACE_ID` | names the workspace for a key that is not scoped to one | console.anthropic.com > Settings > Workspaces (`wrkspc_...`) | **the current key is refused** |
| `ZERNIO_API_KEY` | TikTok publishing and analytics | zernio.com > Settings > API | TikTok publishes dry |
| `PUBLISH_MODE` | `live` lets posts leave; anything else keeps every account dry | you | dry |
| `MEDIA_PUBLIC_BASE_URL` | the https address Zernio and Meta fetch slides from | the media host in the README's deploy steps | nothing can publish |
| `META_APP_ID`, `META_APP_SECRET` | a long-lived Instagram token, and when it expires | developers.facebook.com > your app > App settings > Basic | no Instagram token |
| `IG_TOKEN_<PACK>` | each account's Instagram token | `npm run instagram:token -- --pack <id> --short <token>` | that account's Instagram publishes dry |
| `GRAPH_API_VERSION` | the Graph API version | leave empty (v25.0) | |
| `OF_USER_AGENT` | how the engine names itself to Wikimedia and others: a contact | your site and email | a generic name; Wikimedia may throttle it |
| `SEC_USER_AGENT` | a name and an email for EDGAR | you | EDGAR sources are refused |
| `BRAVE_API_KEY` | finding sources for a new account | brave.com/search/api | onboarding skips discovery |
| `YOUTUBE_API_KEY` | trends: Shorts with their view counts | console.cloud.google.com, YouTube Data API v3 | trends skipped |
| `PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY` | stock photos | pexels.com/api, unsplash.com/developers | Commons and the pack's own photos only (the three accounts use only these) |
| `OF_BUDGET_MONTHLY_USD` | the monthly cap | you | $15 |
| `OF_BATCH` | `off` drafts with direct calls | you | batches when Claude is live |
| `MODEL_DRAFT`, `MODEL_REWRITE`, `MODEL_REVIEW`, `MODEL_JUDGE` | the model per role | | Sonnet 5.5, Sonnet 5.5, Sonnet 5.5, Haiku 5.5 |
| `OF_HOME`, `OF_MODE`, `OF_LLM`, `ZERNIO_BASE` | where the private folder is; live or recorded; force recordings; Zernio's base URL | | `./private`; live with a key; off; zernio.com |
| `PORT`, `PUBLIC_HOST`, `SESSION_SECRET`, `OF_ADMIN_USER`, `OF_ADMIN_PASSWORD` | the website | you | 127.0.0.1:4700, no public name |

New in this phase: `OF_USER_AGENT`, and the Meta permission
`instagram_manage_contents` (Facebook Login) for deleting a post.
`npm run instagram:check` reports whether a token has it.

## Cost per post, and the month

Measured on the launch set: every request exactly what the engine sends, the
engine's review and its rewrite included, every call priced from its token counts
(`docs/costs.md` has the method and its limits):

| | Per post | 180 posts a month |
|---|---|---|
| Each account, batched and cached, per attempt | $0.022 to $0.041 (the three within half a cent) | |
| Per published post, counting redrafts and the posts the checks stop | $0.040 to $0.068 | **$7.20 to $12.20** |
| If Hebrew counts 35% more tokens | $0.054 to $0.092 | $9.70 to $16.50 |
| No batch, no cache | about $0.145 | about $26 |
| Zernio, outside the cap | | $6 |

Higher than the first estimate of this phase ($3.80 to $6.70): the review is
strict and flags most of a post's lines, so nearly every post pays for a rewrite,
and about 30% of drafted posts were stopped by the checks in the round drafted
without help. The expected month fits; the worst cases do not, and then the cap
holds and the planner publishes fewer posts. The split per account is in the
private report.

## Uncertainties, and how they were decided

1. **Live costs are unmeasured.** The unknowns are thinking length, the Hebrew
   token count, how strict the live review is, and how many posts the live model
   gets stopped. The expected month fits; the worst case does not, so the planner
   cuts volume before the cap is reached. `npm run live-day -- --confirm` measures it.
2. **Wikipedia's robots.txt disallows its API paths**, while its robot policy
   describes how bots should use those same APIs. Decided: the APIs are the
   sanctioned door. The engine identifies itself, waits on a 429, and reads a few
   requests at a time (decisions.md).
3. **News sites** forbid automated reading or use with AI in their terms. Decided:
   none is a source, which makes Wikipedia the main source for two of the accounts.
4. **Event photos**: the owner allowed them. They come in by hand, each with where
   it came from, and they pass the screen. A takedown notice deletes the post.
5. **Instagram deletion** needs Facebook Login and `instagram_manage_contents`. It
   is tested against a stub only, not against Meta.
6. **A blind reviewer is one opinion.** The launch set's reviewer is a Claude Code
   subagent playing a skeptical Israeli viewer, strict by instruction, and a fresh
   one each round. Its verdicts swing on the same post from round to round (a post
   passed and then failed twice), so they are saved with each post for the owner
   to weigh, not used as a gate.
7. **TikTok's search reading on-slide keywords** is the research's claim; it is
   not something the engine can test. The keywords sit on the last slide, where
   they cost the cover nothing.
8. **Inherited**: the fact gate proves that a fact can be traced, not that it is
   true. The review covers more of that gap.

## What I need from you

1. **Push `private/`** to its private remote (it is committed, not pushed).
2. **`ANTHROPIC_WORKSPACE_ID`** in `private/.env`, then `npm run live-day --
   --confirm` once, for real numbers per post.
3. **Register the six handles** (three on TikTok, three on Instagram; they are
   listed in `private/REPORT.md`), and **switch the TikTok accounts to Business**.
4. **The Meta app**: link each Instagram professional account to a Page, set up
   Facebook Login with `instagram_manage_contents`, then run `npm run
   instagram:token` and `npm run instagram:check` (README, *Instagram*).
5. **Zernio**: connect the three TikTok accounts, put their ids in each
   `pack.json`, run `npm run zernio:check`, then send one private post with
   `--send-private --confirm`.
6. **`OF_USER_AGENT`** with your contact, before the engine reads Wikipedia on a
   schedule.
7. **Approve the launch posts** (`private/out/launch/<pack>/`, start with
   `README.md` there). Read each post's `reviewer-notes.md` with it.
8. Deploy with the README's steps; every account starts in Approve mode.
