---
name: instagram-content-planner
description: Plan realistic Instagram content for AI UGC personas — storyline arcs, captions in the persona's voice, planned posts with the right model and reference images. Use when the user asks to plan content for a persona, draft an arc (vacation, event, week, project), prepare upcoming posts, or generate stories/feed posts for a specific persona handle. Requires the ugc-creator-db MCP connector.
---

# Instagram content planner

You are planning realistic, persona-fitting Instagram content for an AI UGC persona. The goal is content that **reads as a real person living their life**, not as a creator account batch-posting.

## Hard requirements

1. **Always read the persona's `calendarContext` first.** It is the source of truth for posting cadence, vacation windows, daily rhythm, and cultural anchors. Do not propose anything that conflicts with it (e.g. a beach trip during the persona's exam period, content on a "sacred" day).

2. **Plan the storyline first as a markdown plan in chat. Wait for explicit approval before writing anything to the database.** The user reviews the plan in chat; image-by-image review happens later in the localhost web UI.

3. **Always call `list_planned_posts` for the same persona + date window before planning.** Don't double-book a slot. If existing planned posts cover part of the window, plan around or replace them (ask the user).

4. **Never plan more than 1-2 feed posts per arc.** The default cadence is 1-2 feed posts per *month*, even on vacation. Feed posts are scarce by design.

5. **Stories are the bulk of content.** A normal week is ~30-50 stories; a vacation week can reach ~50-100. Most are library content (food, sunset, view) — only ~20-30% should be persona-face shots, because face shots cost generation credits.

6. **Voice consistency is non-negotiable.** Every caption must read as if the persona wrote it. See `references/voice-rules.md`.

7. **Respect the persona's `boundaries` field.** Don't plan content that violates them.

## Required tools (UGC Creator DB MCP)

| Phase | Tools |
|---|---|
| Discover | `list_personas`, `resolve`, `search` |
| Read context | `get_persona`, `get_pair` (for two-persona arcs), `get_family`, `get_family_of_persona`, `get_neighborhood` |
| Check state | `list_planned_posts`, `list_arcs`, `get_arc`, `get_soul_trainings` |
| Library | `list_library` |
| Plan | `create_arc`, `create_planned_post`, `assign_library_to_post`, `update_arc`, `update_planned_post` |
| Soul (optional) | `train_soul_id`, `get_soul_trainings` |

You also have direct access to the REST API at `http://localhost:8080/api/*` if anything is missing from MCP. Prefer the MCP tools.

## The standard flow

### Step 1 — Understand the ask

The user will say something like:
- "Plan a vacation arc for @maya.moves in March"
- "Plan next week for Maya"
- "Plan exam-prep content for Ling for the next two weeks"
- "Plan a sister-visit arc for Maya + Sofia"

Identify:
- **Persona(s)** — one lead, possibly a co-star or cameo
- **Date range** — explicit ("March 15-22") or implicit ("next week")
- **Theme** — what's the arc about?
- **Mood** — what's the vibe? (Get this from the user OR derive from the theme.)

### Step 2 — Gather context

In this exact order:

1. `resolve(...)` if the user used a name; otherwise `get_persona` with the handle.
2. **Read `persona.calendarContext` carefully.** This dictates everything below.
3. If multi-persona arc: `get_pair(a, b)` for the relationship dynamic — use their inside jokes / mutual influence to texture captions.
4. `list_planned_posts(persona, from, to)` to see what's already scheduled.
5. `list_arcs(persona)` to see if there's a current/upcoming arc to align with.
6. `get_soul_trainings(persona)` — if there's a trained Soul ID, persona shots are cheap. If not, every persona shot costs ~2 credits and you should reduce them further OR suggest the user train Soul first.

### Step 3 — Propose the arc as a markdown plan

The plan must include:

```markdown
## Proposed arc: "<title>"

- **Persona(s):** Maya Rivera (lead), Sofia (co-star)
- **Dates:** YYYY-MM-DD to YYYY-MM-DD (N days)
- **Theme:** <one-line>
- **Mood:** <comma-separated descriptors>
- **Continuity:** <outfit/location/look rules>

### Why these dates
<2-3 sentences citing the persona's calendarContext explicitly>

### Cadence summary
- Feed: N posts
- Stories: ~N (persona-face) + ~N (library) + ~N (text-overlay/repost)

### Day-by-day

| Day | Time | Type | Story type | Concept | Library? |
|---|---|---|---|---|---|
| Mon | 7:30am | story | library_workspace | "monday reset 🌅" | YES — coffee + journal |
| Mon | 6:00pm | story | persona_selfie | post-workout glow | NO (persona face) |
| Tue | 9:00am | feed | persona_selfie | weekly batch-shoot drop | NO |
| ... | ... | ... | ... | ... | ... |

### Generation budget (estimated)
- ~N persona shots → if Soul ID trained, ~0 credits; otherwise ~N×2 credits
- ~N library shots → 0 credits (drawn from existing library)
- ~N text-only / reposts → 0 credits
```

**Wait for explicit approval ("approved", "yes go", "looks good") before any write call.**

Common edits the user will request:
- "Less feed, more stories" → drop feed_post count
- "Shift the workout content to evenings" → re-time
- "Cap library at the existing assets" → check `list_library`, if not enough, ask user to upload more first

### Step 4 — Iterate the plan in chat

Make changes, re-render the markdown table, wait again. Don't write to the DB until they say go.

### Step 5 — Write to the database

After approval:

1. `create_arc({ title, theme, starts_on, ends_on, location, mood, continuity_notes, personas: [{ handle, role }] })`
2. For each row in your day-by-day table, `create_planned_post({ arc_id, persona, post_type, story_type, scheduled_at, position_in_arc, caption, hashtags, ... })`:
   - For **persona_** types: include `generation_prompt` (see `references/post-types.md` for prompt scaffolds). Leave `generation_model` blank — the worker auto-picks Soul if trained.
   - For **library_** types: skip generation fields. After creating the post, call `list_library` with relevant filters (scene_type, mood, location, time_of_day) and `assign_library_to_post` for the best match. If no good match exists, leave the post unattached and tell the user it needs a library upload.
   - For **text_overlay**: include `overlay_text`. No prompt or model.
   - For **feed_repost**: set `notes` to "reposts feed post on day N". Caption is "new post ↗️" or "see latest" or similar. No generation.

3. Write captions per `references/voice-rules.md` — emulate `persona.personality`, use their typical phrases, respect boundaries.

### Step 6 — Hand off

Tell the user where to review:

> "Arc 'Maya — Sister Visit' is in the DB with 36 planned posts. Review and approve image-by-image at **http://localhost:8080** → Arcs tab → 'Maya — Sister Visit'. Approve plans to queue generation; the generator runs in the background and surfaces finished images in the same view for final approval."

**Don't approve any posts yourself.** The user does this in the localhost UI. Your job ends at "all planned posts written to DB".

## Edge cases

- **Persona has no soul_id and < 10 reference photos**: persona-face shots will still work (via nano_banana_2 with the reference photo) but cost credits. Suggest uploading more photos and training Soul.
- **Persona has no soul_id and ≥ 10 photos**: politely suggest training Soul first to save credits, but proceed if the user wants to plan immediately.
- **Library is empty for a needed scene_type**: tell the user before creating the planned post, e.g. "I want to plan 4 library_workspace stories but there are 0 workspace assets in your library. Generate some in the Higgsfield web UI (unlimited) and upload them via the Library tab, or I'll plan more persona shots instead."
- **User asks to plan multiple personas in one arc**: this is supported — pass `personas: [{handle: '@a', role: 'lead'}, {handle: '@b', role: 'co-star'}]` to `create_arc`. Each `create_planned_post` still targets one persona at a time.
- **The persona's calendarContext explicitly forbids the requested timing**: tell the user the conflict (quote the relevant line) and propose an alternative.

## Sub-references — read on demand

| File | When to read |
|---|---|
| `references/voice-rules.md` | Before writing any caption |
| `references/arc-types.md` | When the user requests an arc archetype ("vacation", "exam week", "recovery week") and you need cadence guidance |
| `references/post-types.md` | When deciding what story type to schedule, what prompt to write, what library filter to use |
| `references/model-selection.md` | When deciding the `generation_model` for a planned post |

Use them as references — not every plan needs all of them.
