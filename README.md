# open-frequency

One engine that runs several Hebrew social accounts, each in its own niche and
each its own brand. It reads approved sources, drafts slideshows grounded in
quotes it can prove, checks them in code, renders them, and publishes them
through Zernio after the approval its mode asks for. Working product name: Teder
(תדר).

This repository is the engine, the website, the tests, the docs and one fictional
demo pack. Real accounts, their database, rendered media and keys live in a
private folder, `$OF_HOME` (`./private/` by default), which is never committed.

```bash
npm install
npx playwright install chromium
npm test                                  # every hard rule, offline
npm run dry -- --pack demo --count 5      # five Hebrew slideshows to disk, sources listed
```

More in `docs/PLAN.md`, `docs/decisions.md` and the full README at the end of the session.
