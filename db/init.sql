-- ============================================================
-- AI UGC Creator Database — schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Binary image blobs, referenced by personas.photo_id and gallery.image_id
CREATE TABLE images (
    id          UUID PRIMARY KEY,
    data        BYTEA NOT NULL,
    mime_type   TEXT  NOT NULL,
    size_bytes  INTEGER NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Personas
CREATE TABLE personas (
    id                 UUID PRIMARY KEY,
    name               TEXT NOT NULL,
    age                INTEGER,
    gender             TEXT,
    status             TEXT NOT NULL DEFAULT 'active',
    ethnicity          TEXT,
    location           TEXT,
    languages          TEXT[] NOT NULL DEFAULT '{}',
    biography          TEXT,
    backstory          TEXT,
    personality        TEXT,
    persona_values     TEXT[] NOT NULL DEFAULT '{}',
    niches             TEXT[] NOT NULL DEFAULT '{}',
    topics             TEXT[] NOT NULL DEFAULT '{}',
    style              TEXT,
    boundaries         TEXT,
    management_url     TEXT,
    management_notes   TEXT,
    photo_id           UUID REFERENCES images(id) ON DELETE SET NULL,
    -- Physical attributes (all optional) — consistency anchors for image gen
    height_cm            INTEGER,
    build                TEXT,
    hair                 TEXT,
    eye_color            TEXT,
    skin                 TEXT,
    distinguishing_marks TEXT,
    -- Planning context (migration 005)
    occupation               TEXT,
    affiliation              TEXT,
    calendar_context         TEXT,
    soul_id                  TEXT,
    persona_generation_notes TEXT,
    sample             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX personas_name_idx ON personas (lower(name));
CREATE INDEX personas_status_idx ON personas (status);
CREATE INDEX personas_sample_idx ON personas (sample);

-- Social accounts (one row per platform per persona)
CREATE TABLE socials (
    id           UUID PRIMARY KEY,
    persona_id   UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL DEFAULT 0,
    platform     TEXT NOT NULL,
    handle       TEXT,
    url          TEXT,
    email        TEXT,
    password     TEXT,
    notes        TEXT
);

CREATE INDEX socials_persona_idx ON socials (persona_id);
CREATE INDEX socials_handle_lower_idx
   ON socials (lower(regexp_replace(coalesce(handle, ''), '^@', '')));

-- Image library entries (gallery items reference images by id)
CREATE TABLE gallery (
    id           UUID PRIMARY KEY,
    persona_id   UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL DEFAULT 0,
    image_id     UUID REFERENCES images(id) ON DELETE SET NULL,
    prompt       TEXT,
    model        TEXT,
    post_time    TEXT
);

CREATE INDEX gallery_persona_idx ON gallery (persona_id);

-- Auto-update updated_at on persona changes
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER personas_touch
BEFORE UPDATE ON personas
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Families — named groups of personas with shared lore.
-- ============================================================
CREATE TABLE families (
    id           UUID PRIMARY KEY,
    name         TEXT NOT NULL,
    handle       TEXT NOT NULL UNIQUE,            -- stable slug: "the-riveras"
    lore         TEXT,
    photo_id     UUID REFERENCES images(id) ON DELETE SET NULL,
    location     TEXT,
    established  TEXT,                            -- freeform: "1958", "Spring 2018"
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX families_name_idx ON families (lower(name));

CREATE TRIGGER families_touch
BEFORE UPDATE ON families
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Family membership — joins personas to a family with a role
-- and (for tree layout) generation + parent links inside the family.
-- ============================================================
CREATE TABLE family_members (
    id                  UUID PRIMARY KEY,
    family_id           UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    persona_id          UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    role                TEXT,
    generation          INTEGER NOT NULL DEFAULT 0,
    parent_member_ids   UUID[] NOT NULL DEFAULT '{}',
    position            INTEGER NOT NULL DEFAULT 0,
    UNIQUE (family_id, persona_id)
);
CREATE INDEX family_members_family_idx  ON family_members (family_id);
CREATE INDEX family_members_persona_idx ON family_members (persona_id);

-- ============================================================
-- Relationships — pairwise links between two personas with category+type
-- + structured quick-facts + rich narrative.
-- ============================================================
CREATE TABLE relationships (
    id                  UUID PRIMARY KEY,
    from_persona_id     UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    to_persona_id       UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    category            TEXT NOT NULL,
    type                TEXT NOT NULL,
    custom_label        TEXT,
    is_directional      BOOLEAN NOT NULL DEFAULT FALSE,

    cadence             TEXT,
    since               TEXT,
    status              TEXT,
    family_id           UUID REFERENCES families(id) ON DELETE SET NULL,

    origin              TEXT,
    dynamic             TEXT,
    bonding_moments     TEXT,
    tensions            TEXT,
    mutual_influence    TEXT,
    inside_jokes        TEXT,
    current_arc         TEXT,
    content_seeds       TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (from_persona_id <> to_persona_id),
    UNIQUE (from_persona_id, to_persona_id, category, type)
);
CREATE INDEX relationships_from_idx   ON relationships (from_persona_id);
CREATE INDEX relationships_to_idx     ON relationships (to_persona_id);
CREATE INDEX relationships_family_idx ON relationships (family_id);
CREATE INDEX relationships_category_idx ON relationships (category);
CREATE INDEX relationships_cat_status_idx ON relationships (category, status);

CREATE TRIGGER relationships_touch
BEFORE UPDATE ON relationships
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Photos taken of two personas together — separate from each persona's library.
-- ============================================================
CREATE TABLE relationship_images (
    id                  UUID PRIMARY KEY,
    relationship_id     UUID NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
    position            INTEGER NOT NULL DEFAULT 0,
    image_id            UUID REFERENCES images(id) ON DELETE SET NULL,
    caption             TEXT,
    taken               TEXT
);
CREATE INDEX relationship_images_rel_idx ON relationship_images (relationship_id);

-- ============================================================
-- Graph query helpers — same as db/migrations/003-graph-queries.sql
-- ============================================================

CREATE OR REPLACE FUNCTION persona_subgraph(
    root_id  UUID,
    max_depth INT DEFAULT 2
) RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    WITH RECURSIVE walk(persona_id, depth) AS (
        SELECT root_id, 0
        UNION
        SELECT CASE
                 WHEN r.from_persona_id = w.persona_id THEN r.to_persona_id
                 ELSE r.from_persona_id
               END,
               w.depth + 1
          FROM walk w
          JOIN relationships r
            ON r.from_persona_id = w.persona_id OR r.to_persona_id = w.persona_id
         WHERE w.depth < max_depth
    ),
    nodes AS (
        SELECT DISTINCT p.id, p.name, p.photo_id, p.status,
               (SELECT min(w.depth) FROM walk w WHERE w.persona_id = p.id) AS depth
          FROM personas p
          JOIN walk w ON w.persona_id = p.id
    ),
    edges AS (
        SELECT r.id, r.from_persona_id, r.to_persona_id,
               r.category, r.type, r.is_directional,
               r.status, r.family_id
          FROM relationships r
         WHERE r.from_persona_id IN (SELECT id FROM nodes)
           AND r.to_persona_id   IN (SELECT id FROM nodes)
    )
    SELECT json_build_object(
        'root', root_id,
        'depth', max_depth,
        'nodes', COALESCE((SELECT json_agg(json_build_object(
                    'id', n.id, 'name', n.name, 'photoId', n.photo_id,
                    'status', n.status, 'depth', n.depth
                  ) ORDER BY n.depth, n.name) FROM nodes n), '[]'::json),
        'edges', COALESCE((SELECT json_agg(json_build_object(
                    'id', e.id,
                    'fromPersonaId', e.from_persona_id,
                    'toPersonaId',   e.to_persona_id,
                    'category', e.category, 'type', e.type,
                    'isDirectional', e.is_directional,
                    'status', e.status, 'familyId', e.family_id
                  )) FROM edges e), '[]'::json),
        'families', COALESCE((SELECT json_agg(json_build_object(
                       'id', f.id, 'name', f.name, 'handle', f.handle,
                       'memberIds', (SELECT json_agg(fm.persona_id)
                                       FROM family_members fm
                                      WHERE fm.family_id = f.id
                                        AND fm.persona_id IN (SELECT id FROM nodes))
                     ))
                     FROM families f
                    WHERE f.id IN (
                       SELECT DISTINCT fm.family_id
                         FROM family_members fm
                        WHERE fm.persona_id IN (SELECT id FROM nodes)
                    )), '[]'::json)
    ) INTO result;
    RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION full_graph() RETURNS JSON AS $$
    SELECT json_build_object(
        'nodes', COALESCE((SELECT json_agg(json_build_object(
                    'id', p.id, 'name', p.name, 'photoId', p.photo_id,
                    'status', p.status, 'handles',
                    COALESCE((SELECT json_agg(json_build_object(
                                'platform', s.platform, 'handle', s.handle
                              )) FROM socials s WHERE s.persona_id = p.id), '[]'::json),
                    'familyIds',
                    COALESCE((SELECT json_agg(fm.family_id)
                                FROM family_members fm WHERE fm.persona_id = p.id), '[]'::json)
                  )) FROM personas p), '[]'::json),
        'edges', COALESCE((SELECT json_agg(json_build_object(
                    'id', r.id,
                    'fromPersonaId', r.from_persona_id,
                    'toPersonaId',   r.to_persona_id,
                    'category', r.category, 'type', r.type,
                    'isDirectional', r.is_directional,
                    'status', r.status, 'familyId', r.family_id
                  )) FROM relationships r), '[]'::json),
        'families', COALESCE((SELECT json_agg(json_build_object(
                       'id', f.id, 'name', f.name, 'handle', f.handle,
                       'photoId', f.photo_id,
                       'memberIds', (SELECT json_agg(fm.persona_id)
                                       FROM family_members fm
                                      WHERE fm.family_id = f.id)
                     )) FROM families f), '[]'::json)
    );
$$ LANGUAGE SQL STABLE;

CREATE MATERIALIZED VIEW persona_neighborhood AS
SELECT
    p.id AS persona_id,
    p.name,
    jsonb_build_object(
        'persona', jsonb_build_object(
            'id', p.id, 'name', p.name, 'photoId', p.photo_id, 'status', p.status
        ),
        'families', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', f.id, 'name', f.name, 'handle', f.handle,
                'role', fm.role, 'generation', fm.generation
            ))
            FROM family_members fm
            JOIN families f ON f.id = fm.family_id
            WHERE fm.persona_id = p.id
        ), '[]'::jsonb),
        'relationships', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', r.id, 'category', r.category, 'type', r.type,
                'isDirectional', r.is_directional, 'status', r.status,
                'familyId', r.family_id, 'asFromSide', (r.from_persona_id = p.id),
                'other', jsonb_build_object(
                    'id', other.id, 'name', other.name, 'photoId', other.photo_id
                )
            ))
            FROM relationships r
            JOIN personas other
              ON other.id = CASE WHEN r.from_persona_id = p.id
                                 THEN r.to_persona_id ELSE r.from_persona_id END
            WHERE r.from_persona_id = p.id OR r.to_persona_id = p.id
        ), '[]'::jsonb)
    ) AS context
FROM personas p;

CREATE UNIQUE INDEX persona_neighborhood_pk ON persona_neighborhood (persona_id);
CREATE INDEX persona_neighborhood_name_idx ON persona_neighborhood (lower(name));

CREATE OR REPLACE FUNCTION refresh_persona_neighborhood() RETURNS VOID AS $$
    REFRESH MATERIALIZED VIEW CONCURRENTLY persona_neighborhood;
$$ LANGUAGE SQL;

-- ============================================================
-- Storyline arcs + planned posts + library assets
-- (same shape as db/migrations/005-storyline.sql)
-- ============================================================

CREATE TABLE storyline_arcs (
    id                UUID PRIMARY KEY,
    title             TEXT NOT NULL,
    theme             TEXT,
    starts_on         DATE NOT NULL,
    ends_on           DATE NOT NULL,
    status            TEXT NOT NULL DEFAULT 'planning',
    location          TEXT,
    mood              TEXT,
    continuity_notes  TEXT,
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_on >= starts_on)
);
CREATE INDEX storyline_arcs_dates_idx  ON storyline_arcs (starts_on, ends_on);
CREATE INDEX storyline_arcs_status_idx ON storyline_arcs (status);

CREATE TRIGGER storyline_arcs_touch
BEFORE UPDATE ON storyline_arcs
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE storyline_arc_personas (
    arc_id      UUID NOT NULL REFERENCES storyline_arcs(id) ON DELETE CASCADE,
    persona_id  UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    role        TEXT,
    PRIMARY KEY (arc_id, persona_id)
);
CREATE INDEX storyline_arc_personas_persona_idx ON storyline_arc_personas (persona_id);

CREATE TABLE library_assets (
    id              UUID PRIMARY KEY,
    image_id        UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    scene_type      TEXT,
    mood            TEXT,
    location_hint   TEXT,
    time_of_day     TEXT,
    tags            TEXT[] NOT NULL DEFAULT '{}',
    notes           TEXT,
    times_used      INTEGER NOT NULL DEFAULT 0,
    last_used_at    TIMESTAMPTZ,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX library_assets_scene_idx    ON library_assets (scene_type);
CREATE INDEX library_assets_mood_idx     ON library_assets (mood);
CREATE INDEX library_assets_location_idx ON library_assets (location_hint);
CREATE INDEX library_assets_tags_idx     ON library_assets USING GIN (tags);

CREATE TABLE planned_posts (
    id                      UUID PRIMARY KEY,
    arc_id                  UUID REFERENCES storyline_arcs(id) ON DELETE SET NULL,
    persona_id              UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,

    platform                TEXT NOT NULL DEFAULT 'instagram',
    post_type               TEXT NOT NULL,
    story_type              TEXT,
    scheduled_at            TIMESTAMPTZ,
    position_in_arc         INTEGER,

    caption                 TEXT,
    hashtags                TEXT[] NOT NULL DEFAULT '{}',
    overlay_text            TEXT,

    generation_prompt       TEXT,
    generation_model        TEXT,
    reference_image_id      UUID REFERENCES images(id) ON DELETE SET NULL,
    library_asset_id        UUID REFERENCES library_assets(id) ON DELETE SET NULL,

    generated_image_id      UUID REFERENCES images(id) ON DELETE SET NULL,
    generation_metadata     JSONB,
    regeneration_feedback   TEXT,

    fleet_content_id        TEXT,
    fleet_scheduled_post_id TEXT,
    last_push_error         TEXT,
    pushed_at               TIMESTAMPTZ,

    status                  TEXT NOT NULL DEFAULT 'planned',
    rejection_reason        TEXT,
    notes                   TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX planned_posts_arc_idx       ON planned_posts (arc_id);
CREATE INDEX planned_posts_persona_idx   ON planned_posts (persona_id);
CREATE INDEX planned_posts_status_idx    ON planned_posts (status);
CREATE INDEX planned_posts_scheduled_idx ON planned_posts (scheduled_at);
CREATE INDEX planned_posts_push_error_idx ON planned_posts (status) WHERE last_push_error IS NOT NULL;

CREATE TRIGGER planned_posts_touch
BEFORE UPDATE ON planned_posts
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Soul ID training jobs (migration 006)
-- ============================================================
CREATE TABLE soul_trainings (
    id              UUID PRIMARY KEY,
    persona_id      UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'queued',
    soul_id         TEXT,
    image_ids       UUID[] NOT NULL DEFAULT '{}',
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    error           TEXT,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX soul_trainings_persona_idx ON soul_trainings (persona_id);
CREATE INDEX soul_trainings_status_idx  ON soul_trainings (status);
CREATE INDEX soul_trainings_created_idx ON soul_trainings (created_at DESC);
