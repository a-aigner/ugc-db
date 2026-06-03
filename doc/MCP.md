# MCP Server Reference

The MCP service exposes the UGC Creator Database as a set of LLM-callable tools over the Model Context Protocol. Add it as a connector in Claude (web / desktop / code) and your skills can pull persona context, plan content, and orchestrate workflows.

## Server identity

- **Name:** `ugc-creator-db`
- **Version:** `1.0.0`
- **Endpoint:** `POST /mcp` over streamable HTTP
- **Local URL:** `http://localhost:3100/mcp`
- **Public URL (via Cloudflare Tunnel):** `https://mcp.<your-domain>/mcp`

The service also exposes:

- `GET /health` — `{ ok, name, tools, authRequired }`. Unauthenticated, useful for tunnel and probe checks.
- `GET /` — plain-text capability summary.

## Authentication

The MCP server uses a single shared **bearer token** read from the `MCP_TOKEN` environment variable.

- If `MCP_TOKEN` is **empty**, the server runs in open mode (LAN trust). Suitable for local dev only.
- If `MCP_TOKEN` is **set**, every request must include `Authorization: Bearer <token>`. Requests without it or with the wrong token return **401**.

To rotate: change `MCP_TOKEN` in `.env`, then `docker compose up -d mcp`. Old tokens are immediately invalidated.

To generate a strong one: `openssl rand -hex 32`.

## Setting it up in Claude

### Claude.ai (web / desktop)

1. Settings → Connectors → Add custom connector.
2. URL: `https://mcp.<your-domain>/mcp`
3. Auth: `Authorization: Bearer <your token>`
4. The 21 tools should appear in the next conversation.

### Claude Code

```bash
claude mcp add --transport http --scope user ugc-creator-db https://mcp.<your-domain>/mcp \
  --header "Authorization: Bearer <your token>"
```

### Local-only quick test

The server speaks plain JSON-RPC over POST:

```bash
curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Architecture

Each tool is a thin wrapper around one or more `/api/*` REST endpoints. The MCP server itself stores no data — it's purely a tool layer.

```
                                ┌──────────────┐
   Claude  ─── MCP protocol ───►│  mcp service │──── HTTP ────► api service ──► Postgres
                                │   :3100      │                :3000
                                │              │
                                │ Tool layer:  │
                                │ 21 tools     │
                                │ Bearer auth  │
                                └──────────────┘
```

The MCP service runs in the same docker-compose stack and reaches the API container as `http://api:3000` via the internal Docker network.

## Tools at a glance

Twenty-one tools across five families:

| Family | Tools |
|---|---|
| Browse | `list_personas`, `list_families`, `search` |
| Resolve | `resolve` |
| Bundles | `get_persona`, `get_pair`, `get_family`, `get_family_of_persona` |
| Graph | `get_neighborhood`, `get_relationship_between` |
| Planning | `list_arcs`, `get_arc`, `create_arc`, `update_arc`, `delete_arc`, `list_planned_posts`, `create_planned_post`, `update_planned_post`, `set_post_status`, `list_library`, `assign_library_to_post` |

Each section below covers a single tool with its **purpose**, **input schema**, **output shape**, and **example usage** (both the LLM-facing call and a raw JSON-RPC body for testing).

---

# Browse

## `list_personas`

**Purpose.** Get a compact directory of every persona — name, primary handle, status, niches, family memberships. Use as a starting point when you don't already know specific names.

**Input.** None.

**Output.** A text content item containing:

```json
{
  "count": 4,
  "personas": [
    {
      "id": "uuid",
      "name": "Maya Rivera",
      "handle": "@maya.moves",
      "primaryPlatform": "Instagram",
      "status": "active",
      "age": 24,
      "location": "Los Angeles, CA",
      "niches": ["Fitness", "Wellness", "Activewear"],
      "families": [{ "id": "...", "name": "The Riveras", "role": "daughter" }]
    }
  ]
}
```

**Example.** *"List my personas and pick one whose niche includes fitness."*

---

## `list_families`

**Purpose.** Compact directory of every family — name, handle, location, member count, lore preview (first 160 chars).

**Input.** None.

**Output.**

```json
{
  "count": 1,
  "families": [
    {
      "id": "uuid",
      "name": "The Riveras",
      "handle": "the-riveras",
      "location": "Los Angeles, CA",
      "established": "1958",
      "memberCount": 1,
      "lorePreview": "Elena moved from Mexico City to LA at 19..."
    }
  ]
}
```

---

## `search`

**Purpose.** Free-text search across persona bios / backstories / styles / niches / topics / social handles, and family lore. Returns matching personas and families.

**Input.**

| Field | Type | Required | Notes |
|---|---|---|---|
| `query` | string | yes | Case-insensitive substring |

**Output.**

```json
{
  "query": "fitness",
  "personas": [/* full persona cards */],
  "families": [/* compact family cards */]
}
```

**Example.** *"Search for 'recovery' and tell me which personas it surfaces."*

---

# Resolve

## `resolve`

**Purpose.** Resolve a free-text identifier (name, social handle like `@maya.moves`, family slug like `the-riveras`, or a UUID) into a canonical persona or family record.

**Input.**

| Field | Type | Required | Notes |
|---|---|---|---|
| `identifier` | string | yes | Anything user-supplied |

**Output.** One of:

```json
{ "kind": "persona", "id": "...", "name": "Maya Rivera" }
```

```json
{ "kind": "family", "id": "...", "name": "The Riveras", "handle": "the-riveras" }
```

```json
{ "kind": "ambiguous", "ambiguous": [{ "id": "...", "name": "...", "handles": [...] }] }
```

```json
{ "kind": "not_found", "identifier": "..." }
```

Returns `isError: true` on `not_found`.

**Example.** *"The user just typed 'Maya' — disambiguate before I do anything."*

---

# Bundles

## `get_persona`

**Purpose.** **The workhorse for solo content.** Returns the full persona prompt-bundle: identity, age, **occupation, affiliation, calendar context** (planning-aware), story (bio/backstory/personality/values), visual (reference photo + style + **physical descriptors** + sampled image prompts + **persona generation notes**), social (handles + niches + topics), and the 1-hop neighborhood (relationships + family memberships). The reference photo is included as a base64 image content item by default.

**Input.**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `identifier` | string | yes | — | Persona name, handle, or UUID |
| `samples` | integer | no | 10 | Number of image prompts to sample (0–30) |
| `inline_images` | boolean | no | false | If true, also embed every sample-prompt image as base64 |

**Output.** Two content items:

1. **text** — JSON document with shape:

```json
{
  "persona": {
    "id", "handle", "primaryPlatform", "name", "age", "gender",
    "location", "ethnicity", "languages", "status",
    "occupation", "affiliation", "calendarContext", "soulId",
    "personaGenerationNotes"
  },
  "story": { "biography", "backstory", "personality", "values": [...] },
  "visual": {
    "referencePhotoUrl",
    "style",
    "boundaries",
    "physical": {
      "heightCm", "build", "hair", "eyeColor", "skin", "distinguishingMarks"
    },
    "samplePrompts": [
      { "imageUrl", "prompt", "model", "postTime" }
    ]
  },
  "social": { "handles": [...], "niches": [...], "topics": [...] },
  "neighborhood": {
    "relationships": [...],
    "families": [...]
  }
}
```

2. **image** — the reference photo as base64, with proper `mimeType`.

If `inline_images=true`, additional **image** content items follow — one per sample prompt.

**Example.** *"Get the prompt bundle for @maya.moves and plan a feed post for tomorrow morning that fits her voice and Saturday content batch rhythm."*

---

## `get_pair`

**Purpose.** **For pair content** — Maya + Sofia having coffee, Maya + Aiko on a video call. Returns both personas' summaries (lighter — no neighborhood) + the full relationship narrative (origin, dynamic, bonding moments, tensions, mutual influence, inside jokes, current arc, content seeds) + any photos-together. Both reference photos are embedded as base64.

**Input.**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `a` | string | yes | — | First persona name or handle |
| `b` | string | yes | — | Second persona name or handle |
| `samples` | integer | no | 5 | Image prompt samples per persona |
| `inline_images` | boolean | no | false | Embed photos-together as base64 |

**Output.** Text content with:

```json
{
  "relationship": {
    "id", "category", "type", "customLabel", "isDirectional",
    "status", "cadence", "since", "familyId",
    "narrative": {
      "origin", "dynamic", "bondingMoments", "tensions",
      "mutualInfluence", "insideJokes", "currentArc", "contentSeeds"
    }
  },
  "from": {
    "persona", "story", "visual", "social"   /* summary depth */
  },
  "to": { ... },
  "photosTogether": [
    { "imageUrl", "caption", "taken" }
  ]
}
```

Plus image content items for both reference photos.

Returns `isError: true` with `"error": "no relationship recorded between these personas"` if there's no edge.

**Example.** *"Generate a story of @maya.moves with @aiko.daily at karaoke that lands in Maya's tone and respects their inside jokes."*

---

## `get_family`

**Purpose.** **For family-shoot content** — full family scene plans. Returns family meta (name, handle, lore, location, established) + cover photo + each member's summary bundle (with role + generation + parent links) + intra-family relationships with their narratives. Each member's reference photo is embedded as base64.

**Input.**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `identifier` | string | yes | — | Family name, handle, or UUID |
| `samples` | integer | no | 5 | Per-member sample count |
| `inline_images` | boolean | no | false | Embed every sample-prompt image |

**Output.**

```json
{
  "family": { "id", "handle", "name", "lore", "location", "established", "coverPhotoUrl" },
  "members": [
    {
      "memberId", "role", "generation", "parentMemberIds", "position",
      "persona", "story", "visual", "social"
    }
  ],
  "intraRelationships": [
    { "id", "fromPersonaId", "toPersonaId", "category", "type", "status", "narrative" }
  ]
}
```

Plus image content items for each member's reference photo and the cover.

**Example.** *"Plan a Sunday dinner photo at Abuela Rosa's — get me The Riveras and brief each member."*

---

## `get_family_of_persona`

**Purpose.** **The "use the persona handle as the entry point" tool.** Sometimes you only know the persona, not the family. Pass `@maya.moves` and get back The Riveras' full bundle.

**Input.**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `persona` | string | yes | — | Persona name or handle |
| `family` | string | no | — | Family handle/UUID — required if persona is in multiple families |
| `samples` | integer | no | 5 | |
| `inline_images` | boolean | no | false | |

**Output.** Same as `get_family`.

**Disambiguation.** If the persona is in **multiple families** and no `family` is provided, returns `isError: true` with:

```json
{
  "error": "persona belongs to multiple families; call again with `family: \"<handle>\"`",
  "families": [{ "id", "name", "handle" }, ...]
}
```

If the persona is in **no family**, returns `isError: true` with `"error": "persona is not in any family"`.

**Example.** *"Get the family of @maya.moves and plan a family-shoot arc for Thanksgiving."*

---

# Graph

## `get_neighborhood`

**Purpose.** Return a lightweight subgraph reachable within N hops from a persona — for "who else might fit this storyline" exploration. Nodes carry only id/name/photoId/depth; edges carry category+type+status.

**Input.**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `persona` | string | yes | — | Name or handle |
| `depth` | integer | no | 2 | Max hops (0–4) |

**Output.**

```json
{
  "root": "uuid",
  "depth": 2,
  "nodes": [{ "id", "name", "photoId", "status", "depth": 0 }, ...],
  "edges": [{ "id", "fromPersonaId", "toPersonaId", "category", "type", "isDirectional", "status", "familyId" }],
  "families": [{ "id", "name", "handle", "memberIds": [...] }]
}
```

**Example.** *"Show me everyone within 2 hops of @maya.moves so I know which cameos are realistic for her Bali arc."*

---

## `get_relationship_between`

**Purpose.** A lighter-than-`get_pair` existence check. Use this first if you don't yet need the full narrative — saves payload and base64 image bytes.

**Input.**

| Field | Type | Required | Notes |
|---|---|---|---|
| `a` | string | yes | First persona |
| `b` | string | yes | Second persona |

**Output.**

```json
{ "exists": true, "relationship": { "id", "type", "category", "status", ... } }
```

or

```json
{ "exists": false }
```

---

# Planning

These tools manage the **storyline arcs + planned posts + library assets** pipeline that the content-planning skill orchestrates.

## `list_arcs`

**Purpose.** List storyline arcs. Without filters, returns all arcs newest first.

**Input.**

| Field | Type | Required | Notes |
|---|---|---|---|
| `persona` | string | no | Filter to arcs that include this persona |
| `status` | string | no | `planning` \| `active` \| `past` \| `archived` |
| `from` | string | no | `YYYY-MM-DD` — arcs that end on/after |
| `to` | string | no | `YYYY-MM-DD` — arcs that start on/before |

**Output.**

```json
{
  "count": 2,
  "arcs": [
    {
      "id", "title", "theme",
      "startsOn", "endsOn", "status",
      "location", "mood", "continuityNotes", "notes",
      "personaCount", "postCount",
      "createdAt", "updatedAt"
    }
  ]
}
```

Each arc summary excludes the `personas` array and the `plannedPosts` array — use `get_arc` for those.

**Example.** *"List all of Maya's planned and active arcs — I want to make sure I don't double-book."*

---

## `get_arc`

**Purpose.** Full arc detail with personas + every planned post in scheduled order.

**Input.**

| Field | Type | Required | Notes |
|---|---|---|---|
| `arc_id` | string | yes | Arc UUID |

**Output.** Arc record including:

```json
{
  "id", "title", "theme", "startsOn", "endsOn", "status",
  "location", "mood", "continuityNotes", "notes",
  "personas": [
    { "id", "name", "photoId", "occupation", "role", "handles": [...] }
  ],
  "plannedPosts": [
    { /* full planned-post record, see list_planned_posts */ }
  ]
}
```

---

## `create_arc`

**Purpose.** Create a new storyline arc spanning 1..N personas.

**Input.**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | no | Auto-generated UUID if omitted |
| `title` | string | yes | |
| `theme` | string | no | One-line theme |
| `starts_on` | string | yes | `YYYY-MM-DD` |
| `ends_on` | string | yes | `YYYY-MM-DD`; must be ≥ `starts_on` |
| `status` | string | no | Defaults to `planning` |
| `location` | string | no | |
| `mood` | string | no | "warm, candid, golden hour" |
| `continuity_notes` | string | no | Outfit / location / look continuity |
| `notes` | string | no | |
| `personas` | array | yes | Each item is either a handle string or `{ handle, role }` |

Persona entries:
- `"@maya.moves"` → resolved as `{ handle: "@maya.moves", role: "lead" }`
- `{ "handle": "@aiko.daily", "role": "cameo" }` → kept as-is
- `{ "id": "<uuid>", "role": "co-star" }` → ID also OK

Roles: `lead` (drives the arc), `co-star` (equal weight), `cameo` (single-scene appearance).

**Output.** The full arc record (same shape as `get_arc`).

**Example.**

```jsonc
// MCP call body
{
  "name": "create_arc",
  "arguments": {
    "title": "Maya — Bali Trip with Sofia",
    "theme": "sister bonding vacation",
    "starts_on": "2026-08-15",
    "ends_on": "2026-08-22",
    "location": "Bali",
    "mood": "warm, candid, golden hour, salt-in-hair",
    "continuity_notes": "Maya in earth tones; Sofia in cooler colors",
    "personas": [
      { "handle": "@maya.moves", "role": "lead" },
      { "handle": "@sofia.rivera", "role": "lead" }
    ]
  }
}
```

---

## `update_arc`

**Purpose.** Patch fields on an existing arc. Only provided fields are changed.

**Input.**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | |
| `title`, `theme`, `starts_on`, `ends_on`, `status`, `location`, `mood`, `continuity_notes`, `notes` | string | no | All optional patches |

**Output.** The updated arc.

**Example.** *"The Bali trip got extended — push ends_on to 2026-08-25 and update mood to 'extended-stay, hammock-ridden'."*

---

## `delete_arc`

**Purpose.** Delete an arc. Planned posts on the arc are NOT deleted — their `arc_id` is set to `null`.

**Input.**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | |

**Output.** `{ "ok": true }`.

---

## `list_planned_posts`

**Purpose.** **Always call this before planning new content** so you don't double-book a slot. Filter by persona, arc, status, date window, or post type.

**Input.**

| Field | Type | Required | Notes |
|---|---|---|---|
| `persona` | string | no | Handle/name |
| `arc_id` | string | no | One arc |
| `status` | string | no | Single value or comma-separated (`planned,approved,generated`) |
| `from` | string | no | ISO timestamp — scheduled at or after |
| `to` | string | no | ISO timestamp — scheduled before |
| `post_type` | string | no | `ig_feed` \| `ig_story` \| `ig_carousel` |

**Output.**

```json
{
  "count": 23,
  "posts": [
    {
      "id", "arcId", "personaId",
      "platform", "postType", "storyType",
      "scheduledAt", "positionInArc",
      "caption", "hashtags": [...], "overlayText",
      "generationPrompt", "generationModel",
      "referenceImageId", "libraryAssetId", "generatedImageId",
      "generationMetadata", "regenerationFeedback",
      "fleetContentId", "fleetScheduledPostId",
      "status", "rejectionReason", "notes",
      "createdAt", "updatedAt"
    }
  ]
}
```

**Example.** *"Before planning Maya's week of April 6–12, list her existing planned posts in that window."*

---

## `create_planned_post`

**Purpose.** Create one planned post. Used heavily by the planner skill — it'll call this dozens of times to populate an arc.

**Input.**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | no | Auto-generated UUID if omitted |
| `arc_id` | string | no | Standalone post if omitted |
| `persona` | string | **yes** | Handle/name/UUID |
| `platform` | string | no | Defaults to `instagram` |
| `post_type` | string | **yes** | `ig_feed` \| `ig_story` \| `ig_carousel` |
| `story_type` | string | no | Production taxonomy — see below |
| `scheduled_at` | string | no | ISO timestamp |
| `position_in_arc` | integer | no | Ordering hint |
| `caption` | string | no | |
| `hashtags` | array | no | |
| `overlay_text` | string | no | For text-overlay stories |
| `generation_prompt` | string | no | For `persona_*` types |
| `generation_model` | string | no | CLI model id. **Leave blank for the smart default**: if the persona has a Soul ID, the worker auto-picks `text2image_soul_v2` (cheapest — 5000/mo Soul pool on Plus); otherwise `nano_banana_2`. Override explicitly when you need scene-fidelity multi-references (set to `nano_banana_2` and let the planner pass 2-3 reference images via gallery items). Full catalog: [Higgsfield MODELS.md](https://github.com/higgsfield-ai/cli/blob/main/MODELS.md). |
| `reference_image_id` | string | no | Optional reference for the generator |
| `library_asset_id` | string | no | For `library_*` types (or use `assign_library_to_post` later) |
| `notes` | string | no | |
| `status` | string | no | Defaults to `planned` |

### Story-type taxonomy

| `story_type` | Production path | Generation cost |
|---|---|---|
| `persona_selfie` | CLI: `nano_banana_2` or `text2image_soul_v2` (+ Soul ID) + persona reference photo | Credits |
| `persona_mirror` | CLI: `nano_banana_2` or `text2image_soul_v2` (full body) + persona reference photo | Credits |
| `persona_pov` | CLI: `nano_banana_2` or `text2image_soul_v2` (over-shoulder/hands) | Credits |
| `library_landscape_music` | Library asset + music sticker | Free |
| `library_food` | Library asset | Free |
| `library_object` | Library asset | Free |
| `library_workspace` | Library asset | Free |
| `feed_repost` | Reuses a generated feed image | Free |
| `text_overlay` | Plain background + `overlay_text` | Free |
| `friend_cameo` | Other persona's image / reshare | Mixed |

**Output.** The full planned-post record.

**Example.**

```jsonc
{
  "name": "create_planned_post",
  "arguments": {
    "arc_id": "<arc-id>",
    "persona": "@maya.moves",
    "post_type": "ig_feed",
    "story_type": "persona_selfie",
    "scheduled_at": "2026-08-17T18:00:00Z",
    "position_in_arc": 12,
    "caption": "first full day in. she made it.",
    "hashtags": ["#bali", "#sistertime", "#movewithmaya"],
    "generation_model": "nano_banana_2",
    "generation_prompt": "warm portrait of a 24yo latina fitness creator on a beach at golden hour, linen shirt over a swimsuit, salty hair, candid laugh, soft natural light"
  }
}
```

---

## `update_planned_post`

**Purpose.** Patch fields on an existing planned post. For status changes prefer `set_post_status` — it handles reasons and feedback cleanly.

**Input.** Same field set as `create_planned_post`, plus required `id`. Only provided fields change.

---

## `set_post_status`

**Purpose.** **Drive the state machine.** Every transition (approve / reject / mark generated / accept / push / regenerate) goes through this tool.

The state machine:

```
planned → approved → generating → generated → accepted → pushed → posted
   │           │                       │           │
   ▼           ▼                       ▼           ▼
rejected  rejected                rejected   (terminal)
                                                  
              ↻ regeneration: approved with feedback re-queues for the generator
```

**Input.**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | |
| `status` | string | yes | Target status |
| `reason` | string | no | For `status=rejected` — stored as `rejectionReason` |
| `feedback` | string | no | For regeneration — stored as `regenerationFeedback`. Typical use: set `status=approved` with `feedback="hair is too messy — should be high ponytail"` and the generator re-runs with that hint appended to the prompt. |

**Output.** The updated planned-post record.

**Examples.**

```jsonc
// Approve a plan after user reviewed the markdown plan in chat
{ "name": "set_post_status",
  "arguments": { "id": "<post-id>", "status": "approved" } }

// User rejected the generated image
{ "name": "set_post_status",
  "arguments": {
    "id": "<post-id>",
    "status": "rejected",
    "reason": "smile feels forced, generate without forcing eye contact"
  } }

// User wants a refined regeneration
{ "name": "set_post_status",
  "arguments": {
    "id": "<post-id>",
    "status": "approved",
    "feedback": "redo with hair in a tight high ponytail per generation notes"
  } }
```

---

## `list_library`

**Purpose.** Find candidate stock photos for a `library_*` story slot. The library is the user's pre-uploaded pool of reusable content (food, sunsets, workspaces, etc.).

**Input.**

| Field | Type | Required | Notes |
|---|---|---|---|
| `scene_type` | string | no | `food` \| `drink` \| `workspace` \| `landscape` \| `street` \| `interior` \| `sky` \| `object` |
| `mood` | string | no | `cozy` \| `energetic` \| `minimal` \| `moody` \| `dramatic` \| `soft` |
| `location` | string | no | `apartment` \| `café` \| `gym` \| `park` \| `beach` \| `street` \| `campus` |
| `time_of_day` | string | no | `morning` \| `midday` \| `golden_hour` \| `night` \| `overcast` |
| `tags` | string or array | no | Comma-separated or array — uses array overlap |

**Output.**

```json
{
  "count": 3,
  "assets": [
    {
      "id", "imageId", "imageUrl",
      "sceneType", "mood", "locationHint", "timeOfDay",
      "tags": [...], "notes",
      "timesUsed", "lastUsedAt", "uploadedAt"
    }
  ]
}
```

**Example.** *"For Maya's morning workspace story, find a library asset that's scene_type='workspace', location='apartment', mood='cozy'."*

---

## `assign_library_to_post`

**Purpose.** Attach a library asset to a planned post — typically right after picking one with `list_library`. Bumps the asset's `timesUsed` counter and `lastUsedAt`.

**Input.**

| Field | Type | Required | Notes |
|---|---|---|---|
| `planned_post_id` | string | yes | |
| `library_asset_id` | string | yes | |

**Output.** The updated planned-post record.

---

# Error responses

Every tool may return `isError: true` with a JSON error payload in its text content:

```json
{
  "content": [{ "type": "text", "text": "{\"error\": \"...\"}" }],
  "isError": true
}
```

Common errors:

| Tool | Error | Cause |
|---|---|---|
| `resolve` / any `get_*` | `not_found` / 404 | Identifier didn't match |
| `resolve` / `get_persona` | `ambiguous` / 409 | Identifier matched multiple personas; check the `ambiguous` array |
| `get_family_of_persona` | `persona belongs to multiple families` | Pass `family: "<handle>"` to disambiguate |
| `get_pair` / `get_relationship_between` | `no relationship recorded between these personas` | Build the relationship first via the web UI |
| `set_post_status` | `status must be one of ...` | Invalid status value |
| Tools that take an identifier | upstream 500 | Usually a validation issue in the underlying REST API |

Errors don't crash the MCP server — the tool just reports back and the LLM can decide how to recover.

---

# Recipes

## Plan a vacation arc for Maya

```pseudo
1. neighborhood = get_neighborhood({ persona: "@maya.moves", depth: 1 })
2. maya = get_persona({ identifier: "@maya.moves" })
   → respect maya.persona.calendarContext when picking dates
3. existing = list_planned_posts({ persona: "@maya.moves",
                                   from: "2026-08-01", to: "2026-08-31" })
   → don't overlap
4. arc = create_arc({
     title: "...",
     starts_on: "2026-08-15", ends_on: "2026-08-22",
     personas: [{ handle: "@maya.moves", role: "lead" }],
     mood: "...", continuity_notes: "..."
   })
5. For each post in the plan:
   - If persona_*: create_planned_post with generation_prompt + generation_model
   - If library_*: list_library({ scene_type, mood, location })
                   → pick → create_planned_post then assign_library_to_post
   - If text_overlay: create_planned_post with overlay_text
```

## Approve / regenerate flow

```pseudo
1. set_post_status({ id, status: "approved" })  // user said yes
2. # generator service runs; status moves to "generating" → "generated"
3. # user reviews in the Draft Review UI
4. # approve:  set_post_status({ id, status: "accepted" })
   # reject:   set_post_status({ id, status: "rejected", reason: "..." })
   # refine:   set_post_status({ id, status: "approved", feedback: "..." })
```

## Pair shot from a Maya request

```pseudo
1. resolve("Sofia") → may return ambiguous; pick correct one
2. get_relationship_between({ a: "@maya.moves", b: "@sofia.rivera" })
   → if !exists, fall back to neutral pair scene
3. get_pair({ a: "@maya.moves", b: "@sofia.rivera" })
   → use relationship.narrative.dynamic for tone
   → use relationship.narrative.insideJokes for caption seeds
```

## Family shot via persona handle

```pseudo
1. get_family_of_persona({ persona: "@maya.moves" })
   → if ambiguous (multiple families), pick one:
     get_family_of_persona({ persona: "@maya.moves", family: "the-riveras" })
2. Plan with bundle.family.lore as the throughline
3. Each member's bundle.persona.calendarContext respected
```

---

# Versioning

The current MCP server version is `1.0.0`. New tools may be added (additive change); existing tool schemas won't change without a major version bump. The 21-tool surface documented here is stable.

Any tool additions: append to `mcp/tools.js` and the TOOLS array, then rebuild the `mcp` container.
