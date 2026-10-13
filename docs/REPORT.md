# Report: open-frequency after the first session

2026-10-13. The engine, the website, the tests, the docs and a fictional demo pack
are in this public repository. The real packs, their recordings, the databases and
the keys are in `$OF_HOME` (`./private/` by default), which is its own private git
repository. Nothing was published to a real account and no real money was spent:
every number below comes from recordings.

## The definition of done

| Asked for | Where it stands |
|---|---|
| `npm test` passes and covers every rule | 97 tests plus `check:public`, all passing. Each hard rule has at least one test that tries to break it (list below) |
| `npm run dry -- --pack <id> --count 5` renders 5 Hebrew slideshows per real pack, with sources and cost | 5/5 for each of the three private packs, and for the demo. Each post folder has the slides for TikTok (1080x1920) and Instagram (1080x1350), `caption.txt`, `sources.md` with every fact, its quote and its URL, and `post.json` with the trace and the cost |
| `npm run web` serves the site, with screenshots | Every page, phone (390px) and desktop (1440px), light and dark: 38 pictures in `docs/screenshots/`, taken from the fictional demo only. Also checked against the three real packs (every page 200, all three accounts shown), without screenshots |
| A fourth account through onboarding needs no code | The "New account" page: a seed, discovery, approve the sources, the pack is written as config, five sample posts, then live. Tested end to end (`adding an account needs no code`, `the website flow`) |
| The README covers running, configuring, deploying and adding an account | Yes, plus the private folder and why it should be its own private repository |

### Each hard rule and its test

| Rule | Enforced in | Tested by |
|---|---|---|
| 1. Official APIs only, no engagement | `src/core/net.js`: one network door with an allowlist of writes (Claude's messages, Zernio's create-post) | `test/platform.test.js`: nothing calls `fetch` but the door, no engagement function or endpoint exists, every social write and inbox is refused |
| 2. Distinct brands | `src/packs/validate.js`, `src/rules/check.js` | two packs with the same look, near-identical colours, a shared handle, display face or Zernio profile all fail; a post naming another of our accounts is blocked |
| 3. Honest by construction | `src/verify/claims.js` (quote verbatim in a stored document from an approved source of this account; every number, in digits or Hebrew words, in its quote; a signed token the renderer requires), `src/voice/honesty.js` | `test/verify.test.js`, `test/pipeline.test.js`, the web edit test, and a source removed after drafting pauses the account |
| 4. AI-image disclosure | `ai_generated` and `realistic` on every image row; the publisher sets TikTok's AI flag and adds the line on Instagram | `test/autonomy.test.js` |
| 5. Licensed images only, short quotes | `src/images/index.js` (Pexels, Unsplash, Commons with a licence allowlist, logos and the like refused, credit in the caption when the licence asks), quotes 4 to 40 words | `test/voice.test.js`, `test/verify.test.js` |
| 6. No investment advice | `src/rules/compliance.js`, an engine check a financial pack must enable | `test/packs.test.js`, `test/pipeline.test.js` |
| 7. Monthly caps | `src/budget/ledger.js`: a guard before every paid call, per account and global | `test/pipeline.test.js`: over budget fails before spending, the cap is never crossed, the global cap stops everyone |
| 8. Hebrew RTL | `lang="he" dir="rtl"` at every root, Latin runs isolated, the renderer checks direction | `test/web.test.js`, `test/verify.test.js` |
| 9. No posting on Shabbat | `src/schedule/shabbat.js`: Jerusalem's sunset, candle lighting 40 minutes before, nightfall 50 after | `test/schedule.test.js`, `test/autonomy.test.js` (even approved, even by hand) |
| 10. No secrets committed | `.gitignore`, `npm run check:public` in `npm test` and the pre-commit hook | `test/public.test.js` and the `check:public` cases |

## What works, what is stubbed, what needs a key

**Works with no key at all** (recorded mode): the whole pipeline on recordings
(topic, outline, facts, slides, the checks, render, queue), the dry publisher
(writes the exact request Zernio would get), the website, the runner and its modes
and rails, Shabbat, budgets, format rotation, onboarding with the open-API catalog,
backups.

**Needs a key to go live**

| Part | Key | Without it |
|---|---|---|
| Drafting from live sources, the second-model review, scoring sources, reading a trend | `ANTHROPIC_API_KEY` | Drafts come from recordings; the review is an offline heuristic |
| Publishing and metrics | `ZERNIO_API_KEY`, and `PUBLISH_MODE=live`, and `MEDIA_PUBLIC_BASE_URL`, and the pack's `publisher: "zernio"` with its account ids | Every account uses the dry publisher. No metrics, so format judging waits |
| Finding sources for a new account | `BRAVE_API_KEY` | Onboarding offers the open APIs and any URL you type, and says what it skipped |
| Trend watching | `YOUTUBE_API_KEY` | No trends; nothing is made up |
| Photos | `PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY` | Commons only (keyless). In recorded mode no photo is fetched at all |

**Stubbed or missing**

- No image generator. The AI-disclosure flag is wired end to end, but nothing
  produces an AI image yet, so it never fires in practice.
- Sources behind bot protection (Cloudflare challenges, Imperva, Radware) are not
  read, by decision (see decisions.md): several big Israeli government and
  consumer sites are out of reach until they offer a feed or an API.
- The API reader takes one JSON document per source and cannot read CSV.
- Some sites carry kilobytes of menus with no `<main>`; a per-source
  `hints.selector` narrows them, but the right selector has to be found by hand.
- Shabbat is blocked; Yom Tov (the festivals) is not.
- Metrics come only from Zernio's analytics. If Zernio does not return Instagram
  saves, Instagram posts are not scored, never scored as zero.

## Environment variables

All of them are in `.env.example` with a comment; the file goes to `$OF_HOME/.env`.

| Variable | What | Where to get it |
|---|---|---|
| `OF_HOME` | The private folder | Default `./private`; set it only to keep the data elsewhere |
| `OF_MODE` | `live` or `recorded` | Default: live when an Anthropic key is set |
| `OF_LLM` | `recorded` forces recorded drafting in live mode | For testing |
| `ANTHROPIC_API_KEY` | Claude | console.anthropic.com, API keys |
| `MODEL_DRAFT`, `MODEL_REVIEW`, `MODEL_JUDGE` | Model per role | Default `claude-opus-5-5`; `claude-sonnet-5-5` halves the cost |
| `ZERNIO_API_KEY` | Publishing and analytics | zernio.com, Settings, API |
| `PUBLISH_MODE` | Must be `live` for anything to leave | You |
| `ZERNIO_BASE` | Zernio's API base | Leave empty |
| `MEDIA_PUBLIC_BASE_URL` | The https address Zernio fetches slides from | Your Caddy `file_server` (see `deploy/Caddyfile.example`) |
| `BRAVE_API_KEY` | Source discovery | brave.com/search/api ($5 per 1,000 queries) |
| `YOUTUBE_API_KEY` | Trends | console.cloud.google.com, a key restricted to YouTube Data API v3 (free, quota) |
| `PEXELS_API_KEY` | Photos | pexels.com/api (free) |
| `UNSPLASH_ACCESS_KEY` | Photos | unsplash.com/developers, an app's Access Key (free) |
| `PORT` | Website port, on 127.0.0.1 | Default 4700 |
| `PUBLIC_HOST` | The site's public name behind Caddy | Your domain |
| `SESSION_SECRET` | Signs the login cookie | `openssl rand -hex 32` |
| `OF_ADMIN_USER`, `OF_ADMIN_PASSWORD` | The first user, created once | You (12+ characters); remove the password after the first start |

## Cost per post

**Method.** Every paid call goes through the budget guard, which records its cost
in the `spend` table, per account and per post. Live calls record the tokens the API
reports, at the model's list price. Recorded runs have no API usage, so they record
an estimate from the length of the recorded prompt and answer (Hebrew at 2.2
characters a token), with the answer counted two and a half times over for the
model's thinking. Those rows are marked `estimated`.

**Recorded, Claude Opus 5.5 ($4 in, $20 out per million tokens):**

| Pack | Per post | Calls |
|---|---|---|
| Demo (fictional) | $0.044 to $0.048 | outline, slides |
| The three real packs (private) | $0.059 to $0.069 | outline, slides |

Real packs cost more than the demo because their documents are longer: release
notes, sports articles and benefit pages against the demo's short invented pages.

**Expected live:** add the second-model review (effort low, about $0.02 to $0.04) and,
when a check fails, a redraft of the slides (about $0.025). That is about **$0.08 to
$0.13 per post** on Opus 5.5, or about $3 to $4 a month for one account posting
daily. The default global cap of $60 a month leaves room for all accounts plus
onboarding (a new account costs five Brave queries, $0.025, and one Claude call to score what they found). Images and YouTube cost
nothing. Zernio is a subscription, outside these numbers. The first live week will
replace these estimates with measured ones: each post page shows its cost, and the
Accounts and Settings pages show the month's spend per account.

## Uncertainties

1. **Live costs are unmeasured.** The estimate above is from recordings. Thinking
   length on real documents is the biggest unknown.
2. **Zernio, from this engine, is untested live.** The client follows Zernio's API
   (create a post with TikTok photo settings, the AI flag, a draft flag; analytics by
   post id), but no request has been sent. In particular: whether TikTok photo posts
   accept the AI flag, and whether analytics return Instagram saves. TikTok privacy
   defaults to `SELF_ONLY`, so a first live post is private.
3. **The fact gate proves traceability, not truth.** A wrong source is repeated
   faithfully. Wikipedia is allowed as a secondary source, for settled facts only.
4. **The investment-advice check is patterns, not understanding.** It catches every
   case in its tests and the provider names that are ordinary words no longer trip
   it, but a creative phrasing could pass. A financial pack should stay in Approve
   mode until it has a record.
5. **Hebrew numbers in words.** Three and up are checked; "one" and "two" are not,
   because they are everyday words. A slide saying "שני כללים" against a quote with
   three would pass.
6. **Shabbat margins** (40 and 50 minutes) follow the Jerusalem custom and are
   stricter than most; they can be raised, not lowered below 18 and 40. Festivals are
   not blocked yet.
7. **The offline reviewer** is a heuristic. With a key, Claude does the review, and
   that is the one to trust.

## The first three next steps

1. **Turn on Claude and run a week in Approve mode.** Put `ANTHROPIC_API_KEY` in
   `$OF_HOME/.env`, `npm start`, and approve or reject on the site each morning. It
   measures the real cost per post and shows how often the checks force a redraft.
2. **Connect Zernio with one private post per platform.** Set the account ids in
   each pack, `PUBLISH_MODE=live`, `MEDIA_PUBLIC_BASE_URL`, and publish one post with
   TikTok privacy `SELF_ONLY`. Check that the slides, the caption, the AI flag and
   the analytics come back as expected before any account goes public.
3. **Deploy to the VPS.** Clone this repository, clone the private repository into
   `./private`, then follow the README: the systemd unit, the Caddyfile, the backup
   timer. Add the festival dates to the posting block before the first holiday.

## The public repository

The repository had no commits before it became public, so there was nothing to
rewrite: no real pack, key, database or media was ever committed. `check:public`
runs on every commit and in `npm test`; it reads the real pack ids, handles and
display names from `$OF_HOME/packs`, and extra words from
`$OF_HOME/public-denylist.txt`, and refuses any tracked file that names them.
