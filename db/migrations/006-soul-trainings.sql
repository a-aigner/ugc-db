-- ============================================================
-- Migration 006: soul_trainings
-- Tracks each Higgsfield Soul ID training job for a persona.
--   - status: queued | running | completed | failed
--   - soul_id: the UUID returned by Higgsfield, copied to personas.soul_id
--     when training completes
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS soul_trainings (
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
CREATE INDEX IF NOT EXISTS soul_trainings_persona_idx ON soul_trainings (persona_id);
CREATE INDEX IF NOT EXISTS soul_trainings_status_idx  ON soul_trainings (status);
CREATE INDEX IF NOT EXISTS soul_trainings_created_idx ON soul_trainings (created_at DESC);
