# The owner line: Teder's side

A business owner writes to one WhatsApp number and talks to their assistant about their posts. openfrequency-toran
carries the line: it knows the number as one user of one workspace (openfrequency-accounts), asks Teder about that
workspace's posts and acts on them, and writes Teder's news to the owner. This is what Teder answers and what it
sends. The whole contract, with the accounts and Toran parts, is `docs/owner-line.md` in openfrequency-toran; this
page is its section 2 as Teder implements it.

Everything here is between services on one machine. No route in this document is reachable through Caddy, except the
slide links (`/m/<token>.jpg`), which are on the public site on purpose.

The code is `src/owner/`: `sign.js` (the signature and the slide links), `api.js` (the internal listener), `view.js`
(what a post looks like to the line), `quiet.js` (quiet hours and Shabbat), `events.js` (the outbox and its sender).

## Signing (both directions)

One secret, `OF_ASSISTANT_SECRET` (32 characters or more), is set in Teder's and Toran's `.env` to the same value.
While it is unset or short, every internal route answers `503 not_configured`, and no event is written or sent.
Every request carries:

```
X-OF-Timestamp: <unix seconds>
X-OF-Signature: v1=<hex HMAC-SHA256(secret, "v1\n" + ts + "\n" + METHOD + "\n" + pathWithQuery + "\n" + sha256hex(rawBody))>
```

`rawBody` is the empty string for a GET; `pathWithQuery` is the request's path and query exactly as sent. The
receiver refuses a timestamp more than 300 seconds away from its clock, or a missing one (`401 stale`), and a
signature that does not match (`401 bad_signature`, compared in constant time). Teder also refuses a request with
`X-Forwarded-For` or `Forwarded`, one from a socket that is not loopback, and one whose `Host` is not
`127.0.0.1:<port>` or `localhost:<port>` (`403 not_local`). The checks run in that order: local, configured, signed.

## Teder's internal listener: 127.0.0.1:`TEDER_INTERNAL_PORT` (default 4701), JSON in and out

A separate listener in the same process as the website (`scripts/web.js` starts it; a port already taken stops the
line, not the site). Toran reaches it at `TEDER_INTERNAL` (default `http://127.0.0.1:4701`). Every answer is JSON with
`Cache-Control: no-store`; an error is `{ "error": "<code>" }`, with `problems` for `failed_checks`.

Every route is scoped to one accounts workspace (`?workspace=<id>` on a GET, `workspace` in a POST's body): every
Teder account whose `accounts.workspace_id` is that id. A post of another workspace is `404 not_found`, exactly like
one that does not exist; so is an onboarding sample. A workspace with no Teder account is `404 no_teder`, a workspace
that is not a positive integer `400 bad_workspace`.

Every POST body carries `actor` (who asked, e.g. `wa:972500000123`; 1 to 80 characters, one line, else
`400 bad_actor`). The buttons are the dashboard's own functions (`src/web/actions.js` `approve`, `reject`, `edit`),
called with the actor as the person: Teder records it as `approved_by`, in `edits.actor`, in the post's trace and in
its audit log, as it records a name clicked on the website.

**A post, as listed:**

```json
{ "id": "pmvm79ruk7fe704bb", "number": null, "account": { "id": "dana-shop", "name": "דנה שופ" }, "status": "queued",
  "hook": "5 טעויות בבחירת נעלי ריצה", "slotAt": "2026-10-25T07:00:00.000Z", "slides": 7,
  "cover": { "url": "https://teder.openfrequency.co.il/m/<token>.jpg" } }
```

`id` is Teder's post id, a string. `number` is always null: Toran numbers the posts it shows, never Teder. `hook` is
the cover line as one line (its breaks are the renderer's). `slotAt` is null for a post with no slot. `cover` is null
for a post with no rendered slides. The pictures are Instagram's set (4:5) when the post has one, else TikTok's.

**The slide links.** `cover.url` and every image URL below are signed links that work without a session for 7 days:
`GET /m/<post>.<platform>.<index>.<expiry>.<signature>.jpg` on Teder's public site, the signature an HMAC-SHA256 of
the post, the platform, the slide's 0-based index and the expiry (unix seconds, rounded up to the hour), keyed with
`SESSION_SECRET`. The origin is `https://<PUBLIC_HOST>`, or `http://127.0.0.1:<PORT>` on a laptop. A link past its
expiry is `410`; an altered one, or one whose slide is gone, `404`. A link names a slide by its place, so after an
edit it shows the slide as drawn again. WhatsApp fetches them from Meta's servers.

| Route | Answers |
|---|---|
| `GET /internal/assistant/status?workspace=<id>` | `200 { "workspace": 3, "accounts": [{ "id", "name", "mode", "status" }], "pending": 3, "approvedThisWeek": 4, "publishedThisWeek": 5, "quota": null, "quiet": { "now": false, "until": null, "reason": null }, "quietHours": { "start": "22:00", "end": "08:00" }, "shabbat": true }` |
| `GET /internal/assistant/posts?workspace=<id>&status=queued` | `200 { "posts": [post, ...] }`, oldest slot first, the posts with no slot last, 100 at most. `status` is optional, default `queued` (waiting for approval); one of `drafting`, `blocked`, `queued`, `approved`, `rejected`, `expired`, `publishing`, `published`, `failed`, else `400 bad_status`. |
| `GET /internal/assistant/posts/<id>?workspace=<id>` | `200 { "post": post + { "caption", "hashtags": [...], "slideList": [{ "idx": 1, "kind": "cover", "lines": ["...", "..."], "image": { "url" } }] } }` |
| `POST /internal/assistant/posts/<id>/approve` with `{ workspace, actor }` | `200 { "post": { "id", "status": "approved" } }`; `409 not_pending` (it is not waiting for approval) |
| `POST /internal/assistant/posts/<id>/reject` with `{ workspace, actor, reason: "topic"\|"shorter"\|"tone"\|"photo"\|"other", note }` | `200 { "post": { "id", "status": "rejected" }, "replacement": null, "redosLeft": null }`; `400 bad_reason`; `409 not_pending` |
| `POST /internal/assistant/posts/<id>/edit` with `{ workspace, actor, slide: 1-based, line: 1-based, text }` | `200 { "post": post, "slide": { "idx", "kind", "lines", "image": { "url" } } }` after the checks and the re-render; `422 failed_checks { "problems": ["..."] }`; `409 not_pending`; `400 bad_line` |
| `GET /internal/assistant/posts/<id>/bundle?workspace=<id>` | `200 { "post": { "id", "hook" }, "platform": "instagram", "images": [{ "url" }, ...], "caption": "the caption to copy, hashtags included" }`, the Instagram set |

**Status.** `accounts` are the workspace's Teder accounts: the pack's id and display name, the account's mode
(`approve`, `digest`, `auto`) and status (`active`, `paused`, `onboarding`). "This week" is from Sunday 00:00, Israel
time; `approvedThisWeek` counts every approval (the owner's and the engine's in digest and auto), and
`publishedThisWeek` every post that went out. `quota` is null: Teder has no monthly plan of suggestions and redos per
workspace yet. When it does, it is `{ "month": "2026-10", "suggested": { "used", "limit" }, "redos": { "used", "limit" } }`.

**Approve** takes a post that waits for approval (`queued`). In TikTok's default draft-now mode the approval sends
the TikTok draft at once, as a click does.

**Reject** takes a post that waits or is approved (as the dashboard does; a sample is the operator's). The reason is
kept on the post in Hebrew, with the note after it: `topic` הנושא לא מתאים, `shorter` ארוך מדי, `tone` הטון לא נכון,
`photo` התמונות לא מתאימות, `other` משהו אחר. Teder's reject writes no replacement and counts no redos, so
`replacement` and `redosLeft` are null until it does.

**Edit** takes a post that waits or is approved. A slide's `lines` are its title line first, then its body's lines;
the cover's are the cover line, then the line under it. `line: 1` changes the title (the cover line), and `line: k`
changes the body's line `k-1` (the line under the cover). One line in, one line out: an empty text, or one with a line
break, is `400 bad_line`, as is a slide or a line that does not exist and the closing slide (the dashboard does not
edit it either). The edit is the dashboard's form with that one line changed: the voice, rules and fact checks run
again, nothing is saved on a problem (`422`), and on success the slides are drawn again. The line may be broken again
by the account's rules (`lineDraft`), as a typed one is.

**The bundle** is what the owner needs to post by hand: the slides and the caption as it goes out (Instagram's short
caption when there is one, the photo credits, the hashtags). A post with no Instagram set gives TikTok's, and
`platform` says which.

**Quiet.** `quiet` says whether a message to the owner may go out now. `now: true` comes with `until` (the first
instant nothing holds a message back, so quiet hours that run into Shabbat are one quiet time) and `reason`:

- `shabbat`: the workspace's `shabbat` setting is on (the default), and it is Shabbat or a holiday by Teder's own
  calendar (`restAt`, the window nothing is published in: from 40 minutes before sunset to 50 minutes after it).
- `quiet_hours`: the time is inside the workspace's quiet hours (default 22:00 to 08:00, Israel time; the same time
  twice is none).

Both settings are on Teder's settings page ("הודעות בוואטסאפ"), per workspace, for the workspace's users; view-as
sees them and cannot save. They are kept in `owner_line` (one row per workspace; no row is the default).

## Events: Teder → Toran

Teder writes each event to an outbox (`owner_events`) where it happens, and the sender, beside the runner, posts it
to `TORAN_INTERNAL` (default `http://127.0.0.1:4710`) `/internal/teder/events`, signed as above, every 30 seconds and
at once after an event is written. On anything but a `2xx` (or no answer) it tries again after 1, 5, 15 and 60
minutes, then hourly, until a day has passed since the event, and then drops it. Toran answers `200 { "ok": true }` to
an event it already has, by its `id`. Writing an event never waits for the network and never fails the run that
writes it. Only accounts in a workspace make events, and none are written while `OF_ASSISTANT_SECRET` is unset.

```json
{ "id": "evt_t1x9k2...", "type": "post.ready", "workspace": 3, "at": "2026-10-24T09:00:00.000Z", "data": { ... } }
```

| `type` | When | `data` |
|---|---|---|
| `post.ready` | At the end of a run that queued posts for approval (the day's run, a recap), one event per workspace | `{ "posts": [post, ...] }` (the ones queued in that run) |
| `post.reminder` | An approved post's slot came and its TikTok part is a draft the owner posts themselves: draft-now's reminder at the slot, draft-fallback's at half an hour | `{ "post": post, "platform": "tiktok" }` |
| `post.unposted` | The slot passed and a platform's part did not go out: a publish that failed and is not tried again (the platform that failed), draft-now's reminder too late to send (more than 12 hours after the slot), draft-fallback's direct publish that failed | `{ "post": post, "platform": "tiktok"\|"instagram" }` (Toran fetches the bundle) |
| `quota.low` | Once a month per kind, when the suggestions used reach 80% of the limit, or 2 redos are left | `{ "kind": "suggested"\|"redos", "used": 32, "limit": 40, "month": "2026-10" }`. Never sent until Teder has a plan (the quota is null). |
| `weekly.summary` | Sunday from 09:00 Israel time, once, for the 7 days before (Sunday to Saturday) | `{ "from": "2026-10-18", "to": "2026-10-24", "made": 9, "approved": 7, "rejected": 2, "published": 6, "expired": 0, "pending": 1, "quota": null }` |

`post.reminder` and `post.unposted` happen once per post and platform. In `weekly.summary`, `made` is the posts that
reached the owner's queue (or went past it in digest and auto) in those days, our checks' blocked ones not counted;
`rejected` is the posts rejected in those days (by the audit log); `pending` is what waits now.

## Where this differs from docs/owner-line.md

- A post's `id` is a string (Teder's ids are), not a number.
- `quota` is null in the status and in `weekly.summary`, and `quota.low` is never sent: Teder has no monthly plan of
  suggestions and redos yet. For the same reason a rejection writes no replacement: `replacement` and `redosLeft` are
  always null.
- Reject and edit take an approved post too, as the dashboard does; approve takes only one that waits.
- The edit's `slide` answer and every `slideList` entry carry `kind` as well. The closing slide cannot be edited, and
  neither can a line with a line break in it or an empty one (`400 bad_line`).
- The bundle carries `platform`, and falls back to TikTok's set for a post with no Instagram one.
- More codes than the contract names: `400 bad_workspace`, `bad_actor`, `bad_reason`, `bad_status`, `bad_json`;
  `405 method_not_allowed`; `413 too_large`; a request with `Forwarded`, or with a Host that is not ours, is
  `403 not_local` too; a missing timestamp is `401 stale`.
- `post.unposted` names the platform that did not go out, TikTok or Instagram.
