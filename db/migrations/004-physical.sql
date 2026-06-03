-- ============================================================
-- Migration 004: physical attributes on personas
-- Six optional columns for consistency anchors across many image generations:
--   - height_cm:            numeric, drives relative framing in multi-person shots
--   - build:                free text ("athletic, toned" | "lean")
--   - hair:                 hair color / length / style — single biggest consistency cue
--   - eye_color:            close-up consistency
--   - skin:                 tone + undertones, for editing consistency
--   - distinguishing_marks: tattoos, piercings, scars — character anchors
-- ============================================================

ALTER TABLE personas ADD COLUMN IF NOT EXISTS height_cm            INTEGER;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS build                TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS hair                 TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS eye_color            TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS skin                 TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS distinguishing_marks TEXT;
