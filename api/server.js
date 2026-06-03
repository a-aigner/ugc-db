/* ============================================================
   AI UGC Creator Database — REST API
   ============================================================ */

import express from "express";
import multer from "multer";
import pg from "pg";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { samplePersonas, sampleFamily, sampleRelationship } from "./samples.js";
import * as fleet from "./fleet.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, "..", "web");

const { Pool } = pg;

const pool = new Pool({
  host: process.env.PGHOST || "db",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.POSTGRES_USER || "ugc",
  password: process.env.POSTGRES_PASSWORD || "ugc",
  database: process.env.POSTGRES_DB || "ugc",
  max: 10,
});

const app = express();
app.use(express.json({ limit: "10mb" }));

// Static frontend — served before /api routes. JSX/CSS/HTML never get cached
// (Babel transpiles in-browser, edits should land on hard refresh).
app.use(
  express.static(STATIC_DIR, {
    setHeaders: (res, filePath) => {
      if (/\.(html|jsx|js|css)$/.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }),
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB per image
});

/* ---------- helpers ---------- */

const uid = () => crypto.randomUUID();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s) => typeof s === "string" && UUID_RE.test(s);

/* Slugify: lowercase, alphanumeric+hyphen only, collapse + trim. */
function slugify(s) {
  if (!s) return "";
  return String(s)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")  // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* Normalize a social-handle string for lookup: strip leading @, lowercase. */
function normalizeHandle(s) {
  return String(s || "").trim().replace(/^@+/, "").toLowerCase();
}

/* Generate a unique family handle from a name. If `name`'s slug collides,
   append -2, -3, … until free. */
async function generateUniqueFamilyHandle(name, excludeId = null) {
  const base = slugify(name) || "family";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const r = await pool.query(
      "SELECT id FROM families WHERE handle=$1 AND ($2::uuid IS NULL OR id <> $2)",
      [candidate, excludeId],
    );
    if (r.rowCount === 0) return candidate;
  }
  // Last resort: append a random suffix
  return `${base}-${crypto.randomBytes(3).toString("hex")}`;
}

/* Resolve a string to a persona UUID. Accepts:
     - UUID                       (returned as-is if it exists)
     - "@maya.moves" / "maya.moves"  (any social handle, normalized)
     - "Maya Rivera"               (case-insensitive name; exact, then prefix)
   Returns: { id, ambiguous?: [{id, name, handles}] } or null.
*/
async function resolvePersona(idOrHandleOrName) {
  if (!idOrHandleOrName) return null;
  const s = String(idOrHandleOrName).trim();

  // 1. UUID
  if (isUuid(s)) {
    const r = await pool.query("SELECT id FROM personas WHERE id=$1", [s]);
    return r.rowCount > 0 ? { id: r.rows[0].id } : null;
  }

  // 2. Social handle (any platform)
  const h = normalizeHandle(s);
  if (h) {
    const r = await pool.query(
      `SELECT DISTINCT p.id, p.name
         FROM personas p
         JOIN socials sc ON sc.persona_id = p.id
        WHERE lower(regexp_replace(coalesce(sc.handle, ''), '^@', '')) = $1`,
      [h],
    );
    if (r.rowCount === 1) return { id: r.rows[0].id };
    if (r.rowCount > 1) {
      const list = await hydrateAmbiguous(r.rows);
      return { id: null, ambiguous: list };
    }
  }

  // 3. Name (exact case-insensitive first, then prefix)
  const exact = await pool.query(
    "SELECT id, name FROM personas WHERE lower(name) = lower($1)",
    [s],
  );
  if (exact.rowCount === 1) return { id: exact.rows[0].id };
  if (exact.rowCount > 1) {
    return { id: null, ambiguous: await hydrateAmbiguous(exact.rows) };
  }

  const prefix = await pool.query(
    "SELECT id, name FROM personas WHERE lower(name) LIKE lower($1) || '%' LIMIT 10",
    [s],
  );
  if (prefix.rowCount === 1) return { id: prefix.rows[0].id };
  if (prefix.rowCount > 1) {
    return { id: null, ambiguous: await hydrateAmbiguous(prefix.rows) };
  }

  return null;
}

async function hydrateAmbiguous(rows) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const handles = await pool.query(
    `SELECT persona_id, platform, handle FROM socials WHERE persona_id = ANY($1::uuid[])`,
    [ids],
  );
  const byId = new Map();
  for (const r of rows) byId.set(r.id, { id: r.id, name: r.name, handles: [] });
  for (const h of handles.rows) {
    const e = byId.get(h.persona_id);
    if (e && h.handle) e.handles.push(`${h.platform}: ${h.handle}`);
  }
  return [...byId.values()];
}

/* Refresh the persona_neighborhood materialized view. Called after every
   mutation that could affect a persona's social context. Concurrent refresh
   doesn't block reads; on a 4-persona DB it completes in <10ms. We swallow
   errors so a refresh failure never breaks the originating mutation. */
async function refreshNeighborhood() {
  try {
    await pool.query("SELECT refresh_persona_neighborhood()");
  } catch (e) {
    // Most common cause: concurrent refresh already in flight, or view not yet
    // created on a brand-new DB. Log but don't propagate.
    console.warn("refresh_persona_neighborhood failed:", e.message);
  }
}

/* Resolve a string to a family UUID. Accepts UUID or handle (slug). */
async function resolveFamily(idOrHandle) {
  if (!idOrHandle) return null;
  const s = String(idOrHandle).trim();
  if (isUuid(s)) {
    const r = await pool.query("SELECT id FROM families WHERE id=$1", [s]);
    return r.rowCount > 0 ? { id: r.rows[0].id } : null;
  }
  const r = await pool.query("SELECT id FROM families WHERE handle=$1", [s]);
  return r.rowCount > 0 ? { id: r.rows[0].id } : null;
}

function rowToPersona(r) {
  return {
    id: r.id,
    name: r.name,
    age: r.age,
    gender: r.gender ?? "",
    status: r.status,
    ethnicity: r.ethnicity ?? "",
    location: r.location ?? "",
    languages: r.languages ?? [],
    biography: r.biography ?? "",
    backstory: r.backstory ?? "",
    personality: r.personality ?? "",
    values: r.persona_values ?? [],
    niches: r.niches ?? [],
    topics: r.topics ?? [],
    style: r.style ?? "",
    boundaries: r.boundaries ?? "",
    managementUrl: r.management_url ?? "",
    managementNotes: r.management_notes ?? "",
    photoId: r.photo_id,
    // Physical attributes (all nullable)
    heightCm: r.height_cm,
    build: r.build ?? "",
    hair: r.hair ?? "",
    eyeColor: r.eye_color ?? "",
    skin: r.skin ?? "",
    distinguishingMarks: r.distinguishing_marks ?? "",
    // Planning context (migration 005)
    occupation: r.occupation ?? "",
    affiliation: r.affiliation ?? "",
    calendarContext: r.calendar_context ?? "",
    soulId: r.soul_id ?? null,
    personaGenerationNotes: r.persona_generation_notes ?? "",
    sample: r.sample,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
    socials: [],
    gallery: [],
  };
}

function rowToSocial(r) {
  return {
    id: r.id,
    platform: r.platform,
    handle: r.handle ?? "",
    url: r.url ?? "",
    email: r.email ?? "",
    password: r.password ?? "",
    notes: r.notes ?? "",
  };
}

function rowToGalleryItem(r) {
  return {
    id: r.id,
    imageId: r.image_id,
    prompt: r.prompt ?? "",
    model: r.model ?? "",
    postTime: r.post_time ?? "",
  };
}

function personaWriteArgs(p) {
  return [
    p.id,
    p.name,
    p.age === "" || p.age == null ? null : Number(p.age),
    p.gender || null,
    p.status || "active",
    p.ethnicity || null,
    p.location || null,
    p.languages || [],
    p.biography || null,
    p.backstory || null,
    p.personality || null,
    p.values || [],
    p.niches || [],
    p.topics || [],
    p.style || null,
    p.boundaries || null,
    p.managementUrl || null,
    p.managementNotes || null,
    p.photoId || null,
    p.heightCm === "" || p.heightCm == null ? null : Number(p.heightCm),
    p.build || null,
    p.hair || null,
    p.eyeColor || null,
    p.skin || null,
    p.distinguishingMarks || null,
    p.occupation || null,
    p.affiliation || null,
    p.calendarContext || null,
    p.soulId || null,
    p.personaGenerationNotes || null,
    !!p.sample,
  ];
}

async function insertPersona(client, p) {
  await client.query(
    `INSERT INTO personas (
       id, name, age, gender, status, ethnicity, location, languages,
       biography, backstory, personality, persona_values, niches, topics,
       style, boundaries, management_url, management_notes, photo_id,
       height_cm, build, hair, eye_color, skin, distinguishing_marks,
       occupation, affiliation, calendar_context, soul_id, persona_generation_notes,
       sample
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
       $20,$21,$22,$23,$24,$25,
       $26,$27,$28,$29,$30,
       $31
     )`,
    personaWriteArgs(p),
  );
}

async function updatePersona(client, p) {
  await client.query(
    `UPDATE personas SET
       name=$2, age=$3, gender=$4, status=$5, ethnicity=$6, location=$7, languages=$8,
       biography=$9, backstory=$10, personality=$11, persona_values=$12, niches=$13, topics=$14,
       style=$15, boundaries=$16, management_url=$17, management_notes=$18, photo_id=$19,
       height_cm=$20, build=$21, hair=$22, eye_color=$23, skin=$24, distinguishing_marks=$25,
       occupation=$26, affiliation=$27, calendar_context=$28, soul_id=$29, persona_generation_notes=$30,
       sample=$31
     WHERE id=$1`,
    personaWriteArgs(p),
  );
}

async function replaceSocials(client, personaId, socials) {
  await client.query("DELETE FROM socials WHERE persona_id=$1", [personaId]);
  for (let i = 0; i < socials.length; i++) {
    const s = socials[i];
    await client.query(
      `INSERT INTO socials (id, persona_id, position, platform, handle, url, email, password, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        s.id || uid(),
        personaId,
        i,
        s.platform || "Other",
        s.handle || null,
        s.url || null,
        s.email || null,
        s.password || null,
        s.notes || null,
      ],
    );
  }
}

async function replaceGallery(client, personaId, gallery) {
  await client.query("DELETE FROM gallery WHERE persona_id=$1", [personaId]);
  for (let i = 0; i < gallery.length; i++) {
    const g = gallery[i];
    await client.query(
      `INSERT INTO gallery (id, persona_id, position, image_id, prompt, model, post_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        g.id || uid(),
        personaId,
        i,
        g.imageId || null,
        g.prompt || null,
        g.model || null,
        g.postTime || null,
      ],
    );
  }
}

async function loadAllPersonas() {
  const personas = await pool.query("SELECT * FROM personas ORDER BY name");
  const socials = await pool.query("SELECT * FROM socials ORDER BY persona_id, position");
  const gallery = await pool.query("SELECT * FROM gallery ORDER BY persona_id, position");

  const byId = new Map();
  for (const r of personas.rows) {
    const p = rowToPersona(r);
    byId.set(p.id, p);
  }
  for (const r of socials.rows) {
    const p = byId.get(r.persona_id);
    if (p) p.socials.push(rowToSocial(r));
  }
  for (const r of gallery.rows) {
    const p = byId.get(r.persona_id);
    if (p) p.gallery.push(rowToGalleryItem(r));
  }
  return [...byId.values()];
}

async function loadOnePersona(id) {
  const personas = await pool.query("SELECT * FROM personas WHERE id=$1", [id]);
  if (personas.rowCount === 0) return null;
  const p = rowToPersona(personas.rows[0]);
  const socials = await pool.query(
    "SELECT * FROM socials WHERE persona_id=$1 ORDER BY position",
    [id],
  );
  const gallery = await pool.query(
    "SELECT * FROM gallery WHERE persona_id=$1 ORDER BY position",
    [id],
  );
  p.socials = socials.rows.map(rowToSocial);
  p.gallery = gallery.rows.map(rowToGalleryItem);

  // Relationships summary (lightweight — no narrative blocks) so the persona
  // detail page can render the new section in one round-trip.
  const rels = await pool.query(
    `SELECT r.id, r.from_persona_id, r.to_persona_id, r.category, r.type,
            r.custom_label, r.is_directional, r.status, r.family_id,
            p_other.id AS other_id, p_other.name AS other_name,
            p_other.photo_id AS other_photo_id,
            f.name AS family_name
       FROM relationships r
       JOIN personas p_other
         ON p_other.id = CASE WHEN r.from_persona_id = $1 THEN r.to_persona_id ELSE r.from_persona_id END
       LEFT JOIN families f ON f.id = r.family_id
      WHERE r.from_persona_id = $1 OR r.to_persona_id = $1
      ORDER BY r.created_at`,
    [id],
  );
  p.relationships = rels.rows.map((r) => ({
    id: r.id,
    category: r.category,
    type: r.type,
    customLabel: r.custom_label,
    isDirectional: r.is_directional,
    // "from this persona" → display the forward label; otherwise display the inverse.
    asFromSide: r.from_persona_id === id,
    status: r.status,
    familyId: r.family_id,
    familyName: r.family_name,
    other: {
      id: r.other_id,
      name: r.other_name,
      photoId: r.other_photo_id,
    },
  }));

  // Families this persona belongs to
  const fams = await pool.query(
    `SELECT fm.family_id, f.name AS family_name, fm.role, fm.generation
       FROM family_members fm
       JOIN families f ON f.id = fm.family_id
      WHERE fm.persona_id = $1
      ORDER BY f.name`,
    [id],
  );
  p.families = fams.rows.map((r) => ({
    id: r.family_id,
    name: r.family_name,
    role: r.role,
    generation: r.generation,
  }));

  return p;
}

/* ---------- families + relationships helpers ---------- */

function rowToFamily(r) {
  return {
    id: r.id,
    name: r.name,
    handle: r.handle,
    lore: r.lore ?? "",
    photoId: r.photo_id,
    location: r.location ?? "",
    established: r.established ?? "",
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  };
}

function rowToFamilyMember(r) {
  return {
    id: r.id,
    familyId: r.family_id,
    personaId: r.persona_id,
    role: r.role ?? "",
    generation: r.generation ?? 0,
    parentMemberIds: r.parent_member_ids ?? [],
    position: r.position ?? 0,
  };
}

function rowToRelationship(r) {
  return {
    id: r.id,
    fromPersonaId: r.from_persona_id,
    toPersonaId: r.to_persona_id,
    category: r.category,
    type: r.type,
    customLabel: r.custom_label ?? "",
    isDirectional: r.is_directional,
    cadence: r.cadence ?? "",
    since: r.since ?? "",
    status: r.status ?? "",
    familyId: r.family_id,
    origin: r.origin ?? "",
    dynamic: r.dynamic ?? "",
    bondingMoments: r.bonding_moments ?? "",
    tensions: r.tensions ?? "",
    mutualInfluence: r.mutual_influence ?? "",
    insideJokes: r.inside_jokes ?? "",
    currentArc: r.current_arc ?? "",
    contentSeeds: r.content_seeds ?? "",
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
    images: [],
  };
}

function rowToRelationshipImage(r) {
  return {
    id: r.id,
    imageId: r.image_id,
    caption: r.caption ?? "",
    taken: r.taken ?? "",
    position: r.position ?? 0,
  };
}

/* Sort persona IDs so symmetric relationships always store with the
   lexicographically smaller UUID as `from_persona_id`. Returns the pair
   in the order to store. */
function normalizeSymmetric(a, b, isDirectional) {
  if (isDirectional) return [a, b];
  return a < b ? [a, b] : [b, a];
}

async function loadFamilyMembers(familyId) {
  const r = await pool.query(
    `SELECT fm.*, p.name AS persona_name, p.photo_id AS persona_photo_id
       FROM family_members fm
       JOIN personas p ON p.id = fm.persona_id
      WHERE fm.family_id = $1
      ORDER BY fm.generation, fm.position`,
    [familyId],
  );
  return r.rows.map((row) => ({
    ...rowToFamilyMember(row),
    persona: {
      id: row.persona_id,
      name: row.persona_name,
      photoId: row.persona_photo_id,
    },
  }));
}

async function loadOneFamily(id) {
  const f = await pool.query("SELECT * FROM families WHERE id=$1", [id]);
  if (f.rowCount === 0) return null;
  const family = rowToFamily(f.rows[0]);
  family.members = await loadFamilyMembers(id);
  return family;
}

async function loadAllFamilies() {
  const f = await pool.query(
    `SELECT f.*, (SELECT COUNT(*)::int FROM family_members fm WHERE fm.family_id=f.id) AS member_count
       FROM families f
       ORDER BY f.name`,
  );
  return f.rows.map((r) => ({ ...rowToFamily(r), memberCount: r.member_count }));
}

async function loadOneRelationship(id) {
  const r = await pool.query("SELECT * FROM relationships WHERE id=$1", [id]);
  if (r.rowCount === 0) return null;
  const rel = rowToRelationship(r.rows[0]);

  // Hydrate both personas (summary)
  const personas = await pool.query(
    "SELECT id, name, age, gender, status, photo_id FROM personas WHERE id = ANY($1::uuid[])",
    [[rel.fromPersonaId, rel.toPersonaId]],
  );
  const byId = new Map(personas.rows.map((p) => [p.id, {
    id: p.id, name: p.name, age: p.age, gender: p.gender,
    status: p.status, photoId: p.photo_id,
  }]));
  rel.fromPersona = byId.get(rel.fromPersonaId);
  rel.toPersona = byId.get(rel.toPersonaId);

  // Images
  const imgs = await pool.query(
    "SELECT * FROM relationship_images WHERE relationship_id=$1 ORDER BY position",
    [id],
  );
  rel.images = imgs.rows.map(rowToRelationshipImage);
  return rel;
}

/* ---------- routes ---------- */

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/personas", async (_req, res, next) => {
  try {
    res.json(await loadAllPersonas());
  } catch (e) {
    next(e);
  }
});

app.get("/api/personas/:idOrHandle", async (req, res, next) => {
  try {
    const ref = await resolvePersona(req.params.idOrHandle);
    if (!ref) return res.status(404).json({ error: "not found" });
    if (!ref.id) {
      return res.status(409).json({ error: "ambiguous", ambiguous: ref.ambiguous });
    }
    const p = await loadOnePersona(ref.id);
    if (!p) return res.status(404).json({ error: "not found" });
    res.json(p);
  } catch (e) {
    next(e);
  }
});

/* Dedicated resolver endpoint — useful for the MCP server to probe before
   committing to a tool call. Returns { id, name } on a single match, or
   { ambiguous: [...] } if multiple candidates. */
app.get("/api/resolve/persona/:identifier", async (req, res, next) => {
  try {
    const ref = await resolvePersona(req.params.identifier);
    if (!ref) return res.status(404).json({ error: "no match" });
    if (!ref.id) return res.status(409).json({ ambiguous: ref.ambiguous });
    const r = await pool.query("SELECT id, name FROM personas WHERE id=$1", [ref.id]);
    res.json({ id: r.rows[0].id, name: r.rows[0].name });
  } catch (e) { next(e); }
});

app.get("/api/resolve/family/:identifier", async (req, res, next) => {
  try {
    const ref = await resolveFamily(req.params.identifier);
    if (!ref || !ref.id) return res.status(404).json({ error: "no match" });
    const r = await pool.query("SELECT id, name, handle FROM families WHERE id=$1", [ref.id]);
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

app.post("/api/personas", async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const p = req.body;
    if (!p || !p.id || !p.name || !p.name.trim()) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "id and name required" });
    }
    await insertPersona(client, p);
    await replaceSocials(client, p.id, p.socials || []);
    await replaceGallery(client, p.id, p.gallery || []);
    await client.query("COMMIT");
    await refreshNeighborhood();
    res.json(await loadOnePersona(p.id));
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
});

app.put("/api/personas/:idOrHandle", async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Resolve identifier — if it's a known persona, target that ID; if it's a
    // raw UUID with no match, treat as create-by-UUID (matches prior behavior).
    let targetId = req.params.idOrHandle;
    if (!isUuid(targetId)) {
      const ref = await resolvePersona(targetId);
      if (!ref || !ref.id) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "persona not found; PUT requires existing or UUID" });
      }
      targetId = ref.id;
    }
    const p = { ...req.body, id: targetId };
    if (!p.name || !p.name.trim()) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "name required" });
    }
    const exists = await client.query("SELECT id FROM personas WHERE id=$1", [targetId]);
    if (exists.rowCount === 0) {
      await insertPersona(client, p);
    } else {
      await updatePersona(client, p);
    }
    await replaceSocials(client, targetId, p.socials || []);
    await replaceGallery(client, targetId, p.gallery || []);
    await client.query("COMMIT");
    await refreshNeighborhood();
    res.json(await loadOnePersona(targetId));
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
});

app.delete("/api/personas/:idOrHandle", async (req, res, next) => {
  try {
    const ref = await resolvePersona(req.params.idOrHandle);
    if (!ref || !ref.id) return res.status(404).json({ error: "not found" });
    await pool.query("DELETE FROM personas WHERE id=$1", [ref.id]);
    await refreshNeighborhood();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.post("/api/images", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "no file" });
    const id = uid();
    await pool.query(
      `INSERT INTO images (id, data, mime_type, size_bytes) VALUES ($1,$2,$3,$4)`,
      [id, req.file.buffer, req.file.mimetype || "application/octet-stream", req.file.size],
    );
    res.json({ id, mimeType: req.file.mimetype, sizeBytes: req.file.size });
  } catch (e) {
    next(e);
  }
});

app.get("/api/images/:id", async (req, res, next) => {
  try {
    const r = await pool.query(
      "SELECT data, mime_type FROM images WHERE id=$1",
      [req.params.id],
    );
    if (r.rowCount === 0) return res.status(404).end();
    res.set("Content-Type", r.rows[0].mime_type || "application/octet-stream");
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.send(r.rows[0].data);
  } catch (e) {
    next(e);
  }
});

/* ---------- families ---------- */

app.get("/api/families", async (_req, res, next) => {
  try {
    res.json(await loadAllFamilies());
  } catch (e) { next(e); }
});

app.get("/api/families/:idOrHandle", async (req, res, next) => {
  try {
    const ref = await resolveFamily(req.params.idOrHandle);
    if (!ref || !ref.id) return res.status(404).json({ error: "not found" });
    const f = await loadOneFamily(ref.id);
    if (!f) return res.status(404).json({ error: "not found" });
    res.json(f);
  } catch (e) { next(e); }
});

/* Validate or auto-generate a family handle. Returns
   { handle } on success, { error } on collision (caller returns 409). */
async function pickFamilyHandle(name, requested, excludeId) {
  if (requested) {
    const slug = slugify(requested);
    if (!slug) return { error: "handle is empty after normalization" };
    const exists = await pool.query(
      "SELECT id FROM families WHERE handle=$1 AND ($2::uuid IS NULL OR id <> $2)",
      [slug, excludeId],
    );
    if (exists.rowCount > 0) return { error: "handle already in use", existingId: exists.rows[0].id };
    return { handle: slug };
  }
  return { handle: await generateUniqueFamilyHandle(name, excludeId) };
}

app.post("/api/families", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.id || !b.name || !b.name.trim()) {
      return res.status(400).json({ error: "id and name required" });
    }
    const pick = await pickFamilyHandle(b.name, b.handle, null);
    if (pick.error) return res.status(409).json(pick);
    await pool.query(
      `INSERT INTO families (id, name, handle, lore, photo_id, location, established)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [b.id, b.name.trim(), pick.handle, b.lore || null, b.photoId || null, b.location || null, b.established || null],
    );
    await refreshNeighborhood();
    res.json(await loadOneFamily(b.id));
  } catch (e) { next(e); }
});

app.put("/api/families/:idOrHandle", async (req, res, next) => {
  try {
    const ref = await resolveFamily(req.params.idOrHandle);
    const targetId = ref?.id || (isUuid(req.params.idOrHandle) ? req.params.idOrHandle : null);
    if (!targetId) {
      // No existing record found and we got a non-UUID; this is a create-by-handle attempt.
      // Caller should POST instead. Reject so we don't silently create with the wrong id.
      return res.status(404).json({ error: "family not found; use POST to create" });
    }
    const b = { ...req.body, id: targetId };
    if (!b.name || !b.name.trim()) return res.status(400).json({ error: "name required" });
    const pick = await pickFamilyHandle(b.name, b.handle, targetId);
    if (pick.error) return res.status(409).json(pick);

    const exists = await pool.query("SELECT id FROM families WHERE id=$1", [targetId]);
    if (exists.rowCount === 0) {
      await pool.query(
        `INSERT INTO families (id, name, handle, lore, photo_id, location, established)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [targetId, b.name.trim(), pick.handle, b.lore || null, b.photoId || null, b.location || null, b.established || null],
      );
    } else {
      await pool.query(
        `UPDATE families SET name=$2, handle=$3, lore=$4, photo_id=$5, location=$6, established=$7 WHERE id=$1`,
        [targetId, b.name.trim(), pick.handle, b.lore || null, b.photoId || null, b.location || null, b.established || null],
      );
    }
    await refreshNeighborhood();
    res.json(await loadOneFamily(targetId));
  } catch (e) { next(e); }
});

app.delete("/api/families/:idOrHandle", async (req, res, next) => {
  try {
    const ref = await resolveFamily(req.params.idOrHandle);
    if (!ref || !ref.id) return res.status(404).json({ error: "not found" });
    await pool.query("DELETE FROM families WHERE id=$1", [ref.id]);
    await refreshNeighborhood();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* family members */

async function validateParentMemberIds(familyId, parentIds) {
  if (!parentIds || parentIds.length === 0) return;
  if (parentIds.length > 2) throw new Error("at most 2 parents per member");
  const r = await pool.query(
    "SELECT COUNT(*)::int AS n FROM family_members WHERE family_id=$1 AND id = ANY($2::uuid[])",
    [familyId, parentIds],
  );
  if (r.rows[0].n !== parentIds.length) {
    throw new Error("one or more parent_member_ids do not belong to this family");
  }
}

app.post("/api/families/:idOrHandle/members", async (req, res, next) => {
  try {
    const ref = await resolveFamily(req.params.idOrHandle);
    if (!ref || !ref.id) return res.status(404).json({ error: "family not found" });
    const familyId = ref.id;
    const m = req.body || {};
    // personaId may also be a handle or name — resolve it
    let personaUuid = m.personaId;
    if (personaUuid && !isUuid(personaUuid)) {
      const pref = await resolvePersona(personaUuid);
      if (!pref || !pref.id) {
        return res.status(404).json({ error: "persona not found", ambiguous: pref?.ambiguous });
      }
      personaUuid = pref.id;
    }
    if (!personaUuid) return res.status(400).json({ error: "personaId required" });
    await validateParentMemberIds(familyId, m.parentMemberIds || []);
    const memberId = m.id || uid();
    await pool.query(
      `INSERT INTO family_members (id, family_id, persona_id, role, generation, parent_member_ids, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (family_id, persona_id) DO UPDATE
         SET role=EXCLUDED.role, generation=EXCLUDED.generation,
             parent_member_ids=EXCLUDED.parent_member_ids, position=EXCLUDED.position`,
      [memberId, familyId, personaUuid, m.role || null, m.generation || 0, m.parentMemberIds || [], m.position || 0],
    );
    await refreshNeighborhood();
    res.json(await loadOneFamily(familyId));
  } catch (e) { next(e); }
});

app.put("/api/families/:idOrHandle/members/:mid", async (req, res, next) => {
  try {
    const ref = await resolveFamily(req.params.idOrHandle);
    if (!ref || !ref.id) return res.status(404).json({ error: "family not found" });
    const familyId = ref.id;
    const mid = req.params.mid;
    const m = req.body || {};
    await validateParentMemberIds(familyId, m.parentMemberIds || []);
    const r = await pool.query(
      `UPDATE family_members SET role=$3, generation=$4, parent_member_ids=$5, position=$6
       WHERE family_id=$1 AND id=$2`,
      [familyId, mid, m.role || null, m.generation || 0, m.parentMemberIds || [], m.position || 0],
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "member not found" });
    await refreshNeighborhood();
    res.json(await loadOneFamily(familyId));
  } catch (e) { next(e); }
});

app.delete("/api/families/:idOrHandle/members/:mid", async (req, res, next) => {
  try {
    const ref = await resolveFamily(req.params.idOrHandle);
    if (!ref || !ref.id) return res.status(404).json({ error: "family not found" });
    await pool.query("DELETE FROM family_members WHERE family_id=$1 AND id=$2", [ref.id, req.params.mid]);
    await refreshNeighborhood();
    res.json(await loadOneFamily(ref.id));
  } catch (e) { next(e); }
});

/* ---------- relationships ---------- */

app.get("/api/relationships", async (req, res, next) => {
  try {
    const conds = [];
    const args = [];
    if (req.query.persona_id) {
      args.push(req.query.persona_id);
      conds.push(`(from_persona_id = $${args.length} OR to_persona_id = $${args.length})`);
    }
    if (req.query.family_id) {
      args.push(req.query.family_id);
      conds.push(`family_id = $${args.length}`);
    }
    if (req.query.category) {
      args.push(req.query.category);
      conds.push(`category = $${args.length}`);
    }
    if (req.query.status) {
      args.push(req.query.status);
      conds.push(`status = $${args.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const rs = await pool.query(`SELECT * FROM relationships ${where} ORDER BY created_at`, args);
    res.json(rs.rows.map(rowToRelationship));
  } catch (e) { next(e); }
});

app.get("/api/relationships/:id", async (req, res, next) => {
  try {
    const rel = await loadOneRelationship(req.params.id);
    if (!rel) return res.status(404).json({ error: "not found" });
    res.json(rel);
  } catch (e) { next(e); }
});

const REL_TEXT_FIELDS = [
  "origin", "dynamic", "bonding_moments", "tensions",
  "mutual_influence", "inside_jokes", "current_arc", "content_seeds",
];

function relInsertArgs(b) {
  const [from, to] = normalizeSymmetric(b.fromPersonaId, b.toPersonaId, !!b.isDirectional);
  return [
    b.id, from, to, b.category, b.type,
    b.customLabel || null, !!b.isDirectional,
    b.cadence || null, b.since || null, b.status || null, b.familyId || null,
    b.origin || null, b.dynamic || null, b.bondingMoments || null, b.tensions || null,
    b.mutualInfluence || null, b.insideJokes || null, b.currentArc || null, b.contentSeeds || null,
  ];
}

app.post("/api/relationships", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.id || !b.fromPersonaId || !b.toPersonaId || !b.category || !b.type) {
      return res.status(400).json({ error: "id, fromPersonaId, toPersonaId, category, type required" });
    }
    if (b.fromPersonaId === b.toPersonaId) {
      return res.status(400).json({ error: "fromPersonaId and toPersonaId must differ" });
    }
    // Check for an existing record matching the normalized pair + category + type
    const [from, to] = normalizeSymmetric(b.fromPersonaId, b.toPersonaId, !!b.isDirectional);
    const existing = await pool.query(
      `SELECT id FROM relationships
        WHERE from_persona_id=$1 AND to_persona_id=$2 AND category=$3 AND type=$4`,
      [from, to, b.category, b.type],
    );
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: "relationship already exists", existingId: existing.rows[0].id });
    }
    await pool.query(
      `INSERT INTO relationships (
         id, from_persona_id, to_persona_id, category, type,
         custom_label, is_directional,
         cadence, since, status, family_id,
         origin, dynamic, bonding_moments, tensions,
         mutual_influence, inside_jokes, current_arc, content_seeds
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      relInsertArgs(b),
    );
    await refreshNeighborhood();
    res.json(await loadOneRelationship(b.id));
  } catch (e) { next(e); }
});

app.put("/api/relationships/:id", async (req, res, next) => {
  try {
    const b = { ...req.body, id: req.params.id };
    if (!b.fromPersonaId || !b.toPersonaId || !b.category || !b.type) {
      return res.status(400).json({ error: "fromPersonaId, toPersonaId, category, type required" });
    }
    const [from, to] = normalizeSymmetric(b.fromPersonaId, b.toPersonaId, !!b.isDirectional);
    const exists = await pool.query("SELECT id FROM relationships WHERE id=$1", [b.id]);
    if (exists.rowCount === 0) {
      // upsert behavior: create
      await pool.query(
        `INSERT INTO relationships (
           id, from_persona_id, to_persona_id, category, type,
           custom_label, is_directional,
           cadence, since, status, family_id,
           origin, dynamic, bonding_moments, tensions,
           mutual_influence, inside_jokes, current_arc, content_seeds
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        relInsertArgs(b),
      );
    } else {
      await pool.query(
        `UPDATE relationships SET
           from_persona_id=$2, to_persona_id=$3, category=$4, type=$5,
           custom_label=$6, is_directional=$7,
           cadence=$8, since=$9, status=$10, family_id=$11,
           origin=$12, dynamic=$13, bonding_moments=$14, tensions=$15,
           mutual_influence=$16, inside_jokes=$17, current_arc=$18, content_seeds=$19
         WHERE id=$1`,
        relInsertArgs(b),
      );
    }
    await refreshNeighborhood();
    res.json(await loadOneRelationship(b.id));
  } catch (e) { next(e); }
});

app.delete("/api/relationships/:id", async (req, res, next) => {
  try {
    await pool.query("DELETE FROM relationships WHERE id=$1", [req.params.id]);
    await refreshNeighborhood();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post("/api/relationships/:id/images", upload.single("file"), async (req, res, next) => {
  try {
    const relId = req.params.id;
    const rel = await pool.query("SELECT id FROM relationships WHERE id=$1", [relId]);
    if (rel.rowCount === 0) return res.status(404).json({ error: "relationship not found" });
    if (!req.file) return res.status(400).json({ error: "no file" });
    const imageId = uid();
    await pool.query(
      `INSERT INTO images (id, data, mime_type, size_bytes) VALUES ($1,$2,$3,$4)`,
      [imageId, req.file.buffer, req.file.mimetype || "application/octet-stream", req.file.size],
    );
    const riId = uid();
    const positionRow = await pool.query(
      "SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM relationship_images WHERE relationship_id=$1",
      [relId],
    );
    await pool.query(
      `INSERT INTO relationship_images (id, relationship_id, position, image_id, caption, taken)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [riId, relId, positionRow.rows[0].pos, imageId, req.body.caption || null, req.body.taken || null],
    );
    res.json({ id: riId, imageId, caption: req.body.caption || "", taken: req.body.taken || "", position: positionRow.rows[0].pos });
  } catch (e) { next(e); }
});

app.delete("/api/relationships/:id/images/:iid", async (req, res, next) => {
  try {
    await pool.query(
      "DELETE FROM relationship_images WHERE id=$1 AND relationship_id=$2",
      [req.params.iid, req.params.id],
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ============================================================
   Prompt bundles — LLM-ready JSON shaped for image generation
   and content writing. Single source of truth for what the MCP
   server feeds downstream tools.
   ============================================================ */

const SOCIAL_PRIORITY = ["Instagram", "TikTok", "YouTube", "X", "Threads", "Snapchat", "OnlyFans", "Fanvue", "Patreon", "Twitch"];

/* Pick the most "addressable" handle from a persona's socials.
   Instagram first, then TikTok, then whatever's there. */
function pickPrimaryHandle(socials) {
  if (!socials || socials.length === 0) return null;
  for (const plat of SOCIAL_PRIORITY) {
    const s = socials.find((x) => x.platform === plat && x.handle);
    if (s) return { platform: plat, handle: s.handle };
  }
  const any = socials.find((s) => s.handle);
  return any ? { platform: any.platform, handle: any.handle } : null;
}

function publicImageUrl(imageId) {
  return imageId ? `/api/images/${imageId}` : null;
}

/* Sample up to `n` items from an array, evenly spaced. */
function sampleEvenly(arr, n) {
  if (!arr || arr.length === 0) return [];
  if (arr.length <= n) return arr.slice();
  const step = arr.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

/* Build a persona prompt-bundle. `depth` controls how much is included:
     'full' — everything (default)
     'summary' — fields useful inside a family/pair bundle without payload explosion */
async function buildPersonaBundle(personaId, { sampleImages = 10, depth = "full" } = {}) {
  const p = await loadOnePersona(personaId);
  if (!p) return null;

  const primary = pickPrimaryHandle(p.socials);
  const handles = (p.socials || [])
    .filter((s) => s.handle)
    .map((s) => ({ platform: s.platform, handle: s.handle, url: s.url || null }));

  const samples = sampleEvenly(p.gallery || [], sampleImages).map((g) => ({
    imageUrl: publicImageUrl(g.imageId),
    prompt: g.prompt || "",
    model: g.model || "",
    postTime: g.postTime || "",
  }));

  const persona = {
    id: p.id,
    handle: primary ? `@${String(primary.handle).replace(/^@/, "")}` : null,
    primaryPlatform: primary ? primary.platform : null,
    name: p.name,
    age: p.age,
    gender: p.gender,
    location: p.location,
    ethnicity: p.ethnicity,
    languages: p.languages || [],
    status: p.status,
    // Planning context — used by the content-planner skill
    occupation: p.occupation || "",
    affiliation: p.affiliation || "",
    calendarContext: p.calendarContext || "",
    soulId: p.soulId || null,
    personaGenerationNotes: p.personaGenerationNotes || "",
  };

  const story = {
    biography: p.biography || "",
    backstory: p.backstory || "",
    personality: p.personality || "",
    values: p.values || [],
  };

  const visual = {
    referencePhotoUrl: publicImageUrl(p.photoId),
    style: p.style || "",
    boundaries: p.boundaries || "",
    physical: {
      heightCm: p.heightCm ?? null,
      build: p.build || "",
      hair: p.hair || "",
      eyeColor: p.eyeColor || "",
      skin: p.skin || "",
      distinguishingMarks: p.distinguishingMarks || "",
    },
    samplePrompts: samples,
  };

  const social = {
    handles,
    niches: p.niches || [],
    topics: p.topics || [],
  };

  if (depth === "summary") {
    return { persona, story, visual, social };
  }

  // Full bundle adds the 1-hop neighborhood
  const neighborhood = {
    relationships: (p.relationships || []).map((r) => ({
      id: r.id,
      category: r.category,
      type: r.type,
      customLabel: r.customLabel || "",
      isDirectional: r.isDirectional,
      asFromSide: r.asFromSide,
      status: r.status,
      familyId: r.familyId,
      familyName: r.familyName,
      other: {
        id: r.other.id,
        name: r.other.name,
        photoId: r.other.photoId,
      },
    })),
    families: (p.families || []).map((f) => ({
      id: f.id, name: f.name, role: f.role, generation: f.generation,
    })),
  };

  return { persona, story, visual, social, neighborhood };
}

async function buildRelationshipBundle(relationshipId, { sampleImages = 5 } = {}) {
  const r = await loadOneRelationship(relationshipId);
  if (!r) return null;

  const [from, to] = await Promise.all([
    buildPersonaBundle(r.fromPersona.id, { sampleImages, depth: "summary" }),
    buildPersonaBundle(r.toPersona.id, { sampleImages, depth: "summary" }),
  ]);

  const t = (await pool.query(
    "SELECT * FROM relationships WHERE id=$1", [relationshipId],
  )).rows[0];

  return {
    relationship: {
      id: t.id,
      category: t.category,
      type: t.type,
      customLabel: t.custom_label || "",
      isDirectional: t.is_directional,
      status: t.status || "",
      cadence: t.cadence || "",
      since: t.since || "",
      familyId: t.family_id,
      narrative: {
        origin: t.origin || "",
        dynamic: t.dynamic || "",
        bondingMoments: t.bonding_moments || "",
        tensions: t.tensions || "",
        mutualInfluence: t.mutual_influence || "",
        insideJokes: t.inside_jokes || "",
        currentArc: t.current_arc || "",
        contentSeeds: t.content_seeds || "",
      },
    },
    from,
    to,
    photosTogether: (r.images || []).map((img) => ({
      imageUrl: publicImageUrl(img.imageId),
      caption: img.caption || "",
      taken: img.taken || "",
    })),
  };
}

async function buildFamilyBundle(familyId, { sampleImages = 5 } = {}) {
  const fam = await loadOneFamily(familyId);
  if (!fam) return null;

  // Each member gets a summary-depth persona bundle
  const members = await Promise.all(
    (fam.members || []).map(async (m) => {
      const bundle = await buildPersonaBundle(m.personaId, { sampleImages, depth: "summary" });
      return {
        memberId: m.id,
        role: m.role || "",
        generation: m.generation || 0,
        parentMemberIds: m.parentMemberIds || [],
        position: m.position || 0,
        ...bundle,
      };
    }),
  );

  // Relationships *within* the family — useful for body-language hints in family-shoot prompts
  const memberPersonaIds = (fam.members || []).map((m) => m.personaId);
  let intraRels = [];
  if (memberPersonaIds.length >= 2) {
    const r = await pool.query(
      `SELECT * FROM relationships
        WHERE from_persona_id = ANY($1::uuid[])
          AND to_persona_id   = ANY($1::uuid[])`,
      [memberPersonaIds],
    );
    intraRels = r.rows.map((row) => ({
      id: row.id,
      fromPersonaId: row.from_persona_id,
      toPersonaId: row.to_persona_id,
      category: row.category,
      type: row.type,
      status: row.status || "",
      narrative: {
        origin: row.origin || "",
        dynamic: row.dynamic || "",
        bondingMoments: row.bonding_moments || "",
        currentArc: row.current_arc || "",
      },
    }));
  }

  return {
    family: {
      id: fam.id,
      handle: fam.handle,
      name: fam.name,
      lore: fam.lore || "",
      location: fam.location || "",
      established: fam.established || "",
      coverPhotoUrl: publicImageUrl(fam.photoId),
    },
    members,
    intraRelationships: intraRels,
  };
}

/* ---------- prompt-bundle routes ---------- */

app.get("/api/personas/:idOrHandle/prompt-bundle", async (req, res, next) => {
  try {
    const ref = await resolvePersona(req.params.idOrHandle);
    if (!ref) return res.status(404).json({ error: "not found" });
    if (!ref.id) return res.status(409).json({ ambiguous: ref.ambiguous });
    const samples = Number(req.query.samples) || 10;
    const bundle = await buildPersonaBundle(ref.id, { sampleImages: samples });
    if (!bundle) return res.status(404).json({ error: "not found" });
    res.json(bundle);
  } catch (e) { next(e); }
});

app.get("/api/relationships/:id/prompt-bundle", async (req, res, next) => {
  try {
    const samples = Number(req.query.samples) || 5;
    const bundle = await buildRelationshipBundle(req.params.id, { sampleImages: samples });
    if (!bundle) return res.status(404).json({ error: "not found" });
    res.json(bundle);
  } catch (e) { next(e); }
});

app.get("/api/families/:idOrHandle/prompt-bundle", async (req, res, next) => {
  try {
    const ref = await resolveFamily(req.params.idOrHandle);
    if (!ref || !ref.id) return res.status(404).json({ error: "not found" });
    const samples = Number(req.query.samples) || 5;
    const bundle = await buildFamilyBundle(ref.id, { sampleImages: samples });
    if (!bundle) return res.status(404).json({ error: "not found" });
    res.json(bundle);
  } catch (e) { next(e); }
});

/* The "give me the family for this persona" entry point — lets the MCP
   server start from @mayamoves and get back The Riveras' full bundle. */
app.get("/api/personas/:idOrHandle/family-bundle", async (req, res, next) => {
  try {
    const ref = await resolvePersona(req.params.idOrHandle);
    if (!ref) return res.status(404).json({ error: "persona not found" });
    if (!ref.id) return res.status(409).json({ ambiguous: ref.ambiguous });

    // Find the families this persona belongs to
    const fams = await pool.query(
      `SELECT f.id, f.name, f.handle
         FROM families f
         JOIN family_members fm ON fm.family_id = f.id
        WHERE fm.persona_id = $1
        ORDER BY f.name`,
      [ref.id],
    );
    if (fams.rowCount === 0) {
      return res.status(404).json({ error: "persona is not in any family" });
    }

    let targetFamilyId;
    if (req.query.family) {
      // Disambiguate to a specific family
      const famRef = await resolveFamily(req.query.family);
      if (!famRef || !famRef.id) {
        return res.status(404).json({ error: "family param did not resolve" });
      }
      if (!fams.rows.some((r) => r.id === famRef.id)) {
        return res.status(404).json({ error: "persona is not in that family" });
      }
      targetFamilyId = famRef.id;
    } else if (fams.rowCount === 1) {
      targetFamilyId = fams.rows[0].id;
    } else {
      // Multiple families, no disambiguation → ambiguous
      return res.status(409).json({
        error: "persona belongs to multiple families; specify ?family=<handle>",
        families: fams.rows.map((r) => ({ id: r.id, name: r.name, handle: r.handle })),
      });
    }

    const samples = Number(req.query.samples) || 5;
    const bundle = await buildFamilyBundle(targetFamilyId, { sampleImages: samples });
    if (!bundle) return res.status(404).json({ error: "family not found" });
    res.json(bundle);
  } catch (e) { next(e); }
});

/* Lightweight neighborhood query — reads the materialized view directly.
   For the MCP server when it just wants "who's near this persona" without
   the full prompt context. */
app.get("/api/personas/:idOrHandle/neighborhood", async (req, res, next) => {
  try {
    const ref = await resolvePersona(req.params.idOrHandle);
    if (!ref) return res.status(404).json({ error: "not found" });
    if (!ref.id) return res.status(409).json({ ambiguous: ref.ambiguous });
    const r = await pool.query(
      "SELECT context FROM persona_neighborhood WHERE persona_id=$1",
      [ref.id],
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "not found" });
    res.json(r.rows[0].context);
  } catch (e) { next(e); }
});

/* Full lightweight graph — for the upcoming graph view AND for MCP-server
   "give me everyone" queries. Reads the SQL function (one query, well-indexed). */
app.get("/api/graph", async (_req, res, next) => {
  try {
    const r = await pool.query("SELECT full_graph() AS g");
    res.json(r.rows[0].g);
  } catch (e) { next(e); }
});

/* Subgraph centered on a persona, N hops out. */
app.get("/api/graph/neighborhood/:idOrHandle", async (req, res, next) => {
  try {
    const ref = await resolvePersona(req.params.idOrHandle);
    if (!ref) return res.status(404).json({ error: "not found" });
    if (!ref.id) return res.status(409).json({ ambiguous: ref.ambiguous });
    const depth = Math.max(0, Math.min(4, Number(req.query.depth) || 2));
    const r = await pool.query("SELECT persona_subgraph($1::uuid, $2::int) AS g", [ref.id, depth]);
    res.json(r.rows[0].g);
  } catch (e) { next(e); }
});

/* ============================================================
   Storyline arcs + planned posts + library assets
   ============================================================ */

const PLANNED_POST_STATUSES = [
  "planned", "approved", "generating", "generated",
  "accepted", "rejected", "pushed", "posted",
];

function rowToArc(r) {
  return {
    id: r.id,
    title: r.title,
    theme: r.theme ?? "",
    startsOn: r.starts_on ? r.starts_on.toISOString().slice(0, 10) : null,
    endsOn:   r.ends_on   ? r.ends_on.toISOString().slice(0, 10) : null,
    status: r.status,
    location: r.location ?? "",
    mood: r.mood ?? "",
    continuityNotes: r.continuity_notes ?? "",
    notes: r.notes ?? "",
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  };
}

function rowToPlannedPost(r) {
  return {
    id: r.id,
    arcId: r.arc_id,
    personaId: r.persona_id,
    platform: r.platform,
    postType: r.post_type,
    storyType: r.story_type ?? "",
    scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
    positionInArc: r.position_in_arc,
    caption: r.caption ?? "",
    hashtags: r.hashtags ?? [],
    overlayText: r.overlay_text ?? "",
    generationPrompt: r.generation_prompt ?? "",
    generationModel:  r.generation_model ?? "",
    referenceImageId: r.reference_image_id,
    libraryAssetId:   r.library_asset_id,
    generatedImageId: r.generated_image_id,
    generationMetadata: r.generation_metadata ?? null,
    regenerationFeedback: r.regeneration_feedback ?? "",
    fleetContentId: r.fleet_content_id ?? null,
    fleetScheduledPostId: r.fleet_scheduled_post_id ?? null,
    lastPushError: r.last_push_error ?? null,
    pushedAt: r.pushed_at ? new Date(r.pushed_at).toISOString() : null,
    status: r.status,
    rejectionReason: r.rejection_reason ?? "",
    notes: r.notes ?? "",
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  };
}

function rowToLibraryAsset(r) {
  return {
    id: r.id,
    imageId: r.image_id,
    imageUrl: `/api/images/${r.image_id}`,
    sceneType: r.scene_type ?? "",
    mood: r.mood ?? "",
    locationHint: r.location_hint ?? "",
    timeOfDay: r.time_of_day ?? "",
    tags: r.tags ?? [],
    notes: r.notes ?? "",
    timesUsed: r.times_used ?? 0,
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
    uploadedAt: new Date(r.uploaded_at).toISOString(),
  };
}

async function loadOneArc(id) {
  const arc = await pool.query("SELECT * FROM storyline_arcs WHERE id=$1", [id]);
  if (arc.rowCount === 0) return null;
  const out = rowToArc(arc.rows[0]);

  const personas = await pool.query(
    `SELECT sap.role, p.id, p.name, p.photo_id, p.occupation,
            (SELECT json_agg(json_build_object('platform', s.platform, 'handle', s.handle))
               FROM socials s WHERE s.persona_id = p.id AND s.handle IS NOT NULL) AS handles
       FROM storyline_arc_personas sap
       JOIN personas p ON p.id = sap.persona_id
      WHERE sap.arc_id = $1
      ORDER BY p.name`,
    [id],
  );
  out.personas = personas.rows.map((row) => ({
    id: row.id,
    name: row.name,
    photoId: row.photo_id,
    occupation: row.occupation ?? "",
    role: row.role ?? "lead",
    handles: row.handles ?? [],
  }));

  const posts = await pool.query(
    "SELECT * FROM planned_posts WHERE arc_id=$1 ORDER BY position_in_arc NULLS LAST, scheduled_at NULLS LAST, created_at",
    [id],
  );
  out.plannedPosts = posts.rows.map(rowToPlannedPost);
  return out;
}

/* ---------- arc routes ---------- */

app.get("/api/arcs", async (req, res, next) => {
  try {
    const conds = [];
    const args = [];

    if (req.query.persona_id) {
      args.push(req.query.persona_id);
      conds.push(`a.id IN (SELECT arc_id FROM storyline_arc_personas WHERE persona_id = $${args.length})`);
    } else if (req.query.persona) {
      // resolve handle/name
      const ref = await resolvePersona(req.query.persona);
      if (!ref || !ref.id) return res.json([]);
      args.push(ref.id);
      conds.push(`a.id IN (SELECT arc_id FROM storyline_arc_personas WHERE persona_id = $${args.length})`);
    }
    if (req.query.status) {
      args.push(req.query.status);
      conds.push(`a.status = $${args.length}`);
    }
    if (req.query.from) {
      args.push(req.query.from);
      conds.push(`a.ends_on >= $${args.length}`);
    }
    if (req.query.to) {
      args.push(req.query.to);
      conds.push(`a.starts_on <= $${args.length}`);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const r = await pool.query(
      `SELECT a.*,
              (SELECT COUNT(*)::int FROM storyline_arc_personas sap WHERE sap.arc_id = a.id) AS persona_count,
              (SELECT COUNT(*)::int FROM planned_posts pp WHERE pp.arc_id = a.id) AS post_count
         FROM storyline_arcs a
         ${where}
         ORDER BY a.starts_on DESC NULLS LAST`,
      args,
    );
    res.json(r.rows.map((row) => ({
      ...rowToArc(row),
      personaCount: row.persona_count,
      postCount: row.post_count,
    })));
  } catch (e) { next(e); }
});

app.get("/api/arcs/:id", async (req, res, next) => {
  try {
    const arc = await loadOneArc(req.params.id);
    if (!arc) return res.status(404).json({ error: "not found" });
    res.json(arc);
  } catch (e) { next(e); }
});

app.post("/api/arcs", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const b = req.body || {};
    if (!b.id || !b.title || !b.title.trim() || !b.startsOn || !b.endsOn) {
      return res.status(400).json({ error: "id, title, startsOn, endsOn required" });
    }
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO storyline_arcs (id, title, theme, starts_on, ends_on, status, location, mood, continuity_notes, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [b.id, b.title.trim(), b.theme || null, b.startsOn, b.endsOn,
       b.status || "planning", b.location || null, b.mood || null,
       b.continuityNotes || null, b.notes || null],
    );
    // Personas: array of { id_or_handle, role }
    for (const p of (b.personas || [])) {
      let personaId = p.id || p.personaId;
      if (personaId && !isUuid(personaId)) {
        const ref = await resolvePersona(personaId);
        if (!ref || !ref.id) throw new Error(`could not resolve persona '${personaId}'`);
        personaId = ref.id;
      }
      if (!personaId && p.handle) {
        const ref = await resolvePersona(p.handle);
        if (!ref || !ref.id) throw new Error(`could not resolve persona handle '${p.handle}'`);
        personaId = ref.id;
      }
      if (!personaId) continue;
      await client.query(
        `INSERT INTO storyline_arc_personas (arc_id, persona_id, role)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [b.id, personaId, p.role || "lead"],
      );
    }
    await client.query("COMMIT");
    res.json(await loadOneArc(b.id));
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
});

app.put("/api/arcs/:id", async (req, res, next) => {
  try {
    const b = { ...req.body, id: req.params.id };
    if (!b.title || !b.title.trim()) return res.status(400).json({ error: "title required" });
    if (!b.startsOn || !b.endsOn)    return res.status(400).json({ error: "startsOn and endsOn required" });
    await pool.query(
      `UPDATE storyline_arcs SET title=$2, theme=$3, starts_on=$4, ends_on=$5,
              status=$6, location=$7, mood=$8, continuity_notes=$9, notes=$10
        WHERE id=$1`,
      [b.id, b.title.trim(), b.theme || null, b.startsOn, b.endsOn,
       b.status || "planning", b.location || null, b.mood || null,
       b.continuityNotes || null, b.notes || null],
    );
    res.json(await loadOneArc(b.id));
  } catch (e) { next(e); }
});

app.delete("/api/arcs/:id", async (req, res, next) => {
  try {
    await pool.query("DELETE FROM storyline_arcs WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post("/api/arcs/:id/personas", async (req, res, next) => {
  try {
    const b = req.body || {};
    let personaId = b.personaId;
    if (personaId && !isUuid(personaId)) {
      const ref = await resolvePersona(personaId);
      if (!ref || !ref.id) return res.status(404).json({ error: "persona not found", ambiguous: ref?.ambiguous });
      personaId = ref.id;
    }
    if (!personaId) return res.status(400).json({ error: "personaId required" });
    await pool.query(
      `INSERT INTO storyline_arc_personas (arc_id, persona_id, role)
       VALUES ($1,$2,$3) ON CONFLICT (arc_id, persona_id) DO UPDATE SET role=EXCLUDED.role`,
      [req.params.id, personaId, b.role || "lead"],
    );
    res.json(await loadOneArc(req.params.id));
  } catch (e) { next(e); }
});

app.delete("/api/arcs/:id/personas/:personaId", async (req, res, next) => {
  try {
    await pool.query(
      "DELETE FROM storyline_arc_personas WHERE arc_id=$1 AND persona_id=$2",
      [req.params.id, req.params.personaId],
    );
    res.json(await loadOneArc(req.params.id));
  } catch (e) { next(e); }
});

/* ---------- planned post routes ---------- */

function plannedPostWriteArgs(p, idForUpdate = null) {
  return [
    idForUpdate || p.id,
    p.arcId || null,
    p.personaId,
    p.platform || "instagram",
    p.postType,
    p.storyType || null,
    p.scheduledAt || null,
    p.positionInArc ?? null,
    p.caption || null,
    p.hashtags || [],
    p.overlayText || null,
    p.generationPrompt || null,
    p.generationModel || null,
    p.referenceImageId || null,
    p.libraryAssetId || null,
    p.generatedImageId || null,
    p.generationMetadata || null,
    p.regenerationFeedback || null,
    p.fleetContentId || null,
    p.fleetScheduledPostId || null,
    p.status || "planned",
    p.rejectionReason || null,
    p.notes || null,
  ];
}

app.get("/api/planned-posts", async (req, res, next) => {
  try {
    const conds = [];
    const args = [];
    if (req.query.persona_id) {
      args.push(req.query.persona_id);
      conds.push(`pp.persona_id = $${args.length}`);
    } else if (req.query.persona) {
      const ref = await resolvePersona(req.query.persona);
      if (!ref || !ref.id) return res.json([]);
      args.push(ref.id);
      conds.push(`pp.persona_id = $${args.length}`);
    }
    if (req.query.arc_id) {
      args.push(req.query.arc_id);
      conds.push(`pp.arc_id = $${args.length}`);
    }
    if (req.query.status) {
      const statuses = String(req.query.status).split(",");
      args.push(statuses);
      conds.push(`pp.status = ANY($${args.length}::text[])`);
    }
    if (req.query.from) {
      args.push(req.query.from);
      conds.push(`pp.scheduled_at >= $${args.length}`);
    }
    if (req.query.to) {
      args.push(req.query.to);
      conds.push(`pp.scheduled_at < $${args.length}`);
    }
    if (req.query.post_type) {
      args.push(req.query.post_type);
      conds.push(`pp.post_type = $${args.length}`);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const r = await pool.query(
      `SELECT pp.* FROM planned_posts pp ${where}
        ORDER BY pp.scheduled_at NULLS LAST, pp.position_in_arc NULLS LAST, pp.created_at`,
      args,
    );
    res.json(r.rows.map(rowToPlannedPost));
  } catch (e) { next(e); }
});

app.get("/api/planned-posts/:id", async (req, res, next) => {
  try {
    const r = await pool.query("SELECT * FROM planned_posts WHERE id=$1", [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: "not found" });
    res.json(rowToPlannedPost(r.rows[0]));
  } catch (e) { next(e); }
});

app.post("/api/planned-posts", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.id || !b.personaId || !b.postType) {
      return res.status(400).json({ error: "id, personaId, postType required" });
    }
    // resolve persona handle/name if provided
    if (b.personaId && !isUuid(b.personaId)) {
      const ref = await resolvePersona(b.personaId);
      if (!ref || !ref.id) return res.status(404).json({ error: "persona not found", ambiguous: ref?.ambiguous });
      b.personaId = ref.id;
    }
    await pool.query(
      `INSERT INTO planned_posts (
         id, arc_id, persona_id, platform, post_type, story_type, scheduled_at, position_in_arc,
         caption, hashtags, overlay_text,
         generation_prompt, generation_model, reference_image_id, library_asset_id,
         generated_image_id, generation_metadata, regeneration_feedback,
         fleet_content_id, fleet_scheduled_post_id,
         status, rejection_reason, notes
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
       )`,
      plannedPostWriteArgs(b),
    );
    const r = await pool.query("SELECT * FROM planned_posts WHERE id=$1", [b.id]);
    res.json(rowToPlannedPost(r.rows[0]));
  } catch (e) { next(e); }
});

app.put("/api/planned-posts/:id", async (req, res, next) => {
  try {
    const b = { ...req.body, id: req.params.id };
    if (!b.personaId || !b.postType) {
      return res.status(400).json({ error: "personaId, postType required" });
    }
    if (b.personaId && !isUuid(b.personaId)) {
      const ref = await resolvePersona(b.personaId);
      if (!ref || !ref.id) return res.status(404).json({ error: "persona not found" });
      b.personaId = ref.id;
    }
    const exists = await pool.query("SELECT id FROM planned_posts WHERE id=$1", [b.id]);
    if (exists.rowCount === 0) return res.status(404).json({ error: "not found" });
    await pool.query(
      `UPDATE planned_posts SET
         arc_id=$2, persona_id=$3, platform=$4, post_type=$5, story_type=$6,
         scheduled_at=$7, position_in_arc=$8,
         caption=$9, hashtags=$10, overlay_text=$11,
         generation_prompt=$12, generation_model=$13,
         reference_image_id=$14, library_asset_id=$15,
         generated_image_id=$16, generation_metadata=$17, regeneration_feedback=$18,
         fleet_content_id=$19, fleet_scheduled_post_id=$20,
         status=$21, rejection_reason=$22, notes=$23
       WHERE id=$1`,
      plannedPostWriteArgs(b, b.id),
    );
    const r = await pool.query("SELECT * FROM planned_posts WHERE id=$1", [b.id]);
    res.json(rowToPlannedPost(r.rows[0]));
  } catch (e) { next(e); }
});

app.patch("/api/planned-posts/:id/status", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.status || !PLANNED_POST_STATUSES.includes(b.status)) {
      return res.status(400).json({ error: `status must be one of ${PLANNED_POST_STATUSES.join(", ")}` });
    }
    const fields = ["status=$2"];
    const args = [req.params.id, b.status];
    if (b.rejectionReason !== undefined) {
      args.push(b.rejectionReason || null);
      fields.push(`rejection_reason=$${args.length}`);
    }
    if (b.regenerationFeedback !== undefined) {
      args.push(b.regenerationFeedback || null);
      fields.push(`regeneration_feedback=$${args.length}`);
    }
    if (b.generatedImageId !== undefined) {
      args.push(b.generatedImageId || null);
      fields.push(`generated_image_id=$${args.length}`);
    }
    if (b.generationMetadata !== undefined) {
      args.push(b.generationMetadata);
      fields.push(`generation_metadata=$${args.length}`);
    }
    // Clear stale push error when transitioning into a non-accepted state.
    if (b.status !== "accepted" && b.status !== "pushed") {
      fields.push(`last_push_error=NULL`);
    }
    const r = await pool.query(
      `UPDATE planned_posts SET ${fields.join(", ")} WHERE id=$1 RETURNING *`,
      args,
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "not found" });
    const post = rowToPlannedPost(r.rows[0]);

    // Auto-push: when a generated image is accepted, fire the handoff in the
    // background and respond immediately. The UI polls and will see the
    // status flip to 'pushed' (or surface last_push_error on failure).
    if (b.status === "accepted" && fleet.fleetEnabled()) {
      pushPlannedPostAsync(req.params.id).catch((e) => {
        console.warn(`[fleet] background push failed for ${req.params.id}:`, e.message);
      });
    }

    res.json(post);
  } catch (e) { next(e); }
});

/* ---------- fleetmanager handoff ---------- */

/** Manual retry endpoint — re-pushes a planned_post. */
app.post("/api/planned-posts/:id/push", async (req, res, next) => {
  try {
    if (!fleet.fleetEnabled()) {
      return res.status(503).json({
        error: "Fleetmanager integration not enabled",
        fleet: fleet.fleetConfigSummary(),
      });
    }
    const result = await pushPlannedPostAsync(req.params.id);
    res.json(result);
  } catch (e) {
    // Already-pushed / not-found / push errors come back through normally.
    if (e instanceof fleet.FleetError) {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    next(e);
  }
});

/** Read-only status of fleet integration. */
app.get("/api/fleet/status", (_req, res) => {
  res.json({
    ...fleet.fleetConfigSummary(),
    ready: fleet.fleetEnabled(),
  });
});

/**
 * Push a planned_post to fleetmanager and persist the result.
 * Throws FleetError on failure. Used by both auto-push and manual retry.
 */
async function pushPlannedPostAsync(plannedPostId) {
  // Load the planned_post + persona Instagram handle + generated image bytes.
  const row = await pool.query(
    `SELECT pp.*, p.id AS persona_id_real
       FROM planned_posts pp
       JOIN personas p ON p.id = pp.persona_id
      WHERE pp.id = $1`,
    [plannedPostId],
  );
  if (row.rowCount === 0) throw new fleet.FleetError("NOT_FOUND", `planned_post ${plannedPostId} not found`);
  const pp = row.rows[0];

  if (pp.platform !== "instagram") {
    throw new fleet.FleetError("UNSUPPORTED_PLATFORM",
      `fleetmanager handoff only supports instagram (this post: ${pp.platform})`);
  }
  if (!pp.scheduled_at) {
    throw new fleet.FleetError("MISSING_SCHEDULED_AT", "planned_post has no scheduled_at");
  }

  // Find the persona's Instagram handle.
  const handleRow = await pool.query(
    `SELECT handle FROM socials
      WHERE persona_id=$1 AND platform='instagram' AND handle IS NOT NULL
      ORDER BY position LIMIT 1`,
    [pp.persona_id],
  );
  if (handleRow.rowCount === 0) {
    throw new fleet.FleetError("NO_HANDLE", "persona has no instagram handle in socials");
  }
  const personaHandle = handleRow.rows[0].handle;

  // Resolve the image to push: prefer the generated image, fall back to the
  // library asset's image (so library-only posts like landscapes also push).
  let imageId = pp.generated_image_id;
  if (!imageId && pp.library_asset_id) {
    const la = await pool.query(`SELECT image_id FROM library_assets WHERE id=$1`, [pp.library_asset_id]);
    imageId = la.rows[0]?.image_id || null;
  }

  if (!imageId && pp.story_type !== "text_overlay" && pp.story_type !== "feed_repost") {
    throw new fleet.FleetError("MISSING_IMAGE",
      `planned_post has no generated image and no library asset (story_type=${pp.story_type || "?"})`);
  }

  let imageBytes = null;
  let mimeType = "image/jpeg";
  if (imageId) {
    const img = await pool.query(`SELECT data, mime_type FROM images WHERE id=$1`, [imageId]);
    if (img.rowCount === 0) throw new fleet.FleetError("IMAGE_NOT_FOUND", `image ${imageId} not found`);
    imageBytes = img.rows[0].data;
    mimeType = img.rows[0].mime_type || "image/jpeg";
  }

  // Push!
  let result;
  try {
    result = await fleet.pushPlannedPost({
      personaHandle,
      postType: pp.post_type,
      caption: pp.caption || "",
      hashtags: pp.hashtags || [],
      scheduledAt: new Date(pp.scheduled_at).toISOString(),
      imageBytes,
      mimeType,
      title: `${pp.post_type} ${plannedPostId.slice(0, 8)}`,
    });
  } catch (e) {
    // Persist the error message for the UI.
    await pool.query(
      `UPDATE planned_posts SET last_push_error=$2 WHERE id=$1`,
      [plannedPostId, e.message || String(e)],
    );
    throw e;
  }

  // Persist success.
  await pool.query(
    `UPDATE planned_posts
        SET fleet_content_id=$2,
            fleet_scheduled_post_id=$3,
            pushed_at=NOW(),
            last_push_error=NULL,
            status='pushed'
      WHERE id=$1`,
    [plannedPostId, result.fleetContentId, result.fleetScheduledPostId],
  );

  return {
    plannedPostId,
    fleetContentId: result.fleetContentId,
    fleetScheduledPostId: result.fleetScheduledPostId,
    accountId: result.accountId,
    accountHandle: result.account?.handle,
  };
}

app.delete("/api/planned-posts/:id", async (req, res, next) => {
  try {
    await pool.query("DELETE FROM planned_posts WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------- library asset routes ---------- */

app.get("/api/library", async (req, res, next) => {
  try {
    const conds = [];
    const args = [];
    if (req.query.scene_type) { args.push(req.query.scene_type); conds.push(`scene_type = $${args.length}`); }
    if (req.query.mood)       { args.push(req.query.mood); conds.push(`mood = $${args.length}`); }
    if (req.query.location)   { args.push(req.query.location); conds.push(`location_hint = $${args.length}`); }
    if (req.query.time_of_day){ args.push(req.query.time_of_day); conds.push(`time_of_day = $${args.length}`); }
    if (req.query.tags) {
      const tags = String(req.query.tags).split(",");
      args.push(tags);
      conds.push(`tags && $${args.length}::text[]`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const r = await pool.query(
      `SELECT * FROM library_assets ${where} ORDER BY uploaded_at DESC`,
      args,
    );
    res.json(r.rows.map(rowToLibraryAsset));
  } catch (e) { next(e); }
});

app.get("/api/library/:id", async (req, res, next) => {
  try {
    const r = await pool.query("SELECT * FROM library_assets WHERE id=$1", [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: "not found" });
    res.json(rowToLibraryAsset(r.rows[0]));
  } catch (e) { next(e); }
});

// Multipart upload — file + metadata fields in one POST
app.post("/api/library", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "no file" });
    const b = req.body || {};
    const imageId = uid();
    await pool.query(
      `INSERT INTO images (id, data, mime_type, size_bytes) VALUES ($1,$2,$3,$4)`,
      [imageId, req.file.buffer, req.file.mimetype || "application/octet-stream", req.file.size],
    );
    const assetId = uid();
    const tags = b.tags ? (Array.isArray(b.tags) ? b.tags : String(b.tags).split(",").map((s) => s.trim()).filter(Boolean)) : [];
    await pool.query(
      `INSERT INTO library_assets (id, image_id, scene_type, mood, location_hint, time_of_day, tags, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [assetId, imageId, b.scene_type || b.sceneType || null,
       b.mood || null, b.location_hint || b.locationHint || null,
       b.time_of_day || b.timeOfDay || null, tags, b.notes || null],
    );
    const r = await pool.query("SELECT * FROM library_assets WHERE id=$1", [assetId]);
    res.json(rowToLibraryAsset(r.rows[0]));
  } catch (e) { next(e); }
});

app.put("/api/library/:id", async (req, res, next) => {
  try {
    const b = req.body || {};
    const tags = b.tags ? (Array.isArray(b.tags) ? b.tags : String(b.tags).split(",").map((s) => s.trim()).filter(Boolean)) : null;
    const r = await pool.query(
      `UPDATE library_assets SET
         scene_type    = COALESCE($2, scene_type),
         mood          = COALESCE($3, mood),
         location_hint = COALESCE($4, location_hint),
         time_of_day   = COALESCE($5, time_of_day),
         tags          = COALESCE($6, tags),
         notes         = COALESCE($7, notes)
       WHERE id=$1 RETURNING *`,
      [req.params.id,
       b.sceneType ?? b.scene_type ?? null,
       b.mood ?? null,
       b.locationHint ?? b.location_hint ?? null,
       b.timeOfDay ?? b.time_of_day ?? null,
       tags,
       b.notes ?? null],
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "not found" });
    res.json(rowToLibraryAsset(r.rows[0]));
  } catch (e) { next(e); }
});

app.delete("/api/library/:id", async (req, res, next) => {
  try {
    await pool.query("DELETE FROM library_assets WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* Mark a library asset as used by a planned post (bumps usage counter). */
app.post("/api/planned-posts/:id/library", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.libraryAssetId) return res.status(400).json({ error: "libraryAssetId required" });
    const updPost = await pool.query(
      "UPDATE planned_posts SET library_asset_id=$2 WHERE id=$1 RETURNING *",
      [req.params.id, b.libraryAssetId],
    );
    if (updPost.rowCount === 0) return res.status(404).json({ error: "post not found" });
    await pool.query(
      "UPDATE library_assets SET times_used = times_used + 1, last_used_at = now() WHERE id=$1",
      [b.libraryAssetId],
    );
    res.json(rowToPlannedPost(updPost.rows[0]));
  } catch (e) { next(e); }
});

/* ============================================================
   Soul ID training
   ============================================================ */

function rowToSoulTraining(r) {
  return {
    id: r.id,
    personaId: r.persona_id,
    name: r.name,
    status: r.status,
    soulId: r.soul_id,
    imageIds: r.image_ids ?? [],
    startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    error: r.error,
    metadata: r.metadata,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/* Slugify the persona name into a Soul ID name (e.g. "maya-rivera"). */
function soulNameForPersona(persona) {
  const base = String(persona.name || "persona")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "persona";
}

/* Start a Soul ID training job for a persona. Requires the persona to have
   at least 10 gallery items with an imageId (Higgsfield recommends 10–20). */
app.post("/api/personas/:idOrHandle/soul-train", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const ref = await resolvePersona(req.params.idOrHandle);
    if (!ref || !ref.id) return res.status(404).json({ error: "persona not found" });

    // Block if there's already a queued/running training for this persona
    const inFlight = await client.query(
      `SELECT id, status FROM soul_trainings
        WHERE persona_id = $1 AND status IN ('queued', 'running')
        ORDER BY created_at DESC LIMIT 1`,
      [ref.id],
    );
    if (inFlight.rowCount > 0) {
      return res.status(409).json({
        error: "a Soul training is already in progress for this persona",
        existingId: inFlight.rows[0].id,
        status: inFlight.rows[0].status,
      });
    }

    // Load the persona and its gallery
    const persona = await loadOnePersona(ref.id);
    if (!persona) return res.status(404).json({ error: "persona not found" });

    // Pick images: prefer gallery items with imageId, then the main photo
    const imageIds = (persona.gallery || [])
      .map((g) => g.imageId)
      .filter(Boolean);
    if (persona.photoId && !imageIds.includes(persona.photoId)) {
      imageIds.unshift(persona.photoId);
    }
    const MIN_IMAGES = Number(req.body?.minImages || process.env.SOUL_MIN_IMAGES || 10);
    if (imageIds.length < MIN_IMAGES) {
      return res.status(400).json({
        error: `persona has ${imageIds.length} reference image(s); need at least ${MIN_IMAGES} for Soul training`,
      });
    }

    // Cap at 20 to keep training fast/cheap
    const MAX_IMAGES = Number(req.body?.maxImages || 20);
    const capped = imageIds.slice(0, MAX_IMAGES);

    const trainingId = uid();
    const name = req.body?.name || soulNameForPersona(persona) + "-v1";

    await client.query(
      `INSERT INTO soul_trainings (id, persona_id, name, image_ids, status)
       VALUES ($1, $2, $3, $4, 'queued')`,
      [trainingId, ref.id, name, capped],
    );

    const r = await client.query("SELECT * FROM soul_trainings WHERE id=$1", [trainingId]);
    res.json(rowToSoulTraining(r.rows[0]));
  } catch (e) {
    next(e);
  } finally {
    client.release();
  }
});

/* List training jobs for a persona, newest first. */
app.get("/api/personas/:idOrHandle/soul-trainings", async (req, res, next) => {
  try {
    const ref = await resolvePersona(req.params.idOrHandle);
    if (!ref || !ref.id) return res.status(404).json({ error: "persona not found" });
    const r = await pool.query(
      `SELECT * FROM soul_trainings WHERE persona_id=$1 ORDER BY created_at DESC`,
      [ref.id],
    );
    res.json(r.rows.map(rowToSoulTraining));
  } catch (e) { next(e); }
});

/* Get one training job by id. */
app.get("/api/soul-trainings/:id", async (req, res, next) => {
  try {
    const r = await pool.query("SELECT * FROM soul_trainings WHERE id=$1", [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: "not found" });
    res.json(rowToSoulTraining(r.rows[0]));
  } catch (e) { next(e); }
});

/* ---------- seed ---------- */

app.post("/api/seed", async (_req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT COUNT(*)::int AS n FROM personas WHERE sample=TRUE");
    if (existing.rows[0].n > 0) {
      await client.query("ROLLBACK");
      return res.json({ seeded: false, reason: "samples already present" });
    }
    const samples = samplePersonas();
    for (const p of samples) {
      await insertPersona(client, p);
      await replaceSocials(client, p.id, p.socials);
      await replaceGallery(client, p.id, p.gallery);
    }

    // One sample family with Maya as G3 member
    const maya = samples.find((p) => p.name === "Maya Rivera");
    const aiko = samples.find((p) => p.name === "Aiko Tanaka");
    let familyId = null;
    if (maya) {
      const fam = sampleFamily();
      familyId = fam.id;
      await client.query(
        `INSERT INTO families (id, name, handle, lore, photo_id, location, established)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [fam.id, fam.name, slugify(fam.name), fam.lore, fam.photoId, fam.location, fam.established],
      );
      await client.query(
        `INSERT INTO family_members (id, family_id, persona_id, role, generation, parent_member_ids, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [uid(), fam.id, maya.id, "daughter", 3, [], 0],
      );
    }

    // One sample relationship: Maya ↔ Aiko, close friend
    if (maya && aiko) {
      const rel = sampleRelationship(maya.id, aiko.id);
      const [from, to] = rel.fromPersonaId < rel.toPersonaId
        ? [rel.fromPersonaId, rel.toPersonaId]
        : [rel.toPersonaId, rel.fromPersonaId];
      await client.query(
        `INSERT INTO relationships (
           id, from_persona_id, to_persona_id, category, type,
           custom_label, is_directional,
           cadence, since, status, family_id,
           origin, dynamic, bonding_moments, tensions,
           mutual_influence, inside_jokes, current_arc, content_seeds
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          rel.id, from, to, rel.category, rel.type,
          rel.customLabel, rel.isDirectional,
          rel.cadence, rel.since, rel.status, rel.familyId,
          rel.origin, rel.dynamic, rel.bondingMoments, rel.tensions,
          rel.mutualInfluence, rel.insideJokes, rel.currentArc, rel.contentSeeds,
        ],
      );
    }

    await client.query("COMMIT");
    await refreshNeighborhood();
    res.json({ seeded: true, count: samples.length, familyId });
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
});

/* ---------- error handler ---------- */

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "internal error" });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`ugc-api listening on :${port}`);
});
