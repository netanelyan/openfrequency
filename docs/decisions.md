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
