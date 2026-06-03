# REST API Reference

Base URL when running locally: **`http://localhost:8080/api`**
Behind Cloudflare Tunnel: `https://ugc.<your-domain>/api`

The API runs in the `api` service of the docker-compose stack. It serves both the static frontend (under `/`) and the REST API (under `/api`). All responses are JSON unless noted.

## Conventions

- **IDs.** All entity primary keys are UUIDs. For personas, families, arcs, etc. the API also accepts human-friendly identifiers in URL paths.
- **Identifier resolution.** Endpoints with `:idOrHandle` accept either a UUID, a slug/handle, or in some cases a name. See [Identifier Resolution](#identifier-resolution).
- **Status codes.** `200` success; `400` validation error; `404` not found; `409` conflict / ambiguous; `500` server error.
- **Timestamps.** All emitted timestamps are ISO 8601 in UTC. Inputs accept either ISO or `YYYY-MM-DD` for dates.
- **Authentication.** The API has no built-in auth. Lock down public access via Cloudflare Access if you expose `ugc.<domain>` via the tunnel.

## Identifier resolution

Many endpoints take `:idOrHandle`. The resolver tries in this order:

1. **UUID** — if the string is a valid v4 UUID, looked up directly.
2. **Social handle** (personas only) — leading `@` is stripped, lowercased, and matched against any `socials.handle` value across any platform. So `@maya.moves` and `maya.moves` and `@MAYA.MOVES` and `@mayamoves` (TikTok) all resolve to Maya Rivera.
3. **Slug** (families only) — `families.handle`, e.g. `the-riveras`.
4. **Name** (personas only) — case-insensitive exact match, then prefix match. "Maya" matches Maya Rivera if no other persona starts with "Maya".

If a name or handle matches multiple personas, the API returns **409** with the candidate list — the caller picks one.

## Tables of contents

- [Personas](#personas)
- [Socials and credentials](#socials-and-credentials) (embedded in persona payloads)
- [Persona image library / gallery](#persona-image-library)
- [Families](#families)
- [Family members](#family-members)
- [Relationships](#relationships)
- [Relationship photos](#relationship-photos)
- [Storyline arcs](#storyline-arcs) *(new)*
- [Planned posts](#planned-posts) *(new)*
- [Library assets](#library-assets) *(new)*
- [Images](#images)
- [Resolvers](#resolvers)
- [Graph queries](#graph-queries)
- [Prompt bundles](#prompt-bundles)
- [Seed](#seed)
- [Health](#health)

---

# Personas

The core entity. Every other table revolves around personas.

### Schema

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `name` | text | Required, displayed everywhere |
| `age` | integer | Nullable |
| `gender` | text | Free text |
| `status` | text | `active` (default) \| `draft` \| `retired` |
| `ethnicity` | text | |
| `location` | text | "Los Angeles, CA" |
| `languages` | text[] | |
| `biography` | text | One-paragraph summary |
| `backstory` | text | Long-form origin story |
| `personality` | text | Voice description — drives caption tone |
| `values` | text[] | |
| `niches` | text[] | Content niches |
| `topics` | text[] | Specific topics |
| `style` | text | Visual / editorial style |
| `boundaries` | text | What this persona won't do |
| `managementUrl` | text | Link to Metricool / Later / etc. |
| `managementNotes` | text | |
| `photoId` | UUID | FK to `images.id` — reference photo |
| `heightCm` | integer | Physical attribute |
| `build` | text | "athletic, toned" |
| `hair` | text | Length/color/style |
| `eyeColor` | text | |
| `skin` | text | Tone + undertones |
| `distinguishingMarks` | text | Tattoos, piercings, scars |
| `occupation` | text | **(new)** "Full-time fitness content creator" |
| `affiliation` | text | **(new)** Institution / employer / brand affiliation |
| `calendarContext` | text | **(new)** Multi-line free text describing daily/weekly/yearly rhythm |
| `soulId` | text | **(new)** Higgsfield Soul ID for character-consistent generation |
| `personaGenerationNotes` | text | **(new)** Accumulated feedback for the generator (hair quirks, palette, etc.) |
| `sample` | boolean | True for seed personas — used by the in-app hint bar |
| `createdAt` / `updatedAt` | timestamp | Epoch ms in JSON |

Each persona payload also includes:
- `socials` — array of social account objects
- `gallery` — array of image library entries (per-image prompt + model + post time)
- `relationships` — summary array of 1-hop relationships (added by `GET /api/personas/:idOrHandle`)
- `families` — array of family memberships

### Endpoints

#### `GET /api/personas`

List all personas. No filters; returns the complete dataset (small). Each persona is the full record.

```bash
curl http://localhost:8080/api/personas
```

#### `GET /api/personas/:idOrHandle`

Resolve and return one persona. Includes `socials`, `gallery`, `relationships` summary, and `families`.

```bash
curl http://localhost:8080/api/personas/@maya.moves
curl http://localhost:8080/api/personas/Maya
curl 'http://localhost:8080/api/personas/664d4aae-6535-4364-963a-08c6e9ec0488'
```

Returns **409** if the identifier matches multiple personas:

```json
{
  "error": "ambiguous",
  "ambiguous": [
    { "id": "...", "name": "Maya Rivera", "handles": ["Instagram: @maya.moves", "TikTok: @mayamoves"] },
    { "id": "...", "name": "Maya Williams", "handles": [] }
  ]
}
```

#### `POST /api/personas`

Create a new persona. The body must include `id`, `name`, and ideally most other fields.

```bash
curl -X POST http://localhost:8080/api/personas \
  -H "Content-Type: application/json" \
  -d '{
    "id": "...uuid...",
    "name": "New Persona",
    "age": 22,
    "status": "draft",
    "socials": [],
    "gallery": []
  }'
```

#### `PUT /api/personas/:idOrHandle`

Idempotent upsert. If the identifier exists, the record is replaced; otherwise a new record is inserted at the given UUID. `socials` and `gallery` are replaced as a whole (not patched).

#### `DELETE /api/personas/:idOrHandle`

Cascades to `socials`, `gallery`, `relationships`, `family_members`, and `planned_posts` referencing this persona.

---

# Socials and credentials

Embedded in persona payloads under `socials`:

```json
{
  "id": "uuid",
  "platform": "Instagram",
  "handle": "@maya.moves",
  "url": "https://instagram.com/maya.moves",
  "email": "maya.moves.ig@example.com",
  "password": "...",
  "notes": "Primary channel"
}
```

Replaced wholesale on `PUT /api/personas/:idOrHandle`. No standalone endpoint.

> ⚠ Passwords are stored in **plain text** — same trade-off as the original prototype. Do not expose without auth.

---

# Persona image library

Embedded in persona payloads under `gallery`:

```json
{
  "id": "uuid",
  "imageId": "uuid",
  "prompt": "candid photo of a 24yo latina fitness influencer mid-stretch...",
  "model": "Midjourney v6.1",
  "postTime": "2026-05-28T08:30"
}
```

Replaced wholesale on `PUT /api/personas/:idOrHandle`.

---

# Families

### Schema

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `name` | text | |
| `handle` | text | Slug. Auto-generated from name on create, editable later. Unique. |
| `lore` | text | Family's shared narrative |
| `photoId` | UUID | Cover photo |
| `location` | text | |
| `established` | text | Free text — "1958", "Spring 2018" |
| `createdAt` / `updatedAt` | timestamp | |

Each family payload includes:
- `members` (in single-family GET) — array of `{ id, familyId, personaId, role, generation, parentMemberIds, position, persona: { id, name, photoId } }`
- `memberCount` (in list GET)

### Endpoints

#### `GET /api/families`

List all families (with member counts, without member arrays).

#### `GET /api/families/:idOrHandle`

Full family record including hydrated `members`.

```bash
curl http://localhost:8080/api/families/the-riveras
```

#### `POST /api/families`

Create. If `handle` is omitted, it's auto-generated from `name`. Returns **409** if the requested handle conflicts.

```bash
curl -X POST http://localhost:8080/api/families \
  -H "Content-Type: application/json" \
  -d '{ "id": "...", "name": "The Riveras", "lore": "...", "location": "LA" }'
```

#### `PUT /api/families/:idOrHandle`

Idempotent upsert (with handle collision check).

#### `DELETE /api/families/:idOrHandle`

Cascades to `family_members`. Relationships keep their `family_id` (set to null).

---

# Family members

Embedded under family payloads. Standalone CRUD via:

#### `POST /api/families/:idOrHandle/members`

Add a persona to a family with a role and generation. `personaId` may be a UUID, a handle, or a name.

```bash
curl -X POST http://localhost:8080/api/families/the-riveras/members \
  -H "Content-Type: application/json" \
  -d '{
    "personaId": "@maya.moves",
    "role": "daughter",
    "generation": 3,
    "parentMemberIds": ["<elena-member-id>"]
  }'
```

The `parentMemberIds` must reference members of the same family. Max 2 parents.

#### `PUT /api/families/:idOrHandle/members/:memberId`

Update role, generation, parent links, or horizontal position.

#### `DELETE /api/families/:idOrHandle/members/:memberId`

Removes one persona from the family without deleting the persona.

---

# Relationships

Pairwise persona-to-persona links with rich narrative.

### Schema

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `fromPersonaId` / `toPersonaId` | UUID | For symmetric types, the API normalizes to lower-UUID-first. |
| `category` | text | `friendship` \| `family` \| `romantic` \| `professional` \| `other` |
| `type` | text | One of 44 types — see `web/rel-types.js` |
| `customLabel` | text | Used when `type='custom'` |
| `isDirectional` | boolean | Drives the flip behavior on the inverse side |
| `cadence` | text | `daily` \| `weekly` \| `monthly` \| `rarely` \| `never` |
| `since` | text | Free text — "Birth", "2018", "After their fight" |
| `status` | text | `active_close` \| `active_complicated` \| `drifted` \| `estranged` \| `ended` |
| `familyId` | UUID | Optional — anchors the relationship to a family |
| `origin` / `dynamic` / `bondingMoments` / `tensions` / `mutualInfluence` / `insideJokes` / `currentArc` / `contentSeeds` | text | Narrative blocks |
| `images` | array | Photos together (joined separately) |
| `createdAt` / `updatedAt` | timestamp | |

### Endpoints

#### `GET /api/relationships`

Filters via query params:

| Param | Purpose |
|---|---|
| `persona_id` | UUID of a persona involved on either side |
| `family_id` | UUID — relationships tagged to this family |
| `category` | Filter to one category |
| `status` | Filter by status |

```bash
curl 'http://localhost:8080/api/relationships?persona_id=<maya-uuid>&status=active_close'
```

#### `GET /api/relationships/:id`

Full record including both personas' summaries and any `relationship_images`.

#### `POST /api/relationships`

Create. Returns **409** with `existingId` if a duplicate already exists (symmetric normalization is applied first, so re-creating "Maya ↔ Lina sister" from either side hits the same dedupe).

#### `PUT /api/relationships/:id`

Replace by primary key. Symmetric normalization is also applied; `from_persona_id` will be the lower UUID after save.

#### `DELETE /api/relationships/:id`

Cascades to `relationship_images`.

---

# Relationship photos

#### `POST /api/relationships/:id/images`

Multipart form upload — `file` field plus optional `caption` and `taken`:

```bash
curl -X POST http://localhost:8080/api/relationships/<rel-id>/images \
  -F "file=@photo.jpg" \
  -F "caption=PCH road trip" \
  -F "taken=Summer 2020"
```

Returns `{ id, imageId, caption, taken, position }`. Images are auto-positioned at the end of the existing gallery.

#### `DELETE /api/relationships/:id/images/:imageId`

Removes one photo from the relationship's gallery.

---

# Storyline arcs

*New in Phase 11c.* Date-bounded narrative windows that drive content planning. One arc can span multiple personas (e.g. a vacation with a co-star).

### Schema

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `title` | text | Required — "Maya — Bali Trip with Sofia" |
| `theme` | text | One-line theme |
| `startsOn` | date | `YYYY-MM-DD` |
| `endsOn` | date | `YYYY-MM-DD`; must be ≥ `startsOn` |
| `status` | text | `planning` (default) \| `active` \| `past` \| `archived` |
| `location` | text | |
| `mood` | text | "warm, candid, golden hour" |
| `continuityNotes` | text | Outfit/look/location continuity rules |
| `notes` | text | |
| `createdAt` / `updatedAt` | timestamp | |

`GET` responses include:
- `personas` — array of `{ id, name, photoId, occupation, role, handles[] }` where `role` is `lead` | `co-star` | `cameo`
- `plannedPosts` — array of all posts on this arc, ordered by `positionInArc` then `scheduledAt` (only in single-arc GET)
- `personaCount` and `postCount` (only in list GET)

### Endpoints

#### `GET /api/arcs`

Filters:

| Param | Purpose |
|---|---|
| `persona` | Handle/name/UUID — arcs that include this persona |
| `persona_id` | Same as `persona` but UUID-only (skips resolver) |
| `status` | Filter by status |
| `from` | `YYYY-MM-DD` — arcs that end on/after |
| `to` | `YYYY-MM-DD` — arcs that start on/before |

```bash
curl 'http://localhost:8080/api/arcs?persona=@maya.moves&status=active'
```

Returns array of arc summaries (no `plannedPosts` to keep payloads small).

#### `GET /api/arcs/:id`

Full arc detail with personas + all planned posts.

#### `POST /api/arcs`

Create an arc with one or more personas.

```bash
curl -X POST http://localhost:8080/api/arcs \
  -H "Content-Type: application/json" \
  -d '{
    "id": "...uuid...",
    "title": "Maya — Bali Trip with Sofia",
    "theme": "sister bonding vacation",
    "startsOn": "2026-08-15",
    "endsOn": "2026-08-22",
    "status": "planning",
    "location": "Bali, Indonesia",
    "mood": "warm, candid, golden hour, salt-in-hair",
    "continuityNotes": "Maya in earth tones throughout; Sofia in cooler colors",
    "personas": [
      { "id": "@maya.moves", "role": "lead" },
      { "id": "@sofia.rivera", "role": "lead" }
    ]
  }'
```

Each persona entry accepts `id` as a handle, name, or UUID. The API resolves it.

#### `PUT /api/arcs/:id`

Replace arc metadata (does NOT modify personas — use the dedicated routes below).

#### `DELETE /api/arcs/:id`

Deletes the arc. Planned posts on the arc keep their data — their `arc_id` is set to `null`.

#### `POST /api/arcs/:id/personas`

Add or upsert a persona on the arc.

```bash
curl -X POST http://localhost:8080/api/arcs/<arc-id>/personas \
  -H "Content-Type: application/json" \
  -d '{ "personaId": "@aiko.daily", "role": "cameo" }'
```

#### `DELETE /api/arcs/:id/personas/:personaId`

Remove one persona from the arc.

---

# Planned posts

*New in Phase 11c.* Individual planned Instagram posts (feed + stories), each tied to a persona and (usually) an arc. Status moves through a clear state machine: `planned → approved → generating → generated → accepted → pushed → posted`, or → `rejected`.

### Schema

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `arcId` | UUID | Optional — null for standalone posts |
| `personaId` | UUID | Required |
| `platform` | text | Default `instagram` |
| `postType` | text | `ig_feed` \| `ig_story` \| `ig_carousel` |
| `storyType` | text | Production taxonomy: `persona_selfie` \| `persona_mirror` \| `persona_pov` \| `library_landscape_music` \| `library_food` \| `library_object` \| `library_workspace` \| `feed_repost` \| `text_overlay` \| `friend_cameo` |
| `scheduledAt` | timestamp | ISO 8601 UTC |
| `positionInArc` | integer | Ordering hint within an arc |
| `caption` | text | |
| `hashtags` | text[] | |
| `overlayText` | text | For text-overlay stories |
| `generationPrompt` | text | For persona_* types |
| `generationModel` | text | e.g. `nano_banana_2`, `text2image_soul_v2`, `seedream_5_lite` |
| `referenceImageId` | UUID | Optional reference for the generator |
| `libraryAssetId` | UUID | For library_* types |
| `generatedImageId` | UUID | Set by the generator once produced |
| `generationMetadata` | jsonb | Model output, seed, etc. |
| `regenerationFeedback` | text | Used when status moves to `approved` with refinement notes |
| `fleetContentId` / `fleetScheduledPostId` | text | Set on handoff to fleetmanager |
| `status` | text | See state machine above |
| `rejectionReason` | text | For status=`rejected` |
| `notes` | text | |
| `createdAt` / `updatedAt` | timestamp | |

### Endpoints

#### `GET /api/planned-posts`

Filters:

| Param | Purpose |
|---|---|
| `persona` | Handle/name/UUID |
| `persona_id` | UUID only |
| `arc_id` | One arc |
| `status` | Single status or comma-separated list (`planned,approved`) |
| `from` | ISO timestamp — scheduled at or after |
| `to` | ISO timestamp — scheduled before |
| `post_type` | `ig_feed` / `ig_story` / `ig_carousel` |

```bash
curl 'http://localhost:8080/api/planned-posts?persona=@maya.moves&status=planned,approved&from=2026-04-01&to=2026-04-30'
```

#### `GET /api/planned-posts/:id`

One full post.

#### `POST /api/planned-posts`

Create one post. `personaId` accepts a handle/name/UUID. `arcId` and other fields are optional.

```bash
curl -X POST http://localhost:8080/api/planned-posts \
  -H "Content-Type: application/json" \
  -d '{
    "id": "...uuid...",
    "arcId": "<arc-id>",
    "personaId": "@maya.moves",
    "postType": "ig_feed",
    "storyType": "persona_selfie",
    "scheduledAt": "2026-08-17T18:00:00Z",
    "caption": "first full day in. she made it.",
    "hashtags": ["#bali", "#sistertime"],
    "generationModel": "nano_banana_2",
    "generationPrompt": "warm portrait of a 24yo latina fitness creator on a beach at golden hour, linen shirt..."
  }'
```

#### `PUT /api/planned-posts/:id`

Full replace.

#### `PATCH /api/planned-posts/:id/status`

The recommended way to transition status. Accepts optional `rejectionReason`, `regenerationFeedback`, `generatedImageId`, `generationMetadata`.

```bash
curl -X PATCH http://localhost:8080/api/planned-posts/<id>/status \
  -H "Content-Type: application/json" \
  -d '{
    "status": "rejected",
    "rejectionReason": "hair is too messy — should be a tight high ponytail per generation notes"
  }'
```

Valid statuses (enforced server-side): `planned`, `approved`, `generating`, `generated`, `accepted`, `rejected`, `pushed`, `posted`.

#### `DELETE /api/planned-posts/:id`

Removes one post.

#### `POST /api/planned-posts/:id/library`

Attach a library asset and bump its usage counter. Typical for `library_*` story slots.

```bash
curl -X POST http://localhost:8080/api/planned-posts/<post-id>/library \
  -H "Content-Type: application/json" \
  -d '{ "libraryAssetId": "<asset-id>" }'
```

---

# Library assets

*New in Phase 11c.* Reusable stock photos the user generates manually in the Higgsfield web UI (free under Plus's unlimited passes) and uploads here. The planning skill draws from this pool for `library_*` story slots to save credits.

### Schema

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `imageId` | UUID | FK to `images.id` |
| `imageUrl` | string | Convenience — `/api/images/<imageId>` |
| `sceneType` | text | `food` \| `drink` \| `workspace` \| `landscape` \| `street` \| `interior` \| `sky` \| `object` \| ... |
| `mood` | text | `cozy` \| `energetic` \| `minimal` \| `moody` \| `dramatic` \| `soft` |
| `locationHint` | text | `apartment` \| `café` \| `gym` \| `park` \| `beach` \| `street` \| `campus` \| ... |
| `timeOfDay` | text | `morning` \| `midday` \| `golden_hour` \| `night` \| `overcast` |
| `tags` | text[] | Freeform: `laptop_open`, `coffee_with_oat`, `plants_in_frame` |
| `notes` | text | |
| `timesUsed` | integer | Bumped by `POST /api/planned-posts/:id/library` |
| `lastUsedAt` | timestamp | |
| `uploadedAt` | timestamp | |

### Endpoints

#### `GET /api/library`

Filters: `scene_type`, `mood`, `location` (= `location_hint`), `time_of_day`, `tags` (comma-separated; uses array overlap).

```bash
curl 'http://localhost:8080/api/library?scene_type=landscape&time_of_day=golden_hour&tags=palmtrees,la'
```

#### `GET /api/library/:id`

One asset.

#### `POST /api/library`

Multipart form upload. The `file` field is the image; other fields are metadata (snake_case or camelCase accepted).

```bash
curl -X POST http://localhost:8080/api/library \
  -F "file=@sunset.png" \
  -F "scene_type=landscape" \
  -F "mood=warm" \
  -F "location_hint=beach" \
  -F "time_of_day=golden_hour" \
  -F "tags=sunset,palmtrees,la" \
  -F "notes=Venice beach sunset for vacation arcs"
```

#### `PUT /api/library/:id`

Update metadata. Any omitted field is preserved (uses `COALESCE`).

#### `DELETE /api/library/:id`

Cascades to the underlying `images` row.

---

# Images

The raw image-bytes store. Used by personas (reference photos), gallery items, relationship photos, family covers, library assets, and generated planned-post output.

#### `POST /api/images`

Multipart upload. Returns `{ id, mimeType, sizeBytes }`. Max file size is 25 MB.

```bash
curl -X POST http://localhost:8080/api/images -F "file=@photo.jpg"
```

#### `GET /api/images/:id`

Streams the bytes with the original `Content-Type` and a long `Cache-Control: public, max-age=31536000, immutable` header. **404** if missing.

---

# Resolvers

The MCP server uses these to ground free-text persona/family references.

#### `GET /api/resolve/persona/:identifier`

Returns `{ id, name }` on a single match, **404** on no match, **409** on ambiguous with `{ ambiguous: [{ id, name, handles }, ...] }`.

```bash
curl http://localhost:8080/api/resolve/persona/@maya.moves
curl http://localhost:8080/api/resolve/persona/Maya
```

#### `GET /api/resolve/family/:identifier`

Same shape for families. Resolution is UUID then handle (slug) only — families don't have name fuzzy-matching.

---

# Graph queries

For the knowledge-graph frontend and MCP exploration.

#### `GET /api/graph`

The whole graph. Nodes carry their handles inline so a client can resolve a name → ID without a second call.

```json
{
  "nodes": [
    {
      "id": "uuid",
      "name": "Maya Rivera",
      "photoId": null,
      "status": "active",
      "handles": [{ "platform": "Instagram", "handle": "@maya.moves" }, ...],
      "familyIds": ["..."]
    }
  ],
  "edges": [
    {
      "id": "uuid",
      "fromPersonaId": "...",
      "toPersonaId": "...",
      "category": "friendship",
      "type": "close_friend",
      "isDirectional": false,
      "status": "active_close",
      "familyId": null
    }
  ],
  "families": [
    {
      "id": "uuid",
      "name": "The Riveras",
      "handle": "the-riveras",
      "photoId": null,
      "memberIds": ["..."]
    }
  ]
}
```

#### `GET /api/graph/neighborhood/:idOrHandle?depth=N`

N-hop subgraph centered on a persona. `depth` clamps to `[0, 4]`, default 2.

Returns the same shape as `/api/graph` plus a `root` UUID and a per-node `depth` integer.

#### `GET /api/personas/:idOrHandle/neighborhood`

Lightweight materialized-view read — pre-computed JSONB blob containing the persona + relationships + families.

---

# Prompt bundles

For the MCP server and downstream consumers (writing skills, image generation).

#### `GET /api/personas/:idOrHandle/prompt-bundle?samples=N`

LLM-ready JSON document with the full persona context.

Shape:

```json
{
  "persona": {
    "id": "uuid",
    "handle": "@maya.moves",
    "primaryPlatform": "Instagram",
    "name": "Maya Rivera",
    "age": 24,
    "gender": "Female",
    "location": "Los Angeles, CA",
    "ethnicity": "Latina (Mexican-American)",
    "languages": ["English", "Spanish"],
    "status": "active",
    "occupation": "Full-time fitness content creator",
    "affiliation": "Independent — manages her own brand partnerships",
    "calendarContext": "Lives in Los Angeles, PST.\nDaily rhythm: 5:30am wake-up...",
    "soulId": null,
    "personaGenerationNotes": "Hair is almost always pulled back when working out..."
  },
  "story": {
    "biography": "...",
    "backstory": "...",
    "personality": "...",
    "values": ["..."]
  },
  "visual": {
    "referencePhotoUrl": "/api/images/...",
    "style": "Bright, sunlit, candid...",
    "boundaries": "...",
    "physical": {
      "heightCm": 168,
      "build": "athletic, toned",
      "hair": "shoulder-length dark brown...",
      "eyeColor": "warm hazel",
      "skin": "warm olive...",
      "distinguishingMarks": "small heart tattoo..."
    },
    "samplePrompts": [
      { "imageUrl": "/api/images/...", "prompt": "...", "model": "...", "postTime": "..." }
    ]
  },
  "social": {
    "handles": [{ "platform": "Instagram", "handle": "@maya.moves", "url": "..." }],
    "niches": [...],
    "topics": [...]
  },
  "neighborhood": {
    "relationships": [
      {
        "id": "...",
        "category": "friendship",
        "type": "close_friend",
        "asFromSide": true,
        "status": "active_close",
        "familyId": null,
        "familyName": null,
        "other": { "id": "...", "name": "Aiko Tanaka", "photoId": null }
      }
    ],
    "families": [{ "id": "...", "name": "The Riveras", "role": "daughter", "generation": 3 }]
  }
}
```

`samples` controls how many gallery items go into `visual.samplePrompts` (default 10).

#### `GET /api/relationships/:id/prompt-bundle?samples=N`

For pair generation. Returns:

```json
{
  "relationship": {
    "id": "...",
    "category": "friendship",
    "type": "close_friend",
    "isDirectional": false,
    "status": "active_close",
    "cadence": "weekly",
    "since": "2023",
    "familyId": null,
    "narrative": {
      "origin": "...", "dynamic": "...", "bondingMoments": "...",
      "tensions": "...", "mutualInfluence": "...", "insideJokes": "...",
      "currentArc": "...", "contentSeeds": "..."
    }
  },
  "from": { /* persona bundle (summary depth) */ },
  "to":   { /* persona bundle (summary depth) */ },
  "photosTogether": [
    { "imageUrl": "/api/images/...", "caption": "...", "taken": "..." }
  ]
}
```

#### `GET /api/families/:idOrHandle/prompt-bundle?samples=N`

For family shoots:

```json
{
  "family": {
    "id": "...", "handle": "the-riveras", "name": "The Riveras",
    "lore": "...", "location": "...", "established": "...",
    "coverPhotoUrl": "/api/images/..."
  },
  "members": [
    {
      "memberId": "...", "role": "daughter", "generation": 3,
      "parentMemberIds": ["..."], "position": 0,
      "persona": { ... }, "story": { ... }, "visual": { ... }, "social": { ... }
    }
  ],
  "intraRelationships": [
    { "id": "...", "category": "family", "type": "sister", "narrative": { ... } }
  ]
}
```

#### `GET /api/personas/:idOrHandle/family-bundle?family=<handle>&samples=N`

The "give me Maya's family for a family shoot" entry point. Resolves the persona, then:

- If persona is in **1 family**: returns its bundle.
- If persona is in **N > 1 families** and no `family` query param: returns **409** with `families: [...]` candidate list.
- If persona is in **N > 1 families** and `family=<handle>`: returns that one.
- If persona is in **0 families**: **404**.

---

# Seed

#### `POST /api/seed`

Idempotent — loads four sample personas + one sample family (The Riveras) + one sample relationship (Maya ↔ Aiko close_friend) if none with `sample=true` exist. Returns `{ seeded: bool, count, familyId }`.

---

# Fleetmanager handoff

When `FLEET_ENABLED=true` and a planned post transitions to `accepted`, ugc-db
asynchronously pushes the post into fleetmanager. See
[FLEET_HANDOFF.md](./FLEET_HANDOFF.md) for the full flow.

#### `GET /api/fleet/status`

Read-only diagnostic. Returns:

```json
{
  "enabled": true,
  "configured": true,
  "baseUrl": "http://api.fleetmanager:4000",
  "hasToken": true,
  "ready": true
}
```

`ready` is `enabled && configured`. When `ready` is false, no auto-push or
manual push will run.

#### `POST /api/planned-posts/:id/push`

Manually trigger a fleet push (used by the **Retry push** button in Draft
Review and by the `push_to_fleet` MCP tool). Required when an auto-push fails
and the user wants to retry after fixing the underlying issue.

Returns:

```json
{
  "plannedPostId": "<uuid>",
  "fleetContentId": "<id from fleetmanager>",
  "fleetScheduledPostId": "<id>",
  "accountId": "<fleetmanager account id>",
  "accountHandle": "maya.moves"
}
```

On failure, returns 400 with `{ error, code }` where `code` is one of
`ACCOUNT_NOT_FOUND`, `NO_HANDLE`, `MISSING_IMAGE`, `NETWORK`, `HTTP_4xx`,
etc. The error message is also persisted to `planned_posts.last_push_error`.

503 if `FLEET_ENABLED=false` or token/url not configured (response includes
the `fleet_config_summary`).

#### planned_posts payload additions

The `planned_posts` REST payload now includes:

| Field | Type | Notes |
|---|---|---|
| `fleetContentId` | string \| null | Content id in fleetmanager (after push) |
| `fleetScheduledPostId` | string \| null | Scheduled-post id in fleetmanager |
| `lastPushError` | string \| null | Last error message from a push attempt; cleared on success or status change away from `accepted`/`pushed` |
| `pushedAt` | ISO 8601 \| null | When the post was successfully pushed |

---

# Health

#### `GET /api/health`

`{ "ok": true }` — used by Cloudflare Tunnel and Docker healthchecks.

---

## A note on the auto-refresh of `persona_neighborhood`

After every mutation that affects relationships, families, family members, or personas, the API calls `SELECT refresh_persona_neighborhood()` (concurrent refresh). This keeps the lightweight `/api/personas/:idOrHandle/neighborhood` endpoint consistent. Refresh is best-effort — failures are logged but don't fail the originating mutation.

## Error responses

All error responses use:

```json
{ "error": "human-readable message" }
```

For 409s with multiple candidates:

```json
{
  "error": "ambiguous",
  "ambiguous": [
    { "id": "uuid", "name": "...", "handles": ["Instagram: @...", "TikTok: @..."] }
  ]
}
```

For relationship duplicate detection:

```json
{ "error": "relationship already exists", "existingId": "uuid" }
```

For family handle collision:

```json
{ "error": "handle already in use", "existingId": "uuid" }
```
