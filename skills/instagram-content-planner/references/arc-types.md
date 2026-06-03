# Arc archetypes

An arc is a date-bounded window with a coherent theme. The archetype determines cadence, content mix, and tone. Pick the closest match and adjust.

## Cadence table (per arc archetype)

| Archetype | Days | Feed posts | Persona stories | Library stories | Text overlay | Reposts | Total stories |
|---|---|---|---|---|---|---|---|
| Normal week | 7 | 0-1 | ~5-8 | ~15-25 | ~2-5 | 0-1 | ~25-40 |
| Vacation | 7 | 1-2 | ~12-20 | ~25-40 | ~3-5 | ~2 | ~45-70 |
| Recovery / slow | 7 | 0-1 | ~3-6 | ~10-20 | ~3-6 | 0 | ~20-30 |
| Project sprint | 7 | 1 | ~5-10 | ~10-15 | ~5-8 (process shots) | ~1 | ~25-35 |
| Event week | 3-5 | 1-2 | ~10-18 (peaking on event day) | ~10-20 | ~2-3 | ~2 | ~30-50 |
| Exam / focus | 7-14 | 0 | ~3-5 (low energy) | ~15-30 (workspaces, coffee) | ~5-8 (questions to followers) | 0 | ~25-45 |
| Family / friend visit | 5-7 | 1-2 | ~10-15 (with cameos) | ~15-25 | ~2-4 | ~2 | ~30-50 |
| Brand launch / collab | 3-7 | 2-3 | ~8-12 | ~10-15 | ~3-5 (CTAs) | ~2 | ~25-40 |

Adjust for the persona — Maya (LA fitness creator, batch days Tue/Sat) won't match Ling (Vienna student) on cadence. **Always sanity-check against `persona.calendarContext`.**

---

## Archetype details

### Normal week
**Purpose:** background cadence between arcs. Maintains presence without milestones.
**Tone:** day-in-the-life, candid.
**Structure:** Monday reset → mid-week routine → Friday energy / weekend slowing.
**Continuity:** persona's everyday outfits, usual locations (gym, café, apartment).
**Examples of slots:**
- Mon AM: library_workspace (morning coffee + journal) + text_overlay ("week plan?")
- Tue PM: persona_selfie (post-batch-shoot mirror selfie, story)
- Wed AM: library_food (smoothie or breakfast)
- Wed PM: feed_repost from last Saturday's feed (if applicable)
- Thu: persona_pov story (hands working on something)
- Fri PM: library_landscape_music (golden hour, no caption)
- Sat: 1 feed post (the batch shoot drop), 3-5 supporting stories
- Sun: minimal, lifestyle stories only

### Vacation
**Purpose:** travel narrative. Coherent location + outfit + mood across days.
**Tone:** higher energy, more inside-the-experience, mood-driven.
**Structure:** travel day → arrival → exploration → "settled in" routine → return.
**Continuity rules to set in `continuity_notes`:**
- "Earth-tone palette: olive, cream, rust"
- "Same swimsuit days 2-4, different day 5"
- "Hair down only at dinner; pulled back during activities"
**Hot moments:** arrival selfie (story or feed), first meal at destination, golden hour day 2-3, group/cameo shot, last night.
**Example day breakdown:**
- 7am: library_landscape_music (sunrise from balcony)
- 9am: library_food (breakfast)
- 11am: persona_selfie story (about to head out)
- 1pm: library_object story (something cool you spotted)
- 3pm: persona_pov (hands holding a drink/menu/object)
- 6pm: library_food (dinner setup)
- 8pm: persona_mirror story OR feed_repost
- 10pm: library_landscape_music (night view)

### Recovery / slow
**Purpose:** dial back. Often follows an intense week or arc.
**Tone:** quiet, reflective, low-stakes.
**Structure:** library-heavy, minimal persona shots.
**Captions:** even shorter than usual. Often single words or emojis.
**Examples:** "slow sunday.", "needed this.", emoji-only stories.

### Project sprint
**Purpose:** working on something. Lots of process shots.
**Tone:** focused, slightly chaotic, occasional comic relief.
**Structure:** day 1 setup → mid-sprint grind → day 7 finish OR cliffhanger.
**Persona shots:** desk-pov / workspace selfies; rarely full face.
**Library:** workspaces, coffee, notebooks, screens (not the actual project — those are persona shots).
**Text overlay:** "deadline mode", "day 4 of 7", progress questions.

### Event week
**Purpose:** around a single peak day (concert, conference, wedding).
**Tone:** rising anticipation → peak → afterglow.
**Structure:**
- T-2 days: library + casual mention
- T-1: persona prep selfie ("packing", "outfit?")
- Event day: 5-10 stories across the day, 1 feed post
- T+1: persona_selfie story ("recovering"), library "morning after"
- T+2: feed_repost or reflection
**Continuity:** the event outfit appears in multiple shots that day.

### Exam / focus
**Purpose:** student or focused-work personas. Suppresses persona-face content.
**Tone:** stressed-funny, relatable, vulnerable.
**Structure:**
- Mostly library_workspace + library_object (notes, laptop, coffee cups)
- ~3-5 persona shots total across 2 weeks — bare face, hair up, "what day is it" energy
- ~5-8 text_overlay ("3 days left ask me anything", "if you see me out know it's not real")
**Vienna student example continuity:** café Saturday morning, library Sunday afternoon, "rerun the lecture" Wednesday night.

### Family / friend visit
**Purpose:** cameo arc, two-persona narratives.
**Tone:** warmer than normal week, more humor, references to relationships.
**Structure:**
- Day 1: pickup / arrival
- Days 2-N: joint outings + each persona's individual content alongside
- Last day: "she's leaving 🫂" or similar
**Important:** plan content for **both** personas in lockstep. If Maya does an airport selfie at 6pm, Sofia does a "got @maya.moves at the airport" story at 6:30pm.
**Use `get_pair`** for the dynamic and inside jokes — weave them into captions.

### Brand launch / collab
**Purpose:** strategic feed-heavy window with a clear CTA.
**Tone:** still in voice; respect `boundaries` (no misleading claims).
**Structure:**
- T-3: tease (library or text_overlay, "something's coming")
- T-1: persona reveal story
- T-day: feed post + 3-5 supporting stories
- T+1: testimonials / Q&A
- T+2-3: feed_repost reminders
**CTAs:** in voice — "link in bio if you want it", not "BUY NOW".

---

## Picking the archetype

User says... | You pick...
---|---
"Plan next week for Maya" | Normal week (check her calendar — what day is it?)
"Maya's going to Mexico in August" | Vacation
"Maya tweaked her knee" | Recovery
"Sofia is visiting Maya next week" | Family / friend visit
"Ling has exams Jan 15-Feb 14" | Exam / focus
"Maya is launching a new program March 1" | Brand launch
"Maya's friend is throwing a party Saturday" | Event week

If the user's ask doesn't match any: **default to Normal week** and ask for more context.
