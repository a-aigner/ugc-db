# Instagram Content Planner — Skill

A Claude skill that plans realistic, persona-fitting Instagram content for the AI UGC creators in your ugc-db. It calls the **ugc-creator-db MCP connector** to read persona context, propose a storyline arc in chat, then write planned posts to the database for image-by-image approval in the localhost UI.

## What this skill does

- Takes a request like *"plan a vacation arc for @maya.moves in March"*
- Reads the persona's full bundle (bio, voice, calendar context, physical, neighborhood)
- Checks what's already planned for the persona (so it doesn't double-book)
- Proposes a day-by-day plan as a **markdown table in chat** for your approval
- After approval, writes the arc + planned posts to the database
- Tells you to review individual posts at `http://localhost:8080` → Arcs tab

## What it does NOT do

- It never approves or rejects generated images. That's your job in the localhost UI.
- It never overrides your `calendarContext` — if the persona's calendar forbids the timing, it will tell you and propose an alternative.
- It doesn't post to Instagram. That's downstream (fleetmanager or your scheduler).

## Setup

### 1. Make sure the ugc-creator-db MCP is connected in Claude

Per the project's [README](../../README.md) and [MCP doc](../../doc/MCP.md):

- Local: `http://localhost:3100/mcp`
- Via Cloudflare Tunnel: `https://mcp.<your-domain>/mcp`
- Auth header: `Authorization: Bearer <MCP_TOKEN>`

### 2. Install the skill

Copy or symlink the `skills/instagram-content-planner/` directory into wherever your Claude environment picks up skills (e.g., `~/.claude/skills/` for Claude Code).

For Claude Code globally:

```bash
ln -s "$PWD/skills/instagram-content-planner" ~/.claude/skills/instagram-content-planner
```

Claude.ai (web) and Claude Desktop have their own skill mechanisms — check your platform's documentation.

### 3. Verify

In a new conversation:

> "What skills do you have available?"

Claude should mention `instagram-content-planner`.

## How to use it

### Plan a normal week

> "Plan next week for @maya.moves."

The skill will read Maya's calendar context, check existing planned posts, and propose a normal-week archetype plan (~0-1 feed, ~30-40 stories spread across the week).

### Plan a vacation arc

> "Plan a vacation arc for @maya.moves March 15-22 — Sofia is visiting."

Multi-persona arc with Sofia as co-star. The skill calls `get_pair(maya, sofia)`, weaves their inside jokes into captions, and plans content for **both** personas in lockstep (e.g., when Maya posts an airport pickup, Sofia posts a "got @maya.moves at LAX 🫂" story).

### Plan an exam week for a student persona

> "Plan exam content for Ling, Jan 20-31."

If Ling's calendar context describes Vienna semester dates, the skill respects them. Output is heavy on `library_workspace` + `library_object` (laptops, coffee, notes), light on persona shots (~3-5 total), peppered with `text_overlay` polls.

### Iterate

The plan is rendered as a markdown table in chat. Comments like:
- "less feed, more library"
- "shift Saturday's content to Friday"
- "no library_food on Tuesday — use workspace instead"
- "the Tuesday 9am persona shot — make it a mirror selfie instead"

The skill re-renders the table. Repeat until you say "approved" or "go".

## What happens after approval

1. The skill calls `create_arc` then ~30-50 `create_planned_post` calls.
2. For `library_*` posts, it queries `list_library` for fitting assets and calls `assign_library_to_post`.
3. It tells you exactly how many posts were created and the URL to review.

You then:

1. Open `http://localhost:8080` → Arcs tab → your new arc.
2. Click a planned post row → Draft Review screen.
3. **Approve plan** → generator picks it up → image gets created → status flips to `generated`.
4. Review the image. **Approve** (terminal), **Reject** (with reason), or **Regenerate** (with refinement feedback that gets appended to the prompt).

## Skill layout

```
skills/instagram-content-planner/
├── SKILL.md                          # Main entry — what Claude reads first
├── README.md                         # This file (for humans)
└── references/
    ├── voice-rules.md                # How to write captions in persona voice
    ├── arc-types.md                  # 8 arc archetypes with cadence tables
    ├── post-types.md                 # The story_type taxonomy and prompts
    └── model-selection.md            # When to use Soul vs Nano Banana vs library
```

Sub-references are loaded on demand by Claude based on what the plan needs.

## Common workflows

### Before first use: train Soul IDs for active personas

For every persona you plan to actively post for, train Soul ID **once**:

1. Make sure persona has ≥ 10 reference photos (uploaded to gallery).
2. Either via the localhost UI ("Train Soul ID" button on persona detail) OR via the skill: *"Train a Soul ID for @maya.moves."*
3. Wait ~3 minutes. Now every persona shot for that persona is effectively free (within the Plus Soul pool).

### Library prep — one-off batch session

Plan calls `list_library` heavily and will tell you if it can't find assets for a needed scene. Before planning a vacation arc, do a 20-30 minute web-UI session generating library content (unlimited on Plus) and upload via the Library tab. Suggested starter set per persona:

- 10 sunsets/landscapes (varied moods)
- 10 food + drink (different times of day)
- 5 workspaces
- 5 generic objects (notebook, mug, plants)
- 3-5 location-specific (your persona's actual neighborhoods)

### Multi-persona arc

> "Plan a sister-visit arc — Maya + Sofia, May 5-12, sister bonding theme."

Skill plans **both** personas in lockstep. Make sure both are in your DB.

## Troubleshooting

**Skill says "no calendar context for @maya.moves":** edit Maya in the localhost UI, fill in the Calendar context field. The skill needs that field to plan realistically.

**Skill plans too many persona shots:** edit `references/arc-types.md` — bump up the library ratio in your preferred archetypes. Or tell the skill explicitly: "max 5 persona shots this week".

**Skill plans posts but library has no matching assets:** the skill should warn you. If it didn't, ask it to "skip library posts when no asset exists" — it should reduce that story type's count.

**Generator burns credits on persona shots:** the persona doesn't have a Soul ID yet. Train it: *"Train Soul ID for @maya.moves"*.

## Customizing the skill

Every reference file is editable. If your personas have different post types, edit `post-types.md`. If your voice rules differ, edit `voice-rules.md`. The SKILL.md tells Claude to read these on demand, so changes take effect immediately for new conversations.

## Future additions

- **Caption-only mode** — produce captions without committing posts (useful for editing existing posts).
- **Regeneration helper** — analyze rejected generations to refine `personaGenerationNotes`.
- **Cross-persona timeline view** — visualize what multiple personas are doing on the same days.
- **fleetmanager handoff** — once approved, push to fleetmanager for actual posting.
