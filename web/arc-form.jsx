/* ============================================================
   ArcForm — create / edit a storyline arc
   ============================================================ */

function blankArc() {
  const today = new Date().toISOString().slice(0, 10);
  const inAWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    id: window.uid(),
    title: "",
    theme: "",
    startsOn: today,
    endsOn: inAWeek,
    status: "planning",
    location: "",
    mood: "",
    continuityNotes: "",
    notes: "",
    personas: [],
  };
}

function ArcPersonaRow({ member, onRoleChange, onRemove, onOpen }) {
  return (
    <div className="arc-persona-row">
      <button
        type="button"
        className="arc-persona-info"
        onClick={onOpen}
        title={`Open ${member.name}`}
      >
        <Photo imageId={member.photoId} className="mr-thumb" />
        <div className="mr-info">
          <div className="mr-name">{member.name}</div>
          {member.occupation && <div className="mr-sub">{member.occupation}</div>}
        </div>
      </button>
      <label className="f arc-role-select">
        <span className="f-label">Role</span>
        <select value={member.role || "lead"} onChange={(e) => onRoleChange(e.target.value)}>
          <option value="lead">Lead</option>
          <option value="co-star">Co-star</option>
          <option value="cameo">Cameo</option>
        </select>
      </label>
      <button type="button" className="row-remove" onClick={onRemove} title="Remove">
        <Icon name="trash" size={15} />
      </button>
    </div>
  );
}

function ArcForm({ initial, allPersonas, onSave, onCancel, onOpenPersona }) {
  const [a, setA] = useState(() =>
    initial ? JSON.parse(JSON.stringify(initial)) : blankArc()
  );
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setA((s) => ({ ...s, [k]: v }));

  const addPersona = (p) => {
    if (a.personas.some((x) => x.id === p.id)) return;
    setA((s) => ({
      ...s,
      personas: [
        ...s.personas,
        {
          id: p.id,
          name: p.name,
          photoId: p.photoId,
          occupation: p.occupation || "",
          role: s.personas.length === 0 ? "lead" : "co-star",
        },
      ],
    }));
  };

  const save = async () => {
    if (!a.title.trim()) { setErr("Title required."); return; }
    if (!a.startsOn || !a.endsOn) { setErr("Start and end dates required."); return; }
    if (a.endsOn < a.startsOn) { setErr("End date must be on or after start date."); return; }
    if (a.personas.length === 0) { setErr("Pick at least one persona for this arc."); return; }
    setErr("");
    setSaving(true);
    try {
      const payload = {
        ...a,
        title: a.title.trim(),
        personas: a.personas.map((m) => ({ id: m.id, role: m.role || "lead" })),
      };
      const saved = initial
        ? await window.DB.arcs.update(a.id, payload)
        : await window.DB.arcs.create(payload);
      onSave(saved);
    } catch (e) {
      setErr(e.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const memberPersonaIds = a.personas.map((m) => m.id);

  return (
    <Overlay onClose={onCancel} wide>
      <div className="sheet-head">
        <div>
          <div className="eyebrow">{initial ? "Edit arc" : "New arc"}</div>
          <h2>{a.title.trim() || "Untitled arc"}</h2>
        </div>
        <button className="iconbtn lg" onClick={onCancel} title="Close">
          <Icon name="x" size={20} />
        </button>
      </div>

      <div className="sheet-body form-body">
        <section className="form-sec">
          <h4 className="sec-label">Identity</h4>
          <div className="grid">
            <label className="f wide-2">
              <span className="f-label">Title *</span>
              <input value={a.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Maya — Bali Trip with Sofia" />
            </label>
            <label className="f wide-2">
              <span className="f-label">Theme</span>
              <input value={a.theme} onChange={(e) => set("theme", e.target.value)} placeholder="sister bonding vacation" />
            </label>
            <label className="f">
              <span className="f-label">Starts on *</span>
              <input type="date" value={a.startsOn} onChange={(e) => set("startsOn", e.target.value)} />
            </label>
            <label className="f">
              <span className="f-label">Ends on *</span>
              <input type="date" value={a.endsOn} onChange={(e) => set("endsOn", e.target.value)} />
            </label>
            <label className="f">
              <span className="f-label">Status</span>
              <select value={a.status} onChange={(e) => set("status", e.target.value)}>
                <option value="planning">Planning</option>
                <option value="active">Active</option>
                <option value="past">Past</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label className="f">
              <span className="f-label">Location</span>
              <input value={a.location} onChange={(e) => set("location", e.target.value)} placeholder="Bali, LA, Berlin…" />
            </label>
            <label className="f wide-2">
              <span className="f-label">Mood</span>
              <input value={a.mood} onChange={(e) => set("mood", e.target.value)} placeholder="warm, candid, golden hour, salt-in-hair" />
            </label>
          </div>
        </section>

        <section className="form-sec">
          <h4 className="sec-label">Personas in this arc</h4>
          <PersonaPicker
            allPersonas={allPersonas}
            excludeIds={memberPersonaIds}
            onPick={addPersona}
            placeholder="+ Add a persona to this arc…"
          />
          {a.personas.length === 0 && (
            <p className="sec-empty">No personas yet — add at least one (the arc's lead).</p>
          )}
          <div className="member-list arc-persona-list">
            {a.personas.map((m, i) => (
              <ArcPersonaRow
                key={m.id}
                member={m}
                onOpen={() => onOpenPersona && onOpenPersona(m.id)}
                onRoleChange={(role) => setA((s) => ({
                  ...s,
                  personas: s.personas.map((x, j) => (j === i ? { ...x, role } : x)),
                }))}
                onRemove={() => setA((s) => ({
                  ...s,
                  personas: s.personas.filter((_, j) => j !== i),
                }))}
              />
            ))}
          </div>
        </section>

        <section className="form-sec">
          <h4 className="sec-label">Continuity &amp; notes</h4>
          <div className="grid">
            <label className="f wide-2">
              <span className="f-label">Continuity notes</span>
              <textarea
                rows="3"
                value={a.continuityNotes}
                onChange={(e) => set("continuityNotes", e.target.value)}
                placeholder="Outfit, location, look continuity rules. e.g. 'Maya in earth tones throughout; Sofia in cooler colors'"
              />
            </label>
            <label className="f wide-2">
              <span className="f-label">Notes</span>
              <textarea
                rows="3"
                value={a.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Free-form notes about this arc."
              />
            </label>
          </div>
        </section>
      </div>

      <div className="sheet-foot">
        {err && <span className="err-msg">{err}</span>}
        <div className="foot-actions">
          <button className="btn ghost" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving}>
            <Icon name="check" size={16} /> {saving ? "Saving…" : "Save arc"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

Object.assign(window, { ArcForm, blankArc });
