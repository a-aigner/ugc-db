-- ============================================================
-- Migration 003: graph queries
--   - persona_subgraph(persona_id, depth): recursive CTE returning nodes + edges
--     reachable within N hops, as a JSON document. Drives the graph view and
--     the MCP server's "give me everyone near X" queries.
--   - persona_neighborhood materialized view: pre-computes each persona's
--     immediate context (1-hop relationships + family memberships) as a JSONB
--     blob. The MCP server hits this for prompt-bundle composition.
--   - Composite indexes for filtered graph queries.
-- ============================================================

-- ---------- composite indexes ----------
CREATE INDEX IF NOT EXISTS relationships_cat_status_idx
   ON relationships (category, status);

-- ---------- persona_subgraph: recursive CTE wrapped in a function ----------
DROP FUNCTION IF EXISTS persona_subgraph(UUID, INT);

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

-- ---------- full graph (no walk) — for the graph view ----------
DROP FUNCTION IF EXISTS full_graph();

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

-- ---------- persona_neighborhood materialized view ----------
-- Each row: a persona's 1-hop context as a JSONB blob, ready for prompt bundles.
DROP MATERIALIZED VIEW IF EXISTS persona_neighborhood;

CREATE MATERIALIZED VIEW persona_neighborhood AS
SELECT
    p.id AS persona_id,
    p.name,
    jsonb_build_object(
        'persona', jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'photoId', p.photo_id,
            'status', p.status
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
                'id', r.id,
                'category', r.category,
                'type', r.type,
                'isDirectional', r.is_directional,
                'status', r.status,
                'familyId', r.family_id,
                'asFromSide', (r.from_persona_id = p.id),
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

-- Refresh function — the API calls this after every relationship/family mutation.
CREATE OR REPLACE FUNCTION refresh_persona_neighborhood() RETURNS VOID AS $$
    REFRESH MATERIALIZED VIEW CONCURRENTLY persona_neighborhood;
$$ LANGUAGE SQL;
