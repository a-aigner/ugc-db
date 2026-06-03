/* ============================================================
   LibraryUpload — bulk upload + per-asset tagging
   LibraryDetail — view/edit one asset
   ============================================================ */

function LibraryUploadRow({ pending, onChange, onRemove }) {
  const url = useBlobUrl(pending.blob);
  const set = (k, v) => onChange({ ...pending, [k]: v });
  return (
    <div className="edit-img-row library-upload-row">
      <div className="eir-thumb">
        <div className="et-img" style={{ backgroundImage: url ? `url("${url}")` : "" }} />
        <button type="button" className="et-remove" onClick={onRemove} title="Remove">
          <Icon name="x" size={13} stroke={2.4} />
        </button>
      </div>
      <div className="eir-fields">
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label className="f">
            <span className="f-label">Scene</span>
            <select value={pending.sceneType || ""} onChange={(e) => set("sceneType", e.target.value)}>
              <option value="">—</option>
              {SCENE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="f">
            <span className="f-label">Mood</span>
            <select value={pending.mood || ""} onChange={(e) => set("mood", e.target.value)}>
              <option value="">—</option>
              {MOODS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="f">
            <span className="f-label">Location</span>
            <select value={pending.locationHint || ""} onChange={(e) => set("locationHint", e.target.value)}>
              <option value="">—</option>
              {LOCATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="f">
            <span className="f-label">Time</span>
            <select value={pending.timeOfDay || ""} onChange={(e) => set("timeOfDay", e.target.value)}>
              <option value="">—</option>
              {TIMES_OF_DAY.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <label className="f">
          <span className="f-label">Tags</span>
          <TagInput value={pending.tags || []} onChange={(v) => set("tags", v)} placeholder="laptop_open, coffee_with_oat…" />
        </label>
        <label className="f">
          <span className="f-label">Notes</span>
          <input value={pending.notes || ""} onChange={(e) => set("notes", e.target.value)} placeholder="optional context" />
        </label>
      </div>
    </div>
  );
}

function LibraryUploadForm({ onSave, onCancel }) {
  const [pending, setPending] = useState([]);
  const [err, setErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const onFiles = (files) => {
    const imgs = [...files].filter((f) => f.type.startsWith("image/"));
    setPending((ps) => [
      ...ps,
      ...imgs.map((f) => ({
        id: window.uid(), blob: f,
        sceneType: "", mood: "", locationHint: "", timeOfDay: "",
        tags: [], notes: "",
      })),
    ]);
  };

  const save = async () => {
    if (pending.length === 0) { setErr("Pick at least one image."); return; }
    setErr("");
    setUploading(true);
    const saved = [];
    try {
      for (const p of pending) {
        const out = await window.DB.library.upload(p.blob, {
          scene_type: p.sceneType,
          mood: p.mood,
          location_hint: p.locationHint,
          time_of_day: p.timeOfDay,
          tags: p.tags,
          notes: p.notes,
        });
        saved.push(out);
      }
      onSave(saved);
    } catch (e) {
      setErr(e.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Overlay onClose={onCancel} wide>
      <div className="sheet-head">
        <div>
          <div className="eyebrow">Upload library assets</div>
          <h2>{pending.length} pending</h2>
        </div>
        <button className="iconbtn lg" onClick={onCancel} title="Close">
          <Icon name="x" size={20} />
        </button>
      </div>

      <div className="sheet-body form-body">
        <section className="form-sec">
          <div className="sec-head">
            <h4 className="sec-label">Pick images</h4>
            <div className="sec-head-actions">
              <button type="button" className="btn ghost sm" onClick={() => fileRef.current && fileRef.current.click()}>
                <Icon name="upload" size={15} /> Add images
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
          </div>
          {pending.length === 0 && (
            <p className="sec-empty">No images yet. Click "Add images" to pick a batch of files.</p>
          )}
          <div className="edit-gallery">
            {pending.map((p, i) => (
              <LibraryUploadRow
                key={p.id}
                pending={p}
                onChange={(next) => setPending(pending.map((x, j) => (j === i ? next : x)))}
                onRemove={() => setPending(pending.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        </section>
      </div>

      <div className="sheet-foot">
        {err && <span className="err-msg">{err}</span>}
        <div className="foot-actions">
          <button className="btn ghost" onClick={onCancel} disabled={uploading}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={uploading || pending.length === 0}>
            <Icon name="check" size={16} /> {uploading ? "Uploading…" : `Upload ${pending.length}`}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function LibraryDetail({ asset, onClose, onUpdate, onDelete }) {
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(asset)));
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(asset);

  const set = (k, v) => setDraft((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const updated = await window.DB.library.update(asset.id, {
        sceneType: draft.sceneType,
        mood: draft.mood,
        locationHint: draft.locationHint,
        timeOfDay: draft.timeOfDay,
        tags: draft.tags,
        notes: draft.notes,
      });
      onUpdate(updated);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="sheet-head">
        <div>
          <div className="eyebrow">Library asset</div>
          <h2>{draft.sceneType || "Untyped"}</h2>
        </div>
        <div className="dh-actions">
          <button className="btn ghost sm danger-text" onClick={onDelete}>
            <Icon name="trash" size={15} /> Delete
          </button>
          <button className="iconbtn lg" onClick={onClose} title="Close">
            <Icon name="x" size={20} />
          </button>
        </div>
      </div>

      <div className="sheet-body">
        <div
          className="library-detail-img"
          style={{ backgroundImage: `url("${asset.imageUrl}")` }}
        />

        <div className="grid" style={{ marginTop: 16 }}>
          <label className="f">
            <span className="f-label">Scene</span>
            <select value={draft.sceneType || ""} onChange={(e) => set("sceneType", e.target.value)}>
              <option value="">—</option>
              {SCENE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="f">
            <span className="f-label">Mood</span>
            <select value={draft.mood || ""} onChange={(e) => set("mood", e.target.value)}>
              <option value="">—</option>
              {MOODS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="f">
            <span className="f-label">Location</span>
            <select value={draft.locationHint || ""} onChange={(e) => set("locationHint", e.target.value)}>
              <option value="">—</option>
              {LOCATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="f">
            <span className="f-label">Time</span>
            <select value={draft.timeOfDay || ""} onChange={(e) => set("timeOfDay", e.target.value)}>
              <option value="">—</option>
              {TIMES_OF_DAY.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="f wide-2">
            <span className="f-label">Tags</span>
            <TagInput value={draft.tags || []} onChange={(v) => set("tags", v)} />
          </label>
          <label className="f wide-2">
            <span className="f-label">Notes</span>
            <input value={draft.notes || ""} onChange={(e) => set("notes", e.target.value)} />
          </label>
        </div>

        <div className="muted" style={{ fontFamily: "var(--mono)", fontSize: 11, marginTop: 16 }}>
          Used {asset.timesUsed} time(s){asset.lastUsedAt ? ` · last ${new Date(asset.lastUsedAt).toLocaleDateString()}` : ""}
          {" · uploaded "}{new Date(asset.uploadedAt).toLocaleDateString()}
        </div>
      </div>

      <div className="sheet-foot">
        <div className="foot-actions">
          <button className="btn ghost" onClick={onClose}>Close</button>
          <button className="btn primary" onClick={save} disabled={!dirty || saving}>
            <Icon name="check" size={16} /> {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

Object.assign(window, { LibraryUploadForm, LibraryDetail });
