/* ============================================================
   Families gallery — card grid of all families.
   ============================================================ */

function FamilyCard({ f, onOpen }) {
  return (
    <button className="card" onClick={onOpen}>
      <div className="card-photo-wrap fam-photo-wrap">
        <Photo imageId={f.photoId} label="family photo" className="card-photo" />
        {f.memberCount > 0 && (
          <span className="card-status">
            <span className="badge fam-badge">
              <span className="dot" />
              {f.memberCount} {f.memberCount === 1 ? "member" : "members"}
            </span>
          </span>
        )}
      </div>
      <div className="card-body">
        <div className="card-name">{f.name}</div>
        {(f.location || f.established) && (
          <div className="card-sub">
            {[f.location, f.established].filter(Boolean).join(" · ")}
          </div>
        )}
        {f.lore && (
          <p className="card-lore" title={f.lore}>{f.lore}</p>
        )}
      </div>
    </button>
  );
}

function FamiliesGallery({ families, query, onOpen, onNew }) {
  const q = (query || "").trim().toLowerCase();
  const filtered = (families || []).filter((f) => {
    if (!q) return true;
    const hay = [f.name, f.lore, f.location, f.established].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });

  if (!families) {
    return <div className="loading"><span>Loading…</span></div>;
  }

  if (families.length === 0) {
    return (
      <div className="empty">
        <div className="empty-art"><Icon name="globe" size={28} /></div>
        <h3>No families yet</h3>
        <p>Group personas into families to share lore, build trees, and link relationships.</p>
        <div className="empty-actions">
          <button className="btn primary" onClick={onNew}>
            <Icon name="plus" size={17} /> New family
          </button>
        </div>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="empty">
        <div className="empty-art"><Icon name="search" size={26} /></div>
        <h3>No matches</h3>
        <p>Nothing fits your search.</p>
      </div>
    );
  }

  return (
    <div className="grid-cards">
      {filtered.map((f) => (
        <FamilyCard key={f.id} f={f} onOpen={() => onOpen(f.id)} />
      ))}
    </div>
  );
}

Object.assign(window, { FamiliesGallery, FamilyCard });
