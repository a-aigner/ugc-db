/* ============================================================
   RelationshipForm — pick other persona, pick category+type, fill narrative.
   Renders all three sections in one overlay; the user can scroll between them.
   ============================================================ */

function blankRelationship(fromPersonaId) {
  return {
    id: window.uid(),
    fromPersonaId: fromPersonaId || null,
    toPersonaId: null,
    category: "friendship",
    type: "close_friend",
    customLabel: "",
    isDirectional: false,
    cadence: "",
    since: "",
    status: "",
    familyId: null,
    origin: "",
    dynamic: "",
    bondingMoments: "",
    tensions: "",
    mutualInfluence: "",
    insideJokes: "",
    currentArc: "",
    contentSeeds: "",
  };
}

/* A single photo-together row in the editor: thumbnail (pending blob OR
   server image) + caption + taken + remove button. */
function PhotoTogetherRow({ item, onChange, onRemove }) {
  const url = useImageUrl({ blob: item.blob, imageId: item.imageId });
  const fileRef = useRef(null);
  const set = (k, v) => onChange({ ...item, [k]: v });
  const pick = (file) => {
    // New file replaces any prior image (blob OR persisted imageId)
    if (file && file.type.startsWith("image/")) onChange({ ...item, blob: file, imageId: null });
  };
  return (
    <div className="edit-img-row">
      <div className="eir-thumb">
        <div
          className={"et-img" + (url ? "" : " is-empty")}
          style={url ? { backgroundImage: `url("${url}")` } : {}}
          onClick={() => fileRef.current && fileRef.current.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}
          title={url ? "Click to replace image" : "Click to add image"}
        >
          {!url && (
            <span className="et-add">
              <Icon name="upload" size={16} />
              add photo
            </span>
          )}
          {url && <span className="et-replace">Replace</span>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files[0])} />
        <button type="button" className="et-remove" onClick={onRemove} title="Remove photo">
          <Icon name="x" size={13} stroke={2.4} />
        </button>
      </div>
      <div className="eir-fields">
        <label className="f">
          <span className="f-label">Caption</span>
          <input
            value={item.caption || ""}
            onChange={(e) => set("caption", e.target.value)}
            placeholder="What's happening in this photo…"
          />
        </label>
        <label className="f">
          <span className="f-label">When</span>
          <input
            value={item.taken || ""}
            onChange={(e) => set("taken", e.target.value)}
            placeholder="PCH road trip '20, 2024-10-31…"
          />
        </label>
      </div>
    </div>
  );
}

/* Friendship ladder — 5-dot intensity scale. */
function FriendshipLadder({ value, onChange }) {
  const rungs = window.typesByCategory("friendship");
  return (
    <div className="friendship-ladder">
      {rungs.map((t) => {
        const on = value === t.key;
        const level = t.friendship_level ?? null;
        return (
          <button
            type="button"
            key={t.key}
            className={"rung level-" + (level == null ? "x" : level) + (on ? " on" : "")}
            onClick={() => onChange(t.key)}
          >
            {level != null && (
              <div className="rung-dots">
                {[1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className={i <= level ? "lit" : ""} />
                ))}
              </div>
            )}
            <div className="rung-name">{t.label}</div>
          </button>
        );
      })}
    </div>
  );
}

/* Generic chip grid for non-friendship categories. */
function TypeChipGrid({ category, value, onChange }) {
  const types = window.typesByCategory(category);
  return (
    <div className="type-chip-grid">
      {types.map((t) => (
        <button
          type="button"
          key={t.key}
          className={"type-chip " + (t.directional ? "directional" : "symmetric") + (value === t.key ? " on" : "")}
          onClick={() => onChange(t.key)}
        >
          <span>{t.label}</span>
          {t.directional && t.inverse_label && (
            <span className="t-arrow">→ {t.inverse_label}</span>
          )}
          {t.directional && !t.inverse_label && <span className="t-arrow">→</span>}
          {!t.directional && <span className="t-arrow">↔</span>}
        </button>
      ))}
    </div>
  );
}

function CategoryTabs({ value, onChange }) {
  return (
    <div className="seg cat-tabs">
      {window.REL_CATEGORIES.map((c) => (
        <button
          type="button"
          key={c.key}
          className={"seg-btn" + (value === c.key ? " on" : "")}
          onClick={() => onChange(c.key)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function RelationshipForm({ initial, fromPersona, allPersonas, allFamilies, onSave, onCancel }) {
  const [r, setR] = useState(() => {
    if (initial) return JSON.parse(JSON.stringify({ ...initial, images: undefined }));
    return blankRelationship(fromPersona?.id);
  });
  // Photos-together: each item is { id, blob?, imageId?, caption, taken, position }.
  // Existing photos arrive with imageId; new ones get blob.
  const [photos, setPhotos] = useState(() =>
    initial && initial.images
      ? initial.images.map((img) => ({
          id: img.id || window.uid(),
          blob: null,
          imageId: img.imageId || null,
          caption: img.caption || "",
          taken: img.taken || "",
          position: img.position ?? 0,
        }))
      : [],
  );
  const photoInput = useRef(null);
  // Remember which originally-loaded photos were deleted so we can call
  // DELETE on the server after save.
  const [removedPhotoIds, setRemovedPhotoIds] = useState([]);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setR((s) => ({ ...s, [k]: v }));

  // When category changes, default the type to the first item in that category.
  const switchCategory = (catKey) => {
    const list = window.typesByCategory(catKey);
    const first = list[0];
    if (!first) return;
    setR((s) => ({
      ...s,
      category: catKey,
      type: first.key,
      isDirectional: !!first.directional,
      customLabel: "",
    }));
  };

  const switchType = (typeKey) => {
    const t = window.REL_TYPES_BY_KEY[typeKey];
    setR((s) => ({
      ...s,
      type: typeKey,
      isDirectional: !!t?.directional,
      // clear custom_label unless we're picking custom
      customLabel: typeKey === "custom" ? s.customLabel : "",
    }));
  };

  // Who's the "other" persona (anyone except fromPersona, no self-link)
  const otherCandidates = (allPersonas || []).filter(
    (p) => p.id !== r.fromPersonaId,
  );
  const toPersona = otherCandidates.find((p) => p.id === r.toPersonaId);

  const addBlankPhoto = () => {
    setPhotos((ps) => [
      ...ps,
      { id: window.uid(), blob: null, imageId: null, caption: "", taken: "", position: ps.length },
    ]);
  };
  const onPhotoFiles = (files) => {
    const imgs = [...files].filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setPhotos((ps) => [
      ...ps,
      ...imgs.map((f) => ({
        id: window.uid(), blob: f, imageId: null,
        caption: "", taken: "", position: ps.length,
      })),
    ]);
  };
  const removePhoto = (idx) => {
    const target = photos[idx];
    // If this photo had an existing server-side record, remember to DELETE it.
    if (target.imageId && initial) {
      const original = initial.images?.find((x) => x.id === target.id);
      if (original) setRemovedPhotoIds((ids) => [...ids, original.id]);
    }
    setPhotos((ps) => ps.filter((_, j) => j !== idx));
  };

  const save = async () => {
    if (!r.fromPersonaId) { setErr("Pick the 'from' persona."); return; }
    if (!r.toPersonaId)   { setErr("Pick the other persona."); return; }
    if (r.fromPersonaId === r.toPersonaId) { setErr("Pick two different personas."); return; }
    if (!r.type)          { setErr("Pick a type."); return; }
    setErr("");
    setSaving(true);
    try {
      const payload = { ...r };
      if (initial) payload.__existing = true;
      const saved = await window.DB.relationships.put(payload);

      // 1. Remove any deleted server-side photos
      for (const recordId of removedPhotoIds) {
        await window.DB.relationships.removeImage(saved.id, recordId);
      }

      // 2. Upload any new photos. Updates to caption/taken on existing
      //    photos aren't supported by the server yet — they'd require a PUT
      //    on /api/relationships/:id/images/:iid. For now we treat the
      //    pair as immutable after upload (matches the "scrapbook" mental model).
      for (const ph of photos) {
        if (ph.blob instanceof Blob) {
          await window.DB.relationships.uploadImage(saved.id, ph.blob, ph.caption, ph.taken);
        }
      }

      // 3. Reload with fresh server state so the parent sees the new photos
      const fresh = await window.DB.relationships.get(saved.id);
      onSave(fresh);
    } catch (e) {
      if (e.code === "duplicate") {
        setErr(`A relationship of this exact type already exists. (id ${e.existingId.slice(0, 8)}…) — open or edit that one instead.`);
      } else {
        setErr(e.message || "Failed to save.");
      }
    } finally {
      setSaving(false);
    }
  };

  const t = window.REL_TYPES_BY_KEY[r.type];
  const inheritedFamily = (allFamilies || []).find((f) => f.id === r.familyId);

  return (
    <Overlay onClose={onCancel} wide>
      <div className="sheet-head">
        <div>
          <div className="eyebrow">{initial ? "Edit relationship" : "New relationship"}</div>
          <h2>
            {fromPersona?.name || "(pick from)"} <span className="rel-arrow">{t?.directional ? "→" : "↔"}</span> {toPersona?.name || "(pick other)"}
          </h2>
        </div>
        <button className="iconbtn lg" onClick={onCancel} title="Close">
          <Icon name="x" size={20} />
        </button>
      </div>

      <div className="sheet-body form-body">
        {/* STEP 1 — pick the other persona */}
        <section className="form-sec">
          <h4 className="sec-label">1 · The other persona</h4>
          {fromPersona && (
            <div className="rel-from-summary">
              <Photo imageId={fromPersona.photoId} className="rel-from-thumb" />
              <div>
                <div className="rel-from-name">{fromPersona.name}</div>
                <div className="rel-from-sub">From-side. {t?.directional ? "Will see the forward label." : "Will see the same label as the other side."}</div>
              </div>
            </div>
          )}
          {!toPersona && (
            <PersonaPicker
              allPersonas={otherCandidates}
              excludeIds={[r.fromPersonaId].filter(Boolean)}
              onPick={(p) => set("toPersonaId", p.id)}
              placeholder="Search the other persona…"
            />
          )}
          {toPersona && (
            <div className="rel-to-summary">
              <Photo imageId={toPersona.photoId} className="rel-from-thumb" />
              <div style={{ flex: 1 }}>
                <div className="rel-from-name">{toPersona.name}</div>
                <div className="rel-from-sub">To-side. {t?.directional && t?.inverse_label ? `Will see "${t.inverse_label}".` : "Will see the same label."}</div>
              </div>
              <button type="button" className="btn ghost sm" onClick={() => set("toPersonaId", null)}>
                Change
              </button>
            </div>
          )}
        </section>

        {/* STEP 2 — category + type */}
        <section className="form-sec">
          <h4 className="sec-label">2 · Type the relationship</h4>
          <CategoryTabs value={r.category} onChange={switchCategory} />
          <p className="cat-desc">
            {window.REL_CATEGORIES.find((c) => c.key === r.category)?.description}
          </p>
          {r.category === "friendship" ? (
            <FriendshipLadder value={r.type} onChange={switchType} />
          ) : (
            <TypeChipGrid category={r.category} value={r.type} onChange={switchType} />
          )}
          {r.type === "custom" && (
            <label className="f" style={{ marginTop: 12 }}>
              <span className="f-label">Custom label</span>
              <input
                value={r.customLabel}
                onChange={(e) => set("customLabel", e.target.value)}
                placeholder="e.g. summer-camp friend, internet best friend"
              />
            </label>
          )}
        </section>

        {/* STEP 3 — quick facts + narrative */}
        <section className="form-sec">
          <h4 className="sec-label">3 · Quick facts</h4>
          <div className="grid">
            <label className="f">
              <span className="f-label">Cadence</span>
              <select value={r.cadence} onChange={(e) => set("cadence", e.target.value)}>
                <option value="">—</option>
                {window.REL_CADENCE_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="f">
              <span className="f-label">Since</span>
              <input
                value={r.since}
                onChange={(e) => set("since", e.target.value)}
                placeholder="2018, Birth, After their fight…"
              />
            </label>
            <label className="f">
              <span className="f-label">Status</span>
              <select value={r.status} onChange={(e) => set("status", e.target.value)}>
                <option value="">—</option>
                {window.REL_STATUS_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="f">
              <span className="f-label">Family</span>
              <select value={r.familyId || ""} onChange={(e) => set("familyId", e.target.value || null)}>
                <option value="">(none)</option>
                {(allFamilies || []).map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </label>
          </div>
          {inheritedFamily && (
            <p className="cat-desc" style={{ marginTop: 8 }}>
              Linked to <strong>{inheritedFamily.name}</strong>. Family lore appears alongside this relationship in the detail view.
            </p>
          )}
        </section>

        <section className="form-sec">
          <h4 className="sec-label">Narrative — fill what's useful</h4>
          <div className="grid">
            <label className="f wide-2">
              <span className="f-label">Origin</span>
              <textarea rows="3" value={r.origin} onChange={(e) => set("origin", e.target.value)} placeholder="Where this relationship started." />
            </label>
            <label className="f wide-2">
              <span className="f-label">The dynamic</span>
              <textarea rows="3" value={r.dynamic} onChange={(e) => set("dynamic", e.target.value)} placeholder="Who initiates, how they communicate, characteristic tone." />
            </label>
            <label className="f">
              <span className="f-label">Bonding moments</span>
              <textarea rows="3" value={r.bondingMoments} onChange={(e) => set("bondingMoments", e.target.value)} placeholder="Specific events." />
            </label>
            <label className="f">
              <span className="f-label">Tensions</span>
              <textarea rows="3" value={r.tensions} onChange={(e) => set("tensions", e.target.value)} placeholder="What they disagree on." />
            </label>
            <label className="f">
              <span className="f-label">Mutual influence</span>
              <textarea rows="3" value={r.mutualInfluence} onChange={(e) => set("mutualInfluence", e.target.value)} placeholder="How they've shaped each other." />
            </label>
            <label className="f">
              <span className="f-label">Inside jokes &amp; references</span>
              <textarea rows="3" value={r.insideJokes} onChange={(e) => set("insideJokes", e.target.value)} placeholder="Phrases, callbacks, shared language." />
            </label>
            <label className="f wide-2">
              <span className="f-label">Current arc</span>
              <textarea rows="2" value={r.currentArc} onChange={(e) => set("currentArc", e.target.value)} placeholder="What's happening between them right now." />
            </label>
            <label className="f wide-2">
              <span className="f-label">Content seeds</span>
              <textarea rows="2" value={r.contentSeeds} onChange={(e) => set("contentSeeds", e.target.value)} placeholder="Bullet list — posts/formats this dynamic is suited for." />
            </label>
          </div>
        </section>

        {/* PHOTOS TOGETHER */}
        <section className="form-sec">
          <div className="sec-head">
            <h4 className="sec-label">Photos together</h4>
            <div className="sec-head-actions">
              <button type="button" className="btn ghost sm" onClick={addBlankPhoto}>
                <Icon name="plus" size={15} /> Add entry
              </button>
              <button type="button" className="btn ghost sm" onClick={() => photoInput.current && photoInput.current.click()}>
                <Icon name="upload" size={15} /> Upload photos
              </button>
            </div>
            <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(e) => onPhotoFiles(e.target.files)} />
          </div>
          {photos.length === 0 && (
            <p className="sec-empty">No shared photos yet. Each one carries a caption and a "when" — they show up in the relationship view's gallery.</p>
          )}
          <div className="edit-gallery">
            {photos.map((ph, i) => (
              <PhotoTogetherRow
                key={ph.id}
                item={ph}
                onChange={(next) => setPhotos(photos.map((p, j) => (j === i ? next : p)))}
                onRemove={() => removePhoto(i)}
              />
            ))}
          </div>
        </section>
      </div>

      <div className="sheet-foot">
        {err && <span className="err-msg">{err}</span>}
        <div className="foot-actions">
          <button className="btn ghost" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving}>
            <Icon name="check" size={16} /> {saving ? "Saving…" : "Save relationship"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

Object.assign(window, { RelationshipForm, blankRelationship });
