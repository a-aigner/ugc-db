/* ============================================================
   DraftReview — review a planned post and drive its status
   Side-by-side reference + generated, with status-aware actions.
   ============================================================ */

const STATUS_DESCRIPTIONS = {
  planned:    "Plan written — waiting for your approval before generation.",
  approved:   "Approved — queued for the generator to pick up.",
  generating: "Generating image — refresh in a few seconds.",
  generated:  "Image ready — review side-by-side and decide.",
  accepted:   "Accepted — ready to push to fleetmanager.",
  rejected:   "Rejected. Re-plan or delete.",
  pushed:     "Pushed to fleetmanager.",
  posted:     "Posted to Instagram.",
};

function PersonaContextPanel({ persona, post }) {
  if (!persona) return null;
  const physicalBits = [
    persona.heightCm ? `${persona.heightCm} cm` : null,
    persona.build,
    persona.hair,
    persona.eyeColor && `${persona.eyeColor} eyes`,
    persona.skin,
  ].filter(Boolean);
  return (
    <div className="draft-context-panel">
      <div className="draft-context-head">
        <Photo imageId={persona.photoId} className="draft-context-avatar" />
        <div style={{ minWidth: 0 }}>
          <div className="draft-context-name">{persona.name}</div>
          {persona.occupation && (
            <div className="draft-context-sub">{persona.occupation}</div>
          )}
        </div>
      </div>

      {physicalBits.length > 0 && (
        <div className="draft-context-row">
          <span className="draft-context-label">Look</span>
          <span className="draft-context-val">{physicalBits.join(" · ")}</span>
        </div>
      )}
      {persona.distinguishingMarks && (
        <div className="draft-context-row">
          <span className="draft-context-label">Marks</span>
          <span className="draft-context-val">{persona.distinguishingMarks}</span>
        </div>
      )}
      {persona.personality && (
        <div className="draft-context-row">
          <span className="draft-context-label">Voice</span>
          <span className="draft-context-val">{persona.personality}</span>
        </div>
      )}
      {persona.style && (
        <div className="draft-context-row">
          <span className="draft-context-label">Style</span>
          <span className="draft-context-val">{persona.style}</span>
        </div>
      )}
      {persona.personaGenerationNotes && (
        <div className="draft-context-row draft-context-notes">
          <span className="draft-context-label">Gen notes</span>
          <span className="draft-context-val">{persona.personaGenerationNotes}</span>
        </div>
      )}
      {persona.soulId && (
        <div className="draft-context-row">
          <span className="draft-context-label">Soul ID</span>
          <span className="draft-context-val mono">{persona.soulId}</span>
        </div>
      )}
    </div>
  );
}

function GeneratedStage({ post, libraryAsset }) {
  // For posts using a library asset, show the asset image
  if (post.libraryAssetId && libraryAsset) {
    return (
      <div className="draft-generated-wrap">
        <div className="draft-generated-label">Library asset (no generation)</div>
        <div
          className="draft-generated-img"
          style={{ backgroundImage: `url("${libraryAsset.imageUrl}")` }}
        />
      </div>
    );
  }
  // For posts with a generated image
  if (post.generatedImageId) {
    const url = window.api.imageUrl(post.generatedImageId);
    return (
      <div className="draft-generated-wrap">
        <div className="draft-generated-label">Generated</div>
        <div
          className="draft-generated-img"
          style={{ backgroundImage: `url("${url}")` }}
        />
      </div>
    );
  }
  // Otherwise: placeholder appropriate to status
  const message =
    post.status === "planned"   ? "Approve the plan to queue generation." :
    post.status === "approved"  ? "Waiting for the generator to pick this up…" :
    post.status === "generating" ? "Generating…" :
    post.status === "rejected"  ? "Rejected — no image generated." :
    "No image yet.";
  return (
    <div className="draft-generated-wrap">
      <div className="draft-generated-label">Not yet generated</div>
      <div className="draft-generated-img placeholder">
        <span className="ph-label">{message}</span>
      </div>
    </div>
  );
}

function ArcContextPanel({ arc }) {
  if (!arc) return null;
  return (
    <div className="draft-arc-context">
      <div className="draft-arc-head">
        <span className="draft-arc-eyebrow">Arc</span>
        <span className="draft-arc-title">{arc.title}</span>
      </div>
      <div className="draft-arc-rows">
        {arc.theme && (
          <div className="draft-context-row">
            <span className="draft-context-label">Theme</span>
            <span className="draft-context-val">{arc.theme}</span>
          </div>
        )}
        {arc.mood && (
          <div className="draft-context-row">
            <span className="draft-context-label">Mood</span>
            <span className="draft-context-val">{arc.mood}</span>
          </div>
        )}
        {arc.continuityNotes && (
          <div className="draft-context-row">
            <span className="draft-context-label">Continuity</span>
            <span className="draft-context-val">{arc.continuityNotes}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DraftReview({
  post, persona, arc, libraryAsset, prevPost, nextPost,
  onPostChange, onClose, onPrev, onNext, onOpenPersona,
}) {
  const [feedback, setFeedback] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [acting, setActing] = useState(null);  // string action name when in-flight

  useEffect(() => {
    setFeedback(post?.regenerationFeedback || "");
    setRejectReason(post?.rejectionReason || "");
  }, [post?.id]);

  useEffect(() => {
    const h = (e) => {
      if (e.key === "ArrowLeft" && prevPost) onPrev();
      if (e.key === "ArrowRight" && nextPost) onNext();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [prevPost, nextPost]);

  if (!post) return null;

  const setStatus = async (status, extra = {}) => {
    setActing(status);
    try {
      const updated = await window.DB.plannedPosts.setStatus(post.id, { status, ...extra });
      onPostChange(updated);
    } finally {
      setActing(null);
    }
  };

  const whenLabel = post.scheduledAt
    ? new Date(post.scheduledAt).toLocaleString(undefined, {
        weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })
    : "Unscheduled";

  const isGenerated = !!post.generatedImageId || !!post.libraryAssetId;
  const isPlanned = post.status === "planned";
  const isApproved = post.status === "approved";
  const isLocked = ["accepted", "pushed", "posted"].includes(post.status);
  const wasRejected = post.status === "rejected";

  return (
    <Overlay onClose={onClose} wide>
      <div className="sheet-head detail-head">
        <div className="dh-main">
          <div className="eyebrow">Draft review</div>
          <h2>{whenLabel}</h2>
          <div className="dh-sub">
            {arc?.title ? `${arc.title} · ` : ""}{post.postType.replace("ig_", "")}
            {post.storyType ? ` · ${post.storyType}` : ""}
          </div>
        </div>
        <div className="dh-actions">
          <PostStatusPill status={post.status} />
          <button className="iconbtn lg" onClick={onClose} title="Close">
            <Icon name="x" size={20} />
          </button>
        </div>
      </div>

      <div className="sheet-body detail-body">
        <p className="cat-desc" style={{ margin: "0 0 18px" }}>
          {STATUS_DESCRIPTIONS[post.status] || ""}
        </p>

        {/* SIDE BY SIDE */}
        <div className="draft-stage">
          <PersonaContextPanel persona={persona} post={post} />
          <GeneratedStage post={post} libraryAsset={libraryAsset} />
        </div>

        {/* CAPTION */}
        <div className="block" style={{ marginTop: 24 }}>
          <h4 className="block-label">Caption</h4>
          {post.caption ? (
            <p className="block-text">{post.caption}</p>
          ) : (
            <p className="sec-empty">No caption yet.</p>
          )}
          {post.hashtags && post.hashtags.length > 0 && (
            <div style={{ marginTop: 6, fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--accent-press)" }}>
              {post.hashtags.join("  ")}
            </div>
          )}
          {post.overlayText && (
            <div style={{ marginTop: 8 }}>
              <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>OVERLAY</span>
              <p className="block-text" style={{ fontStyle: "italic" }}>{post.overlayText}</p>
            </div>
          )}
        </div>

        {/* PROMPT + MODEL — only for persona_* */}
        {(post.generationPrompt || post.generationModel) && (
          <div className="block" style={{ marginTop: 18 }}>
            <h4 className="block-label">Generation</h4>
            <div className="grid">
              {post.generationModel && (
                <label className="f">
                  <span className="f-label">Model</span>
                  <span className="mono" style={{ background: "var(--surface-2)", border: "1px solid var(--line)", padding: "7px 10px", borderRadius: 8, fontSize: 12.5 }}>
                    {post.generationModel}
                  </span>
                </label>
              )}
              {post.generationPrompt && (
                <label className="f wide-2">
                  <span className="f-label">Prompt</span>
                  <p className="block-text mono" style={{ background: "var(--surface-2)", border: "1px solid var(--line)", padding: "10px 12px", borderRadius: 8, fontSize: 12, lineHeight: 1.5 }}>
                    {post.generationPrompt}
                  </p>
                </label>
              )}
            </div>
          </div>
        )}

        {/* ARC CONTEXT */}
        {arc && <ArcContextPanel arc={arc} />}

        {/* PREVIOUS REJECTION (if re-planning) */}
        {wasRejected && post.rejectionReason && (
          <div className="block" style={{ marginTop: 16, background: "var(--danger-soft)", border: "1px solid oklch(0.85 0.06 25)", borderRadius: 10, padding: "12px 14px" }}>
            <h4 className="block-label" style={{ color: "var(--danger)" }}>Previous rejection</h4>
            <p className="block-text">{post.rejectionReason}</p>
          </div>
        )}

        {/* ACTIONS */}
        {!isLocked && (
          <div className="draft-actions">
            {isGenerated && (
              <>
                <button
                  className="btn primary"
                  disabled={acting !== null}
                  onClick={() => setStatus("accepted")}
                >
                  <Icon name="check" size={16} /> {acting === "accepted" ? "Approving…" : "Approve"}
                </button>
                <button
                  className="btn ghost danger-text"
                  disabled={acting !== null || !rejectReason.trim()}
                  onClick={() => setStatus("rejected", { reason: rejectReason })}
                >
                  <Icon name="x" size={16} /> {acting === "rejected" ? "Rejecting…" : "Reject"}
                </button>
                {!post.libraryAssetId && (
                  <button
                    className="btn ghost"
                    disabled={acting !== null || !feedback.trim()}
                    onClick={() => setStatus("approved", { feedback })}
                  >
                    <Icon name="upload" size={16} stroke={2.2} /> {acting === "approved" ? "Re-queuing…" : "Regenerate"}
                  </button>
                )}
              </>
            )}
            {isPlanned && (
              <>
                <button
                  className="btn primary"
                  disabled={acting !== null}
                  onClick={() => setStatus("approved")}
                >
                  <Icon name="check" size={16} /> {acting === "approved" ? "Approving…" : "Approve plan"}
                </button>
                <button
                  className="btn ghost danger-text"
                  disabled={acting !== null || !rejectReason.trim()}
                  onClick={() => setStatus("rejected", { reason: rejectReason })}
                >
                  <Icon name="x" size={16} /> Reject plan
                </button>
              </>
            )}
            {isApproved && (
              <p style={{ fontSize: 13.5, color: "var(--muted)", fontStyle: "italic", margin: 0 }}>
                Plan approved. The generator will pick this up.
              </p>
            )}
            {wasRejected && (
              <p style={{ fontSize: 13.5, color: "var(--muted)", fontStyle: "italic", margin: 0 }}>
                Re-plan via the Instagram content planner skill, or delete.
              </p>
            )}
          </div>
        )}

        {isLocked && (
          <div className="draft-actions" style={{ background: "var(--surface-2)", borderColor: "var(--line)" }}>
            <p style={{ fontSize: 13.5, color: "var(--muted)", margin: 0 }}>
              This post is locked at status <strong>{post.status}</strong>.
            </p>
          </div>
        )}

        {/* FEEDBACK / REJECTION INPUTS — collapsed unless relevant */}
        {!isLocked && (isGenerated || isPlanned) && (
          <div className="draft-feedback-area">
            {isGenerated && !post.libraryAssetId && (
              <label className="f">
                <span className="f-label">Feedback for regeneration</span>
                <textarea
                  rows="2"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="e.g. 'hair should be in a high ponytail per generation notes' — the generator appends this to the prompt and re-runs."
                />
              </label>
            )}
            <label className="f">
              <span className="f-label">Rejection reason</span>
              <input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Why declining? Required to reject."
              />
            </label>
          </div>
        )}
      </div>

      {/* PREV / NEXT NAV */}
      <div className="sheet-foot">
        <button
          className="btn ghost sm"
          disabled={!prevPost}
          onClick={onPrev}
          style={{ marginRight: "auto" }}
        >
          <Icon name="chevronLeft" size={15} /> Previous
        </button>
        <button
          className="btn ghost sm"
          disabled={!nextPost}
          onClick={onNext}
        >
          Next <Icon name="chevronRight" size={15} />
        </button>
      </div>
    </Overlay>
  );
}

Object.assign(window, { DraftReview, STATUS_DESCRIPTIONS });
