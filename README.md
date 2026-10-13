# open-frequency

One engine that runs several Hebrew social accounts, each in its own niche and
each its own brand, mostly on its own. It reads approved sources, drafts
slideshows grounded in quotes it can prove, checks them in code, renders them,
and publishes them through Zernio after the approval each account's mode asks
for. Its website, **Teder** (תדר), is where the owner approves, edits and steers.

<p align="center">
  <img src="docs/screenshots/today-phone.png" width="250" alt="Today, on a phone">
  <img src="docs/screenshots/accounts-desktop.png" width="560" alt="Accounts, on a desk">
</p>

This repository is public. It holds the engine, the website, the tests, the docs
and one fictional demo pack. Real accounts, their database, rendered media,
recordings and keys live in a private folder, `$OF_HOME`, which is never
committed (see [The private folder](#the-private-folder)).

## Try it in two minutes

```bash
npm install
npx playwright install chromium
npm run demo        # a fictional demo with three brands, then the website on :4700
```

`npm run demo` builds a throwaway home in `./.demo`, makes posts in every state
from the fictional pack's recordings (no network, no keys), and prints a login.
Nothing in it is real, and the Results page says so.

## Running it

| Command | What it does |
|---|---|
| `npm test` | every hard rule, offline, then `check:public` |
| `npm run dry -- --pack <id> --count 5` | builds 5 posts for one pack and writes each to disk: slides for each platform, `caption.txt`, `sources.md` (every fact, its quote, its source), `post.json` (checks, trace, cost). Its own database; publishes nothing |
| `npm run web` | the website on `127.0.0.1:4700` |
| `npm start` | the website and the runner: daily generation, publishing at each slot, metrics, learning |
| `npm run record -- --pack <id> [--source <id> --url <page> --key <name>]` | saves a pack's approved sources as recordings, so it runs offline |
| `npm run screenshots` | every page at phone and desktop width (`-- --dark` for both themes), from the demo only |
| `npm run init-private [-- --pack <id>] [-- --git]` | creates the private folder, optionally a blank pack and its own git repo |
| `npm run user:add -- <name>` | adds a website user (asks for the password) |
| `npm run backup` | a consistent copy of the database into `$OF_HOME/data/backups` |
| `npm run check:public` | fails if anything committed looks private (also a pre-commit hook) |

Requires Node 22.13 or newer (for `node:sqlite`); developed on 24.

### Modes

- **Recorded** (the default without `ANTHROPIC_API_KEY`): sources and drafts come
  from each pack's `recordings/`. Every check, the fact gate, the renderer and the
  website run exactly as they would live; a post's cost is an estimate and says so.
- **Live** (`OF_MODE=live`, the default with a key): real sources, real Claude.

Publishing is a separate, deliberate switch: a post leaves through Zernio only when
`PUBLISH_MODE=live`, `ZERNIO_API_KEY` is set, and the pack's own `pack.json` says
`"publisher": "zernio"`. Anything less writes the post and the exact Zernio request
to disk with the dry publisher.

## The private folder

`$OF_HOME` holds everything that belongs to the real accounts. It defaults to
`./private/` inside the checkout and is gitignored entirely; set `OF_HOME` to put it
anywhere else.

```
private/
  packs/<id>/          one folder per account, with recordings/
  data/                openfrequency.db, media/, public/, out/, backups/
  .env                 keys (from .env.example)
  public-denylist.txt  words check:public refuses in the public repo
```

Set it up with `npm run init-private -- --git`. **Make `private/` its own private
git repository** (on GitHub, a private repo): that is how it is backed up and how
the VPS gets the packs (`git pull` inside `private/`). Its own `.gitignore` keeps
`data/` and `.env` out of it; back the database up with `npm run backup`.

**`git clean -fdx` in the engine checkout deletes `./private/`.** Push it first, or
keep `OF_HOME` outside the checkout.

`npm run check:public` runs in `npm test` and as a pre-commit hook (installed by
`npm install`). It reads the git index and fails on any file under `private/`, a
key-shaped string, a database, a pack outside `examples/`, media outside
`docs/screenshots/`, or any real pack id, handle, display name or Zernio id it finds
in `$OF_HOME/packs`, plus every word in `$OF_HOME/public-denylist.txt`.

## Adding an account

No code, ever. Two ways:

1. **On the website**, *New account*: enter a niche, an audience and a few example
   sites. The engine searches for authority sites (Brave), finds their feeds,
   suggests structured APIs, looks for formats that work on YouTube Shorts, and
   scores every source with a one-line reason. Approve the sources, name the
   account; the pack is written with a look no other account has. Five sample posts
   must pass and be reviewed before it goes live, in Approve mode.
2. **By hand**: `npm run init-private -- --pack <id>`, then edit the six files.

A pack is a folder:

| File | Holds |
|---|---|
| `pack.json` | id, display name, handle, platforms, Zernio profile and account ids, schedule (windows, slots, posts per day), autonomy mode, monthly budget, compliance checks, topics |
| `voice.md` | who is talking, to whom, how it sounds; `## שורות טובות` and `## שורות רעות` with examples |
| `theme.json` | a template and variant from the engine's library, colours, fonts |
| `sources.json` | approved sources only: type (`rss`, `web`, `api`), url, name, why it is trusted, when approved |
| `formats.json` | post formats, hook patterns, closing lines, caption questions, hashtags, trend queries |
| `rules.json` | banned phrases, regex checks, blocked image words, the maximum quote length |

Validation refuses a pack with weak contrast, a source without https or a reason to trust it, a money
niche without the investment-advice check, and any two packs sharing a template, a
display face, a handle, a name, a Zernio profile, or a palette too close to tell apart.

## How a post is made

```
topic -> facts from approved sources -> outline -> slides -> voice and tell checks
      -> fact verification -> render -> queue -> approval (by mode) -> publish
      -> metrics at 72h -> learn
```

Every step is a row in the database, so any slide traces back to its fact, the
quote, the stored document and the approved source. The website's post page shows
the whole trace.

## The hard rules, and where they are enforced

| Rule | Where |
|---|---|
| 1. Official APIs only; no likes, follows, comments, DMs or logged-in reading | `src/core/net.js` is the only `fetch`; its allowlist has two write endpoints (Claude, Zernio's create-post) and refuses Zernio's inbox by name. Tests scan the code for any other `fetch`, engagement functions and endpoints |
| 2. Each account a distinct brand | `src/packs/validate.js` (`validateAll`), and a cross-promotion check on every post |
| 3. Honest by construction | `src/verify/claims.js`: every quote verbatim in a stored document of an approved source of that account; every number on a slide in its quotes; the renderer refuses text without the gate's token; `src/voice/honesty.js` refuses invented experience and fake badges or metrics |
| 4. AI disclosure | `src/publish/zernio.js` sets TikTok's `video_made_with_ai` (as a draft for photo posts) and adds a caption line on Instagram |
| 5. Rights | `src/images/index.js`: Pexels, Unsplash, Commons only, licence stored, Commons licences on an allowlist, logos and crests refused; quotes are short facts (4 to 40 words) |
| 6. No investment advice | `src/rules/compliance.js`, required for any money niche |
| 7. Cost caps | `src/budget/ledger.js` guards every paid call against the account's and the global monthly cap |
| 8. Hebrew RTL | slides and every page are `lang="he" dir="rtl"` (tested) |
| 9. Shabbat | `src/schedule/shabbat.js`, from the real sunset; the scheduler never plans a Shabbat slot and every publisher refuses one |
| 10. Secrets | `.gitignore`, `check:public`, the pre-commit hook; `.env.example` lists every variable (tested) |

## Autonomy

| Mode | |
|---|---|
| **Approve** | every post waits for the owner; unapproved by the end of its day, it expires. The default for a new account |
| **Digest** | posts go out at their slot unless rejected before it |
| **Auto** | posts go out; a daily summary is written to the website |

In every mode: a kill switch per account and a global one, and an automatic pause
on a failed fact check, a platform strike, a streak of publish errors, or an
exhausted budget. A paused account says why. In Digest and Auto, a post the
reviewer scored as sounding a little like a bot waits for the owner instead.

The runner also reads each post's numbers through Zernio at 72 hours (TikTok:
shares and likes per view; Instagram: saves per view; never a number the API did
not give), keeps 70% of posts on proven formats and 30% on trials, drops a format
after three results in a row under 70% of the median, and once a week looks for
formats that work on YouTube Shorts, copying the format and never the content.

## Deploying

On the VPS, behind Caddy, like any small Node service:

1. Clone this repo to `/opt/open-frequency` and your private repo into
   `/opt/open-frequency/private`; `npm ci --omit=dev`;
   `PLAYWRIGHT_BROWSERS_PATH=/opt/open-frequency/.browsers npx playwright install --with-deps chromium`.
2. Fill `private/.env` (mode 600): at least `SESSION_SECRET`, `OF_ADMIN_USER`,
   `OF_ADMIN_PASSWORD` (remove it after the first start), `PUBLIC_HOST`, and the keys
   you have.
3. `deploy/openfrequency.service` to `/etc/systemd/system/`, then
   `systemctl enable --now openfrequency`. The daily backup:
   `deploy/openfrequency-backup.{service,timer}`.
4. Append `deploy/Caddyfile.example` to the Caddyfile (two names: the website, and
   a media host that serves `private/data/public` for Zernio to fetch slides from;
   set `MEDIA_PUBLIC_BASE_URL` to it), `caddy validate`, `systemctl reload caddy`.

Updating: `git pull` in both checkouts, `npm ci --omit=dev`,
`systemctl restart openfrequency`.

## Configuration

Every variable is in [`.env.example`](.env.example) with a comment saying what it
is for and where to get it. The website's Settings page shows which keys are set,
never their values.

## Layout

```
src/core        paths ($OF_HOME), env, clock, the network door, settings and audit
src/db          SQLite (node:sqlite), the schema
src/packs       loading and validating packs
src/schedule    Israel's clock, sunset, Shabbat, slots
src/sources     RSS/Atom, web pages, JSON and Wikidata APIs, recordings
src/llm         Claude (official SDK, through the network door), recorded client, cost
src/budget      the monthly ledger and its guard
src/voice       Hebrew tells, honesty, the bot-score reviewer
src/verify      facts against stored documents, the pre-render gate
src/rules       pack rules, cross-promotion, Israeli investment-advice compliance
src/images      licensed photographs
src/render      fonts, five templates with two variants each, Chromium
src/pipeline    one post from topic to queue; export to disk
src/publish     dry and Zernio
src/metrics     reading numbers, crediting formats
src/formats     the 70/30 rotation and the judge
src/trends      YouTube Shorts formats
src/autonomy    the runner and the rails
src/onboarding  source discovery, the API catalog, writing a new pack
src/web         the website: server, login, pages, actions, one stylesheet, one script
examples/       the fictional demo pack, and the blank pack template
scripts/        dry, web, demo, record, screenshots, init-private, check-public, backup
test/           node:test, one file per area
deploy/         systemd units, Caddyfile example
docs/           PLAN, decisions, session log, screenshots, REPORT
```

More: [`docs/PLAN.md`](docs/PLAN.md), [`docs/decisions.md`](docs/decisions.md),
[`docs/REPORT.md`](docs/REPORT.md).

## Licence

Not licensed for reuse yet. The bundled Hebrew fonts are under the SIL Open Font
License (licence files in `assets/fonts`).
