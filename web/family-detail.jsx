/* ============================================================
   FamilyDetail — read view: header + family tree + lore + members.
   ============================================================ */

/* Compute layout positions for tree nodes.
   Strategy:
     - Group members by generation (smallest first).
     - Members within a generation are placed evenly along the x-axis,
       sorted by `position` ascending (falling back to insertion order).
     - Each generation gets a fixed vertical band.
   Returns: { nodes: [{member, persona, x, y}], width, height }.
*/
function layoutFamilyTree(members) {
  if (!members || members.length === 0) return { nodes: [], edges: [], width: 600, height: 200 };

  const byGen = new Map();
  for (const m of members) {
    const g = m.generation ?? 0;
    if (!byGen.has(g)) byGen.set(g, []);
    byGen.get(g).push(m);
  }
  for (const list of byGen.values()) {
    list.sort((a, b) => (a.position || 0) - (b.position || 0));
  }
  const gens = [...byGen.keys()].sort((a, b) => a - b);

  const NODE_R = 32;
  const X_PAD = 50;
  const X_GAP = 32;          // horizontal gap between nodes
  const Y_PAD = 40;
  const Y_GAP = 130;         // vertical gap between generations

  // Total width = widest generation
  const widestN = Math.max(...gens.map((g) => byGen.get(g).length));
  const width = Math.max(420, X_PAD * 2 + widestN * (NODE_R * 2) + (widestN - 1) * X_GAP);
  const height = Y_PAD * 2 + gens.length * (NODE_R * 2) + (gens.length - 1) * (Y_GAP - NODE_R * 2);

  const nodes = [];
  gens.forEach((g, gi) => {
    const list = byGen.get(g);
    const totalW = list.length * (NODE_R * 2) + (list.length - 1) * X_GAP;
    const startX = (width - totalW) / 2 + NODE_R;
    const y = Y_PAD + NODE_R + gi * Y_GAP;
    list.forEach((m, mi) => {
      const x = startX + mi * (NODE_R * 2 + X_GAP);
      nodes.push({ member: m, persona: m.persona, x, y, generation: g });
    });
  });

  const nodeById = new Map(nodes.map((n) => [n.member.id, n]));

  // Edges from parents to children (descent lines)
  const edges = [];
  for (const n of nodes) {
    const parents = (n.member.parentMemberIds || []).map((pid) => nodeById.get(pid)).filter(Boolean);
    if (parents.length === 0) continue;
    // Mid-point between parents (union)
    const px = parents.reduce((s, p) => s + p.x, 0) / parents.length;
    const py = parents[0].y; // assume parents are in the same generation
    edges.push({ kind: "descent", fromX: px, fromY: py + NODE_R, toX: n.x, toY: n.y - NODE_R });
    if (parents.length === 2) {
      // Union bar between the two parents
      const [a, b] = parents.sort((x, y) => x.x - y.x);
      edges.push({ kind: "union", fromX: a.x + NODE_R, fromY: a.y, toX: b.x - NODE_R, toY: b.y });
    }
  }

  // Sibling bars (dashed blue) — between consecutive nodes in the same gen sharing all parents
  gens.forEach((g) => {
    const list = byGen.get(g);
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      const aP = (a.parentMemberIds || []).slice().sort().join(",");
      const bP = (b.parentMemberIds || []).slice().sort().join(",");
      if (aP && aP === bP) {
        const an = nodeById.get(a.id), bn = nodeById.get(b.id);
        edges.push({ kind: "sibling", fromX: an.x + NODE_R, fromY: an.y, toX: bn.x - NODE_R, toY: bn.y });
      }
    }
  });

  return { nodes, edges, width, height, nodeR: NODE_R };
}

function FamilyTreeSvg({ members, onOpenPersona }) {
  const layout = React.useMemo(() => layoutFamilyTree(members || []), [members]);
  if (!members || members.length === 0) {
    return (
      <div className="tree-empty">
        <Icon name="user" size={28} />
        <p>No members yet — add personas to this family to build the tree.</p>
      </div>
    );
  }
  const { nodes, edges, width, height, nodeR } = layout;
  return (
    <div className="tree-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="tree-svg" preserveAspectRatio="xMidYMid meet">
        {edges.map((e, i) => {
          if (e.kind === "union") {
            return <line key={i} className="tree-union" x1={e.fromX} y1={e.fromY} x2={e.toX} y2={e.toY} />;
          }
          if (e.kind === "sibling") {
            return <line key={i} className="tree-sibling" x1={e.fromX} y1={e.fromY} x2={e.toX} y2={e.toY} />;
          }
          // descent — draw L-shape: vertical down to midline, horizontal to child x, vertical to child
          const midY = (e.fromY + e.toY) / 2;
          return (
            <g key={i} className="tree-descent">
              <line x1={e.fromX} y1={e.fromY} x2={e.fromX} y2={midY} />
              <line x1={e.fromX} y1={midY} x2={e.toX} y2={midY} />
              <line x1={e.toX} y1={midY} x2={e.toX} y2={e.toY} />
            </g>
          );
        })}
        {nodes.map((n) => (
          <TreeNode key={n.member.id} node={n} nodeR={nodeR} onOpen={() => onOpenPersona(n.persona.id)} />
        ))}
      </svg>
    </div>
  );
}

/* SVG node — renders a circular portrait or placeholder, plus a label below.
   Uses foreignObject for the photo so we can leverage CSS background patterns. */
function TreeNode({ node, nodeR, onOpen }) {
  const url = node.persona && node.persona.photoId
    ? window.api.imageUrl(node.persona.photoId)
    : null;
  const clipId = `clip-${node.member.id.slice(0, 8)}`;
  return (
    <g className="tree-node" onClick={onOpen} style={{ cursor: "pointer" }}>
      <defs>
        <clipPath id={clipId}>
          <circle cx={node.x} cy={node.y} r={nodeR - 2} />
        </clipPath>
      </defs>
      {url ? (
        <image
          href={url}
          x={node.x - nodeR + 2}
          y={node.y - nodeR + 2}
          width={(nodeR - 2) * 2}
          height={(nodeR - 2) * 2}
          clipPath={`url(#${clipId})`}
          preserveAspectRatio="xMidYMid slice"
        />
      ) : (
        <circle cx={node.x} cy={node.y} r={nodeR - 2} className="tree-placeholder" />
      )}
      <circle cx={node.x} cy={node.y} r={nodeR} className="tree-ring" />
      <text x={node.x} y={node.y + nodeR + 16} textAnchor="middle" className="tree-name">
        {node.persona?.name?.split(" ")[0] || "(?)"}
      </text>
      {node.member.role && (
        <text x={node.x} y={node.y + nodeR + 30} textAnchor="middle" className="tree-role">
          {node.member.role}
        </text>
      )}
    </g>
  );
}

function FamilyDetail({ family, onClose, onEdit, onDelete, onOpenPersona }) {
  if (!family) return null;
  return (
    <Overlay onClose={onClose} wide>
      <div className="sheet-head detail-head">
        <div className="dh-main">
          <div className="eyebrow">Family</div>
          <h2>{family.name}</h2>
          {(family.location || family.established) && (
            <div className="dh-sub">
              {[family.location, family.established].filter(Boolean).join(" · ")}
            </div>
          )}
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
        {/* Cover */}
        <div className="fam-cover">
          <Photo imageId={family.photoId} label="family photo" className="fam-cover-photo" />
          <div className="fam-cover-meta">
            <span className="chip fam-chip">
              {family.members?.length || 0} {family.members?.length === 1 ? "member" : "members"}
            </span>
            {family.location && <span className="chip">{family.location}</span>}
            {family.established && <span className="chip">est. {family.established}</span>}
          </div>
        </div>

        {/* Family tree */}
        <div className="library">
          <h4 className="block-label">Family tree</h4>
          <FamilyTreeSvg members={family.members} onOpenPersona={onOpenPersona} />
        </div>

        {/* Lore */}
        {family.lore && (
          <div className="block" style={{ marginTop: 24 }}>
            <h4 className="block-label">Family lore</h4>
            <p className="block-text">{family.lore}</p>
          </div>
        )}

        {/* Flat member list (accessibility / quick scan) */}
        {family.members && family.members.length > 0 && (
          <div className="library">
            <h4 className="block-label">Members</h4>
            <div className="view-gallery fam-member-grid">
              {family.members.map((m) => (
                <button
                  key={m.id}
                  className="view-thumb fam-member-card"
                  onClick={() => onOpenPersona(m.persona.id)}
                >
                  <div className="vt-img" style={m.persona.photoId ? { backgroundImage: `url("${window.api.imageUrl(m.persona.photoId)}")` } : {}}>
                    {!m.persona.photoId && <span className="vt-ph">no photo</span>}
                  </div>
                  <div className="vt-meta">
                    <span className="vt-model">{m.persona.name}</span>
                    {m.role && <span className="vt-prompt">{m.role} · G{m.generation}</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Overlay>
  );
}

Object.assign(window, { FamilyDetail, FamilyTreeSvg, layoutFamilyTree });
