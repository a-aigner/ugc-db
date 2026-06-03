/* ============================================================
   Worker loop — polls planned_posts for status='approved',
   runs Higgsfield generation, saves results to images,
   updates planned_posts to status='generated' (or rolls back).
   ============================================================ */

import pg from "pg";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generate, trainSoulId } from "./higgsfield.js";

const { Pool } = pg;

const pool = new Pool({
  host: process.env.PGHOST || "db",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.POSTGRES_USER || "ugc",
  password: process.env.POSTGRES_PASSWORD || "ugc",
  database: process.env.POSTGRES_DB || "ugc",
  max: 5,
});

const POLL_INTERVAL_MS  = Number(process.env.POLL_INTERVAL_MS  || 5000);
const MAX_CONCURRENT    = Number(process.env.MAX_CONCURRENT    || 4);
const STUCK_AFTER_MIN   = Number(process.env.STUCK_AFTER_MIN   || 15);
const DEFAULT_MODEL     = process.env.DEFAULT_GENERATION_MODEL || "nano_banana_2";
const DEFAULT_RESOLUTION = process.env.DEFAULT_RESOLUTION || "2k";

/* Aspect ratio per Instagram post type:
   - ig_feed:     4:5 (portrait) — IG's recommended max-height feed ratio
   - ig_story:    9:16 (full-screen story)
   - ig_carousel: 1:1 (square slides) */
function aspectForPostType(postType) {
  if (postType === "ig_story") return "9:16";
  if (postType === "ig_carousel") return "1:1";
  return "4:5";
}

const inFlight = new Set();

const uid = () => crypto.randomUUID();

/* Compose the final prompt by stacking:
     1. The post's generation_prompt
     2. The persona's generation notes (consistency anchors)
     3. The post's regeneration_feedback (if any) */
function composePrompt({ prompt, personaNotes, feedback }) {
  const parts = [prompt];
  if (personaNotes && personaNotes.trim()) {
    parts.push(`Persona consistency: ${personaNotes.trim()}`);
  }
  if (feedback && feedback.trim()) {
    parts.push(`Refinement notes for this regeneration: ${feedback.trim()}`);
  }
  return parts.join("\n\n");
}

/* Fetch image bytes + mime type from the images table. */
async function loadImageBytes(imageId) {
  if (!imageId) return null;
  const r = await pool.query(
    "SELECT data, mime_type FROM images WHERE id = $1",
    [imageId],
  );
  if (r.rowCount === 0) return null;
  return { bytes: r.rows[0].data, mimeType: r.rows[0].mime_type };
}

function mimeToExt(mime) {
  if (!mime) return ".png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("webp")) return ".webp";
  return ".png";
}

/* Resolve which image to use as the generation reference:
     1. The post's explicit reference_image_id (planner picked it)
     2. The persona's main photo_id (canonical reference)
     3. null — no reference (pure text-to-image)
   Writes the bytes to a tmp file and returns the path, or null. */
async function prepareReferenceImage({ postReferenceId, personaPhotoId, tmpDir }) {
  const targetImageId = postReferenceId || personaPhotoId;
  if (!targetImageId) return null;
  const img = await loadImageBytes(targetImageId);
  if (!img) return null;
  const ext = mimeToExt(img.mimeType);
  const ref = path.join(tmpDir, `ref${ext}`);
  await fs.writeFile(ref, img.bytes);
  return ref;
}

async function recoverStuck() {
  // Reset posts stuck in 'generating' after STUCK_AFTER_MIN minutes (crash recovery)
  const r = await pool.query(
    `UPDATE planned_posts
        SET status='approved',
            generation_metadata = COALESCE(generation_metadata, '{}'::jsonb)
                                || jsonb_build_object('stuck_recovered_at', now())
      WHERE status='generating'
        AND updated_at < now() - ($1::int || ' minutes')::interval
      RETURNING id`,
    [STUCK_AFTER_MIN],
  );
  if (r.rowCount > 0) {
    console.log(`[recover] reset ${r.rowCount} stuck post(s) to approved`);
  }

  // Reset trainings stuck in 'running' for too long
  const trains = await pool.query(
    `UPDATE soul_trainings
        SET status='queued',
            started_at=NULL,
            metadata=COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('stuck_recovered_at', now())
      WHERE status='running'
        AND started_at < now() - ($1::int || ' minutes')::interval
      RETURNING id`,
    [STUCK_AFTER_MIN],
  );
  if (trains.rowCount > 0) {
    console.log(`[recover] reset ${trains.rowCount} stuck soul-training(s) to queued`);
  }
}

async function processPost(row) {
  const id = row.id;
  console.log(`[gen] processing ${id.slice(0, 8)} (model=${row.generation_model || DEFAULT_MODEL})`);

  // Mark generating
  await pool.query(
    `UPDATE planned_posts SET status='generating' WHERE id=$1`,
    [id],
  );

  // Each post gets its own tmp dir for any reference image we materialize
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gen-"));

  try {
    // Pull persona context — notes, soul_id, and main photo_id for the
    // fallback reference image
    const personaRow = await pool.query(
      `SELECT persona_generation_notes, soul_id, photo_id, name
         FROM personas WHERE id=$1`,
      [row.persona_id],
    );
    const persona = personaRow.rows[0] || {};

    const fullPrompt = composePrompt({
      prompt: row.generation_prompt,
      personaNotes: persona.persona_generation_notes,
      feedback: row.regeneration_feedback,
    });

    // Resolve reference: post.reference_image_id > persona.photo_id
    const referencePath = await prepareReferenceImage({
      postReferenceId: row.reference_image_id,
      personaPhotoId: persona.photo_id,
      tmpDir,
    });
    const referenceSource = row.reference_image_id ? "post"
      : persona.photo_id ? "persona"
      : "none";
    if (referencePath) {
      console.log(`[gen] ${id.slice(0, 8)} using reference from ${referenceSource}`);
    } else {
      console.log(`[gen] ${id.slice(0, 8)} no reference image available (text-only)`);
    }

    // Resolve model with a smart default:
    //   - If the post specifies a model, honor it (planner's choice)
    //   - Else if the persona has a Soul ID, use text2image_soul_v2 (cheapest
    //     via the 5000/mo Soul pool on Plus)
    //   - Else fall back to nano_banana_2 (premium, costs credits)
    const model = row.generation_model
      || (persona.soul_id ? "text2image_soul_v2" : DEFAULT_MODEL);

    const result = await generate({
      model,
      prompt: fullPrompt,
      soulId: persona.soul_id || null,
      referencePath,
      aspectRatio: aspectForPostType(row.post_type),
      resolution: DEFAULT_RESOLUTION,
    });

    // Save the generated image bytes
    const imageId = uid();
    await pool.query(
      `INSERT INTO images (id, data, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4)`,
      [imageId, result.bytes, result.mimeType, result.sizeBytes],
    );

    // Update planned post (also tag where the reference came from in metadata)
    const meta = { ...result.metadata, referenceSource };
    await pool.query(
      `UPDATE planned_posts
          SET status            = 'generated',
              generated_image_id = $1,
              generation_metadata = $2::jsonb,
              regeneration_feedback = NULL
        WHERE id = $3`,
      [imageId, JSON.stringify(meta), id],
    );

    console.log(`[gen] ok ${id.slice(0, 8)} → image ${imageId.slice(0, 8)} (${result.sizeBytes}B, ref=${referenceSource})`);
  } catch (e) {
    console.error(`[gen] failed ${id.slice(0, 8)}: ${e.message}`);
    await pool.query(
      `UPDATE planned_posts
          SET status = 'approved',
              generation_metadata = COALESCE(generation_metadata, '{}'::jsonb)
                                  || jsonb_build_object(
                                       'last_error', $1,
                                       'failed_at',  now()
                                     )
        WHERE id = $2`,
      [e.message, id],
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function processSoulTraining(row) {
  const id = row.id;
  console.log(`[soul] training ${id.slice(0, 8)} for persona ${row.persona_id.slice(0, 8)}, ${(row.image_ids || []).length} images`);

  await pool.query(
    `UPDATE soul_trainings SET status='running', started_at=now() WHERE id=$1`,
    [id],
  );

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "soul-"));
  try {
    // Materialize each image to disk
    const imagePaths = [];
    for (const imageId of row.image_ids) {
      const img = await loadImageBytes(imageId);
      if (!img) continue;
      const ext = mimeToExt(img.mimeType);
      const p = path.join(tmpDir, `${imagePaths.length + 1}${ext}`);
      await fs.writeFile(p, img.bytes);
      imagePaths.push(p);
    }
    if (imagePaths.length < 3) {
      throw new Error(`only ${imagePaths.length} image(s) materialized; need at least 3`);
    }

    const { soulId, metadata } = await trainSoulId({
      name: row.name,
      imagePaths,
    });

    // Save the resulting Soul ID on both the training job and the persona
    await pool.query(
      `UPDATE soul_trainings
          SET status='completed', completed_at=now(), soul_id=$1, metadata=$2::jsonb
        WHERE id=$3`,
      [soulId, JSON.stringify(metadata), id],
    );
    await pool.query(
      `UPDATE personas SET soul_id=$1 WHERE id=$2`,
      [soulId, row.persona_id],
    );

    console.log(`[soul] ok ${id.slice(0, 8)} → soul_id=${soulId}`);
  } catch (e) {
    console.error(`[soul] failed ${id.slice(0, 8)}: ${e.message}`);
    await pool.query(
      `UPDATE soul_trainings
          SET status='failed', completed_at=now(), error=$1
        WHERE id=$2`,
      [e.message, id],
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function tickSoul() {
  // Find queued training jobs, mark and process (concurrency=1 — training
  // is heavy and runs once per persona so serial is fine for v1).
  const r = await pool.query(
    `SELECT * FROM soul_trainings WHERE status='queued' ORDER BY created_at LIMIT 1`,
  );
  if (r.rowCount === 0) return;
  // Don't add to inFlight set; trainings run in their own dedicated loop
  await processSoulTraining(r.rows[0]);
}

async function tick() {
  const free = MAX_CONCURRENT - inFlight.size;
  if (free <= 0) return;

  // Posts that need generation:
  //   status = 'approved'
  //   no library_asset_id (those are library content, not generated)
  //   has a generation_prompt
  //   not currently being processed
  const inFlightIds = [...inFlight];
  const r = await pool.query(
    `SELECT pp.*
       FROM planned_posts pp
      WHERE pp.status = 'approved'
        AND pp.library_asset_id IS NULL
        AND pp.generation_prompt IS NOT NULL
        AND ($1::uuid[] IS NULL OR NOT (pp.id = ANY($1::uuid[])))
      ORDER BY pp.scheduled_at NULLS LAST, pp.position_in_arc NULLS LAST, pp.created_at
      LIMIT $2`,
    [inFlightIds.length ? inFlightIds : null, free],
  );

  for (const row of r.rows) {
    inFlight.add(row.id);
    processPost(row)
      .catch((e) => console.error(`[gen] uncaught: ${e.message}`))
      .finally(() => inFlight.delete(row.id));
  }
}

let stopped = false;

export async function startWorker() {
  await recoverStuck().catch((e) => console.error(`[recover] ${e.message}`));

  console.log(`[worker] started: poll=${POLL_INTERVAL_MS}ms max_concurrent=${MAX_CONCURRENT}`);

  // Main loop — sleep, tick both queues, repeat.
  // We run soul-training first because it's blocking (one at a time) and
  // a queued training shouldn't sit behind a wave of generations.
  while (!stopped) {
    try {
      await tickSoul();
    } catch (e) {
      console.error(`[tickSoul] ${e.message}`);
    }
    try {
      await tick();
    } catch (e) {
      console.error(`[tick] ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

export function stopWorker() { stopped = true; }
export function stats() {
  return { inFlight: inFlight.size, maxConcurrent: MAX_CONCURRENT };
}
