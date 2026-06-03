/* ============================================================
   PersonaForm — add / edit a persona
   ============================================================ */
const PLATFORMS = [
  "Instagram",
  "TikTok",
  "YouTube",
  "X",
  "Snapchat",
  "Threads",
  "Facebook",
  "Pinterest",
  "Reddit",
  "Fanvue",
  "OnlyFans",
  "Patreon",
  "Twitch",
  "Other",
];

function blankPersona() {
  return {
    id: window.uid(),
    name: "",
    age: "",
    gender: "",
    status: "active",
    ethnicity: "",
    location: "",
    languages: [],
    biography: "",
    backstory: "",
    personality: "",
    values: [],
    niches: [],
    topics: [],
    style: "",
    boundaries: "",
    // Planning context (migration 005)
    occupation: "",
    affiliation: "",
    calendarContext: "",
    soulId: null,
    personaGenerationNotes: "",
    socials: [],
    managementUrl: "",
    managementNotes: "",
    photo: null,
    photoId: null,
    gallery: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/* ---- a single social-account row ---- */
function SocialRow({ row, onChange, onRemove }) {
  const [reveal, setReveal] = useState(false);
  const set = (k, v) => onChange({ ...row, [k]: v });
  return (
    <div className="social-row">
      <div className="social-grid">
        <label className="f">
          <span className="f-label">Platform</span>
          <select value={row.platform} onChange={(e) => set("platform", e.target.value)}>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="f">
          <span className="f-label">Handle</span>
          <input value={row.handle} onChange={(e) => set("handle", e.target.value)} placeholder="@username" />
        </label>
        <label className="f wide-2">
          <span className="f-label">Profile URL</span>
          <input value={row.url} onChange={(e) => set("url", e.target.value)} placeholder="https://" />
        </label>
        <label className="f">
          <span className="f-label">Login email / user</span>
          <input value={row.email} onChange={(e) => set("email", e.target.value)} placeholder="account@…" />
        </label>
        <label className="f">
          <span className="f-label">Password</span>
          <div className="pw">
            <input
              type={reveal ? "text" : "password"}
              value={row.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
            <button type="button" className="iconbtn" onClick={() => setReveal((v) => !v)} title={reveal ? "Hide" : "Show"}>
              <Icon name={reveal ? "eyeOff" : "eye"} size={15} />
            </button>
          </div>
        </label>
        <label className="f wide-2">
          <span className="f-label">Notes</span>
          <input value={row.notes} onChange={(e) => set("notes", e.target.value)} placeholder="2FA, recovery, role…" />
        </label>
      </div>
      <button type="button" className="row-remove" onClick={onRemove} title="Remove account">
        <Icon name="trash" size={15} />
      </button>
    </div>
  );
}

/* ---- gallery image row in the editor ---- */
function EditThumb({ item, onChange, onRemove }) {
  const url = useImageUrl({ blob: item.blob, imageId: item.imageId });
  const fileRef = useRef(null);
  const set = (k, v) => onChange({ ...item, [k]: v });
  const pick = (file) => {
    // New file supersedes any prior image (blob OR persisted imageId)
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
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files[0]);
          }}
          title={url ? "Click to replace image" : "Click to add image"}
        >
          {!url && (
            <span className="et-add">
              <Icon name="upload" size={16} />
              add image
            </span>
          )}
          {url && <span className="et-replace">Replace</span>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files[0])} />
        <button type="button" className="et-remove" onClick={onRemove} title="Remove image">
          <Icon name="x" size={13} stroke={2.4} />
        </button>
      </div>
      <div className="eir-fields">
        <label className="f">
          <span className="f-label">Prompt</span>
          <textarea
            rows="3"
            value={item.prompt || ""}
            onChange={(e) => set("prompt", e.target.value)}
            placeholder="The prompt used to generate this image…"
          />
        </label>
        <div className="eir-row2">
          <label className="f">
            <span className="f-label">Service / Model</span>
            <input
              value={item.model || ""}
              onChange={(e) => set("model", e.target.value)}
              placeholder="e.g. Midjourney v6, Flux.1…"
            />
          </label>
          <label className="f">
            <span className="f-label">Post time</span>
            <input
              type="datetime-local"
              value={item.postTime || ""}
              onChange={(e) => set("postTime", e.target.value)}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function PersonaForm({ initial, onSave, onCancel }) {
  // Scrub blobs out of the JSON-cloned shape; keep them in their own state slots.
  const [p, setP] = useState(() =>
    initial
      ? JSON.parse(JSON.stringify({ ...initial, photo: undefined, gallery: undefined }))
      : blankPersona(),
  );
  // `photo` holds a pending Blob for a freshly picked file (only).
  const [photo, setPhoto] = useState(null);
  // Existing gallery items arrive with `imageId` (no blob); newly added rows
  // get `blob` once the user picks a file.
  const [gallery, setGallery] = useState(() =>
    initial && initial.gallery
      ? initial.gallery.map((g) => ({
          id: g.id || window.uid(),
          blob: null,
          imageId: g.imageId || null,
          prompt: g.prompt || "",
          model: g.model || "",
          postTime: g.postTime || "",
        }))
      : [],
  );
  const [err, setErr] = useState(false);
  const [dragPhoto, setDragPhoto] = useState(false);
  const photoUrl = useImageUrl({ blob: photo, imageId: p.photoId });
  const galleryInput = useRef(null);

  const set = (k, v) => setP((s) => ({ ...s, [k]: v }));

  const onPhotoFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setPhoto(file);
    set("photoId", null); // Pending blob supersedes any existing photo
  };
  const clearPhoto = () => {
    setPhoto(null);
    set("photoId", null);
  };
  const onGalleryFiles = (files) => {
    const imgs = [...files].filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setGallery((g) => [
      ...g,
      ...imgs.map((f) => ({
        id: window.uid(),
        blob: f,
        imageId: null,
        prompt: "",
        model: "",
        postTime: "",
      })),
    ]);
  };
  const addBlankImage = () =>
    setGallery((g) => [
      ...g,
      { id: window.uid(), blob: null, imageId: null, prompt: "", model: "", postTime: "" },
    ]);

  const addSocial = () =>
    set("socials", [
      ...p.socials,
      { id: window.uid(), platform: "Instagram", handle: "", url: "", email: "", password: "", notes: "" },
    ]);

  const save = () => {
    if (!p.name.trim()) {
      setErr(true);
      return;
    }
    const out = {
      ...p,
      name: p.name.trim(),
      age: p.age === "" ? "" : Number(p.age),
      photo, // Blob, will be uploaded by DB layer (or null)
      gallery,
      updatedAt: Date.now(),
    };
    delete out.sample;
    onSave(out);
  };

  return (
    <Overlay onClose={onCancel} wide>
      <div className="sheet-head">
        <div>
          <div className="eyebrow">{initial ? "Edit persona" : "New persona"}</div>
          <h2>{p.name.trim() || "Untitled persona"}</h2>
        </div>
        <button className="iconbtn lg" onClick={onCancel} title="Close">
          <Icon name="x" size={20} />
        </button>
      </div>

      <div className="sheet-body form-body">
        {/* PHOTO */}
        <section className="form-sec">
          <h4 className="sec-label">Reference photo</h4>
          <div className="photo-uploader">
            <div
              className={"drop " + (dragPhoto ? "over" : "")}
              onDragOver={(e) => {
                e.preventDefault();
                setDragPhoto(true);
              }}
              onDragLeave={() => setDragPhoto(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragPhoto(false);
                onPhotoFile(e.dataTransfer.files[0]);
              }}
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
              <button type="button" className="btn ghost sm" onClick={clearPhoto}>
                Remove photo
              </button>
            )}
          </div>
        </section>

        {/* IDENTITY */}
        <section className="form-sec">
          <h4 className="sec-label">Identity</h4>
          <div className="grid">
            <label className={"f wide-2 " + (err && !p.name.trim() ? "f-err" : "")}>
              <span className="f-label">Name *</span>
              <input value={p.name} onChange={(e) => set("name", e.target.value)} placeholder="Persona name" />
            </label>
            <label className="f">
              <span className="f-label">Age</span>
              <input type="number" min="0" value={p.age} onChange={(e) => set("age", e.target.value)} placeholder="—" />
            </label>
            <label className="f">
              <span className="f-label">Gender</span>
              <input value={p.gender} onChange={(e) => set("gender", e.target.value)} placeholder="e.g. Female" list="gender-opts" />
              <datalist id="gender-opts">
                <option value="Female" />
                <option value="Male" />
                <option value="Non-binary" />
              </datalist>
            </label>
            <label className="f">
              <span className="f-label">Status</span>
              <select value={p.status} onChange={(e) => set("status", e.target.value)}>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="retired">Retired</option>
              </select>
            </label>
            <label className="f">
              <span className="f-label">Demography / ethnicity</span>
              <input value={p.ethnicity} onChange={(e) => set("ethnicity", e.target.value)} placeholder="e.g. Latina" />
            </label>
            <label className="f">
              <span className="f-label">Location</span>
              <input value={p.location} onChange={(e) => set("location", e.target.value)} placeholder="City, Country" />
            </label>
            <label className="f wide-2">
              <span className="f-label">Languages</span>
              <TagInput value={p.languages} onChange={(v) => set("languages", v)} placeholder="Add a language…" />
            </label>
            <label className="f">
              <span className="f-label">Occupation</span>
              <input value={p.occupation || ""} onChange={(e) => set("occupation", e.target.value)} placeholder="content creator, student, designer…" />
            </label>
            <label className="f">
              <span className="f-label">Affiliation</span>
              <input value={p.affiliation || ""} onChange={(e) => set("affiliation", e.target.value)} placeholder="TU Wien, independent, Anthropic…" />
            </label>
          </div>
        </section>

        {/* PHYSICAL ATTRIBUTES — consistency anchors for image generation */}
        <section className="form-sec">
          <h4 className="sec-label">Physical attributes</h4>
          <p className="cat-desc" style={{ margin: "-4px 0 12px" }}>
            Optional. Most useful in multi-person prompts and for cross-generation consistency.
          </p>
          <div className="grid">
            <label className="f">
              <span className="f-label">Height (cm)</span>
              <input
                type="number" min="0" max="280"
                value={p.heightCm ?? ""}
                onChange={(e) => set("heightCm", e.target.value === "" ? null : Number(e.target.value))}
                placeholder="—"
              />
            </label>
            <label className="f">
              <span className="f-label">Build</span>
              <input value={p.build || ""} onChange={(e) => set("build", e.target.value)} placeholder="athletic, lean, curvy…" />
            </label>
            <label className="f wide-2">
              <span className="f-label">Hair</span>
              <input value={p.hair || ""} onChange={(e) => set("hair", e.target.value)} placeholder="length, color, texture, typical style" />
            </label>
            <label className="f">
              <span className="f-label">Eye color</span>
              <input value={p.eyeColor || ""} onChange={(e) => set("eyeColor", e.target.value)} placeholder="warm hazel" />
            </label>
            <label className="f">
              <span className="f-label">Skin</span>
              <input value={p.skin || ""} onChange={(e) => set("skin", e.target.value)} placeholder="tone + undertones" />
            </label>
            <label className="f wide-2">
              <span className="f-label">Distinguishing marks</span>
              <input value={p.distinguishingMarks || ""} onChange={(e) => set("distinguishingMarks", e.target.value)} placeholder="tattoos, piercings, scars, freckles…" />
            </label>
          </div>
        </section>

        {/* STORY */}
        <section className="form-sec">
          <h4 className="sec-label">Story</h4>
          <div className="grid">
            <label className="f wide-2">
              <span className="f-label">Biography</span>
              <textarea rows="3" value={p.biography} onChange={(e) => set("biography", e.target.value)} placeholder="Short summary of who this persona is." />
            </label>
            <label className="f wide-2">
              <span className="f-label">Backstory</span>
              <textarea rows="4" value={p.backstory} onChange={(e) => set("backstory", e.target.value)} placeholder="Origin, history, how they got here." />
            </label>
          </div>
        </section>

        {/* PERSONALITY */}
        <section className="form-sec">
          <h4 className="sec-label">Personality &amp; voice</h4>
          <div className="grid">
            <label className="f wide-2">
              <span className="f-label">Personality &amp; voice</span>
              <textarea rows="3" value={p.personality} onChange={(e) => set("personality", e.target.value)} placeholder="Tone, speech patterns, humor, vocabulary." />
            </label>
            <label className="f wide-2">
              <span className="f-label">Values</span>
              <TagInput value={p.values} onChange={(v) => set("values", v)} placeholder="Add a value…" />
            </label>
          </div>
        </section>

        {/* CONTENT */}
        <section className="form-sec">
          <h4 className="sec-label">Content &amp; niche</h4>
          <div className="grid">
            <label className="f wide-2">
              <span className="f-label">Niches</span>
              <TagInput value={p.niches} onChange={(v) => set("niches", v)} placeholder="Add a niche…" />
            </label>
            <label className="f wide-2">
              <span className="f-label">Topics</span>
              <TagInput value={p.topics} onChange={(v) => set("topics", v)} placeholder="Add a topic…" />
            </label>
            <label className="f wide-2">
              <span className="f-label">Style</span>
              <textarea rows="2" value={p.style} onChange={(e) => set("style", e.target.value)} placeholder="Visual & editing style, mood, aesthetic." />
            </label>
            <label className="f wide-2">
              <span className="f-label">Boundaries</span>
              <textarea rows="2" value={p.boundaries} onChange={(e) => set("boundaries", e.target.value)} placeholder="What this persona will not do or promote." />
            </label>
          </div>
        </section>

        {/* PLANNING CONTEXT — drives the Instagram content planner */}
        <section className="form-sec">
          <h4 className="sec-label">Planning context</h4>
          <p className="cat-desc" style={{ margin: "-4px 0 12px" }}>
            Free-text fields the content-planning skill reads to plan realistic, persona-fitting arcs and posts.
          </p>
          <div className="grid">
            <label className="f wide-2">
              <span className="f-label">Calendar context</span>
              <textarea
                rows="8"
                value={p.calendarContext || ""}
                onChange={(e) => set("calendarContext", e.target.value)}
                placeholder={
                  "Multi-line. Include daily/weekly rhythm, posting cadence, vacation windows, " +
                  "academic or work calendar if relevant, cultural anchors.\n\n" +
                  "Example: \"Lives in Vienna, CET. Studies CS at TU Wien. " +
                  "WS = Oct–Jan + exam period Jan 15–Feb 14. SS = Mar–Jun + exam period Jul. " +
                  "Vacation windows: Feb break, Aug–early Sept, Christmas. " +
                  "Avoid long trips during exam periods. Posts 1–2 feed/month, daily stories 3–8.\""
                }
              />
            </label>
            <label className="f wide-2">
              <span className="f-label">Generation notes</span>
              <textarea
                rows="4"
                value={p.personaGenerationNotes || ""}
                onChange={(e) => set("personaGenerationNotes", e.target.value)}
                placeholder={
                  "Hair quirks, palette, recurring details to feed the image generator. " +
                  "Accumulates from review feedback over time."
                }
              />
            </label>
            <label className="f wide-2">
              <span className="f-label">Higgsfield Soul ID</span>
              <div className="pw" style={{ background: "var(--surface-2)" }}>
                <input
                  value={p.soulId || ""}
                  onChange={(e) => set("soulId", e.target.value || null)}
                  placeholder="Auto-filled when you train a Soul ID from this persona's reference photos."
                  readOnly={!p.soulId}
                  style={{ background: "transparent" }}
                />
                {p.soulId && (
                  <button type="button" className="iconbtn" onClick={() => set("soulId", null)} title="Clear Soul ID">
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            </label>
          </div>
        </section>

        {/* SOCIALS */}
        <section className="form-sec">
          <div className="sec-head">
            <h4 className="sec-label">Social accounts &amp; credentials</h4>
            <button type="button" className="btn ghost sm" onClick={addSocial}>
              <Icon name="plus" size={15} /> Add account
            </button>
          </div>
          {p.socials.length === 0 && <p className="sec-empty">No accounts yet.</p>}
          <div className="socials">
            {p.socials.map((row, i) => (
              <SocialRow
                key={row.id}
                row={row}
                onChange={(r) => set("socials", p.socials.map((x, j) => (j === i ? r : x)))}
                onRemove={() => set("socials", p.socials.filter((_, j) => j !== i))}
              />
            ))}
          </div>
          <div className="grid mgmt-grid">
            <label className="f wide-2">
              <span className="f-label">Social media management account</span>
              <input value={p.managementUrl} onChange={(e) => set("managementUrl", e.target.value)} placeholder="Link to scheduler / dashboard (e.g. Metricool, Later)" />
            </label>
            <label className="f wide-2">
              <span className="f-label">Management notes</span>
              <input value={p.managementNotes} onChange={(e) => set("managementNotes", e.target.value)} placeholder="Which tool, login, who manages it…" />
            </label>
          </div>
        </section>

        {/* IMAGE LIBRARY */}
        <section className="form-sec">
          <div className="sec-head">
            <h4 className="sec-label">Image library / posts</h4>
            <div className="sec-head-actions">
              <button type="button" className="btn ghost sm" onClick={addBlankImage}>
                <Icon name="plus" size={15} /> Add entry
              </button>
              <button type="button" className="btn ghost sm" onClick={() => galleryInput.current && galleryInput.current.click()}>
                <Icon name="upload" size={15} /> Upload images
              </button>
            </div>
            <input ref={galleryInput} type="file" accept="image/*" multiple hidden onChange={(e) => onGalleryFiles(e.target.files)} />
          </div>
          {gallery.length === 0 && <p className="sec-empty">No images yet — upload posts or add an entry to build the library.</p>}
          <div className="edit-gallery">
            {gallery.map((item, i) => (
              <EditThumb
                key={item.id}
                item={item}
                onChange={(next) => setGallery(gallery.map((g, j) => (j === i ? next : g)))}
                onRemove={() => setGallery(gallery.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        </section>
      </div>

      <div className="sheet-foot">
        {err && !p.name.trim() && <span className="err-msg">Name is required.</span>}
        <div className="foot-actions">
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            <Icon name="check" size={16} /> Save persona
          </button>
        </div>
      </div>
    </Overlay>
  );
}

Object.assign(window, { PersonaForm, blankPersona, PLATFORMS });
