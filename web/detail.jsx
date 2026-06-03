/* ============================================================
   PersonaDetail — full profile view
   ============================================================ */

/* a text block section, only renders if it has content */
function Block({ label, text }) {
  if (!text || !String(text).trim()) return null;
  return (
    <div className="block">
      <h4 className="block-label">{label}</h4>
      <p className="block-text">{text}</p>
    </div>
  );
}

function ChipBlock({ label, items }) {
  if (!items || !items.length) return null;
  return (
    <div className="block">
      <h4 className="block-label">{label}</h4>
      <Chips items={items} />
    </div>
  );
}

/* one social account with credentials */
function SocialCard({ s }) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="social-card">
      <div className="sc-top">
        <span className="sc-platform">{s.platform}</span>
        {s.handle && <span className="sc-handle">{s.handle}</span>}
        {s.url && (
          <a className="iconbtn" href={s.url} target="_blank" rel="noreferrer" title="Open profile">
            <Icon name="external" size={14} />
          </a>
        )}
      </div>
      {(s.email || s.password || s.notes) && (
        <div className="cred">
          {s.email && (
            <div className="cred-row">
              <span className="cred-key">login</span>
              <span className="cred-val">{s.email}</span>
              <CopyBtn text={s.email} label="login" />
            </div>
          )}
          {s.password && (
            <div className="cred-row">
              <span className="cred-key">password</span>
              <span className="cred-val mono">{reveal ? s.password : "•".repeat(Math.min(s.password.length, 12))}</span>
              <button type="button" className="iconbtn" onClick={() => setReveal((v) => !v)} title={reveal ? "Hide" : "Show"}>
                <Icon name={reveal ? "eyeOff" : "eye"} size={14} />
              </button>
              <CopyBtn text={s.password} label="password" />
            </div>
          )}
          {s.notes && (
            <div className="cred-row">
              <span className="cred-key">notes</span>
              <span className="cred-val">{s.notes}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* gallery viewer thumbnail */
function ViewThumb({ item, onOpen }) {
  const url = useImageUrl({ blob: item.blob, imageId: item.imageId });
  const text = item.prompt || item.caption;
  return (
    <button className="view-thumb" onClick={onOpen} title={text || ""}>
      <div className={"vt-img" + (url ? "" : " is-empty")} style={url ? { backgroundImage: `url("${url}")` } : {}}>
        {!url && <span className="vt-ph">no image</span>}
      </div>
      {(item.model || text || item.postTime) && (
        <div className="vt-meta">
          {item.model && <span className="vt-model">{item.model}</span>}
          {text && <span className="vt-prompt">{text}</span>}
          {item.postTime && <span className="vt-time">{formatPostTime(item.postTime)}</span>}
        </div>
      )}
    </button>
  );
}

/* full image-entry view (replaces the profile content in-place) */
function ImageEntryView({ persona, index, onIndex, onBack, onClose }) {
  const gallery = persona.gallery || [];
  const item = gallery[index] || {};
  const url = useImageUrl({ blob: item.blob, imageId: item.imageId });
  const prompt = item.prompt || item.caption;
  const many = gallery.length > 1;
  const go = (dir) => onIndex((index + dir + gallery.length) % gallery.length);

  useEffect(() => {
    const h = (e) => {
      if (e.key === "ArrowLeft" && many) go(-1);
      else if (e.key === "ArrowRight" && many) go(1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [index, gallery.length]);

  return (
    <>
      <div className="sheet-head entry-head">
        <button className="btn ghost sm" onClick={onBack}>
          <Icon name="arrowLeft" size={15} /> Back to {persona.name}
        </button>
        <div className="entry-mid">
          <span className="eyebrow">Image entry</span>
          {many && (
            <span className="entry-count">
              {index + 1} / {gallery.length}
            </span>
          )}
        </div>
        <button className="iconbtn lg" onClick={onClose} title="Close">
          <Icon name="x" size={20} />
        </button>
      </div>

      <div className="sheet-body entry-body">
        <div className="entry-stage">
          {many && (
            <button className="entry-nav prev" onClick={() => go(-1)} title="Previous">
              <Icon name="chevronLeft" size={22} />
            </button>
          )}
          <div className={"entry-img" + (url ? "" : " is-empty")} style={url ? { backgroundImage: `url("${url}")` } : {}}>
            {!url && <span className="vt-ph">no image</span>}
          </div>
          {many && (
            <button className="entry-nav next" onClick={() => go(1)} title="Next">
              <Icon name="chevronRight" size={22} />
            </button>
          )}
        </div>

        <div className="entry-info">
          <div className="lb-meta-row">
            {item.model && (
              <div className="lb-field">
                <span className="lb-key">Service / Model</span>
                <p className="lb-val">{item.model}</p>
              </div>
            )}
            {item.postTime && (
              <div className="lb-field">
                <span className="lb-key">Post time</span>
                <p className="lb-val">{formatPostTime(item.postTime)}</p>
              </div>
            )}
          </div>
          {prompt ? (
            <div className="lb-field">
              <span className="lb-key">
                Prompt <CopyBtn text={prompt} label="prompt" />
              </span>
              <p className="lb-val mono-prompt">{prompt}</p>
            </div>
          ) : (
            <p className="sec-empty">No prompt recorded for this image.</p>
          )}
        </div>
      </div>
    </>
  );
}

function Fact({ label, children }) {
  return (
    <div className="fact">
      <span className="fact-key">{label}</span>
      <span className="fact-val">{children}</span>
    </div>
  );
}

/* Soul ID block — shows trained ID, in-flight training progress, or the
   Train Soul ID button when the persona has ≥10 reference photos. */
function SoulBlock({ persona }) {
  const p = persona;
  const photoCount = (p.gallery || []).length + (p.photoId ? 1 : 0);
  const enough = photoCount >= 10;
  const [inFlight, setInFlight] = useState(null); // latest queued/running training
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  // Hydrate any in-flight training when the block mounts / persona changes
  useEffect(() => {
    let stale = false;
    (async () => {
      try {
        const list = await window.DB.soul.listForPersona(p.id);
        if (stale) return;
        const open = list.find((t) => t.status === "queued" || t.status === "running");
        if (open) setInFlight(open);
      } catch { /* ignore */ }
    })();
    return () => { stale = true; };
  }, [p.id]);

  // Poll the open training every 4s until it finishes
  useEffect(() => {
    if (!inFlight || (inFlight.status !== "queued" && inFlight.status !== "running")) return;
    const t = setInterval(async () => {
      try {
        const fresh = await window.DB.soul.get(inFlight.id);
        setInFlight(fresh);
        if (fresh.status === "completed" || fresh.status === "failed") {
          clearInterval(t);
        }
      } catch { /* keep polling */ }
    }, 4000);
    return () => clearInterval(t);
  }, [inFlight?.id, inFlight?.status]);

  const start = async () => {
    setStarting(true);
    setError("");
    try {
      const job = await window.DB.soul.start(p.id);
      setInFlight(job);
      setConfirming(false);
    } catch (e) {
      setError(e.message || "Failed to start training.");
    } finally {
      setStarting(false);
    }
  };

  // Nothing to show if we have no Soul, no in-flight job, and not enough photos
  if (!p.soulId && !inFlight && !enough) return null;

  return (
    <div className="left-sec">
      <h4 className="block-label">Soul ID (Higgsfield)</h4>

      {p.soulId && !inFlight && (
        <div className="soul-status soul-trained">
          <Icon name="check" size={14} />
          <span>Trained · <code>{p.soulId}</code></span>
        </div>
      )}

      {inFlight && inFlight.status !== "completed" && inFlight.status !== "failed" && (
        <div className="soul-status soul-running">
          <Icon name="upload" size={14} />
          <span>
            Training <code>{inFlight.name}</code> · status <strong>{inFlight.status}</strong>
            {inFlight.startedAt && ` · started ${new Date(inFlight.startedAt).toLocaleTimeString()}`}
            {" — takes ~3 min."}
          </span>
        </div>
      )}

      {inFlight && inFlight.status === "failed" && (
        <div className="soul-status soul-failed">
          <span>Last training failed: {inFlight.error || "unknown error"}</span>
        </div>
      )}

      {/* Train button when no soul yet and no in-flight training */}
      {!p.soulId && (!inFlight || inFlight.status === "failed") && enough && !confirming && (
        <div className="soul-status soul-ready">
          <span>{photoCount} reference photos — ready to train.</span>
          <button type="button" className="btn primary sm" onClick={() => setConfirming(true)}>
            <Icon name="plus" size={14} /> Train Soul ID
          </button>
        </div>
      )}

      {confirming && (
        <div className="soul-confirm">
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            Training will run <code>higgsfield soul-id create --soul-2</code> with up to 20
            reference photos from this persona's gallery. Takes ~3 minutes. Mock mode is on
            by default — set <code>GENERATOR_MOCK=false</code> in <code>.env</code> for a
            real training run (uses Higgsfield credits — ~$3 estimated).
          </p>
          {error && <p className="err-msg" style={{ marginTop: 8 }}>{error}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn ghost sm" onClick={() => setConfirming(false)} disabled={starting}>Cancel</button>
            <button className="btn primary sm" onClick={start} disabled={starting}>
              {starting ? "Queuing…" : "Confirm + start training"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* Small relationship card shown on a persona's profile.
   The label flips based on who is viewing. */
function RelationshipMiniCard({ rel, viewerPersonaId, onOpen }) {
  const label = window.relationshipLabel({
    type: rel.type,
    customLabel: rel.customLabel,
    isDirectional: rel.isDirectional,
    asFromSide: rel.asFromSide,
  });
  return (
    <button className="rel-mini-card" onClick={onOpen}>
      <Photo imageId={rel.other.photoId} className="rel-mini-avatar" />
      <div className="rel-mini-body">
        <div className="rel-mini-name">{rel.other.name}</div>
        <div className="rel-mini-type">
          {label}
          {rel.familyName && <> · <span className="rel-mini-fam">{rel.familyName}</span></>}
        </div>
      </div>
    </button>
  );
}

function PersonaDetail({ persona, onClose, onEdit, onDelete, onAddRelationship, onOpenRelationship, onOpenPersona, onOpenFamily }) {
  const [entryIndex, setEntryIndex] = useState(null);
  const p = persona;
  const sub = [p.age !== "" && p.age != null ? p.age : null, p.gender, p.ethnicity].filter(Boolean).join(" · ");

  if (entryIndex !== null) {
    return (
      <Overlay onClose={onClose} wide>
        <ImageEntryView
          persona={p}
          index={entryIndex}
          onIndex={setEntryIndex}
          onBack={() => setEntryIndex(null)}
          onClose={onClose}
        />
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose} wide>
      <div className="sheet-head detail-head">
        <div className="dh-main">
          <StatusBadge value={p.status} />
          <h2>{p.name}</h2>
          {sub && <div className="dh-sub">{sub}</div>}
        </div>
        <div className="dh-actions">
          <button className="btn ghost sm" onClick={onEdit}>
            <Icon name="edit" size={15} /> Edit
          </button>
          <button className="btn ghost sm danger-text" onClick={onDelete}>
            <Icon name="trash" size={15} /> Delete
          </button>
          <button className="iconbtn lg" onClick={onClose} title="Close">
            <Icon name="x" size={20} />
          </button>
        </div>
      </div>

      <div className="sheet-body detail-body">
        <div className="detail-grid">
          {/* LEFT */}
          <aside className="detail-left">
            <Photo imageId={p.photoId} className="detail-photo" />
            <div className="facts">
              {p.age !== "" && p.age != null && <Fact label="Age">{p.age}</Fact>}
              {p.gender && <Fact label="Gender">{p.gender}</Fact>}
              {p.ethnicity && <Fact label="Demography">{p.ethnicity}</Fact>}
              {p.location && (
                <Fact label="Location">
                  <span className="inline-ico">
                    <Icon name="pin" size={13} /> {p.location}
                  </span>
                </Fact>
              )}
              {p.languages && p.languages.length > 0 && (
                <Fact label="Languages">{p.languages.join(", ")}</Fact>
              )}
              {p.occupation && <Fact label="Occupation">{p.occupation}</Fact>}
              {p.affiliation && <Fact label="Affiliation">{p.affiliation}</Fact>}
            </div>

            {/* Soul ID status — surfaces the Train Soul button when enough reference photos exist */}
            <SoulBlock persona={p} />
            {!p.soulId && p.gallery && p.gallery.length > 0 && p.gallery.length < 10 && (
              <div className="left-sec">
                <h4 className="block-label">Soul ID (Higgsfield)</h4>
                <div className="soul-status soul-pending">
                  <Icon name="image" size={14} />
                  <span>{p.gallery.length} / 10 reference photos. Add {10 - p.gallery.length} more to enable Soul training.</span>
                </div>
              </div>
            )}

            {/* PHYSICAL ATTRIBUTES — only renders if any field is populated */}
            {(p.heightCm || p.build || p.hair || p.eyeColor || p.skin || p.distinguishingMarks) && (
              <div className="left-sec">
                <h4 className="block-label">Physical</h4>
                <div className="facts">
                  {p.heightCm != null && p.heightCm !== "" && (
                    <Fact label="Height">{p.heightCm} cm</Fact>
                  )}
                  {p.build && <Fact label="Build">{p.build}</Fact>}
                  {p.hair && <Fact label="Hair">{p.hair}</Fact>}
                  {p.eyeColor && <Fact label="Eyes">{p.eyeColor}</Fact>}
                  {p.skin && <Fact label="Skin">{p.skin}</Fact>}
                  {p.distinguishingMarks && (
                    <Fact label="Marks">{p.distinguishingMarks}</Fact>
                  )}
                </div>
              </div>
            )}

            {p.socials && p.socials.length > 0 && (
              <div className="left-sec">
                <h4 className="block-label">Accounts &amp; credentials</h4>
                <div className="socials-view">
                  {p.socials.map((s) => (
                    <SocialCard key={s.id} s={s} />
                  ))}
                </div>
              </div>
            )}

            {(p.managementUrl || p.managementNotes) && (
              <div className="left-sec">
                <h4 className="block-label">Management account</h4>
                <div className="mgmt">
                  {p.managementUrl && (
                    <a className="mgmt-link" href={p.managementUrl} target="_blank" rel="noreferrer">
                      <Icon name="link" size={14} /> <span>{p.managementUrl}</span>
                    </a>
                  )}
                  {p.managementNotes && <p className="mgmt-notes">{p.managementNotes}</p>}
                </div>
              </div>
            )}

            {p.families && p.families.length > 0 && onOpenFamily && (
              <div className="left-sec">
                <h4 className="block-label">Families</h4>
                <div className="fam-link-list">
                  {p.families.map((f) => (
                    <button key={f.id} className="fam-link-row" onClick={() => onOpenFamily(f.id)}>
                      <Icon name="globe" size={14} />
                      <span className="fam-link-name">{f.name}</span>
                      {f.role && <span className="fam-link-role">{f.role}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>

          {/* RIGHT */}
          <div className="detail-right">
            <Block label="Biography" text={p.biography} />
            <Block label="Backstory" text={p.backstory} />
            <Block label="Personality & voice" text={p.personality} />
            <ChipBlock label="Values" items={p.values} />
            <ChipBlock label="Niches" items={p.niches} />
            <ChipBlock label="Topics" items={p.topics} />
            <Block label="Style" text={p.style} />
            <Block label="Boundaries" text={p.boundaries} />
            <Block label="Calendar context" text={p.calendarContext} />
            <Block label="Generation notes" text={p.personaGenerationNotes} />
          </div>
        </div>

        {/* RELATIONSHIPS */}
        {onAddRelationship && (
          <div className="library">
            <div className="sec-head" style={{ marginBottom: 14 }}>
              <h4 className="block-label">
                Relationships{p.relationships && p.relationships.length ? ` · ${p.relationships.length}` : ""}
              </h4>
              <button className="btn ghost sm" onClick={onAddRelationship}>
                <Icon name="plus" size={14} /> Add relationship
              </button>
            </div>
            {p.relationships && p.relationships.length > 0 ? (
              <div className="rel-mini-grid">
                {p.relationships.map((rel) => (
                  <RelationshipMiniCard
                    key={rel.id}
                    rel={rel}
                    viewerPersonaId={p.id}
                    onOpen={() => onOpenRelationship(rel.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="sec-empty">No relationships yet — add one to start sketching the web.</p>
            )}
          </div>
        )}

        {/* IMAGE LIBRARY */}
        <div className="library">
          <h4 className="block-label">
            Image library{p.gallery && p.gallery.length ? ` · ${p.gallery.length}` : ""}
          </h4>
          {p.gallery && p.gallery.length ? (
            <div className="view-gallery">
              {p.gallery.map((item, i) => (
                <ViewThumb key={item.id} item={item} onOpen={() => setEntryIndex(i)} />
              ))}
            </div>
          ) : (
            <p className="sec-empty">No images yet.</p>
          )}
        </div>
      </div>
    </Overlay>
  );
}

Object.assign(window, { PersonaDetail });
