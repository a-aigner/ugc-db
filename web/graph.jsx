/* ============================================================
   Graph view — force-directed knowledge graph of personas + relationships.
   - Nodes are personas, sized by connection count
   - Edges are relationships, colored by category
   - Families render as soft bubble clusters
   - Hover dims non-neighbors; click opens persona/relationship
   - Filters by category, status, family + search across names/handles
   ============================================================ */


const GRAPH_CATEGORIES = [
  { key: "friendship",   label: "Friendship",   color: "oklch(0.62 0.18 30)"  },
  { key: "family",       label: "Family",       color: "oklch(0.55 0.15 65)"  },
  { key: "romantic",     label: "Romantic",     color: "oklch(0.6 0.2 350)"   },
  { key: "professional", label: "Professional", color: "oklch(0.55 0.14 280)" },
  { key: "other",        label: "Other",        color: "oklch(0.55 0.02 250)" },
];
const GRAPH_CATEGORY_BY_KEY = Object.fromEntries(GRAPH_CATEGORIES.map((c) => [c.key, c]));

function edgeColor(category) {
  return GRAPH_CATEGORY_BY_KEY[category]?.color || "var(--muted)";
}

function edgeThickness(edge) {
  // Friendship rungs feed thickness; otherwise default 1.5
  const t = window.REL_TYPES_BY_KEY[edge.type];
  if (t?.friendship_level != null) return 0.8 + t.friendship_level * 0.6; // 0.8 → 3.8
  return 1.6;
}

function nodeRadius(degree) {
  // Sized by connection count, capped so unread parts don't dominate
  return 14 + Math.min(degree, 8) * 1.6;
}

/* useResizeObserver — track the container size for the SVG viewport. */
function useResizeObserver(ref) {
  const [size, setSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/* useForceSim — wraps d3-force with a tick callback into React state. */
function useForceSim(nodes, edges, width, height) {
  const [tick, setTick] = useState(0);
  const simRef = useRef(null);
  const nodeMap = useRef(new Map());

  useEffect(() => {
    if (!nodes.length) return;
    const d3 = window.d3;
    if (!d3 || !d3.forceSimulation) {
      console.warn("d3-force not loaded; graph will be static");
      return;
    }

    // Preserve x/y of existing nodes for smooth re-layout
    const enriched = nodes.map((n) => {
      const prev = nodeMap.current.get(n.id);
      return prev ? { ...n, x: prev.x, y: prev.y, vx: 0, vy: 0 } : { ...n };
    });
    nodeMap.current = new Map(enriched.map((n) => [n.id, n]));

    const links = edges
      .map((e) => ({
        source: nodeMap.current.get(e.fromPersonaId),
        target: nodeMap.current.get(e.toPersonaId),
        edge: e,
      }))
      .filter((l) => l.source && l.target);

    const sim = d3.forceSimulation(enriched)
      .force("link", d3.forceLink(links).id((d) => d.id).distance(95).strength(0.6))
      .force("charge", d3.forceManyBody().strength(-280))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius((d) => nodeRadius(d.degree || 0) + 6))
      .alpha(0.9)
      .alphaDecay(0.04)
      .on("tick", () => setTick((t) => t + 1));

    simRef.current = sim;
    return () => sim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, edges.length, width, height]);

  // When width/height shifts, update the centering force
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.force("center", window.d3.forceCenter(width / 2, height / 2));
    sim.alpha(0.4).restart();
  }, [width, height]);

  const reheat = () => {
    const sim = simRef.current;
    if (sim) { sim.alpha(0.7).restart(); }
  };

  return { nodes: [...nodeMap.current.values()], tick, reheat };
}

/* GraphNode — circular portrait via SVG clipPath, with a colored ring per category mix. */
function GraphNode({ node, focused, dimmed, onClick }) {
  const url = node.photoId ? window.api.imageUrl(node.photoId) : null;
  const r = nodeRadius(node.degree || 0);
  const clipId = `gnode-clip-${node.id.slice(0, 8)}`;
  return (
    <g
      transform={`translate(${node.x},${node.y})`}
      className={"graph-node" + (focused ? " focused" : "") + (dimmed ? " dimmed" : "")}
      onClick={() => onClick(node)}
      style={{ cursor: "pointer" }}
    >
      <defs>
        <clipPath id={clipId}>
          <circle r={r - 2} />
        </clipPath>
      </defs>
      {url ? (
        <image
          href={url}
          x={-r + 2} y={-r + 2}
          width={(r - 2) * 2} height={(r - 2) * 2}
          clipPath={`url(#${clipId})`}
          preserveAspectRatio="xMidYMid slice"
        />
      ) : (
        <circle r={r - 2} className="graph-node-placeholder" />
      )}
      <circle r={r} className="graph-node-ring" />
      <text y={r + 12} textAnchor="middle" className="graph-node-label">
        {node.name?.split(" ")[0] || "?"}
      </text>
    </g>
  );
}

/* GraphEdge — straight line; opacity dims when focus is active and edge isn't part of it. */
function GraphEdge({ edge, source, target, focused, dimmed, onClick }) {
  if (!source || !target) return null;
  return (
    <line
      x1={source.x} y1={source.y} x2={target.x} y2={target.y}
      stroke={edgeColor(edge.category)}
      strokeWidth={edgeThickness(edge)}
      strokeOpacity={dimmed ? 0.15 : 0.7}
      className={"graph-edge" + (focused ? " focused" : "")}
      onClick={() => onClick(edge)}
      style={{ cursor: "pointer", pointerEvents: "stroke" }}
    />
  );
}

/* FamilyBubble — soft tinted ellipse around all members of a family. */
function FamilyBubble({ family, nodeMap }) {
  const members = (family.memberIds || []).map((id) => nodeMap.get(id)).filter(Boolean);
  if (members.length < 1) return null;
  const xs = members.map((m) => m.x);
  const ys = members.map((m) => m.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = Math.max(80, (maxX - minX) / 2 + 50);
  const ry = Math.max(60, (maxY - minY) / 2 + 50);
  return (
    <g className="family-bubble">
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} />
      <text x={cx} y={cy - ry - 6} textAnchor="middle" className="family-bubble-label">
        {family.name}
      </text>
    </g>
  );
}

function GraphLegend({ visible, onToggleCategory }) {
  return (
    <div className="graph-legend">
      <span className="graph-legend-title">Categories</span>
      {GRAPH_CATEGORIES.map((c) => (
        <button
          key={c.key}
          className={"graph-legend-item" + (visible.has(c.key) ? " on" : " off")}
          onClick={() => onToggleCategory(c.key)}
        >
          <span className="graph-legend-swatch" style={{ background: c.color }} />
          {c.label}
        </button>
      ))}
    </div>
  );
}

function GraphView({ onOpenPersona, onOpenRelationship, onOpenFamily }) {
  const [graph, setGraph] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const [query, setQuery] = useState("");
  const [visibleCats, setVisibleCats] = useState(() => new Set(GRAPH_CATEGORIES.map((c) => c.key)));
  const [familyFilter, setFamilyFilter] = useState("all");
  const containerRef = useRef(null);
  const { width, height } = useResizeObserver(containerRef);

  // Initial load
  useEffect(() => {
    let stale = false;
    (async () => {
      const r = await fetch("/api/graph");
      const g = await r.json();
      if (!stale) setGraph(g);
    })();
    return () => { stale = true; };
  }, []);

  // Compute degree per node from edges
  const degrees = React.useMemo(() => {
    const d = new Map();
    (graph?.edges || []).forEach((e) => {
      d.set(e.fromPersonaId, (d.get(e.fromPersonaId) || 0) + 1);
      d.set(e.toPersonaId, (d.get(e.toPersonaId) || 0) + 1);
    });
    return d;
  }, [graph]);

  // Filter nodes + edges before feeding the simulation
  const filteredEdges = React.useMemo(() => {
    if (!graph) return [];
    return graph.edges.filter((e) => {
      if (!visibleCats.has(e.category)) return false;
      if (familyFilter !== "all" && e.familyId !== familyFilter) return false;
      return true;
    });
  }, [graph, visibleCats, familyFilter]);

  const filteredNodes = React.useMemo(() => {
    if (!graph) return [];
    let ns = graph.nodes;
    if (familyFilter !== "all") {
      ns = ns.filter((n) => (n.familyIds || []).includes(familyFilter));
    }
    return ns.map((n) => ({ ...n, degree: degrees.get(n.id) || 0 }));
  }, [graph, degrees, familyFilter]);

  // Force simulation
  const { nodes: simNodes, reheat } = useForceSim(filteredNodes, filteredEdges, width, height);
  const nodeMap = React.useMemo(() => new Map(simNodes.map((n) => [n.id, n])), [simNodes]);

  // Search highlighting
  const matchedIds = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      filteredNodes
        .filter((n) =>
          n.name?.toLowerCase().includes(q) ||
          (n.handles || []).some((h) => (h.handle || "").toLowerCase().includes(q)),
        )
        .map((n) => n.id),
    );
  }, [query, filteredNodes]);

  // Focus mode: when hovering or matching, dim everything else
  const focusedSet = React.useMemo(() => {
    if (matchedIds) return matchedIds;
    if (!hoverId) return null;
    const focused = new Set([hoverId]);
    filteredEdges.forEach((e) => {
      if (e.fromPersonaId === hoverId) focused.add(e.toPersonaId);
      if (e.toPersonaId === hoverId) focused.add(e.fromPersonaId);
    });
    return focused;
  }, [hoverId, matchedIds, filteredEdges]);

  const toggleCategory = (k) => {
    setVisibleCats((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
    reheat();
  };

  if (!graph) {
    return <div className="loading"><span>Loading graph…</span></div>;
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="empty">
        <div className="empty-art"><Icon name="globe" size={30} /></div>
        <h3>No personas yet</h3>
        <p>Add some personas and the graph fills in.</p>
      </div>
    );
  }

  return (
    <div className="graph-wrap" ref={containerRef}>
      <div className="graph-toolbar">
        <div className="search graph-search">
          <Icon name="search" size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or handle…"
          />
          {query && (
            <button className="iconbtn" onClick={() => setQuery("")} title="Clear">
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
        <label className="select-wrap">
          <span className="sw-label">Family</span>
          <select value={familyFilter} onChange={(e) => { setFamilyFilter(e.target.value); reheat(); }}>
            <option value="all">All</option>
            {graph.families.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <Icon name="chevron" size={15} className="sw-chev" />
        </label>
        <GraphLegend visible={visibleCats} onToggleCategory={toggleCategory} />
        <span className="graph-stats">
          {filteredNodes.length} personas · {filteredEdges.length} relationships
        </span>
      </div>

      <svg className="graph-svg" width={width} height={height}>
        {/* Family bubbles drawn first so they sit behind everything */}
        {graph.families
          .filter((f) => familyFilter === "all" || f.id === familyFilter)
          .map((f) => (
            <FamilyBubble key={f.id} family={f} nodeMap={nodeMap} />
          ))}

        {/* Edges */}
        <g className="graph-edges">
          {filteredEdges.map((e) => {
            const source = nodeMap.get(e.fromPersonaId);
            const target = nodeMap.get(e.toPersonaId);
            const isFocused = focusedSet
              ? (focusedSet.has(e.fromPersonaId) && focusedSet.has(e.toPersonaId))
              : false;
            const isDimmed = focusedSet && !isFocused;
            return (
              <GraphEdge
                key={e.id}
                edge={e}
                source={source}
                target={target}
                focused={isFocused}
                dimmed={isDimmed}
                onClick={(edge) => onOpenRelationship(edge.id)}
              />
            );
          })}
        </g>

        {/* Nodes */}
        <g className="graph-nodes">
          {simNodes.map((n) => {
            const isFocused = focusedSet ? focusedSet.has(n.id) : false;
            const isDimmed = focusedSet && !isFocused;
            return (
              <g key={n.id} onMouseEnter={() => setHoverId(n.id)} onMouseLeave={() => setHoverId(null)}>
                <GraphNode
                  node={n}
                  focused={isFocused}
                  dimmed={isDimmed}
                  onClick={(node) => onOpenPersona(node.id)}
                />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

Object.assign(window, { GraphView, GRAPH_CATEGORIES });
