/* ============================================================
   RelationshipDetail — read view: both portraits, quick-facts, narrative.
   ============================================================ */

function RelTypePill({ rel, viewerPersonaId }) {
  const t = window.REL_TYPES_BY_KEY[rel.type];
  const asFromSide = rel.fromPersonaId === viewerPersonaId || !viewerPersonaId;
  const label = window.relationshipLabel({
    type: rel.type,
    customLabel: rel.customLabel,
    isDirectional: rel.isDirectional,
    asFromSide,
  });
  const dots = t?.friendship_level;
  let cls = "rel-pill";
  if (rel.category === "friendship") cls += dots >= 4 ? " hot" : dots >= 2 ? " warm" : " cool";
  else if (rel.category === "family") cls += " warm";
  else if (rel.category === "romantic") cls += " romantic";
  else if (rel.category === "professional") cls += " pro";
  else cls += " neutral";
  return (
    <span className={cls}>
      {dots != null && (
        <span className="rel-pill-dots">
          {[1, 2, 3, 4, 5].map((i) => (
            <span key={i} className={i <= dots ? "lit" : ""} />
          ))}
        </span>
      )}
      {rel.isDirectional && (asFromSide ? <span>→</span> : <span>←</span>)}
      {!rel.isDirectional && <span>↔</span>}
      <span>{label}</span>
    </span>
  );
}

function StatusPill({ status }) {
  if (!status) return null;
  const opt = window.REL_STATUS_OPTIONS.find((o) => o.key === status);
  const live = status === "active_close" || status === "active_complicated";
  return (
    <span className={"chip status-chip " + (live ? "live" : "")}>{opt?.label || status}</span>
  );
}

function NarrativeBlock({ label, text }) {
  if (!text || !String(text).trim()) return null;
  return (
    <div className="block">
      <h4 className="block-label">{label}</h4>
      <p className="block-text">{text}</p>
    </div>
  );
}

function RelImageThumb({ item, onOpen }) {
  const url = window.api.imageUrl(item.imageId);
  return (
    <button className="view-thumb" onClick={onOpen} title={item.caption || ""}>
      <div className="vt-img" style={url ? { backgroundImage: `url("${url}")` } : {}}>
        {!url && <span className="vt-ph">no image</span>}
      </div>
      {(item.caption || item.taken) && (
        <div className="vt-meta">
          {item.caption && <span className="vt-prompt">{item.caption}</span>}
          {item.taken && <span className="vt-time">{item.taken}</span>}
        </div>
      )}
    </button>
  );
}

/* In-place lightbox view for a single shared photo — same overlay sheet,
   content swaps to the photo + caption + when, with prev/next arrows
   and a Back-to-relationship button. */
function RelImageEntryView({ relationship, index, onIndex, onBack, onClose }) {
  const gallery = relationship.images || [];
  const item = gallery[index] || {};
  const url = window.api.imageUrl(item.imageId);
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
          <Icon name="arrowLeft" size={15} /> Back to {relationship.fromPersona.name} &amp; {relationship.toPersona.name}
        </button>
        <div className="entry-mid">
          <span className="eyebrow">Shared photo</span>
          {many && <span className="entry-count">{index + 1} / {gallery.length}</span>}
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
          {item.caption && (
            <div className="lb-field">
              <span className="lb-key">Caption</span>
              <p className="lb-val">{item.caption}</p>
            </div>
          )}
          {item.taken && (
            <div className="lb-field">
              <span className="lb-key">When</span>
              <p className="lb-val">{item.taken}</p>
            </div>
          )}
          {!item.caption && !item.taken && (
            <p className="sec-empty">No caption or date recorded for this photo.</p>
          )}
        </div>
      </div>
    </>
  );
}

function RelationshipDetail({ relationship, viewerPersonaId, onClose, onEdit, onDelete, onOpenPersona }) {
  const [photoIndex, setPhotoIndex] = useState(null);
  if (!relationship) return null;
  const rel = relationship;
  const cadenceLabel = window.REL_CADENCE_OPTIONS.find((o) => o.key === rel.cadence)?.label;
  const statusLabel = window.REL_STATUS_OPTIONS.find((o) => o.key === rel.status)?.label;

  if (photoIndex !== null) {
    return (
      <Overlay onClose={onClose} wide>
        <RelImageEntryView
          relationship={rel}
          index={photoIndex}
          onIndex={setPhotoIndex}
          onBack={() => setPhotoIndex(null)}
          onClose={onClose}
        />
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose} wide>
      <div className="sheet-head detail-head">
        <div className="dh-main">
          <div className="eyebrow">Relationship</div>
          <div className="rel-duo-head">
            <button
              type="button"
              className="rel-portrait-btn"
              onClick={() => onOpenPersona(rel.fromPersona.id)}
              title={`Open ${rel.fromPersona.name}`}
            >
              <Photo imageId={rel.fromPersona.photoId} className="rel-portrait" />
              <span className="rel-portrait-name">{rel.fromPersona.name}</span>
            </button>
            <RelTypePill rel={rel} viewerPersonaId={viewerPersonaId} />
            <button
              type="button"
              className="rel-portrait-btn"
              onClick={() => onOpenPersona(rel.toPersona.id)}
              title={`Open ${rel.toPersona.name}`}
            >
              <Photo imageId={rel.toPersona.photoId} className="rel-portrait" />
              <span className="rel-portrait-name">{rel.toPersona.name}</span>
            </button>
          </div>
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
        {/* Quick-facts strip */}
        <div className="facts-strip">
          {cadenceLabel && <div className="fact-cell"><div className="k">Cadence</div><div className="v">{cadenceLabel}</div></div>}
          {rel.since && <div className="fact-cell"><div className="k">Since</div><div className="v">{rel.since}</div></div>}
          {statusLabel && <div className="fact-cell"><div className="k">Status</div><div className="v">{statusLabel}</div></div>}
        </div>

        {/* Narrative blocks */}
        <div className="rel-narrative">
          <NarrativeBlock label="Origin" text={rel.origin} />
          <NarrativeBlock label="The dynamic" text={rel.dynamic} />
          <NarrativeBlock label="Mutual influence" text={rel.mutualInfluence} />
          <NarrativeBlock label="Bonding moments" text={rel.bondingMoments} />
          <NarrativeBlock label="Tensions" text={rel.tensions} />
          <NarrativeBlock label="Inside jokes & references" text={rel.insideJokes} />
          <NarrativeBlock label="Current arc" text={rel.currentArc} />
        </div>

        {/* Photos together */}
        {rel.images && rel.images.length > 0 && (
          <div className="library">
            <h4 className="block-label">Photos together · {rel.images.length}</h4>
            <div className="view-gallery">
              {rel.images.map((img, i) => (
                <RelImageThumb key={img.id} item={img} onOpen={() => setPhotoIndex(i)} />
              ))}
            </div>
          </div>
        )}

        {/* Content seeds */}
        {rel.contentSeeds && (
          <div className="seed-block">
            <h4 className="block-label">Content seeds</h4>
            <p className="block-text">{rel.contentSeeds}</p>
          </div>
        )}
      </div>
    </Overlay>
  );
}

Object.assign(window, { RelationshipDetail, RelTypePill });
