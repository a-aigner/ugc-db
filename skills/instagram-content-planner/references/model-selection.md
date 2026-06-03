# Model selection — when to set `generation_model` (and when to leave it blank)

The generator worker has a smart default. Use the default in most cases. Override only when you have a specific reason.

## Decision tree

```
Is this a library_* / text_overlay / feed_repost?
  → YES: leave generation_model blank. No generation runs.
  → NO: continue.

Is the persona's soul_id set?
  → YES: leave generation_model blank.
         Worker auto-picks `text2image_soul_v2` + the Soul ID + persona reference.
         This is the cheap path (Soul pool on Plus).
  → NO: leave generation_model blank.
         Worker auto-picks `nano_banana_2` + persona reference photo.
         Costs ~2 credits per generation. Still good quality.

Is this a multi-reference scene shot? (you need to lock outfit + location + composition together)
  → YES: override with `generation_model: "nano_banana_2"` regardless of Soul status.
         Plan to set 2-3 `reference_image_id` slots — but our schema currently
         allows only 1 reference_image_id per post. Workaround: pick the *most
         critical* reference (outfit OR location) and let the rest be prompt-driven.
         Tell the user this is a 2-credit shot.
  → NO: don't override.

Is this a generic non-persona scene the library doesn't have?
  → Use `generation_model: "seedream_v5_lite"` for free/cheap general images.
         But really: it's better to generate this manually in the Higgsfield web UI
         (uses Plus's unlimited pass — FREE) and upload to library_assets.
         Only use seedream via the worker if it's a one-off and not worth the
         manual round-trip.
```

## Models recognized by the worker

| `generation_model` value | When it applies | Cost (Plus, via CLI) |
|---|---|---|
| `text2image_soul_v2` (default if Soul ID present) | Persona shots, character-consistent | Within 5000/mo Soul pool — usually free |
| `nano_banana_2` (default if no Soul ID) | Persona shots without trained Soul, OR scene-fidelity needs | ~2 credits/gen |
| `seedream_v5_lite` | Generic non-persona images via worker | ~1 credit/gen via CLI |
| `flux_2` | Alt generic | ~1-2 credits |
| `gpt_image_2` | Diagrams, infographics | ~2-3 credits |

Full CLI catalog: https://github.com/higgsfield-ai/cli/blob/main/MODELS.md

## When to suggest Soul training before planning

If the persona has no `soul_id` AND ≥ 10 reference photos in their gallery:

> "Before I plan, I noticed Maya doesn't have a Soul ID trained yet. She has 12 reference photos in her gallery, which is enough — training Soul once (~3 min) makes every future persona shot effectively free (within the Plus Soul pool). Without it, every persona shot costs ~2 credits. Want me to queue the training first? Otherwise I'll plan with nano_banana_2."

Call `train_soul_id({ persona })` if they say yes. Then `get_soul_trainings` to poll. Then plan.

If the persona has < 10 photos: don't suggest Soul yet. Plan with nano_banana_2 and remind the user that uploading more reference photos enables Soul.

## Budget telegraphing in the plan

In your Step 3 markdown plan, always include a "Generation budget" block:

```
### Generation budget (estimated)
- 8 persona shots × text2image_soul_v2 (Soul ID trained) → ~0 credits (within Soul pool)
- 22 library shots → 0 credits
- 4 text-overlay → 0 credits

Total: free, within plan
```

Or:

```
### Generation budget (estimated)
- 14 persona shots × nano_banana_2 (no Soul yet) → ~28 credits
- 30 library shots → 0 credits

Total: ~28 credits, ~3% of monthly Plus pool (1000 credits)
```

This lets the user reject expensive plans before any DB writes.

## Reference image hierarchy

The worker resolves the reference image as:
1. `planned_posts.reference_image_id` if you set it (e.g. lock to a specific outfit photo)
2. `personas.photo_id` otherwise (canonical persona reference)
3. None (text-only)

For most persona shots: leave `reference_image_id` blank. The persona's main photo is exactly what we want.

Set `reference_image_id` explicitly when:
- An arc has outfit continuity rules — lock to one outfit photo across multiple days
- A specific gallery image best captures the scene you're prompting for
- The persona was recently rebranded — lock to a newer image instead of the older `photo_id`
