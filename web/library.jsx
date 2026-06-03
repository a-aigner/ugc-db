/* ============================================================
   Library — reusable stock assets (food, sunsets, workspaces)
   ============================================================ */

const SCENE_TYPES = ["food", "drink", "workspace", "landscape", "street", "interior", "sky", "object"];
const MOODS       = ["cozy", "energetic", "minimal", "moody", "dramatic", "soft", "warm"];
const LOCATIONS   = ["apartment", "café", "gym", "park", "beach", "street", "campus", "studio", "kitchen"];
const TIMES_OF_DAY = ["morning", "midday", "golden_hour", "night", "overcast"];

function LibraryAssetCard({ asset, onOpen }) {
  return (
    <button className="library-card" onClick={onOpen} title={asset.notes || ""}>
      <div
        className="library-card-img"
        style={{ backgroundImage: `url("${asset.imageUrl}")` }}
      />
      <div className="library-card-body">
        <div className="library-card-tags">
          {asset.sceneType && <span className="chip sm">{asset.sceneType}</span>}
          {asset.mood && <span className="chip sm">{asset.mood}</span>}
          {asset.timeOfDay && <span className="chip sm">{asset.timeOfDay}</span>}
        </div>
        {asset.locationHint && (
          <div className="card-sub">{asset.locationHint}</div>
        )}
        {asset.timesUsed > 0 && (
          <div className="library-card-usage">used {asset.timesUsed}×</div>
        )}
      </div>
    </button>
  );
}

function LibraryFilters({ filters, onChange, onClear }) {
  const set = (k, v) => onChange({ ...filters, [k]: v });
  return (
    <div className="library-filters">
      <label className="select-wrap">
        <span className="sw-label">Scene</span>
        <select value={filters.sceneType || "all"} onChange={(e) => set("sceneType", e.target.value === "all" ? "" : e.target.value)}>
          <option value="all">All</option>
          {SCENE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Icon name="chevron" size={15} className="sw-chev" />
      </label>
      <label className="select-wrap">
        <span className="sw-label">Mood</span>
        <select value={filters.mood || "all"} onChange={(e) => set("mood", e.target.value === "all" ? "" : e.target.value)}>
          <option value="all">All</option>
          {MOODS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Icon name="chevron" size={15} className="sw-chev" />
      </label>
      <label className="select-wrap">
        <span className="sw-label">Location</span>
        <select value={filters.location || "all"} onChange={(e) => set("location", e.target.value === "all" ? "" : e.target.value)}>
          <option value="all">All</option>
          {LOCATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Icon name="chevron" size={15} className="sw-chev" />
      </label>
      <label className="select-wrap">
        <span className="sw-label">Time</span>
        <select value={filters.timeOfDay || "all"} onChange={(e) => set("timeOfDay", e.target.value === "all" ? "" : e.target.value)}>
          <option value="all">All</option>
          {TIMES_OF_DAY.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Icon name="chevron" size={15} className="sw-chev" />
      </label>
      {(filters.sceneType || filters.mood || filters.location || filters.timeOfDay) && (
        <button className="btn ghost sm" onClick={onClear}>Reset</button>
      )}
    </div>
  );
}

function LibraryGallery({ assets, query, filters, onChangeFilters, onClearFilters, onOpen, onNew }) {
  const q = (query || "").trim().toLowerCase();
  const filtered = (assets || []).filter((a) => {
    if (!q) return true;
    const hay = [a.sceneType, a.mood, a.locationHint, a.timeOfDay, a.notes, ...(a.tags || [])]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });

  if (!assets) {
    return <div className="loading"><span>Loading…</span></div>;
  }

  if (assets.length === 0) {
    return (
      <div className="empty">
        <div className="empty-art"><Icon name="image" size={28} /></div>
        <h3>No library assets yet</h3>
        <p>
          Library assets are reusable stock photos (food, sunsets, workspaces, etc.) that the
          content planner draws from for non-persona stories. Generate them in the Higgsfield
          web UI for free under your Plus passes, then upload them here.
        </p>
        <div className="empty-actions">
          <button className="btn primary" onClick={onNew}>
            <Icon name="upload" size={17} /> Upload assets
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <LibraryFilters filters={filters} onChange={onChangeFilters} onClear={onClearFilters} />
      {filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-art"><Icon name="search" size={26} /></div>
          <h3>No matches</h3>
          <p>Nothing fits your search and filters.</p>
        </div>
      ) : (
        <div className="grid-cards library-grid">
          {filtered.map((a) => (
            <LibraryAssetCard key={a.id} asset={a} onOpen={() => onOpen(a.id)} />
          ))}
        </div>
      )}
    </>
  );
}

Object.assign(window, { LibraryGallery, LibraryAssetCard, SCENE_TYPES, MOODS, LOCATIONS, TIMES_OF_DAY });
