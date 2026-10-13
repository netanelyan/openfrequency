// The schema, as an append-only list of migrations. Never edit a shipped entry:
// add a new one. PRAGMA user_version records how many have run.
//
// Times are ISO strings in UTC. Money is US dollars as REAL. JSON columns are
// TEXT and end in _json.

export const MIGRATIONS = [
  `
  CREATE TABLE accounts (
    id            TEXT PRIMARY KEY,              -- the pack id
    display_name  TEXT NOT NULL,
    handle        TEXT NOT NULL,
    mode          TEXT NOT NULL DEFAULT 'approve' CHECK (mode IN ('approve','digest','auto')),
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','onboarding')),
    paused_reason TEXT,                          -- 'kill' | 'fact_check' | 'strike' | 'publish_errors' | 'budget' | 'manual'
    paused_detail TEXT,
    paused_at     TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE sources (
    id            INTEGER PRIMARY KEY,
    account_id    TEXT NOT NULL REFERENCES accounts(id),
    key           TEXT NOT NULL,                 -- the id in sources.json, or a generated one
    type          TEXT NOT NULL CHECK (type IN ('rss','web','api')),
    url           TEXT NOT NULL,
    name          TEXT NOT NULL,
    why           TEXT,
    lang          TEXT,
    status        TEXT NOT NULL CHECK (status IN ('approved','pending','removed')),
    origin        TEXT NOT NULL CHECK (origin IN ('pack','discovered','manual')),
    approved_at   TEXT,
    score_json    TEXT,                          -- authority, freshness, terms, reason
    config_json   TEXT,                          -- parser hints, api kind
    last_ok_at    TEXT,
    last_error    TEXT,
    created_at    TEXT NOT NULL,
    UNIQUE (account_id, key)
  );

  CREATE TABLE documents (
    id            INTEGER PRIMARY KEY,
    source_id     INTEGER NOT NULL REFERENCES sources(id),
    key           TEXT,                          -- the recording's key, when it came from one
    url           TEXT NOT NULL,
    title         TEXT,
    text          TEXT NOT NULL,                 -- the snapshot every quote is checked against
    sha256        TEXT NOT NULL,
    published_at  TEXT,
    fetched_at    TEXT NOT NULL,
    recorded      INTEGER NOT NULL DEFAULT 0,    -- 1 when it came from a recording
    UNIQUE (source_id, sha256)
  );
  CREATE INDEX documents_source ON documents(source_id, fetched_at);

  CREATE TABLE posts (
    id            TEXT PRIMARY KEY,
    account_id    TEXT NOT NULL REFERENCES accounts(id),
    format_id     TEXT,
    topic         TEXT,
    hook          TEXT,
    sub           TEXT,
    status        TEXT NOT NULL,                 -- drafting | blocked | queued | approved | rejected | expired | publishing | published | failed | sample
    reason        TEXT,                          -- why blocked / rejected / failed
    slot_at       TEXT,
    caption       TEXT,
    hashtags_json TEXT,
    checks_json   TEXT,                          -- voice, tells, review, verify, rules, render
    review_score  REAL,
    cost_usd      REAL NOT NULL DEFAULT 0,
    cost_estimated INTEGER NOT NULL DEFAULT 0,
    media_json    TEXT,                          -- rendered files per platform
    publish_json  TEXT,                          -- per platform result
    ai_label      INTEGER NOT NULL DEFAULT 0,
    mode_at_queue TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    approved_at   TEXT,
    approved_by   TEXT,
    published_at  TEXT,
    sample        INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX posts_account ON posts(account_id, status, slot_at);

  CREATE TABLE slides (
    id            INTEGER PRIMARY KEY,
    post_id       TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    idx           INTEGER NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('cover','item','closer')),
    title         TEXT,
    body          TEXT,
    fact_ids_json TEXT,
    image_id      INTEGER REFERENCES images(id),
    files_json    TEXT,
    UNIQUE (post_id, idx)
  );

  CREATE TABLE facts (
    id            INTEGER PRIMARY KEY,
    post_id       TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    key           TEXT NOT NULL,                 -- the draft's own id for it (f1, f2...)
    claim         TEXT NOT NULL,
    quote         TEXT NOT NULL,
    document_id   INTEGER REFERENCES documents(id),
    source_id     INTEGER REFERENCES sources(id),
    verified      INTEGER NOT NULL DEFAULT 0,
    error         TEXT,
    UNIQUE (post_id, key)
  );

  CREATE TABLE steps (
    id            INTEGER PRIMARY KEY,
    post_id       TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    step          TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('ok','failed','skipped','info')),
    detail_json   TEXT,
    cost_usd      REAL NOT NULL DEFAULT 0,
    at            TEXT NOT NULL
  );
  CREATE INDEX steps_post ON steps(post_id, id);

  CREATE TABLE images (
    id            INTEGER PRIMARY KEY,
    provider      TEXT NOT NULL,                 -- pexels | unsplash | commons | rendered
    provider_id   TEXT,
    license       TEXT NOT NULL,
    license_url   TEXT,
    author        TEXT,
    author_url    TEXT,
    source_url    TEXT,
    alt           TEXT,
    query         TEXT,
    ai_generated  INTEGER NOT NULL DEFAULT 0,
    realistic     INTEGER NOT NULL DEFAULT 0,
    file          TEXT,
    sha256        TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE metrics (
    id            INTEGER PRIMARY KEY,
    post_id       TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    platform      TEXT NOT NULL,
    collected_at  TEXT NOT NULL,
    age_hours     REAL,
    views         INTEGER,
    likes         INTEGER,
    comments      INTEGER,
    shares        INTEGER,
    saves         INTEGER,                       -- null when the platform does not report it (TikTok)
    raw_json      TEXT,
    UNIQUE (post_id, platform, collected_at)
  );

  CREATE TABLE formats (
    id            INTEGER PRIMARY KEY,
    account_id    TEXT NOT NULL REFERENCES accounts(id),
    format_key    TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('proven','trial')),
    status        TEXT NOT NULL CHECK (status IN ('active','dropped')),
    weight        REAL NOT NULL DEFAULT 1,
    own           INTEGER NOT NULL DEFAULT 1,
    results_json  TEXT NOT NULL DEFAULT '[]',
    dropped_why   TEXT,
    dropped_at    TEXT,
    promoted_at   TEXT,
    returned_at   TEXT,
    UNIQUE (account_id, format_key)
  );

  CREATE TABLE spend (
    id            INTEGER PRIMARY KEY,
    account_id    TEXT,                          -- null: engine-wide (onboarding, trends)
    post_id       TEXT,
    api           TEXT NOT NULL,
    model         TEXT,
    units         REAL NOT NULL DEFAULT 1,
    usd           REAL NOT NULL,
    estimated     INTEGER NOT NULL DEFAULT 0,
    tag           TEXT,
    month         TEXT NOT NULL,                 -- Israel month, YYYY-MM
    at            TEXT NOT NULL
  );
  CREATE INDEX spend_month ON spend(month, account_id);

  CREATE TABLE edits (
    id            INTEGER PRIMARY KEY,
    post_id       TEXT NOT NULL,
    account_id    TEXT NOT NULL,
    slide_idx     INTEGER,
    field         TEXT NOT NULL,
    before        TEXT,
    after         TEXT,
    user_id       INTEGER,
    at            TEXT NOT NULL
  );

  CREATE TABLE audit (
    id            INTEGER PRIMARY KEY,
    at            TEXT NOT NULL,
    actor         TEXT NOT NULL,                 -- 'engine' or a user name
    action        TEXT NOT NULL,
    account_id    TEXT,
    post_id       TEXT,
    detail_json   TEXT
  );
  CREATE INDEX audit_at ON audit(at);

  CREATE TABLE settings (
    key           TEXT PRIMARY KEY,
    value_json    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','editor','viewer')),
    created_at    TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE onboarding (
    id            TEXT PRIMARY KEY,
    seed_json     TEXT NOT NULL,
    status        TEXT NOT NULL,                 -- discovering | review | samples | ready | live | abandoned
    pack_id       TEXT,
    candidates_json TEXT NOT NULL DEFAULT '[]',
    notes_json    TEXT NOT NULL DEFAULT '[]',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE trend_formats (
    id            INTEGER PRIMARY KEY,
    account_id    TEXT NOT NULL,
    platform      TEXT NOT NULL,
    url           TEXT NOT NULL,
    views         INTEGER,
    likes         INTEGER,
    comments      INTEGER,
    published_at  TEXT,
    card_json     TEXT,                          -- the shape, never the content
    status        TEXT NOT NULL,                 -- kept | rejected
    why           TEXT,
    found_at      TEXT NOT NULL,
    UNIQUE (account_id, url)
  );

  CREATE TABLE summaries (
    id            INTEGER PRIMARY KEY,
    day           TEXT NOT NULL,                 -- Israel date
    account_id    TEXT,
    text          TEXT NOT NULL,
    data_json     TEXT,
    at            TEXT NOT NULL,
    UNIQUE (day, account_id)
  );
  `,
  `
  -- Money held for calls still in flight. guard() counts it with what was spent,
  -- so concurrent and batched calls cannot together cross a cap.
  CREATE TABLE reservations (
    id            INTEGER PRIMARY KEY,
    account_id    TEXT,
    post_id       TEXT,
    usd           REAL NOT NULL,
    tag           TEXT,
    month         TEXT NOT NULL,
    at            TEXT NOT NULL
  );
  CREATE INDEX reservations_month ON reservations(month, account_id);

  -- What each Claude call really used, as the API reported it, and whether it
  -- went through the Message Batches API (half price).
  ALTER TABLE spend ADD COLUMN batch INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE spend ADD COLUMN usage_json TEXT;

  -- Message batches sent to Anthropic, kept until every request in them is
  -- recorded, so a restart in the middle of a batch still records what it cost.
  CREATE TABLE batches (
    id            TEXT PRIMARY KEY,              -- Anthropic's batch id
    status        TEXT NOT NULL,                 -- in_progress | ended | recorded
    requests_json TEXT NOT NULL,                 -- custom_id -> { account_id, post_id, model, tag, reservation }
    counts_json   TEXT,
    created_at    TEXT NOT NULL,
    ended_at      TEXT,
    recorded_at   TEXT
  );

  -- Answers from paid or quota-limited lookups (Brave, YouTube search), reused
  -- until they expire: discovery runs weekly and reads the cache first.
  CREATE TABLE lookups (
    key           TEXT PRIMARY KEY,
    value_json    TEXT NOT NULL,
    at            TEXT NOT NULL,
    expires_at    TEXT NOT NULL
  );

  -- Instagram reports reach as well as views.
  ALTER TABLE metrics ADD COLUMN reach INTEGER;

  -- A document built from hand-checked facts stops being evidence after the
  -- earliest expiry date of the facts in it.
  ALTER TABLE documents ADD COLUMN expires_at TEXT;
  `,
];
