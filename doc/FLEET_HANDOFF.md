# Fleetmanager handoff

Once you approve a generated image in **Draft Review**, ugc-db pushes the post
into [fleetmanager](https://github.com/your-org/fleetmanager) — which then
schedules it on Instagram via the Meta Graph API.

This is the **bridge** between the character-bible side (ugc-db) and the
publishing-operations side (fleetmanager). No new fleetmanager code is
required — we use its existing REST API.

---

## What gets pushed

When `planned_post.status` transitions to `accepted`, ugc-db performs four
HTTP calls to fleetmanager:

1. **Find account** — `GET /api/v1/accounts?platform=instagram`, filter by
   normalized handle (strips leading `@`, lowercases).
2. **Create content** — `POST /api/v1/content` with caption, hashtags, post type
   (`ig-feed` / `ig-story`), status `ready`.
3. **Upload media** — multipart `POST /api/v1/media` with the generated image
   bytes attached to that content id.
4. **Schedule** — `POST /api/v1/schedule` with `{ contentId, targets: [{type: 'account', id}], baseTime, strategy: 'same' }`.

On success ugc-db writes back:
- `planned_posts.fleet_content_id`
- `planned_posts.fleet_scheduled_post_id`
- `planned_posts.pushed_at`
- `planned_posts.status = 'pushed'`

On failure ugc-db writes the error to `planned_posts.last_push_error` and
keeps status at `accepted` so you can retry.

---

## Mapping

| ugc-db | fleetmanager | Mapping rule |
|---|---|---|
| `socials.handle` (instagram) | `accounts.handle` | Strip `@`, lowercase, exact match. Unique per platform. |
| `planned_posts.platform = 'instagram'` | `accounts.platform = 'instagram'` | Direct |
| `planned_posts.post_type` | `content.type` | `ig_feed` → `ig-feed`, `ig_story` → `ig-story`, `ig_carousel` → `ig-feed` (multi-media) |
| `planned_posts.caption` | `content.caption` | Direct |
| `planned_posts.hashtags` | `content.tags` | Direct (string array) |
| `planned_posts.scheduled_at` | `schedule.baseTime` | ISO 8601 |
| `images.data` (bytea) | `media` (multipart upload) | Direct |

---

## Setup

### 1. Issue a long-lived bearer token in fleetmanager

```bash
curl -X POST https://api.fleet.your-domain.com/api/v1/auth/tokens \
  -H "Content-Type: application/json" \
  -H "Cookie: <your fleetmanager session>" \
  -d '{ "name": "ugc-db-handoff" }'
# → { "id": "...", "token": "eyJ...", "name": "ugc-db-handoff" }
```

Save the token — fleetmanager won't show it again. We don't set `expiresAt`
because this is a server-to-server integration; rotate manually if needed.

### 2. Choose your connection strategy

#### Option A — Internal Docker network (recommended)

Both ugc-db and fleetmanager run on the same Docker host. Calls stay on the
local bridge — fast, no Cloudflare hop, no public exposure required.

```bash
# Create the shared network once
docker network create ai-stack

# On fleetmanager side: attach its api container to ai-stack.
# (See fleetmanager's docs/FLEET_HANDOFF_SHARED_NETWORK.md if it exists,
#  or add the same network: block to fleetmanager's compose.)

# On ugc-db side: .env
FLEET_ENABLED=true
FLEET_BASE_URL=http://api.fleetmanager:4000   # service alias inside ai-stack
FLEET_TOKEN=eyJ...
FLEET_NETWORK=ai-stack

# Bring up with the fleet override:
docker compose -f docker-compose.yml -f docker-compose.fleet.yml up -d
```

#### Option B — Via fleetmanager's public Cloudflare URL

Simpler — no Docker network setup. Each call goes out to Cloudflare and back.
With ~4 calls per post and 30 posts in a batch, that's ~120 round-trips through
the tunnel. Fine for normal use; slower than Option A for large bulk pushes.

```bash
# .env
FLEET_ENABLED=true
FLEET_BASE_URL=https://api.fleet.your-domain.com
FLEET_TOKEN=eyJ...

# Bring up normally:
docker compose up -d
```

### 3. Verify

```bash
curl http://localhost:8080/api/fleet/status
# → { "enabled": true, "configured": true, "baseUrl": "...", "hasToken": true, "ready": true }
```

---

## Status state machine — with handoff

```
planned ─approve plan→ approved ─generator picks up→ generating
                                                       │
                                                       ▼
                                                  generated
                                                       │ approve image
                                                       ▼
                                                  accepted ─auto-push→ pushed ─publish→ posted
                                                     │ ▲                  │
                                                     │ │                  │ (no rollback once pushed —
                                                     │ │                  │  delete via fleetmanager UI)
                                                     │ └─ retry on error ─┤
                                                     ▼
                                                  (last_push_error set)
                                                  rejected ─terminal
```

- **accepted → pushed** is automatic when `FLEET_ENABLED=true`. The transition
  fires asynchronously after the PATCH status response returns.
- **accepted → (failed)** leaves status at `accepted` with `last_push_error`
  set. The UI shows a banner with a "Retry push" button.
- **Manual retry**: `POST /api/planned-posts/:id/push`. Used by the Retry
  button and by the `push_to_fleet` MCP tool.
- **pushed → posted**: ugc-db doesn't auto-track this today. fleetmanager
  knows when Instagram accepts the post. Future: webhook from fleetmanager to
  ugc-db, or a poll worker against `GET /api/v1/scheduled-posts/:id`.

---

## Failure modes

| `last_push_error` content | Meaning | Fix |
|---|---|---|
| `ACCOUNT_NOT_FOUND: no fleetmanager Instagram account found with handle @x` | Persona's IG handle doesn't match any account in fleetmanager. | Add the account in fleetmanager, or fix the handle on the persona. |
| `AMBIGUOUS_HANDLE: multiple fleetmanager accounts match …` | Two fleetmanager accounts share a handle (shouldn't happen — handle is unique per platform). | Investigate; pick one canonical account. |
| `NO_HANDLE: persona has no instagram handle in socials` | Persona's `socials` row missing or platform≠instagram. | Add an instagram handle to the persona. |
| `UNSUPPORTED_POST_TYPE: cannot map post_type=…` | Post type isn't `ig_feed` / `ig_story` / `ig_carousel`. | Fix the post type. |
| `MISSING_IMAGE: planned_post has no generated image and no library asset` | Persona/library posts must have either `generated_image_id` or `library_asset_id`. | Generate or attach a library asset before pushing. text_overlay / feed_repost posts skip this check. |
| `NETWORK: cannot reach fleetmanager at …` | Network down or wrong `FLEET_BASE_URL`. | Check `docker compose ps`, `curl $FLEET_BASE_URL/health`. |
| `HTTP_401` | Bad token. | Re-issue token in fleetmanager and update `.env`. |
| `HTTP_4xx` (other) | Validation error from fleetmanager. | Inspect the error message — usually a missing field. |

---

## What fleetmanager does NOT do (yet)

These would be nice but aren't required for the integration. If you ever
extend fleetmanager, here's the wishlist:

1. **`GET /api/v1/accounts/by-handle/:handle?platform=instagram`** —
   saves filtering through all accounts on each push. ~30 lines.
2. **`POST /api/v1/handoff/bulk`** — accept a batch of
   `{content, media, schedule}` triples and process them transactionally. Would
   collapse 4N round-trips to 1.
3. **Webhook on publish** — fleetmanager pings ugc-db when a scheduled post
   actually goes live on Instagram so ugc-db can flip `pushed → posted`.

Without these, ugc-db just works around the limitation (filter client-side,
sequential push, manual `posted` state).

---

## Testing without burning real schedules

For development, point `FLEET_BASE_URL` at a local fleetmanager dev instance.
Or set `FLEET_ENABLED=false` to disable handoff entirely — `accepted` becomes
terminal and you can validate everything else.
