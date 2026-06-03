-- ============================================================
-- Migration 001: families, family_members, relationships, relationship_images
-- Idempotent — safe to run on a fresh DB or an existing one.
-- Apply via:
--   docker-compose exec -T db psql -U ugc -d ugc -f - < db/migrations/001-relationships.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS families (
    id           UUID PRIMARY KEY,
    name         TEXT NOT NULL,
    lore         TEXT,
    photo_id     UUID REFERENCES images(id) ON DELETE SET NULL,
    location     TEXT,
    established  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS families_name_idx ON families (lower(name));

DROP TRIGGER IF EXISTS families_touch ON families;
CREATE TRIGGER families_touch
BEFORE UPDATE ON families
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS family_members (
    id                  UUID PRIMARY KEY,
    family_id           UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    persona_id          UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    role                TEXT,
    generation          INTEGER NOT NULL DEFAULT 0,
    parent_member_ids   UUID[] NOT NULL DEFAULT '{}',
    position            INTEGER NOT NULL DEFAULT 0,
    UNIQUE (family_id, persona_id)
);
CREATE INDEX IF NOT EXISTS family_members_family_idx  ON family_members (family_id);
CREATE INDEX IF NOT EXISTS family_members_persona_idx ON family_members (persona_id);

CREATE TABLE IF NOT EXISTS relationships (
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
CREATE INDEX IF NOT EXISTS relationships_from_idx       ON relationships (from_persona_id);
CREATE INDEX IF NOT EXISTS relationships_to_idx         ON relationships (to_persona_id);
CREATE INDEX IF NOT EXISTS relationships_family_idx     ON relationships (family_id);
CREATE INDEX IF NOT EXISTS relationships_category_idx   ON relationships (category);

DROP TRIGGER IF EXISTS relationships_touch ON relationships;
CREATE TRIGGER relationships_touch
BEFORE UPDATE ON relationships
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS relationship_images (
    id                  UUID PRIMARY KEY,
    relationship_id     UUID NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
    position            INTEGER NOT NULL DEFAULT 0,
    image_id            UUID REFERENCES images(id) ON DELETE SET NULL,
    caption             TEXT,
    taken               TEXT
);
CREATE INDEX IF NOT EXISTS relationship_images_rel_idx ON relationship_images (relationship_id);
