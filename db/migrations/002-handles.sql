-- ============================================================
-- Migration 002: handles
--   - families.handle: stable slug, unique, used by MCP server + URLs
--   - index on lower(socials.handle): persona lookup by social handle
-- ============================================================

-- 1. Add families.handle as nullable, backfill, then enforce NOT NULL + UNIQUE.
ALTER TABLE families ADD COLUMN IF NOT EXISTS handle TEXT;

-- Backfill: slugify name (lowercase, ASCII-only, hyphen-separated)
UPDATE families
   SET handle = lower(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(name, '[^a-zA-Z0-9 -]', '', 'g'),  -- strip non-alphanumeric
                      '\s+', '-', 'g'                                    -- spaces → hyphens
                    ),
                    '-+', '-', 'g'                                       -- collapse multiple hyphens
                  )
                )
 WHERE handle IS NULL OR handle = '';

-- Handle collisions in backfill (rare): append row's id suffix if duplicate.
-- We keep this simple — for any duplicates left over, append a short uuid suffix.
WITH dups AS (
  SELECT id, handle,
         row_number() OVER (PARTITION BY handle ORDER BY created_at, id) AS rn
    FROM families
   WHERE handle IS NOT NULL
)
UPDATE families f
   SET handle = f.handle || '-' || substr(replace(f.id::text, '-', ''), 1, 6)
  FROM dups
 WHERE f.id = dups.id AND dups.rn > 1;

-- Now lock it down
ALTER TABLE families ALTER COLUMN handle SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS families_handle_idx ON families (handle);

-- 2. Fast lookup of personas via any social handle.
-- The handle may or may not have a leading '@' — we strip it on insert and on query.
CREATE INDEX IF NOT EXISTS socials_handle_lower_idx
   ON socials (lower(regexp_replace(coalesce(handle, ''), '^@', '')));
