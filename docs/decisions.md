# Decisions

Each entry: what was decided, the alternatives, and why. Newest at the bottom.

## Dependencies

Three runtime dependencies, each doing a job nothing built in can do:

| Dependency | Why |
|---|---|
| `playwright` | Hebrew needs real bidirectional layout and shaping. A headless Chromium renders the slides and takes the website screenshots. A canvas library would reverse strings and mis-shape final letters. |
| `@anthropic-ai/sdk` | The official Claude client. It takes a custom `fetch`, so it is handed the engine's own network door and its requests pass the same allowlist as everything else. |
| `fast-xml-parser` | RSS, Atom and RDF feeds. A regex feed parser is a bug farm; this one is pure JavaScript and small. |

Everything else is Node's own: `node:sqlite` for the database, `node:test` for tests, `node:http` and `node:crypto` for the website and its login. No web framework, no template engine, no CSS build.

## SQLite through `node:sqlite`, Node 22.13 or newer

`better-sqlite3` is the usual choice and needs a native build on the VPS. `node:sqlite` is built into Node (unflagged since 22.13), synchronous like better-sqlite3, and one file. The cost is a newer Node; the VPS already runs 24.

## One network door, and the Anthropic SDK goes through it

Hard rule 1 says there is no code path that could like, follow, comment or DM. It is enforced by structure rather than by care: `src/core/net.js` is the only module that calls `fetch`, its allowlist has exactly two write rules (Claude's messages endpoint, Zernio's create-post endpoint), social platforms are readable only through listed official API paths, and Zernio's inbox, comments and messages are refused by name. A test scans the code for any other `fetch(`, for engagement-shaped function names, and for engagement endpoints.

## Shabbat from the real sunset, not fixed hours

The earlier pipeline blocked Friday 15:00 to Saturday 20:00, approximate on purpose. The brief here says "Friday sunset to Saturday night", so the window is computed per week from Jerusalem's sunset (the USNO almanac algorithm, accurate to about a minute), from 40 minutes before Friday's sunset (Jerusalem candle lighting) to 50 minutes after Saturday's. The margins can be widened, never narrowed below 18 and 40 minutes. Holidays (Yom Tov) are not blocked yet; that needs a Hebrew calendar and is listed as a next step.

## Recorded clients instead of mocks

Every external client has a real implementation and a recorded one. A pack can carry `recordings/documents` (real fetched documents) and `recordings/drafts` (the answers to the two drafting calls for each document). The pipeline sends the same prompts and schemas either way; every check, the fact gate, the reviewer heuristic and the renderer run on recorded answers exactly as on live ones. That makes the whole system runnable and testable offline, and `OF_MODE=live` switches it to the real thing. A recorded draft is never redrafted: if it fails a check, the post is blocked, which is what the check is for.

## Cost of a recorded post is an estimate, and says so

With no API key there is no usage block to bill from. The ledger records what the exact prompt and the recorded answer would have cost at the model's published rate (Hebrew counted at about 2.2 characters a token, English at 3.6, output tripled for thinking), with `estimated = 1`. The website and the dry run label it as an estimate.

## Templates are code, a pack chooses one

"Account packs are config only" and "no shared visual template" pull in opposite directions: either every pack ships its own CSS (code in a pack), or packs share templates. Packs choose a template and variant from the engine's library and bring their own colours and fonts; validation refuses two packs on the same template and variant, the same display face, or palettes within a ΔE threshold. Five templates with two variants each make ten accounts possible without code; the eleventh needs one new template file.

## The fact gate signs the text it checked

The renderer refuses any post whose text does not hash to the token the gate issued. An edit on the website runs the checks again and issues a new token; there is no way to get unchecked text onto a slide.

## Facts are checked per slide, numbers included

The quote check proves a claim is traceable. It cannot prove the Hebrew claim says what the English quote says, so two more rules carry part of that: every number a slide states must appear in the quotes that slide cites, and a quote must be 4 to 40 words (long enough to be evidence, short enough to be a short fact under copyright). The reviewer call is asked for a `factProblem` on top.

## Investment advice is an engine check, not a pack rule

A pack's `rules.json` holds taste. The Israeli investment-advice rule is law, so it lives in the engine (`src/rules/compliance.js`), a pack enables it by name, and a pack whose own description is about money fails validation without it. It refuses a recommending verb near a specific product, provider, ticker, index or track; a superlative pick; a return promise; an imperative to buy or sell. Explaining how something works passes.

## The repository is public; real data lives in `$OF_HOME`

The owner's instruction mid-session (2026-10-13): the repo becomes public and holds only the engine, the website, tests, docs and one fictional demo pack. Real packs, the database, media, recordings and keys live in `$OF_HOME`, which defaults to `./private/` inside the checkout and is gitignored entirely (an earlier version of the instruction put it at `../open-frequency-private`; it was moved inside the checkout the same day). `npm run check:public` reads the git index and fails on anything under `private/`, a key, a database, a pack outside `examples/`, media outside `docs/screenshots/`, or any real pack id, handle, display name or Zernio id (read from `$OF_HOME/packs`) and any word in `$OF_HOME/public-denylist.txt`. It runs in `npm test` and as a pre-commit hook. Every test runs on a throwaway copy of the demo pack. No commit existed before the change, so no history needed rewriting.

`git clean -fdx` deletes `./private/`. The README says so and recommends making `private/` its own private git repository (`npm run init-private -- --git`), so it is backed up and the VPS can pull it.

## Recordings of real sources live with the real pack

The real packs' recordings are documents fetched from real, approved sources, and the drafts written from them. They are private (they name real sources and real content), so they live in `$OF_HOME/packs/<id>/recordings`, never in the repository. The demo pack's recordings are invented text on reserved `example.*` domains.

## Publishing needs three switches, not one

A post leaves through Zernio only when `PUBLISH_MODE=live`, `ZERNIO_API_KEY` is set
and the pack's own `pack.json` says `"publisher": "zernio"`. A key alone is not
consent to post publicly to a real account; the owner turns that on deliberately,
per account. Everything else uses the dry publisher, which writes the exact request
Zernio would have received.

## One process: the website and the runner

`npm start` runs both. The runner ticks once a minute and never overlaps itself; a
second process would need a lock on the database for no benefit at this volume. The
website alone (`npm run web`) is for looking without anything moving.

## Digest and Auto hold back a post that sounds a little like a bot

The reviewer's score blocks a post at 6 or more. A post that scored 4 or 5 and could
not be rewritten cleanly is allowed in Approve mode (the owner reads it anyway) but
waits for the owner in Digest and Auto, where nobody would.

## The demo shows three fictional accounts

`examples/packs/demo` is the one tracked pack, as asked. The Today and Accounts pages
exist to show several brands side by side, so `npm run demo` adds two more fictional
brands, generated at run time into `./.demo` from `scripts/demo-extras.js`. They are
never a pack folder in the repository. The demo seeds a few readings so the Results
page has something to show; each is marked `demo-seed`, and the page says, in a
banner, that the numbers are invented. The engine itself never writes a number an
API did not give.

## The API catalog lives in the engine

Onboarding suggests open, structured sources (Wikidata, data.gov.il, the CBS and
Bank of Israel APIs, openfootball, Open-Meteo, GitHub's changelog) when the seed's
words match. It is a list of public data sources with keywords, not code about any
one account, and a structured source is the best kind there is for this engine: a
number from an API is quotable exactly and nobody's prose is copied. Adding one is a
line in `src/onboarding/apis.js`.

## Hebrew is counted by words, and some checks were loosened by evidence

Running real content through the checks changed three of them. The "mostly Hebrew"
check counts words that carry Hebrew, not letters, so a button name in Latin letters
inside a Hebrew sentence passes and a Latin sentence does not. The cover's word count
splits on whitespace, so `ש-Gemini` is one word. The singular-"you" list keeps only
unambiguous forms, because the masculine future (`תוכל`) is spelled exactly like the
third person feminine (`Google תוכל`). And the render's fit check tolerates a tall
face's descenders spilling out of a tight line box: only a whole extra line is an
overflow.

## Owner-written text keeps its own direction

Source names, reasons and URLs are whatever the owner or the source wrote, often
English. They render with `dir="auto"` inside the Hebrew page, so an English sentence
keeps its period on the right side. The engine's own words, the catalog's reasons and
the demo's are Hebrew.

## Dry runs have their own database per pack

`npm run dry` recreates `$OF_HOME/data/dry-<pack>.db` and its media folder every
run, never touching the live database, and two dry runs for two packs can go at once.
A pack that is not valid yet is skipped (with a warning) when another pack's dry run
loads the set for the brand checks.

## Sources behind bot protection are not read

Several of the best Israeli sources for a money account answer an automated
reader with a Cloudflare challenge or a 403 from Imperva or Radware. The engine
does not drive a browser through those, rotate addresses, or pretend to be a
person: a site that has put up a gate has said no to automated reading, and
getting past it is the kind of evasion the hard rules exist to rule out. Those
sources come in when they offer a feed or an API.

## A count in Hebrew words is a number

The fact gate compared only digits, so a slide could say "חמש" against a quote
that said four. Hebrew counting words from three up (with their construct forms,
tens, and up to two prefix letters: "ובשלושת") are now numbers on item slides and
in quotes. One and two are left out: "אחד הצמחים" and "יום שני" are not counts, and
a guard that refuses correct Hebrew gets switched off. The cover and the caption
are left out too, where "שלושת הטיפים" is the post's own count.

## Provider names that are ordinary words need context

The investment-advice check refused correct Hebrew: "כלל" (a rule, "בדרך כלל"),
"מגדל" (a tower), "מנורה" (a lamp) and "מור" (inside "המורים") are also the names of
financial companies. Those names now count only next to a company word ("מגדל
מקפת", "כלל ביטוח"), after "חברת" or "בית ההשקעות", or where money is moved to them
("תעבירו את הקרן למגדל"). A bare name next to "כדאי" is no longer caught by this
part; the superlative, the return promise and the buy-or-sell checks still are.
That trade is why a financial pack starts in Approve mode.

## A photo credit is added after the checks

CC BY and CC BY-SA require the author and the licence. The credit line goes into
the caption when it is published or exported, after the fact gate: "CC BY-SA 4.0"
is not a claim, and its 4 is not a number to trace. A Commons photo whose licence
asks for credit and that names no author is not used.

## Phase 2 (2026-10-13): live on $15 a month

### The cap is enforced by reserving the worst case

`OF_BUDGET_MONTHLY_USD` ($15 by default) covers every metered service but Zernio.
A guard that compares an *estimate* with the cap can be crossed by a call that
costs more than its estimate, and a day's drafts in one batch are many calls in
flight at once. So every paid call reserves its ceiling first: its prompt's bytes
(no token is shorter than a byte) plus framing, every token billed at the dearest
input rate it can be (a 1-hour cache write), and all of `max_tokens` at the output
rate; with a server-side fallback, at the dearest model there is. The reservation
and the check are one transaction. The real cost from the usage block replaces it.
A call can cost less than its ceiling and never more, so the sum of real costs
cannot cross the cap. The price is that the last few dollars of a month can sit
unused when no call's ceiling fits in them. The website can lower the cap for a
month, never raise it: the cap belongs to the private `.env`.

Alternatives: counting tokens exactly with the API's `count_tokens` (one more
call per call, and the owner asked for the key not to be spent on anything that
does not need it); keeping a margin (a guess, not a proof).

### Shares, and cutting volume rather than quality

Each account's share is the cap by `budget.share` weights, after 5% kept for
onboarding. Every day, before drafting, the month is forecast: what was spent
and held, plus the slots still to draft this month (Shabbat and festivals
excluded) times the measured cost per produced post (blocked attempts included).
If it does not fit, the weakest account drops to one post a day, then the next.
"Weakest": by its own 72-hour results against the median of its platform; with
none yet, by how often the owner approved its posts; with neither, the one whose
posts cost most. The money a cut frees goes to the accounts that keep their
volume, and the allocations become each account's cap for the month. A budget
pause now lifts as soon as the plan gives the account room again, not only at the
month's turn. 80% spent warns on every page; 100% stops all drafting.

### Drafting through the Message Batches API, a day ahead

The pipeline stays a plain sequence of `askJson` calls. The batcher is a model
client whose answers are held until every post being built in the run is
waiting on the model; then all their requests go as one batch. A day's posts
cost one batch per step (outlines, slides, reviews) rather than one call each,
at half price. Results are read and recorded in full before any post resumes,
or the first to resume would send its next request alone (the test caught this).
Every batch is written to the `batches` table with what each request was for;
after a restart the runner reads the results of any batch not yet recorded and
records their cost, and closes the posts that lost their builder. Generation
moved to the day before: tomorrow's slots, plus today's empty ones that are at
least three hours away. `OF_BATCH=off` goes back to direct calls. Server-side
fallbacks stay on direct calls (the Batches API does not take them).

### Prompts built for the cache

Each request is the pack (voice guide with at most five examples a side, every
format, the Hebrew rules, the law) as the first system block, then the task's
fixed instructions, then a user turn with only what changes per post. The pack
block is the same for the outline, slides and rewrite calls of an account, so
they share one cached prefix: a 1-hour cache in batches (rounds can be more than
five minutes apart), 5 minutes for direct calls. Before, the format and the
slide count sat inside the system prompt and broke the cache on every post.

### Documents narrowed in code before the model sees them

`focusText` drops runs of three or more short lines with no number and no
punctuation (menus), a page's own buttons and repeated lines, and stops at 7,000
characters. On the 25 recorded documents it sends 37% fewer characters and loses
2 of the 115 quotes the recorded drafts used. The stored text is untouched, so
quotes are still checked against all of it. Bituach Leumi pages also get
`hints.selector: mainContent`.

### Measured by Claude Code, not by the project's key

The owner's instruction mid-session: never spend the project's Anthropic key on
what Claude Code can do. The before-and-after comparison (`npm run compare`) is
answered by Claude Code subagents on the matching models, each answering the
exact request the engine would send, once; the harness plays the engine (fact
verification, checks, redraft and review decisions) and prices every call from
token counts at the published rates. Its limits, in docs/costs.md: token counts
are estimated, thinking is unseen (priced as a range), a subagent is not
byte-for-byte the API model (the `haiku` alias may not be Haiku 5.5), and a
subagent carries context from one topic to the next where an API call cannot.
The one thing only the key can measure, the billed cost, is `npm run live-day`,
for the owner to run.

### Claude Haiku 5.5 exists

Released 2026-10-07, after the API reference this session started from: $0.10 in
and $0.50 out per million tokens, adaptive thinking with effort, a 512-token
cache minimum. It is the `judge` model (scoring sources, reading a trend's
format). Its long-prompt tier (over 100,000 tokens, five times the price) is in
the ledger.

### Instagram directly, TikTok through Zernio, per pack

Zernio bills per connected account; Meta's Graph API is free. Each pack names a
publisher per platform (`publishers`), so this can change without code.
Instagram uses the Facebook Login path by default (a business or creator
account linked to a Page; the Page token does not expire) and also supports
Instagram Login (60-day tokens, refreshed daily by the runner when 20 days or
fewer are left). A token comes from `.env`; a refreshed one is kept in the
database and wins until `.env` holds a different one. The network door gains
exactly two Graph writes (create a media container, publish it) and reads of
numeric objects, their insights, the quota and our own token; it refuses every
edge and field expansion for comments, replies, mentions, tags, messages,
hashtags and `business_discovery`, in the path or in `fields`. A post publishes
platform by platform and never re-sends a platform that is already out. An
Instagram throttle, or a container still processing, waits for the next tick
(three attempts), because Instagram publishes only at `media_publish` and the
retry first asks whether the last container went out; a Zernio error is never
retried blind, since a lost answer to a create can be a post that exists.

### The festivals, from the Hebrew calendar

Ported from the Hebrew calendar of an earlier project of the owner (read only): the molad and
the four dechiyot, Israel's yom tov days only (Rosh Hashana two days, the rest
one). A rest day runs from candle lighting on the evening before to nightfall on
the day, so a festival next to Shabbat is one window. Tested against Hebcal's
Israel dates for October 2026 to October 2028 and against ICU's Hebrew calendar
for every day in between.

### The money pack's official sources

data.gov.il's CKAN API, the Bank of Israel's SDMX series API (CSV) and the CBS
APIs answer a plain client; the HTML sites in front of them do not, and the
engine still does not get past bot protection. New: the Bank of Israel rate as
the dates it changed (`changesOnly`), exchange rates, the dwelling price index,
the average wage per employee job, the maximum prices of controlled products,
the Accountant General's rates, the excise on fuel. Coded columns carry Hebrew
labels so a line reads, and quotes, as written. Pension and provident fund
yields (also on data.gov.il) are left out: a post comparing funds is a step from
recommending one. The Bank of Israel's terms page is behind its bot protection;
a search snippet suggests republishing site content needs consent. Facts (a rate,
a date) are not content, but the owner should know.

CBS `percentYear` is the change from the same month a year earlier: CBS's own
pages do not define it, and computed from the index values it matches 33 of 33
months, where a since-January reading matches 4. The recorded price-index slide
already read it that way; the field now carries a Hebrew label saying so.

### Hand-checked facts

A pack's `facts/` folder holds what the owner read on sites the engine may not
read: each sentence word for word, its page, the day it was checked and the day
it expires (at most two years later). Each topic is one document of a `facts`
source, holding only valid facts, and the document stops being evidence on its
earliest expiry: `verifyFact` refuses it, so a post drafted before a fact expired
is blocked before it is published after. Facts are added, rechecked with a new
expiry and removed on the website. Two topics are seeded from Bituach Leumi pages,
copied word for word by Claude and marked "checked by Claude": the owner should
confirm or delete them.

### Discovery from cache

Brave searches are kept 30 days and YouTube searches 7 (`lookups`), so a weekly
trend run or a second onboarding of a similar niche does not pay again or use the
100-a-day search quota.

### The deploy steps, tested in a clean container

`deploy/test/run.sh` builds a plain Ubuntu 24.04 with systemd and runs the
README's steps in it with podman. The container runs privileged because the
unit's hardening needs mount namespaces, which a VM has and an unprivileged
container does not ("Failed to keep CAP_SYS_ADMIN"); under WSL it also needs the
host's network (`NET=host`), since WSL has no nftables.
