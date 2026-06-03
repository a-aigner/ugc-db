/*
 * Fleetmanager handoff client.
 *
 * Pushes a ugc-db planned_post into fleetmanager as:
 *   1. Look up the fleetmanager Account by Instagram handle
 *   2. Create a Content (caption, tags, type)
 *   3. Upload the generated image bytes via multipart /media
 *   4. Schedule the content to that account at planned_post.scheduled_at
 *
 * Writes back fleet_content_id, fleet_scheduled_post_id, pushed_at on success.
 * Writes last_push_error on failure (and leaves status=accepted for retry).
 *
 * Configured via env:
 *   FLEET_ENABLED   — "true" to enable the integration (default "false")
 *   FLEET_BASE_URL  — e.g. http://api.fleetmanager:4000  (internal Docker network)
 *   FLEET_TOKEN     — long-lived bearer token issued via fleetmanager's POST /auth/tokens
 */

import { Buffer } from "node:buffer";

const ENABLED = String(process.env.FLEET_ENABLED || "false").toLowerCase() === "true";
const BASE_URL = (process.env.FLEET_BASE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.FLEET_TOKEN || "";

export function fleetEnabled() {
  return ENABLED && BASE_URL && TOKEN;
}

export function fleetConfigSummary() {
  return {
    enabled: ENABLED,
    configured: Boolean(BASE_URL && TOKEN),
    baseUrl: BASE_URL || null,
    hasToken: Boolean(TOKEN),
  };
}

/* ---------- low-level HTTP ---------- */

async function fleetFetch(path, init = {}) {
  if (!fleetEnabled()) {
    throw new FleetError("FLEET_DISABLED", "Fleetmanager integration is not enabled or not configured");
  }
  const url = `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${TOKEN}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  let res;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (e) {
    throw new FleetError("NETWORK", `cannot reach fleetmanager at ${url}: ${e.message}`);
  }

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");

  if (!res.ok) {
    const msg = (body && body.error) || (body && body.message) || (typeof body === "string" ? body : `HTTP ${res.status}`);
    throw new FleetError(`HTTP_${res.status}`, `fleetmanager ${path} → ${res.status}: ${msg}`);
  }
  return body;
}

export class FleetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FleetError";
    this.code = code;
  }
}

/* ---------- handle normalization ---------- */

export function normalizeHandle(h) {
  return String(h || "").trim().toLowerCase().replace(/^@+/, "");
}

/* ---------- core API calls ---------- */

/**
 * Find a fleetmanager Instagram account whose handle (normalized) matches.
 * Returns { id, handle, name, ... } or throws ACCOUNT_NOT_FOUND.
 *
 * fleetmanager's GET /accounts supports ?platform=instagram filter.
 */
export async function findAccountByHandle(personaHandle) {
  const target = normalizeHandle(personaHandle);
  if (!target) throw new FleetError("INVALID_HANDLE", "persona has no instagram handle");

  const data = await fleetFetch("/api/v1/accounts?platform=instagram");
  const list = Array.isArray(data) ? data : (data.items || data.accounts || []);

  const matches = list.filter((a) => normalizeHandle(a.handle) === target);
  if (matches.length === 0) {
    throw new FleetError("ACCOUNT_NOT_FOUND",
      `no fleetmanager Instagram account found with handle @${target}`);
  }
  if (matches.length > 1) {
    throw new FleetError("AMBIGUOUS_HANDLE",
      `multiple fleetmanager accounts match @${target} (ids: ${matches.map(m => m.id).join(", ")})`);
  }
  return matches[0];
}

/**
 * Create a Content record in fleetmanager.
 *
 * Maps ugc-db post_type → fleetmanager type:
 *   ig_feed     → ig-feed
 *   ig_story    → ig-story
 *   ig_carousel → ig-feed   (carousel = multi-media feed post on Instagram)
 */
export async function createContent({ title, postType, caption, hashtags, locationId, locationName, collaborators }) {
  const typeMap = {
    ig_feed: "ig-feed",
    ig_story: "ig-story",
    ig_carousel: "ig-feed",
  };
  const type = typeMap[postType];
  if (!type) throw new FleetError("UNSUPPORTED_POST_TYPE", `cannot map post_type=${postType} to fleetmanager`);

  const body = {
    title: title || `ugc-db ${postType}`,
    type,
    caption: caption || "",
    tags: Array.isArray(hashtags) ? hashtags : [],
    status: "ready",
  };
  if (locationId) body.locationId = locationId;
  if (locationName) body.locationName = locationName;
  if (Array.isArray(collaborators) && collaborators.length) body.collaborators = collaborators;

  const created = await fleetFetch("/api/v1/content", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!created || !created.id) {
    throw new FleetError("BAD_RESPONSE", `fleetmanager content creation returned no id: ${JSON.stringify(created)}`);
  }
  return created;
}

/**
 * Upload an image buffer to fleetmanager as a media asset attached to a Content.
 * Uses multipart/form-data per fleetmanager's POST /media spec.
 */
export async function uploadMedia({ contentId, imageBytes, mimeType, order = 0, filename }) {
  if (!contentId) throw new FleetError("MISSING_CONTENT_ID", "uploadMedia requires contentId");
  if (!imageBytes || !imageBytes.length) throw new FleetError("MISSING_BYTES", "uploadMedia requires imageBytes");

  const form = new FormData();
  const blob = new Blob([imageBytes], { type: mimeType || "image/jpeg" });
  form.append("file", blob, filename || `ugc-db-${contentId}.${mimeExt(mimeType)}`);
  form.append("contentId", contentId);
  form.append("kind", "image");
  form.append("order", String(order));

  const created = await fleetFetch("/api/v1/media", {
    method: "POST",
    body: form,
  });
  if (!created || !created.id) {
    throw new FleetError("BAD_RESPONSE", `fleetmanager media upload returned no id: ${JSON.stringify(created)}`);
  }
  return created;
}

function mimeExt(mime) {
  if (!mime) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

/**
 * Schedule a Content for posting on a specific account at a given time.
 * Returns the created scheduled-post id (the first/only one).
 */
export async function scheduleContent({ contentId, accountId, baseTime }) {
  if (!contentId) throw new FleetError("MISSING_CONTENT_ID", "scheduleContent requires contentId");
  if (!accountId) throw new FleetError("MISSING_ACCOUNT_ID", "scheduleContent requires accountId");
  if (!baseTime) throw new FleetError("MISSING_BASE_TIME", "scheduleContent requires baseTime (ISO)");

  const body = {
    contentId,
    targets: [{ type: "account", id: accountId }],
    baseTime,
    strategy: "same",
  };
  const created = await fleetFetch("/api/v1/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const list = Array.isArray(created) ? created : (created && created.scheduledPosts) || [];
  if (!list.length || !list[0].id) {
    throw new FleetError("BAD_RESPONSE", `fleetmanager schedule returned no posts: ${JSON.stringify(created)}`);
  }
  return list[0];
}

/* ---------- orchestrator ---------- */

/**
 * Push a planned_post to fleetmanager. The caller is responsible for
 * loading the planned_post row, persona handle, and image bytes from the DB
 * and for persisting the returned ids.
 *
 * Input:
 *   {
 *     personaHandle: "@maya.moves",
 *     postType: "ig_feed",
 *     caption, hashtags, scheduledAt (ISO),
 *     imageBytes: Buffer, mimeType: string,
 *     // optional: locationId, locationName, collaborators, title
 *   }
 * Returns:
 *   { fleetContentId, fleetScheduledPostId, accountId, account, content, media, scheduled }
 */
export async function pushPlannedPost(input) {
  if (!fleetEnabled()) {
    throw new FleetError("FLEET_DISABLED", "Fleetmanager integration is not enabled (set FLEET_ENABLED=true, FLEET_BASE_URL, FLEET_TOKEN)");
  }
  const { personaHandle, postType, caption, hashtags, scheduledAt, imageBytes, mimeType,
          locationId, locationName, collaborators, title } = input;

  if (!scheduledAt) throw new FleetError("MISSING_SCHEDULED_AT", "planned_post has no scheduled_at — cannot schedule");
  if (!imageBytes || !imageBytes.length) throw new FleetError("MISSING_IMAGE", "planned_post has no generated image bytes to push");

  const account = await findAccountByHandle(personaHandle);
  const content = await createContent({ title, postType, caption, hashtags, locationId, locationName, collaborators });
  let media;
  try {
    media = await uploadMedia({ contentId: content.id, imageBytes, mimeType, order: 0 });
  } catch (e) {
    // Best-effort cleanup so we don't leave orphan Content records on fleetmanager.
    await fleetFetch(`/api/v1/content/${content.id}`, { method: "DELETE" }).catch(() => {});
    throw e;
  }
  let scheduled;
  try {
    scheduled = await scheduleContent({ contentId: content.id, accountId: account.id, baseTime: scheduledAt });
  } catch (e) {
    await fleetFetch(`/api/v1/content/${content.id}`, { method: "DELETE" }).catch(() => {});
    throw e;
  }
  return {
    fleetContentId: content.id,
    fleetScheduledPostId: scheduled.id,
    accountId: account.id,
    account, content, media, scheduled,
  };
}
