/* ============================================================
   Shared UI primitives — exported to window for other scripts
   ============================================================ */
const { useState, useEffect, useRef, useCallback } = React;

/* ---- Icons (simple geometric stroke icons) ---- */
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><line x1="16.6" y1="16.6" x2="21" y2="21"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  x: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  chevron: '<polyline points="6 9 12 15 18 9"/>',
  chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
  chevronRight: '<polyline points="9 18 15 12 9 6"/>',
  arrowLeft: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="11 6 5 12 11 18"/>',
  trash: '<polyline points="3 6 21 6"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
  edit: '<path d="M4 20h4L18.5 9.5l-4-4L4 16v4z"/><line x1="13.5" y1="6.5" x2="17.5" y2="10.5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c7 0 11 6 11 6a18 18 0 0 1-2.2 2.9M6.5 6.6A18 18 0 0 0 1 12s4 6 11 6a10.6 10.6 0 0 0 3.6-.6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><polyline points="21 15 16 10 5 21"/>',
  external: '<path d="M14 4h6v6"/><line x1="20" y1="4" x2="11" y2="13"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20c0-4 3.5-6 7.5-6s7.5 2 7.5 6"/>',
  upload: '<path d="M12 16V4"/><polyline points="7 9 12 4 17 9"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  check: '<polyline points="4 12 10 18 20 6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15.5 0 18M12 3c-2.5 2.5-2.5 15.5 0 18"/>',
  link: '<path d="M9 15l6-6"/><path d="M11 6l1-1a4 4 0 0 1 6 6l-1 1"/><path d="M13 18l-1 1a4 4 0 0 1-6-6l1-1"/>',
  pin: '<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
};
function Icon({ name, size = 18, stroke = 1.8, className, style }) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] || "" }}
    />
  );
}

/* ---- Blob -> object URL with cleanup ---- */
function useBlobUrl(blob) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/* ---- Pick the right URL for an image source ----
   Pass { blob } for a pending (un-uploaded) File, { imageId } for an image
   already stored on the server, or both — blob wins so previews reflect the
   freshly-picked file before save. */
function useImageUrl({ blob, imageId } = {}) {
  const blobUrl = useBlobUrl(blob);
  if (blobUrl) return blobUrl;
  if (imageId) return window.api.imageUrl(imageId);
  return null;
}

/* ---- Photo / placeholder ---- */
function Photo({ blob, imageId, label = "reference photo", className = "" }) {
  const url = useImageUrl({ blob, imageId });
  if (!url)
    return (
      <div className={"photo placeholder " + className}>
        <span className="ph-label">{label}</span>
      </div>
    );
  return <div className={"photo " + className} style={{ backgroundImage: `url("${url}")` }} />;
}

/* ---- Status badge ---- */
const STATUS = {
  active: { label: "Active", cls: "st-active" },
  draft: { label: "Draft", cls: "st-draft" },
  retired: { label: "Retired", cls: "st-retired" },
};
function StatusBadge({ value }) {
  const s = STATUS[value] || STATUS.active;
  return (
    <span className={"badge " + s.cls}>
      <span className="dot" />
      {s.label}
    </span>
  );
}

/* ---- Tag input ---- */
function TagInput({ value = [], onChange, placeholder = "Type and press Enter" }) {
  const [draft, setDraft] = useState("");
  const add = (t) => {
    t = (t || "").trim().replace(/,$/, "").trim();
    if (!t) return;
    if (!value.includes(t)) onChange([...value, t]);
    setDraft("");
  };
  const remove = (t) => onChange(value.filter((x) => x !== t));
  return (
    <div className="taginput">
      {value.map((t) => (
        <span className="tag" key={t}>
          {t}
          <button type="button" onClick={() => remove(t)} aria-label={"Remove " + t}>
            <Icon name="x" size={11} stroke={2.4} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            remove(value[value.length - 1]);
          }
        }}
        onBlur={() => add(draft)}
      />
    </div>
  );
}

/* ---- Chips list (read only) ---- */
function Chips({ items, empty = "—" }) {
  if (!items || !items.length) return <span className="muted">{empty}</span>;
  return (
    <div className="chips">
      {items.map((t) => (
        <span className="chip" key={t}>
          {t}
        </span>
      ))}
    </div>
  );
}

/* ---- Full-screen overlay sheet ---- */
function Overlay({ onClose, children, wide }) {
  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"sheet " + (wide ? "wide" : "")} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/* ---- Confirm dialog ---- */
function Confirm({ title, body, confirmLabel = "Delete", onConfirm, onCancel }) {
  return (
    <div className="overlay confirm-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="confirm" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {body && <p>{body}</p>}
        <div className="confirm-actions">
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Copy-to-clipboard button ---- */
function CopyBtn({ text, label }) {
  const [done, setDone] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      className="iconbtn"
      title={"Copy " + (label || "")}
      onClick={() => {
        navigator.clipboard && navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1100);
      }}
    >
      <Icon name={done ? "check" : "copy"} size={14} />
    </button>
  );
}

/* ---- File -> Blob helpers ---- */
function readImageFile(file) {
  // store the File directly (it is a Blob); return as-is
  return file;
}

/* ---- format a datetime-local value for display ---- */
function formatPostTime(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

Object.assign(window, {
  Icon,
  useBlobUrl,
  useImageUrl,
  Photo,
  StatusBadge,
  STATUS,
  TagInput,
  Chips,
  Overlay,
  Confirm,
  CopyBtn,
  readImageFile,
  formatPostTime,
});
