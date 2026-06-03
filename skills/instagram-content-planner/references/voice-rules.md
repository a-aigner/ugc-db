# Voice rules — captions must read as the persona

The single test: **would the persona actually post this?** If not, rewrite.

## How to source the voice

For every caption, pull from the persona's bundle:

- `persona.story.personality` — explicit voice description ("Upbeat hype-friend energy. Speaks directly to camera, uses 'we' and 'let's'. Self-deprecating humor.")
- `persona.story.biography` — what they're known for
- `persona.story.values` — what they care about
- `persona.visual.style` — visual aesthetic (mirrors editorial tone)
- `persona.visual.boundaries` — hard NOs
- `persona.social.niches` and `persona.social.topics` — vocabulary and hashtag pool
- **Existing `visual.samplePrompts`** — these prompts are the historical post style. The captions you write should match the *vibe* the prompts suggest.

## Universal rules

1. **Short. Real people don't write paragraphs.** 1-3 lines for stories, 2-6 lines for feed. Long captions (8+ lines) only for milestone posts (anniversary, big launch, deep reflection).

2. **Lowercase when the persona is casual.** Most lifestyle/fitness/travel personas write mostly lowercase. Capitalize sentences only if the persona's existing captions do.

3. **One thought per caption.** Don't list. Don't summarize. Don't editorialize.

4. **Emojis are personality, not decoration.** Pick the 1-2 that match the persona's vibe. Maya uses ☕🌅🫂 in our seed data — that's her vocabulary. A different persona uses none, or one signature emoji.

5. **Never break the boundaries field.** Maya's says no "before/after" framing — your captions cannot include those words or implied framings.

6. **No marketing speak.** Real accounts don't say "join me on this journey" or "let's do this together" unless the persona's voice already does. Avoid:
   - "Excited to share..."
   - "Today I'm bringing you..."
   - "Make sure to..."
   - "Don't forget to like and follow"

## Hashtags

- **Feed posts: 3-8 hashtags max.** Mix: 1-2 niche-specific (`#movewithmaya`), 2-4 broad (`#fitnessjourney`, `#recovery`), 1-2 trending if relevant.
- **Stories: 0-2 hashtags max.** Often zero.
- **No hashtag walls.** Anything over 10 reads as creator/marketing.
- **Reuse the persona's niche/topic list.** Don't invent hashtags they wouldn't use.

## Persona-voice templates

### Maya Rivera example
*Voice: "Upbeat hype-friend, uses 'we' and 'let's', self-deprecating, casual."*

Good (matches voice):
- "morning reset ☕"
- "back at it slowly. feeling like myself again 🫂"
- "okay we're trying something new today"
- "told my knee 'we got this' and meant it"

Bad (off-voice):
- "Today's workout was incredible! ✨ Don't forget to like and subscribe!" — too marketing
- "Maya here, ready to crush leg day 💪" — third-person/announcing
- "5 reasons recovery week is the BEST" — listicle, not how real people post
- "After 6 months of training I lost 20lbs!" — violates body-positivity boundary

### Aiko Tanaka example
*Voice: "Gentle, soft-spoken, precise. Thoughtful pauses. Avoids hype language; prefers understated honesty."*

Good:
- "this one surprised me 🌿"
- "soft sunday."
- "the bottle is glass. that's the whole post."

Bad:
- "I'M OBSESSED!!! 🔥🔥🔥" — too loud
- "PSA: everyone needs this in their routine!!" — too declarative

### Noah Bennett example
*Voice: "Deadpan, analytical, dryly funny. Measured pacing. Honest about downsides first."*

Good:
- "the headphones are fine. the case is the actual upgrade."
- "30 days in. still works. surprising."
- "tested every claim. most were exaggerated. this one wasn't."

Bad:
- "I LOVE this product so much!!! 😍" — wrong tone
- "Click my link for the full review!" — sells too hard

## When to use the persona's relationships

For multi-persona arcs OR posts that reference another persona:

1. Call `get_pair(persona, other_persona)`.
2. Read `relationship.narrative.dynamic` — that's how they talk to each other.
3. Read `relationship.narrative.insideJokes` — actually use those phrases verbatim (they read as authentic).
4. Read `relationship.narrative.mutualInfluence` — what does the other persona's presence change about the first one's voice?

Example: Maya↔Sofia, "Don't be a Tía Carmen about it" is an inside joke. A caption like "told her not to be a tía carmen 😤" reads instantly as real.

## Captions for different post types

| Type | Caption length | Voice |
|---|---|---|
| `persona_selfie` (feed) | 2-4 lines | Reflective, current arc context, 1-2 hashtags |
| `persona_selfie` (story) | 1 line | Casual, momentary |
| `library_food` | 0-1 lines or just emoji | Aesthetic, no analysis |
| `library_workspace` | 0-1 lines | Mood-setting ("monday reset 🌅") |
| `library_landscape_music` | 0 lines (the music does the talking) or 1 line + location | |
| `text_overlay` | The overlay text IS the caption | Question, quote, poll prompt |
| `feed_repost` | 1 line pointing to the new feed post | "↗️ new post" or "live now" |
| `friend_cameo` | Tag the friend, brief context | "got my favorite human in town 🫂" |

## When in doubt

Ask yourself: *"Would [persona name] swipe through their phone, type this, and tap post in under 30 seconds?"* If no, it's not their voice. Rewrite.
