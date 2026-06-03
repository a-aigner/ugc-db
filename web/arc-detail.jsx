/* ============================================================
   ArcDetail — overlay showing one arc + its personas + planned posts
   ============================================================ */

const POST_STATUS_COLORS = {
  planned:    { bg: "var(--surface-2)",                 fg: "var(--ink-soft)" },
  approved:   { bg: "oklch(0.94 0.08 240)",             fg: "oklch(0.35 0.13 240)" },
  generating: { bg: "oklch(0.94 0.08 290)",             fg: "oklch(0.35 0.13 290)" },
  generated:  { bg: "oklch(0.94 0.07 150)",             fg: "oklch(0.38 0.12 150)" },
  accepted:   { bg: "oklch(0.92 0.1 150)",              fg: "oklch(0.3 0.14 150)" },
  rejected:   { bg: "var(--danger-soft)",               fg: "var(--danger)" },
  pushed:     { bg: "oklch(0.92 0.06 290)",             fg: "oklch(0.35 0.13 290)" },
  posted:     { bg: "oklch(0.92 0.05 250)",             fg: "oklch(0.32 0.13 250)" },
};

function PostStatusPill({ status }) {
  const c = POST_STATUS_COLORS[status] || POST_STATUS_COLORS.planned;
  return (
    <span style={{
      background: c.bg, color: c.fg,
      fontFamily: "var(--mono)", fontSize: 10.5,
      padding: "2px 8px", borderRadius: 999,
      letterSpacing: "0.05em", textTransform: "uppercase",
      fontWeight: 600, whiteSpace: "nowrap",
    }}>{status}</span>
  );
}

function PlannedPostRow({ post, onOpenReview, personasById }) {
  const persona = personasById?.get(post.personaId);
  const when = post.scheduledAt
    ? new Date(post.scheduledAt).toLocaleString(undefined, {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit",
      })
    : "—";
  return (
    <tr className="post-row" onClick={onOpenReview} style={{ cursor: "pointer" }}>
      <td className="post-when">{when}</td>
      <td>
        <span className="post-type-chip">{post.postType.replace("ig_", "")}</span>
        {post.storyType && <span className="post-story-type">{post.storyType}</span>}
      </td>
      <td className="post-persona">
        {persona && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Photo imageId={persona.photoId} className="post-persona-avatar" />
            {persona.name}
          </span>
        )}
      </td>
      <td className="post-caption-cell">
        {post.caption ? (
          <span className="post-caption-preview">{post.caption}</span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td><PostStatusPill status={post.status} /></td>
    </tr>
  );
}

function ArcDetail({ arc, allPersonas, onClose, onEdit, onDelete, onOpenPersona, onOpenPost }) {
  if (!arc) return null;
  const personasById = new Map((allPersonas || []).map((p) => [p.id, p]));

  return (
    <Overlay onClose={onClose} wide>
      <div className="sheet-head detail-head">
        <div className="dh-main">
          <div className="eyebrow">Storyline arc</div>
          <h2>{arc.title}</h2>
          <div className="dh-sub">
            {arc.startsOn} → {arc.endsOn}
            {arc.location ? ` · ${arc.location}` : ""}
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
        {/* META */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
          <span className={"chip " + (ARC_STATUS_LABELS[arc.status]?.cls || "")}>
            {ARC_STATUS_LABELS[arc.status]?.label || arc.status}
          </span>
          {arc.theme && <span className="chip">{arc.theme}</span>}
          {arc.mood && <span className="chip" style={{ fontStyle: "italic" }}>{arc.mood}</span>}
        </div>

        {arc.continuityNotes && (
          <div className="block" style={{ marginBottom: 20 }}>
            <h4 className="block-label">Continuity</h4>
            <p className="block-text">{arc.continuityNotes}</p>
          </div>
        )}

        {arc.notes && (
          <div className="block" style={{ marginBottom: 24 }}>
            <h4 className="block-label">Notes</h4>
            <p className="block-text">{arc.notes}</p>
          </div>
        )}

        {/* PERSONAS */}
        {arc.personas && arc.personas.length > 0 && (
          <div className="library" style={{ marginTop: 8 }}>
            <h4 className="block-label">Personas in this arc</h4>
            <div className="rel-mini-grid">
              {arc.personas.map((m) => (
                <button
                  key={m.id}
                  className="rel-mini-card"
                  onClick={() => onOpenPersona && onOpenPersona(m.id)}
                >
                  <Photo imageId={m.photoId} className="rel-mini-avatar" />
                  <div className="rel-mini-body">
                    <div className="rel-mini-name">{m.name}</div>
                    <div className="rel-mini-type">
                      {m.role}{m.occupation ? ` · ${m.occupation}` : ""}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* PLANNED POSTS TABLE */}
        <div className="library">
          <h4 className="block-label">
            Planned posts{arc.plannedPosts?.length ? ` · ${arc.plannedPosts.length}` : ""}
          </h4>
          {arc.plannedPosts && arc.plannedPosts.length ? (
            <div className="post-table-wrap">
              <table className="post-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th>Persona</th>
                    <th>Caption</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {arc.plannedPosts.map((post) => (
                    <PlannedPostRow
                      key={post.id}
                      post={post}
                      personasById={personasById}
                      onOpenReview={() => onOpenPost && onOpenPost(post)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="sec-empty">No planned posts yet. The Instagram content planner skill will create posts on this arc once it runs.</p>
          )}
        </div>
      </div>
    </Overlay>
  );
}

Object.assign(window, { ArcDetail, PostStatusPill });
