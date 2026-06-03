/* ============================================================
   FamilyForm — create / edit a family + manage its members.
   ============================================================ */

function MemberRow({ member, allMembers, allPersonas, onChange, onRemove }) {
  const persona = allPersonas.find((p) => p.id === member.personaId);
  const parentOptions = allMembers
    .filter((m) => m.id !== member.id) // can't be your own parent
    .map((m) => {
      const p = allPersonas.find((x) => x.id === m.personaId);
      return { id: m.id, name: p ? p.name : "(unknown)" };
    });
  const set = (k, v) => onChange({ ...member, [k]: v });
  const toggleParent = (parentId) => {
    const has = (member.parentMemberIds || []).includes(parentId);
    const next = has
      ? member.parentMemberIds.filter((x) => x !== parentId)
      : [...(member.parentMemberIds || []), parentId];
    if (next.length > 2) return; // hard cap
    set("parentMemberIds", next);
  };

  return (
    <div className="member-row">
      <div className="mr-persona">
        <Photo imageId={persona?.photoId} className="mr-thumb" />
        <div className="mr-info">
          <div className="mr-name">{persona ? persona.name : "(deleted persona)"}</div>
          {persona && persona.age != null && persona.age !== "" && (
            <div className="mr-sub">{[persona.age, persona.gender].filter(Boolean).join(" · ")}</div>
          )}
        </div>
      </div>
      <div className="mr-fields">
        <label className="f">
          <span className="f-label">Role</span>
          <input value={member.role || ""} onChange={(e) => set("role", e.target.value)} placeholder="matriarch, mother, daughter, uncle…" />
        </label>
        <div className="mr-row2">
          <label className="f">
            <span className="f-label">Generation</span>
            <input type="number" min="0" value={member.generation || 0} onChange={(e) => set("generation", Number(e.target.value))} />
          </label>
          <label className="f">
            <span className="f-label">Position</span>
            <input type="number" min="0" value={member.position || 0} onChange={(e) => set("position", Number(e.target.value))} />
          </label>
        </div>
        {parentOptions.length > 0 && (
          <div className="mr-parents">
            <span className="f-label">Parents (max 2)</span>
            <div className="mr-parent-chips">
              {parentOptions.map((p) => {
                const on = (member.parentMemberIds || []).includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={"chip parent-chip" + (on ? " on" : "")}
                    onClick={() => toggleParent(p.id)}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <button type="button" className="row-remove" onClick={onRemove} title="Remove from family">
        <Icon name="trash" size={15} />
      </button>
    </div>
  );
}

function PersonaPicker({ allPersonas, excludeIds, onPick, placeholder = "Add a member…" }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const candidates = allPersonas
    .filter((p) => !excludeIds.includes(p.id))
    .filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 8);
  return (
    <div className="persona-picker">
      <div className="picker-input">
        <Icon name="search" size={15} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
        />
      </div>
      {open && candidates.length > 0 && (
        <div className="picker-dropdown">
          {candidates.map((p) => (
            <button
              key={p.id}
              type="button"
              className="picker-option"
              onMouseDown={() => { onPick(p); setQ(""); }}
            >
              <Photo imageId={p.photoId} className="picker-thumb" />
              <span className="picker-name">{p.name}</span>
              {p.age != null && p.age !== "" && <span className="picker-meta">{p.age}</span>}
            </button>
          ))}
        </div>
      )}
      {open && q.trim() && candidates.length === 0 && (
        <div className="picker-dropdown">
          <div className="picker-empty">No matches</div>
        </div>
      )}
    </div>
  );
}

function blankFamily() {
  return {
    id: window.uid(),
    name: "",
    lore: "",
    photoId: null,
    location: "",
    established: "",
    members: [],
  };
}

function FamilyForm({ initial, allPersonas, onSave, onCancel }) {
  const [f, setF] = useState(() => {
    if (!initial) return blankFamily();
    return JSON.parse(JSON.stringify({ ...initial, photo: undefined }));
  });
  const [photo, setPhoto] = useState(null); // pending blob only
  const [members, setMembers] = useState(() =>
    initial && initial.members
      ? initial.members.map((m) => ({
          id: m.id || window.uid(),
          personaId: m.personaId,
          role: m.role || "",
          generation: m.generation || 0,
          parentMemberIds: m.parentMemberIds || [],
          position: m.position || 0,
        }))
      : [],
  );
  const [err, setErr] = useState(false);
  const [dragPhoto, setDragPhoto] = useState(false);
  const photoUrl = useImageUrl({ blob: photo, imageId: f.photoId });

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const onPhotoFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setPhoto(file);
    set("photoId", null);
  };

  const addMember = (persona) => {
    setMembers((ms) => [
      ...ms,
      {
        id: window.uid(),
        personaId: persona.id,
        role: "",
        generation: ms.length > 0 ? ms[ms.length - 1].generation : 0,
        parentMemberIds: [],
        position: ms.length,
      },
    ]);
  };

  const save = async () => {
    if (!f.name.trim()) {
      setErr(true);
      return;
    }
    // Save family (with photo); server returns the persisted shape.
    const out = { ...f, name: f.name.trim(), photo };
    const saved = await window.DB.families.put(out);

    // Reconcile members: server-side currently has whatever was loaded as initial.
    // Strategy: for every member in our local state, POST (upsert by unique
    // (family_id, persona_id)); for every initial member NOT in our state, DELETE.
    const initialMembers = (initial && initial.members) || [];
    const localIds = new Set(members.map((m) => m.id));
    for (const m of initialMembers) {
      if (!localIds.has(m.id)) {
        await window.DB.families.removeMember(saved.id, m.id);
      }
    }
    for (const m of members) {
      await window.DB.families.addMember(saved.id, m);
    }

    const refreshed = await window.DB.families.get(saved.id);
    onSave(refreshed);
  };

  const memberPersonaIds = members.map((m) => m.personaId);

  return (
    <Overlay onClose={onCancel} wide>
      <div className="sheet-head">
        <div>
          <div className="eyebrow">{initial ? "Edit family" : "New family"}</div>
          <h2>{f.name.trim() || "Untitled family"}</h2>
        </div>
        <button className="iconbtn lg" onClick={onCancel} title="Close">
          <Icon name="x" size={20} />
        </button>
      </div>

      <div className="sheet-body form-body">
        {/* COVER PHOTO */}
        <section className="form-sec">
          <h4 className="sec-label">Cover photo</h4>
          <div className="photo-uploader">
            <div
              className={"drop fam-drop " + (dragPhoto ? "over" : "")}
              onDragOver={(e) => { e.preventDefault(); setDragPhoto(true); }}
              onDragLeave={() => setDragPhoto(false)}
              onDrop={(e) => { e.preventDefault(); setDragPhoto(false); onPhotoFile(e.dataTransfer.files[0]); }}
              style={photoUrl ? { backgroundImage: `url("${photoUrl}")` } : {}}
            >
              {!photoUrl && (
                <div className="drop-hint">
                  <Icon name="upload" size={22} />
                  <span>Drag image here or click to upload</span>
                </div>
              )}
              <input type="file" accept="image/*" onChange={(e) => onPhotoFile(e.target.files[0])} />
            </div>
            {photoUrl && (
              <button type="button" className="btn ghost sm" onClick={() => { setPhoto(null); set("photoId", null); }}>
                Remove photo
              </button>
            )}
          </div>
        </section>

        {/* IDENTITY */}
        <section className="form-sec">
          <h4 className="sec-label">Identity</h4>
          <div className="grid">
            <label className={"f wide-2 " + (err && !f.name.trim() ? "f-err" : "")}>
              <span className="f-label">Name *</span>
              <input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. The Riveras" />
            </label>
            <label className="f">
              <span className="f-label">Location</span>
              <input value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="City, Country" />
            </label>
            <label className="f">
              <span className="f-label">Established</span>
              <input value={f.established} onChange={(e) => set("established", e.target.value)} placeholder="1958, Spring 2018…" />
            </label>
          </div>
        </section>

        {/* LORE */}
        <section className="form-sec">
          <h4 className="sec-label">Family lore</h4>
          <label className="f">
            <textarea
              rows="5"
              value={f.lore}
              onChange={(e) => set("lore", e.target.value)}
              placeholder="The shared story — origins, traditions, recurring themes."
            />
          </label>
        </section>

        {/* MEMBERS */}
        <section className="form-sec">
          <div className="sec-head">
            <h4 className="sec-label">Members &amp; tree</h4>
          </div>
          <PersonaPicker
            allPersonas={allPersonas}
            excludeIds={memberPersonaIds}
            onPick={addMember}
            placeholder="+ Add a persona as a family member…"
          />
          {members.length === 0 && (
            <p className="sec-empty">No members yet — search above to add personas.</p>
          )}
          <div className="member-list">
            {members.map((m, i) => (
              <MemberRow
                key={m.id}
                member={m}
                allMembers={members}
                allPersonas={allPersonas}
                onChange={(next) => setMembers(members.map((x, j) => (j === i ? next : x)))}
                onRemove={() => setMembers(members.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        </section>
      </div>

      <div className="sheet-foot">
        {err && !f.name.trim() && <span className="err-msg">Name is required.</span>}
        <div className="foot-actions">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={save}>
            <Icon name="check" size={16} /> Save family
          </button>
        </div>
      </div>
    </Overlay>
  );
}

Object.assign(window, { FamilyForm, PersonaPicker, blankFamily });
