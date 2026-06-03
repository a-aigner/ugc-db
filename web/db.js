/* ============================================================
   Data layer — REST client talking to /api
   Exposes: window.DB, window.uid, window.api
   ============================================================ */
(function () {
  const API = "/api";

  async function jget(path) {
    const r = await fetch(API + path);
    if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
    return r.json();
  }
  async function jsend(method, path, body) {
    const r = await fetch(API + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`${method} ${path} → ${r.status} ${text}`);
    }
    if (method === "DELETE" || r.status === 204) return null;
    return r.json();
  }

  async function uploadImage(blob) {
    const fd = new FormData();
    fd.append("file", blob, blob.name || "upload.bin");
    const r = await fetch(API + "/images", { method: "POST", body: fd });
    if (!r.ok) throw new Error(`upload failed → ${r.status}`);
    const { id } = await r.json();
    return id;
  }

  /* Walk the persona object and replace any pending Blobs with uploaded image IDs.
     The form keeps Blobs in:
       p.photo  (Blob | null)              — new upload, or null if unchanged/cleared
       p.photoId (string | null)           — existing image, kept if photo is null
       p.gallery[i].blob (Blob | null)     — new upload
       p.gallery[i].imageId (string | null) — existing image
     We POST any Blobs to /api/images, then send a JSON-only payload. */
  async function uploadPending(p) {
    const out = { ...p };

    if (p.photo instanceof Blob) {
      out.photoId = await uploadImage(p.photo);
    }
    delete out.photo;

    out.gallery = await Promise.all(
      (p.gallery || []).map(async (g) => {
        const item = { ...g };
        if (g.blob instanceof Blob) {
          item.imageId = await uploadImage(g.blob);
        }
        delete item.blob;
        return item;
      }),
    );

    return out;
  }

  window.DB = {
    async all() {
      return await jget("/personas");
    },
    async get(id) {
      return await jget(`/personas/${id}`);
    },
    async put(p) {
      const payload = await uploadPending(p);
      // PUT is idempotent: server inserts if missing, updates if present.
      return await jsend("PUT", `/personas/${payload.id}`, payload);
    },
    async del(id) {
      await jsend("DELETE", `/personas/${id}`);
    },
    async seed() {
      return await jsend("POST", "/seed");
    },

    families: {
      async all() { return await jget("/families"); },
      async get(id) { return await jget(`/families/${id}`); },
      async put(family) {
        // Upload pending cover photo if present
        const payload = { ...family };
        if (family.photo instanceof Blob) {
          payload.photoId = await uploadImage(family.photo);
        }
        delete payload.photo;
        return await jsend("PUT", `/families/${payload.id}`, payload);
      },
      async del(id) { await jsend("DELETE", `/families/${id}`); },
      async addMember(familyId, member) {
        return await jsend("POST", `/families/${familyId}/members`, member);
      },
      async updateMember(familyId, memberId, member) {
        return await jsend("PUT", `/families/${familyId}/members/${memberId}`, member);
      },
      async removeMember(familyId, memberId) {
        return await jsend("DELETE", `/families/${familyId}/members/${memberId}`);
      },
    },

    relationships: {
      async forPersona(personaId) {
        return await jget(`/relationships?persona_id=${encodeURIComponent(personaId)}`);
      },
      async get(id) { return await jget(`/relationships/${id}`); },
      async put(rel) {
        // POST when no existing record (so we can detect 409 duplicates),
        // PUT when updating a known id.
        if (rel.__existing) {
          delete rel.__existing;
          return await jsend("PUT", `/relationships/${rel.id}`, rel);
        }
        // Try POST; on 409 the caller can route to the existing record.
        const r = await fetch(`${API}/relationships`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rel),
        });
        if (r.status === 409) {
          const { existingId } = await r.json();
          const err = new Error("relationship already exists");
          err.code = "duplicate";
          err.existingId = existingId;
          throw err;
        }
        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          throw new Error(`POST /relationships → ${r.status} ${txt}`);
        }
        return await r.json();
      },
      async del(id) { await jsend("DELETE", `/relationships/${id}`); },
      async uploadImage(relId, blob, caption, taken) {
        const fd = new FormData();
        fd.append("file", blob, blob.name || "image.bin");
        if (caption) fd.append("caption", caption);
        if (taken) fd.append("taken", taken);
        const r = await fetch(`${API}/relationships/${relId}/images`, { method: "POST", body: fd });
        if (!r.ok) throw new Error(`upload failed → ${r.status}`);
        return await r.json();
      },
      async removeImage(relId, imageRecordId) {
        await jsend("DELETE", `/relationships/${relId}/images/${imageRecordId}`);
      },
    },
  };

  /* ---------- storyline arcs ---------- */
  const arcs = {
    async all({ persona, status, from, to } = {}) {
      const q = new URLSearchParams();
      if (persona) q.set("persona", persona);
      if (status) q.set("status", status);
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      return await jget(`/arcs${q.toString() ? `?${q}` : ""}`);
    },
    async get(id) { return await jget(`/arcs/${id}`); },
    async create(arc) { return await jsend("POST", `/arcs`, arc); },
    async update(id, arc) { return await jsend("PUT", `/arcs/${id}`, arc); },
    async del(id) { await jsend("DELETE", `/arcs/${id}`); },
    async addPersona(arcId, personaId, role) {
      return await jsend("POST", `/arcs/${arcId}/personas`, { personaId, role });
    },
    async removePersona(arcId, personaId) {
      return await jsend("DELETE", `/arcs/${arcId}/personas/${personaId}`);
    },
  };

  /* ---------- planned posts ---------- */
  const plannedPosts = {
    async all({ persona, arcId, status, from, to, postType } = {}) {
      const q = new URLSearchParams();
      if (persona) q.set("persona", persona);
      if (arcId) q.set("arc_id", arcId);
      if (status) q.set("status", status);
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      if (postType) q.set("post_type", postType);
      return await jget(`/planned-posts${q.toString() ? `?${q}` : ""}`);
    },
    async get(id) { return await jget(`/planned-posts/${id}`); },
    async create(post) { return await jsend("POST", `/planned-posts`, post); },
    async update(id, post) { return await jsend("PUT", `/planned-posts/${id}`, post); },
    async setStatus(id, { status, reason, feedback, generatedImageId, generationMetadata } = {}) {
      const body = { status };
      if (reason !== undefined) body.rejectionReason = reason;
      if (feedback !== undefined) body.regenerationFeedback = feedback;
      if (generatedImageId !== undefined) body.generatedImageId = generatedImageId;
      if (generationMetadata !== undefined) body.generationMetadata = generationMetadata;
      return await jsend("PATCH", `/planned-posts/${id}/status`, body);
    },
    async del(id) { await jsend("DELETE", `/planned-posts/${id}`); },
    async assignLibrary(postId, libraryAssetId) {
      return await jsend("POST", `/planned-posts/${postId}/library`, { libraryAssetId });
    },
    /** Manually trigger / retry a fleetmanager push. */
    async push(id) { return await jsend("POST", `/planned-posts/${id}/push`, {}); },
  };

  /* ---------- fleet integration status ---------- */
  const fleet = {
    async status() { return await jget(`/fleet/status`); },
  };

  /* ---------- library assets ---------- */
  const library = {
    async all({ sceneType, mood, location, timeOfDay, tags } = {}) {
      const q = new URLSearchParams();
      if (sceneType) q.set("scene_type", sceneType);
      if (mood) q.set("mood", mood);
      if (location) q.set("location", location);
      if (timeOfDay) q.set("time_of_day", timeOfDay);
      if (tags) q.set("tags", Array.isArray(tags) ? tags.join(",") : tags);
      return await jget(`/library${q.toString() ? `?${q}` : ""}`);
    },
    async get(id) { return await jget(`/library/${id}`); },
    /* Upload a single asset: pass File + metadata. Returns the saved asset. */
    async upload(blob, meta = {}) {
      const fd = new FormData();
      fd.append("file", blob, blob.name || "upload.png");
      for (const [k, v] of Object.entries(meta)) {
        if (v == null || v === "") continue;
        if (Array.isArray(v)) fd.append(k, v.join(","));
        else fd.append(k, String(v));
      }
      const r = await fetch(`${API}/library`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(`library upload → ${r.status}`);
      return await r.json();
    },
    async update(id, meta) { return await jsend("PUT", `/library/${id}`, meta); },
    async del(id) { await jsend("DELETE", `/library/${id}`); },
  };

  /* ---------- soul-id training ---------- */
  const soulTraining = {
    async start(personaIdOrHandle, opts = {}) {
      return await jsend("POST", `/personas/${encodeURIComponent(personaIdOrHandle)}/soul-train`, opts);
    },
    async listForPersona(personaIdOrHandle) {
      return await jget(`/personas/${encodeURIComponent(personaIdOrHandle)}/soul-trainings`);
    },
    async get(id) { return await jget(`/soul-trainings/${id}`); },
  };

  window.DB.arcs = arcs;
  window.DB.plannedPosts = plannedPosts;
  window.DB.library = library;
  window.DB.soul = soulTraining;
  window.DB.fleet = fleet;

  window.api = {
    uploadImage,
    imageUrl: (id) => (id ? `${API}/images/${id}` : null),
  };

  window.uid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
})();
