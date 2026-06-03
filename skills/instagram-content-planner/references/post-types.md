# Post type taxonomy

Every planned post has a `post_type` (the IG primitive: feed/story/carousel) and a `story_type` (how it's produced). Pick the right `story_type` per slot and follow its production rules.

## The taxonomy

| `story_type` | Goes in `post_type` | Source | Has `generation_prompt`? | Has `library_asset_id`? | Cost |
|---|---|---|---|---|---|
| `persona_selfie` | ig_feed OR ig_story | Generator | YES — write a scene prompt | NO | Credits per generation |
| `persona_mirror` | ig_story | Generator | YES — mirror selfie prompt | NO | Credits |
| `persona_pov` | ig_story | Generator | YES — over-shoulder/hands prompt | NO | Credits |
| `library_landscape_music` | ig_story | Library | NO | YES — `list_library({sceneType: 'landscape'})` | Free |
| `library_food` | ig_story | Library | NO | YES — `list_library({sceneType: 'food'})` | Free |
| `library_object` | ig_story | Library | NO | YES — `list_library({sceneType: 'object'})` | Free |
| `library_workspace` | ig_story | Library | NO | YES — `list_library({sceneType: 'workspace'})` | Free |
| `text_overlay` | ig_story | None (overlay only) | NO | NO | Free |
| `feed_repost` | ig_story | None — points to existing feed | NO | NO | Free |
| `friend_cameo` | ig_feed OR ig_story | Mixed — another persona's image or shared | Sometimes | Sometimes | Mixed |

---

## Production rules per type

### `persona_selfie`
- **Use for:** the persona's face, full or half-portrait, candid mood.
- **Prompt scaffold:**
  ```
  candid <portrait|half-body> of <age> <ethnicity> <occupation> <core-activity>,
  <location/setting>, <time-of-day light>,
  <outfit details from continuity_notes>,
  <expression/mood>,
  shot on 35mm film, soft natural shadows, slightly grainy iPhone aesthetic
  ```
- **Pull from persona bundle:**
  - `persona.persona.{age, ethnicity, occupation}` for the noun phrase
  - `persona.visual.physical.{hair, eyeColor, skin, distinguishingMarks}` only if important to this shot
  - `persona.visual.style` for the aesthetic tail
  - `persona.visual.personaGenerationNotes` is **automatically appended by the worker** — you do NOT need to include it in the prompt
- **Reference image:** leave `reference_image_id` blank (worker uses `personas.photo_id` automatically). Only set it if you want a specific gallery image as the anchor (e.g., to lock outfit continuity within an arc).
- **Frequency:** feed posts very rare (1-2/month); stories ~3-15/week depending on archetype.

### `persona_mirror`
- **Use for:** full-body or outfit-of-the-day shots.
- **Prompt scaffold:**
  ```
  mirror selfie of <age> <ethnicity>, holding iPhone,
  <full outfit description>, <location — bathroom/gym/bedroom mirror>,
  <pose>, <expression>,
  natural lighting, slightly grainy iPhone aesthetic
  ```
- **When:** vacation arrival, OOTD, gym mirror, before-going-out.

### `persona_pov`
- **Use for:** "I" perspective — hands holding things, over-shoulder, walking POV.
- **Prompt scaffold:**
  ```
  POV first-person hands holding <object>, <persona's nail color/jewelry if signature>,
  <setting>, <time-of-day>,
  iPhone photo aesthetic
  ```
- **Cheap face budget:** doesn't show face directly — useful when you've already used face budget for the day.

### Library types (all `library_*`)
- **Use for:** the bulk of stories. These are FREE because they pull from pre-uploaded library assets.
- **Production:**
  1. After `create_planned_post` (with the right `story_type`), call `list_library` with appropriate filters:
     - `library_landscape_music` → `list_library({sceneType: 'landscape'})` (refine by `mood`, `timeOfDay`)
     - `library_food` → `list_library({sceneType: 'food'})` (refine by `mood`)
     - `library_object` → `list_library({sceneType: 'object'})`
     - `library_workspace` → `list_library({sceneType: 'workspace'})`
  2. Pick the asset that best matches the arc's `mood` and the persona's `location`. Prefer ones with `timesUsed=0` for variety.
  3. Call `assign_library_to_post({ planned_post_id, library_asset_id })`.
- **If no matching asset exists:** flag this to the user before creating the post. Don't create an orphaned library post.
- **Caption convention:** very short or none. The library type already conveys the meaning. Add a 1-line caption or just emoji.

### `text_overlay`
- **Use for:** "ask me anything", quotes, polls, progress signals.
- **Production:**
  - Set `overlay_text` (this is what gets rendered on a plain background).
  - Leave `caption` empty or use it as the actual text (the renderer might show it).
- **Examples:**
  - "deadline mode. day 4 of 7."
  - "ask me anything about recovery"
  - "outfit pick for tonight? 1 or 2"
- **Frequency:** ~1 per day works. More than that = creator vibe.

### `feed_repost`
- **Use for:** a story that points at a recently-dropped feed post.
- **Production:**
  - No image generation.
  - Set `caption` to something like "new post ↗️" or "live now" or the first sentence of the feed caption.
  - Set `notes` to "reposts feed post on day N" so the user can wire it manually.
- **When:** within 6-24 hours of a feed post going up.

### `friend_cameo`
- **Use for:** another persona appears in this shot (single-person or two-person).
- **Two paths:**
  1. **Two-persona generation:** `persona_selfie` story type with a prompt describing both subjects + their relationship dynamic. Costs credits (one generation, two faces). Use `get_pair` for relationship texture.
  2. **Reshare:** points to the other persona's existing content. Set `notes` "reshare from @other.handle's feed".
- **Caption:** tag the friend. Use inside jokes from `relationship.narrative.insideJokes`.

---

## Choosing post_type given story_type

- `persona_selfie` → ig_feed when it's a "money shot" of the arc (max 1-2 per arc). Otherwise ig_story.
- `persona_mirror` → ig_story (mirror selfies rarely feed-quality).
- `persona_pov` → ig_story.
- All `library_*` → ig_story.
- `text_overlay` → ig_story.
- `feed_repost` → ig_story (it's the pointer; the actual feed post lives separately).
- `friend_cameo` → either, depending on quality.

## Scheduling notes

- Use the persona's `calendarContext` rhythm. Maya's morning content lands 7-9am PT; evening content 5-7pm PT.
- **Don't schedule 8 stories at the same minute.** Real story stacks are clustered (3-5 within ~20 min), then quiet for hours. Approximate:
  - Morning stack: ~3-5 stories in 8-10am
  - Midday: ~1-2 stories
  - Evening: ~3-5 stories in 5-8pm
- Feed posts at **the persona's prime time** for engagement. For LA: 8-10am or 6-8pm PT. For Vienna: 18-21 CET.
- Sunday content for most personas is light or none — many people don't post Sundays.
