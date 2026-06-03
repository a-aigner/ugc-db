/* ============================================================
   Arcs gallery — list of storyline arcs (Maya — Bali, etc.)
   ============================================================ */

const ARC_STATUS_LABELS = {
  planning: { label: "Planning", cls: "st-draft" },
  active:   { label: "Active",   cls: "st-active" },
  past:     { label: "Past",     cls: "st-retired" },
  archived: { label: "Archived", cls: "st-retired" },
};

function ArcCard({ arc, onOpen }) {
  const start = arc.startsOn || "—";
  const end   = arc.endsOn || "—";
  return (
    <button className="card arc-card" onClick={onOpen}>
      <div className="arc-card-head">
        <span className={"badge " + (ARC_STATUS_LABELS[arc.status]?.cls || "st-draft")}>
          <span className="dot" />
          {ARC_STATUS_LABELS[arc.status]?.label || arc.status}
        </span>
        <span className="arc-dates">{start} → {end}</span>
      </div>
      <div className="card-body">
        <div className="card-name">{arc.title}</div>
        {arc.theme && <div className="card-sub">{arc.theme}</div>}
        {arc.mood && <div className="arc-mood">{arc.mood}</div>}
        <div className="arc-card-meta">
          <span>{arc.personaCount ?? 0} {arc.personaCount === 1 ? "persona" : "personas"}</span>
          <span>·</span>
          <span>{arc.postCount ?? 0} posts</span>
          {arc.location && <><span>·</span><span>{arc.location}</span></>}
        </div>
      </div>
    </button>
  );
}

function ArcsGallery({ arcs, query, onOpen, onNew }) {
  const q = (query || "").trim().toLowerCase();
  const filtered = (arcs || []).filter((a) => {
    if (!q) return true;
    const hay = [a.title, a.theme, a.mood, a.location, a.notes].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });

  if (!arcs) {
    return <div className="loading"><span>Loading…</span></div>;
  }

  if (arcs.length === 0) {
    return (
      <div className="empty">
        <div className="empty-art"><Icon name="globe" size={28} /></div>
        <h3>No arcs yet</h3>
        <p>Storyline arcs are date-bounded themes (vacation week, exam prep, project sprint) that drive the content planner.</p>
        <div className="empty-actions">
          <button className="btn primary" onClick={onNew}>
            <Icon name="plus" size={17} /> New arc
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
    <div className="grid-cards arc-grid">
      {filtered.map((a) => (
        <ArcCard key={a.id} arc={a} onOpen={() => onOpen(a.id)} />
      ))}
    </div>
  );
}

Object.assign(window, { ArcsGallery, ArcCard, ARC_STATUS_LABELS });
