-- ============================================================
-- Migration 005: storyline + planning + library
--
-- Adds:
--   - Persona columns: occupation, affiliation, calendar_context,
--                      soul_id, persona_generation_notes
--   - storyline_arcs           — date-bounded themes spanning 1..N personas
--   - storyline_arc_personas   — many-to-many: who's in an arc, in what role
--   - planned_posts            — individual planned IG posts (feed + stories)
--   - library_assets           — reusable stock content (food, sunsets, workspaces…)
--
-- Idempotent — safe to run on a fresh DB or an existing one.
-- ============================================================

-- ---------- persona columns ----------
ALTER TABLE personas ADD COLUMN IF NOT EXISTS occupation               TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS affiliation              TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS calendar_context         TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS soul_id                  TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS persona_generation_notes TEXT;

-- ---------- storyline arcs ----------
CREATE TABLE IF NOT EXISTS storyline_arcs (
    id                UUID PRIMARY KEY,
    title             TEXT NOT NULL,
    theme             TEXT,
    starts_on         DATE NOT NULL,
    ends_on           DATE NOT NULL,
    status            TEXT NOT NULL DEFAULT 'planning',  -- planning | active | past | archived
    location          TEXT,
    mood              TEXT,
    continuity_notes  TEXT,
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS storyline_arcs_dates_idx ON storyline_arcs (starts_on, ends_on);
CREATE INDEX IF NOT EXISTS storyline_arcs_status_idx ON storyline_arcs (status);

DROP TRIGGER IF EXISTS storyline_arcs_touch ON storyline_arcs;
CREATE TRIGGER storyline_arcs_touch
BEFORE UPDATE ON storyline_arcs
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------- arc-persona membership ----------
CREATE TABLE IF NOT EXISTS storyline_arc_personas (
    arc_id      UUID NOT NULL REFERENCES storyline_arcs(id) ON DELETE CASCADE,
    persona_id  UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    role        TEXT,                                   -- 'lead' | 'co-star' | 'cameo'
    PRIMARY KEY (arc_id, persona_id)
);
CREATE INDEX IF NOT EXISTS storyline_arc_personas_persona_idx ON storyline_arc_personas (persona_id);

-- ---------- planned posts ----------
CREATE TABLE IF NOT EXISTS planned_posts (
    id                      UUID PRIMARY KEY,
    arc_id                  UUID REFERENCES storyline_arcs(id) ON DELETE SET NULL,
    persona_id              UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,

    platform                TEXT NOT NULL DEFAULT 'instagram',
    post_type               TEXT NOT NULL,            -- ig_feed | ig_story | ig_carousel
    story_type              TEXT,                     -- persona_selfie | persona_mirror | library_food | … (see post-types.md)
    scheduled_at            TIMESTAMPTZ,
    position_in_arc         INTEGER,

    caption                 TEXT,
    hashtags                TEXT[] NOT NULL DEFAULT '{}',
    overlay_text            TEXT,                     -- for text-overlay stories

    -- generation inputs (for posts that need generation; library posts skip these)
    generation_prompt       TEXT,
    generation_model        TEXT,                     -- nano_banana_2 | text2image_soul_v2 | seedream_5_lite | …
    reference_image_id      UUID REFERENCES images(id) ON DELETE SET NULL,
    library_asset_id        UUID,                     -- FK added once library_assets is created (see end)

    -- generation result
    generated_image_id      UUID REFERENCES images(id) ON DELETE SET NULL,
    generation_metadata     JSONB,
    regeneration_feedback   TEXT,

    -- handoff to fleetmanager
    fleet_content_id        TEXT,
    fleet_scheduled_post_id TEXT,

    status                  TEXT NOT NULL DEFAULT 'planned',
    -- planned → approved → generating → generated → accepted → pushed → posted
    -- or → rejected (terminal)
    rejection_reason        TEXT,
    notes                   TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS planned_posts_arc_idx        ON planned_posts (arc_id);
CREATE INDEX IF NOT EXISTS planned_posts_persona_idx    ON planned_posts (persona_id);
CREATE INDEX IF NOT EXISTS planned_posts_status_idx     ON planned_posts (status);
CREATE INDEX IF NOT EXISTS planned_posts_scheduled_idx  ON planned_posts (scheduled_at);

DROP TRIGGER IF EXISTS planned_posts_touch ON planned_posts;
CREATE TRIGGER planned_posts_touch
BEFORE UPDATE ON planned_posts
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------- library assets ----------
-- Reusable stock content the user generates manually in the Higgsfield
-- web UI (unlimited under Plus) and uploads here. The planning skill picks
-- from this pool for "library_*" story slots, saving credits.
CREATE TABLE IF NOT EXISTS library_assets (
    id              UUID PRIMARY KEY,
    image_id        UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    scene_type      TEXT,                              -- food | drink | workspace | landscape | street | interior | sky | object | …
    mood            TEXT,                              -- cozy | energetic | minimal | moody | dramatic | soft
    location_hint   TEXT,                              -- apartment | café | gym | park | beach | campus | …
    time_of_day     TEXT,                              -- morning | midday | golden_hour | night | overcast | null
    tags            TEXT[] NOT NULL DEFAULT '{}',      -- freeform: 'laptop_open', 'notes_visible', 'coffee_with_oat'
    notes           TEXT,
    times_used      INTEGER NOT NULL DEFAULT 0,
    last_used_at    TIMESTAMPTZ,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS library_assets_scene_idx    ON library_assets (scene_type);
CREATE INDEX IF NOT EXISTS library_assets_mood_idx     ON library_assets (mood);
CREATE INDEX IF NOT EXISTS library_assets_location_idx ON library_assets (location_hint);
CREATE INDEX IF NOT EXISTS library_assets_tags_idx     ON library_assets USING GIN (tags);

-- Add the deferred FK from planned_posts to library_assets now that both exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'planned_posts_library_asset_fkey'
    ) THEN
        ALTER TABLE planned_posts
        ADD CONSTRAINT planned_posts_library_asset_fkey
        FOREIGN KEY (library_asset_id) REFERENCES library_assets(id) ON DELETE SET NULL;
    END IF;
END $$;
