-- ============================================================
-- Migration 007: fleetmanager handoff state
--
-- Adds:
--   - planned_posts.last_push_error  TEXT — last error message from a push attempt
--   - planned_posts.pushed_at        TIMESTAMPTZ — when the post was successfully pushed
--
-- (fleet_content_id and fleet_scheduled_post_id were already added in 005.)
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE planned_posts ADD COLUMN IF NOT EXISTS last_push_error TEXT;
ALTER TABLE planned_posts ADD COLUMN IF NOT EXISTS pushed_at       TIMESTAMPTZ;

-- Useful for "show me posts that failed to push" queries.
CREATE INDEX IF NOT EXISTS planned_posts_push_error_idx
    ON planned_posts (status)
    WHERE last_push_error IS NOT NULL;
