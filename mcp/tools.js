/* ============================================================
   Tool implementations for the UGC Creator DB MCP server.
   Each tool wraps one or more /api endpoints and shapes the result
   into MCP content for the LLM. Most tools return one text item
   (JSON-stringified bundle); persona-style tools also return one
   image item with the reference photo as base64 by default.
   ============================================================ */

import crypto from "node:crypto";

const API_BASE = process.env.API_BASE || "http://api:3000";

async function apiFetch(path, init) {
  const url = `${API_BASE}${path}`;
  const r = await fetch(url, init);
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    const err = new Error(`upstream ${r.status} on ${path}: ${text}`);
    err.upstreamStatus = r.status;
    throw err;
  }
  return r;
}

async function apiGet(path) {
  const r = await apiFetch(path);
  return await r.json();
}

async function apiJsonSend(method, path, body) {
  const r = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (method === "DELETE") return { ok: true };
  return await r.json();
}
const apiPost   = (p, b) => apiJsonSend("POST",   p, b);
const apiPut    = (p, b) => apiJsonSend("PUT",    p, b);
const apiPatch  = (p, b) => apiJsonSend("PATCH",  p, b);
const apiDelete = (p)    => apiJsonSend("DELETE", p);

/* Encode any single image URL (server-relative or absolute) as base64.
   Returns null if the URL is null/undefined. */
async function inlineImage(imageUrl) {
  if (!imageUrl) return null;
  const path = imageUrl.startsWith("http")
    ? imageUrl
    : `${API_BASE}${imageUrl}`;
  const r = await fetch(path);
  if (!r.ok) return null;
  const mimeType = r.headers.get("content-type") || "application/octet-stream";
  const buf = Buffer.from(await r.arrayBuffer());
  return { mimeType, base64: buf.toString("base64") };
}

/* Compact "persona card" used by listings/search results. */
function personaCard(p) {
  const pick = (plat) => (p.socials || []).find((s) => s.platform === plat && s.handle);
  const ig = pick("Instagram"), tt = pick("TikTok");
  const primary = ig || tt || (p.socials || []).find((s) => s.handle);
  return {
    id: p.id,
    name: p.name,
    handle: primary ? `@${String(primary.handle).replace(/^@/, "")}` : null,
    primaryPlatform: primary ? primary.platform : null,
    status: p.status,
    age: p.age,
    location: p.location,
    niches: p.niches || [],
    families: (p.families || []).map((f) => ({ id: f.id, name: f.name, role: f.role })),
  };
}

/* ---------- list / search / resolve ---------- */

async function list_personas() {
  const ps = await apiGet("/api/personas");
  return {
    content: [{
      type: "text",
      text: JSON.stringify(
        { count: ps.length, personas: ps.map(personaCard) },
        null, 2,
      ),
    }],
  };
}

async function list_families() {
  const fs = await apiGet("/api/families");
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        count: fs.length,
        families: fs.map((f) => ({
          id: f.id, name: f.name, handle: f.handle,
          location: f.location, established: f.established,
          memberCount: f.memberCount,
          lorePreview: (f.lore || "").slice(0, 160),
        })),
      }, null, 2),
    }],
  };
}

async function search({ query }) {
  if (!query || !query.trim()) {
    return { content: [{ type: "text", text: '{"matches": []}' }] };
  }
  const q = query.trim().toLowerCase();
  const [personas, families] = await Promise.all([
    apiGet("/api/personas"),
    apiGet("/api/families"),
  ]);
  const matchPersona = (p) => {
    const hay = [
      p.name, p.location, p.biography, p.backstory, p.style,
      (p.socials || []).map((s) => s.handle).join(" "),
      (p.niches || []).join(" "),
      (p.topics || []).join(" "),
    ].join(" ").toLowerCase();
    return hay.includes(q);
  };
  const matchFamily = (f) =>
    `${f.name} ${f.handle} ${f.lore || ""} ${f.location || ""}`.toLowerCase().includes(q);
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        query,
        personas: personas.filter(matchPersona).map(personaCard),
        families: families.filter(matchFamily).map((f) => ({
          id: f.id, name: f.name, handle: f.handle, memberCount: f.memberCount,
        })),
      }, null, 2),
    }],
  };
}

async function resolve({ identifier }) {
  try {
    const r = await apiFetch(`/api/resolve/persona/${encodeURIComponent(identifier)}`);
    const data = await r.json();
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ kind: "persona", ...data }, null, 2),
      }],
    };
  } catch (e) {
    if (e.upstreamStatus === 409) {
      // Ambiguous — pass candidates through
      const body = JSON.parse(e.message.split(":").slice(2).join(":"));
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ kind: "ambiguous", ...body }, null, 2),
        }],
      };
    }
    if (e.upstreamStatus === 404) {
      // Try as a family handle/name before giving up
      const r = await fetch(`${API_BASE}/api/resolve/family/${encodeURIComponent(identifier)}`);
      if (r.ok) {
        const data = await r.json();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ kind: "family", ...data }, null, 2),
          }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ kind: "not_found", identifier }) }],
        isError: true,
      };
    }
    throw e;
  }
}

/* ---------- prompt bundles ---------- */

async function get_persona({ identifier, samples = 10, inline_images = false }) {
  const bundle = await apiGet(
    `/api/personas/${encodeURIComponent(identifier)}/prompt-bundle?samples=${samples}`,
  );
  const content = [{ type: "text", text: JSON.stringify(bundle, null, 2) }];

  // Reference photo as base64 by default
  const refUrl = bundle.visual?.referencePhotoUrl;
  if (refUrl) {
    const img = await inlineImage(refUrl);
    if (img) {
      content.push({ type: "image", data: img.base64, mimeType: img.mimeType });
    }
  }

  // Optional: also inline every sample-prompt image
  if (inline_images && Array.isArray(bundle.visual?.samplePrompts)) {
    for (const sp of bundle.visual.samplePrompts) {
      if (!sp.imageUrl) continue;
      const img = await inlineImage(sp.imageUrl);
      if (img) content.push({ type: "image", data: img.base64, mimeType: img.mimeType });
    }
  }
  return { content };
}

async function get_pair({ a, b, samples = 5, inline_images = false }) {
  // Find the relationship id between two personas (if any)
  const aRef = await apiGet(`/api/resolve/persona/${encodeURIComponent(a)}`);
  const bRef = await apiGet(`/api/resolve/persona/${encodeURIComponent(b)}`);
  if (!aRef.id || !bRef.id) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "could not resolve one or both personas", a: aRef, b: bRef }) }],
      isError: true,
    };
  }
  const rels = await apiGet(`/api/relationships?persona_id=${aRef.id}`);
  const match = rels.find((r) =>
    r.fromPersonaId === bRef.id || r.toPersonaId === bRef.id,
  );
  if (!match) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "no relationship recorded between these personas",
          a: aRef, b: bRef,
        }, null, 2),
      }],
      isError: true,
    };
  }
  const bundle = await apiGet(
    `/api/relationships/${match.id}/prompt-bundle?samples=${samples}`,
  );
  const content = [{ type: "text", text: JSON.stringify(bundle, null, 2) }];

  // Both persona reference photos as base64
  for (const side of ["from", "to"]) {
    const url = bundle[side]?.visual?.referencePhotoUrl;
    if (url) {
      const img = await inlineImage(url);
      if (img) content.push({ type: "image", data: img.base64, mimeType: img.mimeType });
    }
  }

  // Photos-together: by default URL-only; inline_images=true embeds them
  if (inline_images && Array.isArray(bundle.photosTogether)) {
    for (const p of bundle.photosTogether) {
      const img = await inlineImage(p.imageUrl);
      if (img) content.push({ type: "image", data: img.base64, mimeType: img.mimeType });
    }
  }
  return { content };
}

async function get_relationship_between({ a, b }) {
  const aRef = await apiGet(`/api/resolve/persona/${encodeURIComponent(a)}`);
  const bRef = await apiGet(`/api/resolve/persona/${encodeURIComponent(b)}`);
  if (!aRef.id || !bRef.id) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "could not resolve one or both personas" }) }],
      isError: true,
    };
  }
  const rels = await apiGet(`/api/relationships?persona_id=${aRef.id}`);
  const match = rels.find((r) =>
    r.fromPersonaId === bRef.id || r.toPersonaId === bRef.id,
  );
  return {
    content: [{
      type: "text",
      text: JSON.stringify(match ? { exists: true, relationship: match } : { exists: false }, null, 2),
    }],
  };
}

async function get_family({ identifier, samples = 5, inline_images = false }) {
  const bundle = await apiGet(
    `/api/families/${encodeURIComponent(identifier)}/prompt-bundle?samples=${samples}`,
  );
  const content = [{ type: "text", text: JSON.stringify(bundle, null, 2) }];

  // Each member's reference photo as base64
  for (const m of bundle.members || []) {
    const url = m.visual?.referencePhotoUrl;
    if (url) {
      const img = await inlineImage(url);
      if (img) content.push({ type: "image", data: img.base64, mimeType: img.mimeType });
    }
  }

  // Family cover
  if (bundle.family?.coverPhotoUrl) {
    const img = await inlineImage(bundle.family.coverPhotoUrl);
    if (img) content.push({ type: "image", data: img.base64, mimeType: img.mimeType });
  }

  if (inline_images) {
    for (const m of bundle.members || []) {
      for (const sp of m.visual?.samplePrompts || []) {
        const img = await inlineImage(sp.imageUrl);
        if (img) content.push({ type: "image", data: img.base64, mimeType: img.mimeType });
      }
    }
  }
  return { content };
}

async function get_family_of_persona({ persona, family, samples = 5, inline_images = false }) {
  const qs = new URLSearchParams();
  if (family) qs.set("family", family);
  if (samples) qs.set("samples", String(samples));
  const url = `/api/personas/${encodeURIComponent(persona)}/family-bundle${qs.toString() ? `?${qs}` : ""}`;
  try {
    const bundle = await apiGet(url);
    const content = [{ type: "text", text: JSON.stringify(bundle, null, 2) }];
    for (const m of bundle.members || []) {
      const refUrl = m.visual?.referencePhotoUrl;
      if (refUrl) {
        const img = await inlineImage(refUrl);
        if (img) content.push({ type: "image", data: img.base64, mimeType: img.mimeType });
      }
    }
    if (bundle.family?.coverPhotoUrl) {
      const img = await inlineImage(bundle.family.coverPhotoUrl);
      if (img) content.push({ type: "image", data: img.base64, mimeType: img.mimeType });
    }
    if (inline_images) {
      for (const m of bundle.members || []) {
        for (const sp of m.visual?.samplePrompts || []) {
          const img = await inlineImage(sp.imageUrl);
          if (img) content.push({ type: "image", data: img.base64, mimeType: img.mimeType });
        }
      }
    }
    return { content };
  } catch (e) {
    if (e.upstreamStatus === 404) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "persona is not in any family", persona }) }],
        isError: true,
      };
    }
    if (e.upstreamStatus === 409) {
      const body = JSON.parse(e.message.split(":").slice(2).join(":"));
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: "persona belongs to multiple families; call again with `family: \"<handle>\"`",
            ...body,
          }, null, 2),
        }],
        isError: true,
      };
    }
    throw e;
  }
}

async function get_neighborhood({ persona, depth = 2 }) {
  const subgraph = await apiGet(
    `/api/graph/neighborhood/${encodeURIComponent(persona)}?depth=${depth}`,
  );
  return {
    content: [{ type: "text", text: JSON.stringify(subgraph, null, 2) }],
  };
}

/* ============================================================
   Planning tools — storyline arcs + planned posts + library
   ============================================================ */

async function list_arcs({ persona, status, from, to } = {}) {
  const q = new URLSearchParams();
  if (persona) q.set("persona", persona);
  if (status)  q.set("status", status);
  if (from)    q.set("from", from);
  if (to)      q.set("to", to);
  const arcs = await apiGet(`/api/arcs${q.toString() ? `?${q}` : ""}`);
  return {
    content: [{
      type: "text",
      text: JSON.stringify({ count: arcs.length, arcs }, null, 2),
    }],
  };
}

async function get_arc({ arc_id }) {
  if (!arc_id) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "arc_id required" }) }],
      isError: true,
    };
  }
  try {
    const arc = await apiGet(`/api/arcs/${encodeURIComponent(arc_id)}`);
    return { content: [{ type: "text", text: JSON.stringify(arc, null, 2) }] };
  } catch (e) {
    if (e.upstreamStatus === 404) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "arc not found", arc_id }) }],
        isError: true,
      };
    }
    throw e;
  }
}

async function create_arc({ id, title, theme, starts_on, ends_on, status, location, mood, continuity_notes, notes, personas }) {
  const body = {
    id: id || crypto.randomUUID(),
    title, theme, startsOn: starts_on, endsOn: ends_on, status,
    location, mood, continuityNotes: continuity_notes, notes,
    personas: (personas || []).map((p) => {
      // accept either { handle, role } or { id, role } shapes
      if (typeof p === "string") return { id: p, role: "lead" };
      return { id: p.handle || p.id || p.personaId, role: p.role || "lead" };
    }),
  };
  const arc = await apiPost("/api/arcs", body);
  return { content: [{ type: "text", text: JSON.stringify(arc, null, 2) }] };
}

async function update_arc({ id, ...fields }) {
  if (!id) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "id required" }) }],
      isError: true,
    };
  }
  const current = await apiGet(`/api/arcs/${id}`);
  const body = {
    title:            fields.title ?? current.title,
    theme:            fields.theme ?? current.theme,
    startsOn:         fields.starts_on ?? current.startsOn,
    endsOn:           fields.ends_on   ?? current.endsOn,
    status:           fields.status ?? current.status,
    location:         fields.location ?? current.location,
    mood:             fields.mood ?? current.mood,
    continuityNotes:  fields.continuity_notes ?? current.continuityNotes,
    notes:            fields.notes ?? current.notes,
  };
  const arc = await apiPut(`/api/arcs/${id}`, body);
  return { content: [{ type: "text", text: JSON.stringify(arc, null, 2) }] };
}

async function delete_arc({ id }) {
  await apiDelete(`/api/arcs/${id}`);
  return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
}

async function list_planned_posts({ persona, arc_id, status, from, to, post_type } = {}) {
  const q = new URLSearchParams();
  if (persona)   q.set("persona", persona);
  if (arc_id)    q.set("arc_id", arc_id);
  if (status)    q.set("status", status);
  if (from)      q.set("from", from);
  if (to)        q.set("to", to);
  if (post_type) q.set("post_type", post_type);
  const posts = await apiGet(`/api/planned-posts${q.toString() ? `?${q}` : ""}`);
  return {
    content: [{
      type: "text",
      text: JSON.stringify({ count: posts.length, posts }, null, 2),
    }],
  };
}

async function create_planned_post(args) {
  const body = {
    id: args.id || crypto.randomUUID(),
    arcId: args.arc_id || null,
    personaId: args.persona, // handle/name/uuid — API resolves it
    platform: args.platform || "instagram",
    postType: args.post_type,
    storyType: args.story_type,
    scheduledAt: args.scheduled_at,
    positionInArc: args.position_in_arc,
    caption: args.caption,
    hashtags: args.hashtags || [],
    overlayText: args.overlay_text,
    generationPrompt: args.generation_prompt,
    generationModel: args.generation_model,
    referenceImageId: args.reference_image_id,
    libraryAssetId: args.library_asset_id,
    notes: args.notes,
    status: args.status || "planned",
  };
  const post = await apiPost("/api/planned-posts", body);
  return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
}

async function update_planned_post({ id, ...fields }) {
  if (!id) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "id required" }) }],
      isError: true,
    };
  }
  const current = await apiGet(`/api/planned-posts/${id}`);
  const body = {
    arcId:           fields.arc_id ?? current.arcId,
    personaId:       fields.persona ?? current.personaId,
    platform:        fields.platform ?? current.platform,
    postType:        fields.post_type ?? current.postType,
    storyType:       fields.story_type ?? current.storyType,
    scheduledAt:     fields.scheduled_at ?? current.scheduledAt,
    positionInArc:   fields.position_in_arc ?? current.positionInArc,
    caption:         fields.caption ?? current.caption,
    hashtags:        fields.hashtags ?? current.hashtags,
    overlayText:     fields.overlay_text ?? current.overlayText,
    generationPrompt:fields.generation_prompt ?? current.generationPrompt,
    generationModel: fields.generation_model ?? current.generationModel,
    referenceImageId:fields.reference_image_id ?? current.referenceImageId,
    libraryAssetId:  fields.library_asset_id ?? current.libraryAssetId,
    notes:           fields.notes ?? current.notes,
    status:          fields.status ?? current.status,
  };
  const post = await apiPut(`/api/planned-posts/${id}`, body);
  return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
}

async function set_post_status({ id, status, reason, feedback }) {
  if (!id || !status) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "id and status required" }) }],
      isError: true,
    };
  }
  const body = { status };
  if (reason !== undefined)   body.rejectionReason = reason;
  if (feedback !== undefined) body.regenerationFeedback = feedback;
  const post = await apiPatch(`/api/planned-posts/${id}/status`, body);
  return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
}

async function list_library({ scene_type, mood, location, time_of_day, tags } = {}) {
  const q = new URLSearchParams();
  if (scene_type)  q.set("scene_type", scene_type);
  if (mood)        q.set("mood", mood);
  if (location)    q.set("location", location);
  if (time_of_day) q.set("time_of_day", time_of_day);
  if (tags) {
    q.set("tags", Array.isArray(tags) ? tags.join(",") : tags);
  }
  const assets = await apiGet(`/api/library${q.toString() ? `?${q}` : ""}`);
  return {
    content: [{
      type: "text",
      text: JSON.stringify({ count: assets.length, assets }, null, 2),
    }],
  };
}

async function train_soul_id({ persona, name, min_images }) {
  if (!persona) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "persona required" }) }],
      isError: true,
    };
  }
  try {
    const body = {};
    if (name) body.name = name;
    if (min_images != null) body.minImages = min_images;
    const job = await apiPost(`/api/personas/${encodeURIComponent(persona)}/soul-train`, body);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: "Soul training queued. The generator worker will pick it up. Poll the training id for status.",
          training: job,
        }, null, 2),
      }],
    };
  } catch (e) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: e.message,
          upstreamStatus: e.upstreamStatus,
        }),
      }],
      isError: true,
    };
  }
}

async function get_soul_trainings({ persona }) {
  if (!persona) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "persona required" }) }],
      isError: true,
    };
  }
  const list = await apiGet(`/api/personas/${encodeURIComponent(persona)}/soul-trainings`);
  return {
    content: [{
      type: "text",
      text: JSON.stringify({ count: list.length, trainings: list }, null, 2),
    }],
  };
}

async function assign_library_to_post({ planned_post_id, library_asset_id }) {
  if (!planned_post_id || !library_asset_id) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "planned_post_id and library_asset_id required" }) }],
      isError: true,
    };
  }
  const post = await apiPost(
    `/api/planned-posts/${planned_post_id}/library`,
    { libraryAssetId: library_asset_id },
  );
  return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
}

/* ---------- tool registry ---------- */

export const TOOLS = [
  {
    name: "list_personas",
    description:
      "List every persona in the database with a compact card (id, name, primary handle, status, niches, families). Use as the starting point when you don't know specific names.",
    inputSchema: { type: "object", properties: {} },
    handler: () => list_personas(),
  },
  {
    name: "list_families",
    description:
      "List every family with a lore preview and member count. Pair with get_family or get_family_of_persona for the full bundle.",
    inputSchema: { type: "object", properties: {} },
    handler: () => list_families(),
  },
  {
    name: "search",
    description:
      "Free-text search across persona bios, backstories, styles, niches, topics, social handles, and family lore. Returns matching personas + families.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search string" },
      },
      required: ["query"],
    },
    handler: (args) => search(args),
  },
  {
    name: "resolve",
    description:
      "Resolve a free-text identifier (name, IG/TT handle like @maya.moves, family handle like the-riveras, or a UUID) to a canonical persona or family. Returns ambiguous candidates if there are multiple matches.",
    inputSchema: {
      type: "object",
      properties: {
        identifier: { type: "string", description: "Name, handle, or UUID" },
      },
      required: ["identifier"],
    },
    handler: (args) => resolve(args),
  },
  {
    name: "get_persona",
    description:
      "Full prompt-bundle for a persona: identity, age, location, story (bio/backstory/personality/values), visual (reference photo + style + physical descriptors + sampled image prompts), social (handles + niches + topics), and the 1-hop neighborhood of relationships and family memberships. Reference photo is included as base64 by default; pass inline_images=true to also embed every sample-prompt image.",
    inputSchema: {
      type: "object",
      properties: {
        identifier: { type: "string", description: "Persona name, handle (@maya.moves), or UUID" },
        samples: { type: "integer", description: "How many image prompts to sample from the persona's gallery", default: 10, minimum: 0, maximum: 30 },
        inline_images: { type: "boolean", description: "Also embed every sample-prompt image as base64", default: false },
      },
      required: ["identifier"],
    },
    handler: (args) => get_persona(args),
  },
  {
    name: "get_pair",
    description:
      "Prompt-bundle for two personas together: both personas' visual+story summaries, the full relationship narrative (origin/dynamic/bonding moments/tensions/mutual influence/inside jokes/current arc/content seeds), and any photos taken together. Both reference photos are included as base64.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "string", description: "First persona name or handle" },
        b: { type: "string", description: "Second persona name or handle" },
        samples: { type: "integer", description: "How many image prompts to sample per persona", default: 5, minimum: 0, maximum: 20 },
        inline_images: { type: "boolean", description: "Also embed photos-together as base64", default: false },
      },
      required: ["a", "b"],
    },
    handler: (args) => get_pair(args),
  },
  {
    name: "get_family",
    description:
      "Prompt-bundle for a family: family meta (name, handle, lore, location, established), cover photo, every member's persona summary (with role + generation + parent links), and all intra-family relationships with their narratives. Each member's reference photo is included as base64.",
    inputSchema: {
      type: "object",
      properties: {
        identifier: { type: "string", description: "Family name, handle (the-riveras), or UUID" },
        samples: { type: "integer", description: "How many image prompts to sample per member", default: 5, minimum: 0, maximum: 20 },
        inline_images: { type: "boolean", description: "Also embed every sample-prompt image as base64", default: false },
      },
      required: ["identifier"],
    },
    handler: (args) => get_family(args),
  },
  {
    name: "get_family_of_persona",
    description:
      "Family prompt-bundle entered via a persona handle — e.g. 'give me the family of @maya.moves'. If the persona is in exactly one family, that family's bundle is returned. If in multiple, the response is an error listing the candidate families; call again with `family: \"<handle>\"`. If in none, also an error.",
    inputSchema: {
      type: "object",
      properties: {
        persona: { type: "string", description: "Persona name or handle" },
        family: { type: "string", description: "Optional family handle/UUID to disambiguate" },
        samples: { type: "integer", default: 5, minimum: 0, maximum: 20 },
        inline_images: { type: "boolean", default: false },
      },
      required: ["persona"],
    },
    handler: (args) => get_family_of_persona(args),
  },
  {
    name: "get_neighborhood",
    description:
      "Return the subgraph reachable within N hops from a persona — for exploring who else fits a storyline. Lightweight: nodes carry only id/name/photoId/depth; edges carry category+type. Use get_persona or get_pair on specific nodes for full bundles.",
    inputSchema: {
      type: "object",
      properties: {
        persona: { type: "string", description: "Persona name or handle" },
        depth: { type: "integer", description: "Max hops from the root", default: 2, minimum: 0, maximum: 4 },
      },
      required: ["persona"],
    },
    handler: (args) => get_neighborhood(args),
  },
  {
    name: "get_relationship_between",
    description:
      "Check whether a relationship exists between two personas. Returns `{ exists: false }` or a compact relationship record. Lighter than get_pair; use this first if you don't yet need the full narrative.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "string", description: "First persona name or handle" },
        b: { type: "string", description: "Second persona name or handle" },
      },
      required: ["a", "b"],
    },
    handler: (args) => get_relationship_between(args),
  },

  /* ---------- planning tools ---------- */

  {
    name: "list_arcs",
    description:
      "List storyline arcs. Filter by persona (handle/name), status (planning|active|past|archived), or date window (from/to as YYYY-MM-DD). Without filters, returns all arcs newest first. Each result is compact (no posts); use get_arc for the full one.",
    inputSchema: {
      type: "object",
      properties: {
        persona: { type: "string", description: "Filter to arcs that include this persona" },
        status:  { type: "string", description: "planning | active | past | archived" },
        from:    { type: "string", description: "Arcs that end on/after this date (YYYY-MM-DD)" },
        to:      { type: "string", description: "Arcs that start on/before this date (YYYY-MM-DD)" },
      },
    },
    handler: (args) => list_arcs(args),
  },
  {
    name: "get_arc",
    description:
      "Full arc: metadata + every persona on it + every planned post in scheduled order. Use this once you've identified an arc via list_arcs.",
    inputSchema: {
      type: "object",
      properties: {
        arc_id: { type: "string", description: "Arc UUID" },
      },
      required: ["arc_id"],
    },
    handler: (args) => get_arc(args),
  },
  {
    name: "create_arc",
    description:
      "Create a new storyline arc spanning 1..N personas. Provide title, theme, starts_on/ends_on (YYYY-MM-DD), and an array of personas. Each persona is either a string (handle/name, role defaults to 'lead') or { handle, role } where role is 'lead' | 'co-star' | 'cameo'.",
    inputSchema: {
      type: "object",
      properties: {
        id:               { type: "string", description: "Optional UUID; auto-generated if omitted" },
        title:            { type: "string" },
        theme:            { type: "string", description: "One-line theme" },
        starts_on:        { type: "string", description: "YYYY-MM-DD" },
        ends_on:          { type: "string", description: "YYYY-MM-DD" },
        status:           { type: "string", description: "planning (default) | active | past | archived" },
        location:         { type: "string" },
        mood:             { type: "string", description: "e.g. 'relaxed, sun-drenched, candid'" },
        continuity_notes: { type: "string", description: "Outfit, location, look continuity rules" },
        notes:            { type: "string" },
        personas: {
          type: "array",
          items: { type: ["string", "object"], description: "handle string OR { handle, role }" },
        },
      },
      required: ["title", "starts_on", "ends_on", "personas"],
    },
    handler: (args) => create_arc(args),
  },
  {
    name: "update_arc",
    description:
      "Patch fields on an existing arc. Only provided fields are changed.",
    inputSchema: {
      type: "object",
      properties: {
        id:               { type: "string" },
        title:            { type: "string" },
        theme:            { type: "string" },
        starts_on:        { type: "string" },
        ends_on:          { type: "string" },
        status:           { type: "string" },
        location:         { type: "string" },
        mood:             { type: "string" },
        continuity_notes: { type: "string" },
        notes:            { type: "string" },
      },
      required: ["id"],
    },
    handler: (args) => update_arc(args),
  },
  {
    name: "delete_arc",
    description:
      "Delete an arc. Planned posts on the arc keep their data — their arc_id is set to null.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    handler: (args) => delete_arc(args),
  },

  {
    name: "list_planned_posts",
    description:
      "List planned posts. Filter by persona (handle), arc, status (comma-separated for multiple), date window (from/to as ISO timestamps), or post_type (ig_feed|ig_story|ig_carousel). Use this BEFORE planning so the skill doesn't double-book a slot.",
    inputSchema: {
      type: "object",
      properties: {
        persona:   { type: "string" },
        arc_id:    { type: "string" },
        status:    { type: "string", description: "Single status or comma-separated list" },
        from:      { type: "string", description: "ISO timestamp; posts scheduled at or after" },
        to:        { type: "string", description: "ISO timestamp; posts scheduled before" },
        post_type: { type: "string" },
      },
    },
    handler: (args) => list_planned_posts(args),
  },
  {
    name: "create_planned_post",
    description:
      "Create one planned post on an arc (or standalone). Provide persona (handle), post_type (ig_feed|ig_story|ig_carousel), and a story_type that describes how it'll be produced (persona_selfie | persona_mirror | persona_pov | library_landscape_music | library_food | library_object | library_workspace | feed_repost | text_overlay | friend_cameo). For persona_* types include generation_prompt + generation_model; for library_* types attach via assign_library_to_post.",
    inputSchema: {
      type: "object",
      properties: {
        id:                 { type: "string" },
        arc_id:             { type: "string" },
        persona:            { type: "string", description: "Handle or name" },
        platform:           { type: "string", description: "Default 'instagram'" },
        post_type:          { type: "string", description: "ig_feed | ig_story | ig_carousel" },
        story_type:         { type: "string", description: "See description for the taxonomy" },
        scheduled_at:       { type: "string", description: "ISO timestamp" },
        position_in_arc:    { type: "integer" },
        caption:            { type: "string" },
        hashtags:           { type: "array", items: { type: "string" } },
        overlay_text:       { type: "string", description: "For text_overlay stories" },
        generation_prompt:  { type: "string", description: "For persona_* types" },
        generation_model:   { type: "string", description: "e.g. nano_banana_2, text2image_soul_v2, seedream_5_lite" },
        reference_image_id: { type: "string" },
        library_asset_id:   { type: "string" },
        notes:              { type: "string" },
        status:             { type: "string", description: "Default 'planned'" },
      },
      required: ["persona", "post_type"],
    },
    handler: (args) => create_planned_post(args),
  },
  {
    name: "update_planned_post",
    description:
      "Patch fields on an existing planned post. Only provided fields are changed. For status changes use set_post_status (it accepts feedback/reason cleanly).",
    inputSchema: {
      type: "object",
      properties: {
        id:                 { type: "string" },
        arc_id:             { type: "string" },
        persona:            { type: "string" },
        post_type:          { type: "string" },
        story_type:         { type: "string" },
        scheduled_at:       { type: "string" },
        position_in_arc:    { type: "integer" },
        caption:            { type: "string" },
        hashtags:           { type: "array", items: { type: "string" } },
        overlay_text:       { type: "string" },
        generation_prompt:  { type: "string" },
        generation_model:   { type: "string" },
        reference_image_id: { type: "string" },
        library_asset_id:   { type: "string" },
        notes:              { type: "string" },
      },
      required: ["id"],
    },
    handler: (args) => update_planned_post(args),
  },
  {
    name: "set_post_status",
    description:
      "Transition a planned post through its status state machine: planned → approved → generating → generated → accepted → pushed → posted, OR → rejected. For rejected, include `reason`. For a regenerate request, set status=approved and pass `feedback` describing what to change.",
    inputSchema: {
      type: "object",
      properties: {
        id:       { type: "string" },
        status:   { type: "string", description: "Target status" },
        reason:   { type: "string", description: "Why rejected (for status=rejected)" },
        feedback: { type: "string", description: "Refinement notes (for regenerate)" },
      },
      required: ["id", "status"],
    },
    handler: (args) => set_post_status(args),
  },

  {
    name: "list_library",
    description:
      "List reusable library assets (stock photos the user uploaded). Filter by scene_type (food|drink|workspace|landscape|street|interior|sky|object), mood, location, time_of_day, or tags. Use this when planning a library_* story slot to find a fitting asset.",
    inputSchema: {
      type: "object",
      properties: {
        scene_type:  { type: "string" },
        mood:        { type: "string" },
        location:    { type: "string" },
        time_of_day: { type: "string" },
        tags:        { type: ["string", "array"], items: { type: "string" }, description: "Comma-separated or array" },
      },
    },
    handler: (args) => list_library(args),
  },
  {
    name: "assign_library_to_post",
    description:
      "Attach a library asset to a planned post (typical for library_* story slots). Bumps the asset's usage counter and timestamp.",
    inputSchema: {
      type: "object",
      properties: {
        planned_post_id:  { type: "string" },
        library_asset_id: { type: "string" },
      },
      required: ["planned_post_id", "library_asset_id"],
    },
    handler: (args) => assign_library_to_post(args),
  },

  {
    name: "train_soul_id",
    description:
      "Queue a Higgsfield Soul ID training for a persona. The persona needs at least 10 reference images in its gallery (Higgsfield recommends 10-20). The generator worker picks up the job and runs `higgsfield soul-id create --soul-2`. On success the resulting Soul ID is stored on the persona and every future Soul generation uses it. Poll progress via get_soul_trainings.",
    inputSchema: {
      type: "object",
      properties: {
        persona:     { type: "string", description: "Persona name or handle" },
        name:        { type: "string", description: "Optional Soul ID name (default: persona-slug-v1)" },
        min_images:  { type: "integer", description: "Override the minimum image threshold (default 10)" },
      },
      required: ["persona"],
    },
    handler: (args) => train_soul_id(args),
  },
  {
    name: "get_soul_trainings",
    description:
      "List Soul ID training jobs for a persona, newest first. Use to poll status (queued | running | completed | failed) of a training started via train_soul_id.",
    inputSchema: {
      type: "object",
      properties: {
        persona: { type: "string", description: "Persona name or handle" },
      },
      required: ["persona"],
    },
    handler: (args) => get_soul_trainings(args),
  },
];

export const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
