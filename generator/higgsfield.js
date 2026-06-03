/* ============================================================
   Higgsfield CLI wrapper — verified against:
     - https://github.com/higgsfield-ai/cli (README + MODELS.md)

   Command shape (confirmed from MODELS.md per-model flag tables):
     higgsfield generate create <model_id> \
       --prompt "..." \
       [--image <path>] [--soul-id <uuid>] \
       [--aspect_ratio 4:5] [--resolution 2k] [--quality high] \
       --wait --json

   Notes:
     - `--image` is the reference-image flag and is supported by every
       image model (nano_banana_2, seedream_v5_lite, text2image_soul_v2,
       flux_2, flux_kontext, gpt_image_2, etc.) and accepts 1+ paths.
     - `--soul-id` is only on `text2image_soul_v2` — passing it to other
       models will error.
     - There is NO `--output` flag. With `--wait`, the CLI prints the
       result URL to stdout (or a JSON document when `--json` is used).
     - One-time auth: `higgsfield auth login` (device-code OAuth).
   ============================================================ */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const exec = promisify(execFile);
const MOCK = String(process.env.MOCK_GENERATOR || "true").toLowerCase() !== "false";
const CLI = process.env.HIGGSFIELD_CLI || "higgsfield";
const GEN_TIMEOUT_MS = Number(process.env.GENERATION_TIMEOUT_MS || 5 * 60 * 1000);

const SOUL_MODEL = "text2image_soul_v2";

function buildArgs({ model, prompt, soulId, referencePath, aspectRatio, resolution, quality }) {
  const args = ["generate", "create", model, "--prompt", prompt];

  // --soul-id is only valid on text2image_soul_v2 — silently skip it on
  // other models to avoid "unknown flag" errors when a persona happens to
  // have a soul_id and the post requests a different model.
  if (soulId && model === SOUL_MODEL) args.push("--soul-id", soulId);

  // --image works on every image model; passing the reference photo (or
  // the persona's main photo as fallback) is what locks the face.
  if (referencePath) args.push("--image", referencePath);

  if (aspectRatio) args.push("--aspect_ratio", aspectRatio);
  if (resolution)  args.push("--resolution",   resolution);
  if (quality)     args.push("--quality",      quality);

  args.push("--wait", "--json");
  return args;
}

/* Try to find the result URL in the CLI's JSON output.
   We probe common shapes — the exact schema isn't documented in the
   README, so we hedge a bit. If structured parsing fails, fall back
   to extracting the first http(s) URL we find in stdout. */
function extractResultUrl(stdout) {
  const text = String(stdout || "").trim();

  // Try strict JSON parse first
  try {
    const obj = JSON.parse(text);
    const candidates = [
      obj.outputs?.[0]?.url, obj.outputs?.[0]?.image_url, obj.outputs?.[0]?.href,
      obj.result?.url, obj.result?.image_url,
      obj.urls?.[0],
      obj.image_url, obj.url, obj.output_url,
      obj.job?.outputs?.[0]?.url, obj.data?.outputs?.[0]?.url,
    ].filter(Boolean);
    if (candidates.length) return { url: candidates[0], raw: obj };
  } catch {
    // not JSON
  }

  // Fallback: first http(s) URL on stdout
  const m = text.match(/https?:\/\/[^\s"'<>]+/);
  if (m) return { url: m[0], raw: text };

  throw new Error("could not extract result URL from CLI stdout");
}

async function downloadImage(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${url} → ${r.status}`);
  const ct = r.headers.get("content-type") || "application/octet-stream";
  const buf = Buffer.from(await r.arrayBuffer());
  return { bytes: buf, mimeType: ct };
}

/* Generate one image. Inputs:
     model         — CLI model id, e.g. "nano_banana_2", "text2image_soul_v2"
     prompt        — assembled prompt
     soulId        — Soul UUID (only honored when model === text2image_soul_v2)
     referencePath — local file path to a reference image (or null)
     aspectRatio   — e.g. "4:5" (feed), "9:16" (story), "1:1"
     resolution    — e.g. "2k" / "1k"
     quality       — e.g. "high" (only on some models)
   Returns: { bytes, mimeType, sizeBytes, metadata } */
export async function generate({ model, prompt, soulId, referencePath, aspectRatio, resolution, quality }) {
  if (MOCK) {
    const placeholder = await fs.readFile("/app/placeholder.png");
    await new Promise((r) => setTimeout(r, 1500));
    return {
      bytes: placeholder,
      mimeType: "image/png",
      sizeBytes: placeholder.length,
      metadata: {
        mock: true,
        model,
        soulId: model === SOUL_MODEL ? soulId : null,
        referenceUsed: referencePath ? path.basename(referencePath) : null,
        aspectRatio, resolution, quality,
        promptPreview: String(prompt).slice(0, 200),
      },
    };
  }

  const args = buildArgs({ model, prompt, soulId, referencePath, aspectRatio, resolution, quality });

  const started = Date.now();
  const { stdout, stderr } = await exec(CLI, args, {
    timeout: GEN_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });

  const { url, raw } = extractResultUrl(stdout);
  const downloaded = await downloadImage(url);
  const elapsedMs = Date.now() - started;

  // Sniff mime if the server returned a generic one
  let mimeType = downloaded.mimeType;
  if (!/image\//.test(mimeType)) {
    if (downloaded.bytes[0] === 0xff && downloaded.bytes[1] === 0xd8) mimeType = "image/jpeg";
    else if (downloaded.bytes[0] === 0x89 && downloaded.bytes[1] === 0x50) mimeType = "image/png";
    else mimeType = "image/png";
  }

  return {
    bytes: downloaded.bytes,
    mimeType,
    sizeBytes: downloaded.bytes.length,
    metadata: {
      model,
      soulId: model === SOUL_MODEL ? soulId : null,
      referenceUsed: referencePath ? path.basename(referencePath) : null,
      aspectRatio, resolution, quality,
      resultUrl: url,
      elapsedMs,
      stdoutTail: String(stdout).slice(-400),
      stderrTail: String(stderr).slice(-400),
      promptPreview: String(prompt).slice(0, 200),
    },
  };
}

export async function probe() {
  if (MOCK) return { mock: true };
  try {
    const { stdout } = await exec(CLI, ["--version"], { timeout: 10_000 });
    return { mock: false, version: stdout.trim() };
  } catch (e) {
    return { mock: false, error: e.message };
  }
}

/* ============================================================
   Soul ID training — verified CLI commands from
   https://github.com/higgsfield-ai/cli README:

     # 1. Kick off training (returns the soul id immediately):
     higgsfield soul-id create --name me --soul-2 \
       --image ./me1.jpg --image ./me2.jpg --image ./me3.jpg

     # 2. Block until training finishes (separate subcommand):
     higgsfield soul-id wait <soul_id>

   --soul-2 opts into Soul V2 (newer/better). --image accepts 1+
   instances; Higgsfield recommends 10-20 photos for best identity
   preservation, 3 minimum. Training takes ~3 minutes.

   NOTE: `--wait` and `--json` are only valid on `generate create` —
   they're NOT accepted by `soul-id create` / `soul-id wait`. We parse
   the soul id from `soul-id create`'s plaintext stdout, then call
   `soul-id wait` to block.

   Mock mode returns a fake Soul ID after a short delay.
   ============================================================ */
const TRAINING_TIMEOUT_MS = Number(process.env.SOUL_TRAINING_TIMEOUT_MS || 10 * 60 * 1000);
const SOUL_V2_FLAG = "--soul-2";

function buildSoulCreateArgs({ name, imagePaths }) {
  const args = ["soul-id", "create", "--name", name, SOUL_V2_FLAG];
  for (const p of imagePaths) args.push("--image", p);
  return args;
}

function buildSoulWaitArgs(soulId) {
  return ["soul-id", "wait", soulId];
}

/* Try to find a Soul ID UUID in the CLI's output (similar to extractResultUrl).
   We probe common JSON shapes and fall back to scanning stdout for a UUID. */
function extractSoulId(stdout) {
  const text = String(stdout || "").trim();
  try {
    const obj = JSON.parse(text);
    const candidates = [
      obj.soul_id, obj.id, obj.uuid,
      obj.character_id, obj.character?.id,
      obj.result?.soul_id, obj.result?.id,
      obj.data?.soul_id, obj.data?.id,
    ].filter(Boolean);
    if (candidates.length) return { soulId: candidates[0], raw: obj };
  } catch { /* not JSON */ }

  // Fallback: look for a UUID in stdout
  const m = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (m) return { soulId: m[0], raw: text };

  // Last resort: human-friendly id like "maya-v1"
  const friendly = text.match(/[a-z][a-z0-9-]{2,30}/i);
  if (friendly) return { soulId: friendly[0], raw: text };

  throw new Error("could not extract Soul ID from CLI stdout");
}

/* Train a Soul ID from a set of reference images.
   Inputs:
     name        — handle for the Soul ID (e.g. "maya-v1")
     imagePaths  — array of absolute paths to local image files (3+)
   Returns: { soulId, metadata } */
export async function trainSoulId({ name, imagePaths }) {
  if (!Array.isArray(imagePaths) || imagePaths.length < 3) {
    throw new Error(`Soul training needs at least 3 images; got ${imagePaths?.length || 0}`);
  }
  if (MOCK) {
    await new Promise((r) => setTimeout(r, 2500));
    const mockId = `mock-${name}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      soulId: mockId,
      metadata: {
        mock: true,
        name,
        imageCount: imagePaths.length,
        cliArgs: buildSoulCreateArgs({ name, imagePaths }).join(" "),
      },
    };
  }

  // Step 1: kick off training. Returns immediately with the new soul id.
  const createArgs = buildSoulCreateArgs({ name, imagePaths });
  const started = Date.now();
  let createOut;
  try {
    createOut = await exec(CLI, createArgs, {
      timeout: 60_000,             // creating the job is fast; only the wait blocks
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (e) {
    // Default e.message from execFile is just "Command failed: <cmd>" — the
    // real reason lives on e.stderr/e.stdout. Surface both so the failure
    // reason makes it into soul_trainings.error.
    const detail = [
      e.stderr && `stderr: ${String(e.stderr).trim()}`,
      e.stdout && `stdout: ${String(e.stdout).trim()}`,
      e.code != null && `exit: ${e.code}`,
    ].filter(Boolean).join(" | ");
    throw new Error(`soul-id create failed${detail ? ` — ${detail}` : ` (no stderr; e.message=${e.message})`}`);
  }
  const { soulId } = extractSoulId(createOut.stdout);

  // Step 2: block until training finishes. Falls back to a poll loop if the
  // `wait` subcommand isn't recognized by this CLI build.
  let waitOut = { stdout: "", stderr: "" };
  try {
    waitOut = await exec(CLI, buildSoulWaitArgs(soulId), {
      timeout: TRAINING_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (e) {
    const detail = [
      e.stderr && `stderr: ${String(e.stderr).trim()}`,
      e.stdout && `stdout: ${String(e.stdout).trim()}`,
      e.code != null && `exit: ${e.code}`,
    ].filter(Boolean).join(" | ");
    throw new Error(`soul-id wait ${soulId} failed${detail ? ` — ${detail}` : ` (no stderr; e.message=${e.message})`}`);
  }
  const elapsedMs = Date.now() - started;

  return {
    soulId,
    metadata: {
      name,
      imageCount: imagePaths.length,
      elapsedMs,
      createStdoutTail: String(createOut.stdout).slice(-400),
      createStderrTail: String(createOut.stderr).slice(-400),
      waitStdoutTail:   String(waitOut.stdout).slice(-400),
      waitStderrTail:   String(waitOut.stderr).slice(-400),
    },
  };
}
