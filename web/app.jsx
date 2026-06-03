/* ============================================================
   App — gallery, search, filtering, routing, navigation tabs
   ============================================================ */

function PersonaCard({ p, onOpen }) {
  const sub = [p.age !== "" && p.age != null ? p.age : null, p.gender].filter(Boolean).join(" · ");
  const find = (plat) => (p.socials || []).find((s) => s.platform === plat && (s.handle || s.url));
  const ig = find("Instagram");
  const tt = find("TikTok");
  return (
    <button className="card" onClick={onOpen}>
      <div className="card-photo-wrap">
        <Photo imageId={p.photoId} className="card-photo" />
        <span className="card-status">
          <StatusBadge value={p.status} />
        </span>
      </div>
      <div className="card-body">
        <div className="card-name">{p.name}</div>
        {sub && <div className="card-sub">{sub}</div>}
        {(ig || tt) && (
          <div className="card-handles">
            {ig && (
              <span className="handle">
                <span className="hl">IG</span>
                {ig.handle || ig.url}
              </span>
            )}
            {tt && (
              <span className="handle">
                <span className="hl">TT</span>
                {tt.handle || tt.url}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

function NavTabs({ view, onChange }) {
  return (
    <div className="seg nav-tabs">
      <button className={"seg-btn" + (view === "personas" ? " on" : "")} onClick={() => onChange("personas")}>
        Personas
      </button>
      <button className={"seg-btn" + (view === "families" ? " on" : "")} onClick={() => onChange("families")}>
        Families
      </button>
      <button className={"seg-btn" + (view === "arcs" ? " on" : "")} onClick={() => onChange("arcs")}>
        Arcs
      </button>
      <button className={"seg-btn" + (view === "library" ? " on" : "")} onClick={() => onChange("library")}>
        Library
      </button>
      <button className={"seg-btn" + (view === "graph" ? " on" : "")} onClick={() => onChange("graph")}>
        Graph
      </button>
    </div>
  );
}

function App() {
  const [view, setView] = useState("personas"); // personas | families
  const [personas, setPersonas] = useState(null);
  const [families, setFamilies] = useState(null);

  // persona view state
  const [query, setQuery] = useState("");
  const [niche, setNiche] = useState("all");
  const [sort, setSort] = useState("name");
  const [detailId, setDetailId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [showSampleHint, setShowSampleHint] = useState(false);
  const [hydratedPersona, setHydratedPersona] = useState(null); // loaded persona w/ relationships+families

  // relationship state
  const [openRelationshipId, setOpenRelationshipId] = useState(null);
  const [openRelationship, setOpenRelationship] = useState(null);
  const [editingRel, setEditingRel] = useState(null); // "new" | relationship-object | null
  const [relViewerPersonaId, setRelViewerPersonaId] = useState(null); // whose perspective
  const [confirmDelRel, setConfirmDelRel] = useState(null);

  // family view state
  const [familyQuery, setFamilyQuery] = useState("");
  const [familyDetailId, setFamilyDetailId] = useState(null);
  const [editingFamily, setEditingFamily] = useState(null); // family object | "new" | null
  const [confirmDelFamily, setConfirmDelFamily] = useState(null);
  const [openFamily, setOpenFamily] = useState(null); // loaded family detail

  // arcs view state
  const [arcs, setArcs] = useState(null);
  const [arcQuery, setArcQuery] = useState("");
  const [arcDetailId, setArcDetailId] = useState(null);
  const [openArc, setOpenArc] = useState(null);
  const [editingArc, setEditingArc] = useState(null);   // arc object | "new" | null
  const [confirmDelArc, setConfirmDelArc] = useState(null);

  // library view state
  const [libraryAssets, setLibraryAssets] = useState(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryFilters, setLibraryFilters] = useState({});
  const [libraryDetailId, setLibraryDetailId] = useState(null);
  const [openLibraryAsset, setOpenLibraryAsset] = useState(null);
  const [uploadingLibrary, setUploadingLibrary] = useState(false);

  // draft review state
  const [reviewPostId, setReviewPostId] = useState(null);
  const [reviewPost, setReviewPost] = useState(null);
  const [reviewLibraryAsset, setReviewLibraryAsset] = useState(null);

  const refreshPersonas = async () => {
    const list = await window.DB.all();
    setPersonas(list);
    setShowSampleHint(list.some((x) => x.sample));
    return list;
  };
  const refreshFamilies = async () => {
    const list = await window.DB.families.all();
    setFamilies(list);
    return list;
  };
  const refreshArcs = async () => {
    const list = await window.DB.arcs.all();
    setArcs(list);
    return list;
  };
  const refreshLibrary = async (filters = libraryFilters) => {
    const list = await window.DB.library.all(filters);
    setLibraryAssets(list);
    return list;
  };

  /* initial load */
  useEffect(() => {
    (async () => {
      let list = await window.DB.all();
      if (list.length === 0 && !localStorage.getItem("ugc.seeded")) {
        await window.DB.seed();
        localStorage.setItem("ugc.seeded", "1");
        list = await window.DB.all();
      }
      setPersonas(list);
      if (list.some((x) => x.sample)) setShowSampleHint(true);
      await refreshFamilies();
      await refreshArcs();
      await refreshLibrary({});
    })();
  }, []);

  /* arc detail hydration */
  useEffect(() => {
    if (!arcDetailId) { setOpenArc(null); return; }
    let stale = false;
    (async () => {
      const a = await window.DB.arcs.get(arcDetailId);
      if (!stale) setOpenArc(a);
    })();
    return () => { stale = true; };
  }, [arcDetailId]);

  /* library detail hydration */
  useEffect(() => {
    if (!libraryDetailId) { setOpenLibraryAsset(null); return; }
    let stale = false;
    (async () => {
      const a = await window.DB.library.get(libraryDetailId);
      if (!stale) setOpenLibraryAsset(a);
    })();
    return () => { stale = true; };
  }, [libraryDetailId]);

  /* library filters → refresh server-side */
  useEffect(() => {
    if (libraryAssets === null) return; // skip until initial load done
    refreshLibrary(libraryFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryFilters]);

  /* draft review hydration: load the planned post, and its library asset if any */
  useEffect(() => {
    if (!reviewPostId) {
      setReviewPost(null);
      setReviewLibraryAsset(null);
      return;
    }
    let stale = false;
    (async () => {
      const p = await window.DB.plannedPosts.get(reviewPostId);
      if (stale) return;
      setReviewPost(p);
      if (p && p.libraryAssetId) {
        const a = await window.DB.library.get(p.libraryAssetId).catch(() => null);
        if (!stale) setReviewLibraryAsset(a);
      } else {
        setReviewLibraryAsset(null);
      }
    })();
    return () => { stale = true; };
  }, [reviewPostId]);

  /* hydrate the open family whenever the id changes */
  useEffect(() => {
    if (!familyDetailId) {
      setOpenFamily(null);
      return;
    }
    let stale = false;
    (async () => {
      const f = await window.DB.families.get(familyDetailId);
      if (!stale) setOpenFamily(f);
    })();
    return () => { stale = true; };
  }, [familyDetailId]);

  /* hydrate the open persona detail (with full relationships) */
  useEffect(() => {
    if (!detailId) {
      setHydratedPersona(null);
      return;
    }
    let stale = false;
    (async () => {
      const p = await window.DB.get(detailId);
      if (!stale) setHydratedPersona(p);
    })();
    return () => { stale = true; };
  }, [detailId]);

  /* hydrate the open relationship */
  useEffect(() => {
    if (!openRelationshipId) {
      setOpenRelationship(null);
      return;
    }
    let stale = false;
    (async () => {
      const r = await window.DB.relationships.get(openRelationshipId);
      if (!stale) setOpenRelationship(r);
    })();
    return () => { stale = true; };
  }, [openRelationshipId]);

  const upsertPersona = async (p) => {
    const saved = await window.DB.put(p);
    setPersonas((list) => {
      const i = list.findIndex((x) => x.id === saved.id);
      if (i === -1) return [...list, saved];
      const next = [...list];
      next[i] = saved;
      return next;
    });
    setEditing(null);
    setDetailId(saved.id);
  };

  const removePersona = async (id) => {
    await window.DB.del(id);
    setPersonas((list) => list.filter((x) => x.id !== id));
    setConfirmDel(null);
    setDetailId(null);
  };

  const clearSamples = async () => {
    const samples = (personas || []).filter((x) => x.sample);
    for (const s of samples) await window.DB.del(s.id);
    setPersonas((list) => list.filter((x) => !x.sample));
    setShowSampleHint(false);
  };

  const loadSamples = async () => {
    await window.DB.seed();
    localStorage.setItem("ugc.seeded", "1");
    await refreshPersonas();
    await refreshFamilies();
  };

  const upsertFamily = async (saved) => {
    setFamilies((list) => {
      const i = (list || []).findIndex((x) => x.id === saved.id);
      const card = {
        id: saved.id, name: saved.name, photoId: saved.photoId,
        location: saved.location, established: saved.established,
        lore: saved.lore, memberCount: saved.members?.length || 0,
        createdAt: saved.createdAt, updatedAt: saved.updatedAt,
      };
      if (i === -1) return [...(list || []), card];
      const next = [...list];
      next[i] = card;
      return next;
    });
    setEditingFamily(null);
    setFamilyDetailId(saved.id);
    setOpenFamily(saved);
  };

  const removeFamily = async (id) => {
    await window.DB.families.del(id);
    setFamilies((list) => (list || []).filter((x) => x.id !== id));
    setConfirmDelFamily(null);
    setFamilyDetailId(null);
  };

  const upsertArc = async (saved) => {
    await refreshArcs();
    setEditingArc(null);
    setArcDetailId(saved.id);
    setOpenArc(saved);
  };
  const removeArc = async (id) => {
    await window.DB.arcs.del(id);
    setArcs((list) => (list || []).filter((x) => x.id !== id));
    setConfirmDelArc(null);
    setArcDetailId(null);
  };

  const onLibraryUploaded = async () => {
    await refreshLibrary({});
    setLibraryFilters({});
    setUploadingLibrary(false);
  };
  const onLibraryAssetUpdated = async (updated) => {
    setOpenLibraryAsset(updated);
    setLibraryAssets((list) => (list || []).map((a) => (a.id === updated.id ? updated : a)));
  };
  const onLibraryAssetDeleted = async (id) => {
    await window.DB.library.del(id);
    setLibraryAssets((list) => (list || []).filter((a) => a.id !== id));
    setLibraryDetailId(null);
  };

  /* derived persona filters */
  const allNiches = React.useMemo(() => {
    const set = new Set();
    (personas || []).forEach((p) => (p.niches || []).forEach((n) => set.add(n)));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [personas]);

  const filtered = React.useMemo(() => {
    if (!personas) return [];
    const q = query.trim().toLowerCase();
    let out = personas.filter((p) => {
      if (niche !== "all" && !(p.niches || []).includes(niche)) return false;
      if (!q) return true;
      const hay = [
        p.name, p.gender, p.ethnicity, p.location, p.biography,
        p.backstory, p.personality, p.style,
        (p.languages || []).join(" "),
        (p.niches || []).join(" "),
        (p.topics || []).join(" "),
        (p.values || []).join(" "),
        (p.socials || []).map((s) => s.platform + " " + s.handle).join(" "),
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
    out = [...out].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "recent") return (b.updatedAt || 0) - (a.updatedAt || 0);
      if (sort === "age") return (Number(a.age) || 0) - (Number(b.age) || 0);
      return 0;
    });
    return out;
  }, [personas, query, niche, sort]);

  // Prefer the fully-hydrated persona (with relationships + families) once loaded
  const detail = hydratedPersona && hydratedPersona.id === detailId
    ? hydratedPersona
    : (personas || []).find((x) => x.id === detailId);
  const editingPersona = editing === "new" ? null : editing;
  const editingFamilyInitial = editingFamily === "new" ? null : editingFamily;
  const editingRelInitial = editingRel === "new" ? null : editingRel;

  // Lookup helpers for the relationship form
  const fromPersonaForNewRel = editingRel === "new"
    ? personas.find((p) => p.id === relViewerPersonaId)
    : (editingRelInitial ? personas.find((p) => p.id === editingRelInitial.fromPersonaId) : null);

  const refreshDetailPersona = async () => {
    if (!detailId) return;
    const p = await window.DB.get(detailId);
    setHydratedPersona(p);
  };

  const onRelationshipSaved = async (saved) => {
    setEditingRel(null);
    // Refresh the persona detail so the relationships block updates
    await refreshDetailPersona();
    // Open the new (or refreshed) relationship — even if it was already open,
    // re-trigger the hydration so any newly-uploaded photos appear.
    if (openRelationshipId === saved.id) {
      const fresh = await window.DB.relationships.get(saved.id);
      setOpenRelationship(fresh);
    } else {
      setOpenRelationshipId(saved.id);
    }
  };

  const onRelationshipDeleted = async (id) => {
    await window.DB.relationships.del(id);
    setConfirmDelRel(null);
    setOpenRelationshipId(null);
    await refreshDetailPersona();
  };

  if (personas === null || families === null) {
    return <div className="loading"><span>Loading…</span></div>;
  }

  const isPersonas = view === "personas";
  const isFamilies = view === "families";
  const isArcs     = view === "arcs";
  const isLibrary  = view === "library";
  const isGraph    = view === "graph";

  const editingArcInitial = editingArc === "new" ? null : editingArc;

  const searchValue =
    isPersonas ? query
    : isFamilies ? familyQuery
    : isArcs ? arcQuery
    : isLibrary ? libraryQuery
    : "";
  const setSearchValue = (v) => {
    if (isPersonas)      setQuery(v);
    else if (isFamilies) setFamilyQuery(v);
    else if (isArcs)     setArcQuery(v);
    else if (isLibrary)  setLibraryQuery(v);
  };
  const searchPlaceholder =
    isPersonas ? "Search name, niche, handle, bio…"
    : isFamilies ? "Search families…"
    : isArcs ? "Search arcs by title, theme, mood…"
    : isLibrary ? "Search library by tag, mood, notes…"
    : "Search…";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">UGC</div>
          <div className="brand-text">
            <h1>Creator Database</h1>
            <span className="brand-sub">
              {personas.length} personas · {families.length} {families.length === 1 ? "family" : "families"}
            </span>
          </div>
        </div>
        <NavTabs view={view} onChange={setView} />
        <div className="topbar-tools">
          {!isGraph && (
            <div className="search">
              <Icon name="search" size={17} />
              <input
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder={searchPlaceholder}
              />
              {searchValue && (
                <button className="iconbtn" onClick={() => setSearchValue("")} title="Clear">
                  <Icon name="x" size={15} />
                </button>
              )}
            </div>
          )}
          {isPersonas && (
            <button className="btn primary" onClick={() => setEditing("new")}>
              <Icon name="plus" size={17} /> New persona
            </button>
          )}
          {isFamilies && (
            <button className="btn primary" onClick={() => setEditingFamily("new")}>
              <Icon name="plus" size={17} /> New family
            </button>
          )}
          {isArcs && (
            <button className="btn primary" onClick={() => setEditingArc("new")}>
              <Icon name="plus" size={17} /> New arc
            </button>
          )}
          {isLibrary && (
            <button className="btn primary" onClick={() => setUploadingLibrary(true)}>
              <Icon name="upload" size={17} /> Upload assets
            </button>
          )}
        </div>
      </header>

      {isPersonas && showSampleHint && (
        <div className="hint">
          <span>
            Showing 4 sample personas (with one sample family + sample relationship) to get you started.
            Placeholder photos — edit them, or clear samples to start fresh.
          </span>
          <button className="btn ghost sm" onClick={clearSamples}>Clear samples</button>
        </div>
      )}

      {isPersonas && (
        <div className="filters">
          <div className="filters-right">
            <label className="select-wrap">
              <span className="sw-label">Niche</span>
              <select value={niche} onChange={(e) => setNiche(e.target.value)}>
                <option value="all">All niches</option>
                {allNiches.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <Icon name="chevron" size={15} className="sw-chev" />
            </label>
            <label className="select-wrap">
              <span className="sw-label">Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="name">Name (A–Z)</option>
                <option value="recent">Recently updated</option>
                <option value="age">Age</option>
              </select>
              <Icon name="chevron" size={15} className="sw-chev" />
            </label>
          </div>
        </div>
      )}

      <main className="content">
        {isPersonas && (
          filtered.length === 0 ? (
            <div className="empty">
              {personas.length === 0 ? (
                <>
                  <div className="empty-art"><Icon name="user" size={30} /></div>
                  <h3>No personas yet</h3>
                  <p>Create your first AI creator persona to start building your database.</p>
                  <div className="empty-actions">
                    <button className="btn primary" onClick={() => setEditing("new")}>
                      <Icon name="plus" size={17} /> New persona
                    </button>
                    <button className="btn ghost" onClick={loadSamples}>Load sample personas</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="empty-art"><Icon name="search" size={28} /></div>
                  <h3>No matches</h3>
                  <p>Nothing fits your current search and filters.</p>
                  <button className="btn ghost" onClick={() => { setQuery(""); setNiche("all"); }}>
                    Reset filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="grid-cards">
              {filtered.map((p) => (
                <PersonaCard key={p.id} p={p} onOpen={() => setDetailId(p.id)} />
              ))}
            </div>
          )
        )}

        {isFamilies && (
          <FamiliesGallery
            families={families}
            query={familyQuery}
            onOpen={(id) => setFamilyDetailId(id)}
            onNew={() => setEditingFamily("new")}
          />
        )}

        {isArcs && (
          <ArcsGallery
            arcs={arcs}
            query={arcQuery}
            onOpen={(id) => setArcDetailId(id)}
            onNew={() => setEditingArc("new")}
          />
        )}

        {isLibrary && (
          <LibraryGallery
            assets={libraryAssets}
            query={libraryQuery}
            filters={libraryFilters}
            onChangeFilters={setLibraryFilters}
            onClearFilters={() => setLibraryFilters({})}
            onOpen={(id) => setLibraryDetailId(id)}
            onNew={() => setUploadingLibrary(true)}
          />
        )}

        {isGraph && (
          <GraphView
            // Don't change the tab — overlays sit on top of the graph,
            // so closing them returns you straight back to where you were.
            onOpenPersona={(pid) => setDetailId(pid)}
            onOpenRelationship={(rid) => {
              setRelViewerPersonaId(null);  // no specific perspective when opened from graph
              setOpenRelationshipId(rid);
            }}
            onOpenFamily={(fid) => setFamilyDetailId(fid)}
          />
        )}
      </main>

      {/* Persona detail + editor + delete confirm */}
      {detail && !editing && (
        <PersonaDetail
          persona={detail}
          onClose={() => setDetailId(null)}
          onEdit={() => setEditing(detail)}
          onDelete={() => setConfirmDel(detail)}
          onAddRelationship={() => {
            setRelViewerPersonaId(detail.id);
            setEditingRel("new");
          }}
          onOpenRelationship={(relId) => {
            setRelViewerPersonaId(detail.id);
            setOpenRelationshipId(relId);
          }}
          onOpenPersona={(pid) => setDetailId(pid)}
          // Don't switch tabs — open the family overlay over wherever the
          // user is. Closing it returns them to the persona / graph / families
          // view they were on.
          onOpenFamily={(fid) => {
            setDetailId(null);
            setFamilyDetailId(fid);
          }}
        />
      )}

      {editing && (
        <PersonaForm
          initial={editingPersona}
          onSave={upsertPersona}
          onCancel={() => setEditing(null)}
        />
      )}

      {confirmDel && (
        <Confirm
          title={`Delete ${confirmDel.name}?`}
          body="This permanently removes the persona and its image library. This can't be undone."
          confirmLabel="Delete persona"
          onConfirm={() => removePersona(confirmDel.id)}
          onCancel={() => setConfirmDel(null)}
        />
      )}

      {/* Family detail + editor + delete confirm */}
      {familyDetailId && openFamily && !editingFamily && (
        <FamilyDetail
          family={openFamily}
          onClose={() => setFamilyDetailId(null)}
          onEdit={() => setEditingFamily(openFamily)}
          onDelete={() => setConfirmDelFamily(openFamily)}
          // Same principle — open the persona overlay without switching tabs.
          onOpenPersona={(pid) => {
            setFamilyDetailId(null);
            setDetailId(pid);
          }}
        />
      )}

      {editingFamily && (
        <FamilyForm
          initial={editingFamilyInitial}
          allPersonas={personas}
          onSave={upsertFamily}
          onCancel={() => setEditingFamily(null)}
        />
      )}

      {confirmDelFamily && (
        <Confirm
          title={`Delete ${confirmDelFamily.name}?`}
          body="This permanently removes the family (members aren't deleted, just unlinked)."
          confirmLabel="Delete family"
          onConfirm={() => removeFamily(confirmDelFamily.id)}
          onCancel={() => setConfirmDelFamily(null)}
        />
      )}

      {/* Relationship detail + form + delete confirm */}
      {openRelationship && !editingRel && (
        <RelationshipDetail
          relationship={openRelationship}
          viewerPersonaId={relViewerPersonaId}
          onClose={() => setOpenRelationshipId(null)}
          onEdit={() => setEditingRel(openRelationship)}
          onDelete={() => setConfirmDelRel(openRelationship)}
          onOpenPersona={(pid) => {
            setOpenRelationshipId(null);
            setDetailId(pid);
          }}
        />
      )}

      {editingRel && (
        <RelationshipForm
          initial={editingRelInitial}
          fromPersona={fromPersonaForNewRel}
          allPersonas={personas}
          allFamilies={families}
          onSave={onRelationshipSaved}
          onCancel={() => setEditingRel(null)}
        />
      )}

      {confirmDelRel && (
        <Confirm
          title="Delete this relationship?"
          body="This permanently removes the relationship and any photos attached to it."
          confirmLabel="Delete relationship"
          onConfirm={() => onRelationshipDeleted(confirmDelRel.id)}
          onCancel={() => setConfirmDelRel(null)}
        />
      )}

      {/* Arc detail + editor + delete confirm */}
      {arcDetailId && openArc && !editingArc && (
        <ArcDetail
          arc={openArc}
          allPersonas={personas}
          onClose={() => setArcDetailId(null)}
          onEdit={() => setEditingArc(openArc)}
          onDelete={() => setConfirmDelArc(openArc)}
          onOpenPersona={(pid) => {
            setArcDetailId(null);
            setDetailId(pid);
          }}
          onOpenPost={(post) => setReviewPostId(post.id)}
        />
      )}

      {editingArc && (
        <ArcForm
          initial={editingArcInitial}
          allPersonas={personas}
          onSave={upsertArc}
          onCancel={() => setEditingArc(null)}
          onOpenPersona={(pid) => {
            setEditingArc(null);
            setArcDetailId(null);
            setDetailId(pid);
          }}
        />
      )}

      {confirmDelArc && (
        <Confirm
          title={`Delete "${confirmDelArc.title}"?`}
          body="This deletes the arc. Planned posts on this arc are kept (their arc_id becomes null)."
          confirmLabel="Delete arc"
          onConfirm={() => removeArc(confirmDelArc.id)}
          onCancel={() => setConfirmDelArc(null)}
        />
      )}

      {/* Library upload + asset detail */}
      {uploadingLibrary && (
        <LibraryUploadForm
          onSave={onLibraryUploaded}
          onCancel={() => setUploadingLibrary(false)}
        />
      )}

      {libraryDetailId && openLibraryAsset && (
        <LibraryDetail
          asset={openLibraryAsset}
          onClose={() => setLibraryDetailId(null)}
          onUpdate={onLibraryAssetUpdated}
          onDelete={() => onLibraryAssetDeleted(openLibraryAsset.id)}
        />
      )}

      {/* Draft Review — opens when clicking a planned post row in arc detail */}
      {reviewPost && (() => {
        const arcPosts = openArc?.plannedPosts || [];
        const idx = arcPosts.findIndex((p) => p.id === reviewPost.id);
        const prevPost = idx > 0 ? arcPosts[idx - 1] : null;
        const nextPost = idx >= 0 && idx < arcPosts.length - 1 ? arcPosts[idx + 1] : null;
        const persona = personas.find((p) => p.id === reviewPost.personaId);
        return (
          <DraftReview
            post={reviewPost}
            persona={persona}
            arc={openArc}
            libraryAsset={reviewLibraryAsset}
            prevPost={prevPost}
            nextPost={nextPost}
            onPostChange={async (updated) => {
              setReviewPost(updated);
              // Refresh the arc detail so the planned-posts table reflects new status
              if (arcDetailId) {
                const fresh = await window.DB.arcs.get(arcDetailId);
                setOpenArc(fresh);
              }
            }}
            onClose={() => setReviewPostId(null)}
            onPrev={() => prevPost && setReviewPostId(prevPost.id)}
            onNext={() => nextPost && setReviewPostId(nextPost.id)}
            onOpenPersona={(pid) => {
              setReviewPostId(null);
              setDetailId(pid);
            }}
          />
        );
      })()}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
