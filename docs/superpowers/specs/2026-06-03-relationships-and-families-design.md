# Relationships & Families — Design Spec

**Status:** Approved (brainstorm 2026-06-03) — ready for implementation planning
**Project:** AI UGC Creator Database (`/Users/andreaigner/Dev/projects/ugc-db`)
**Brainstorm artifacts:** `.superpowers/brainstorm/48908-1780438628/content/01-…05-…html`

## 1. Goal & motivation

The user catalogues AI UGC creator personas to produce realistic content. Today each persona is a standalone record. Relationships between personas (sister, mentor, best friend, ex-partner) and family groupings (with shared lore) are the missing piece that lets the user **stitch coherent multi-persona narratives**.

Long-term goal: an interactive knowledge graph showing every persona, their relationships, and family clusters, with click-through to detail. This spec scopes the **data + per-relationship detail + per-family detail** that the graph view will eventually visualize. The graph view itself is explicitly deferred to a follow-up phase.

## 2. Decisions captured during brainstorm

| Decision | Rationale |
| --- | --- |
| **Model shape: pairwise relationships + named family groups** (Option B from screen 01) | Families have their own lore page; pairwise links exist freely on top of that. Cleanly separates "the family unit's narrative" from "Person A's relationship to Person B." |
| **Both symmetric & directional relationships supported** | "Sister" reads the same both ways; "Mentor → Mentee" flips on each side. Directionality is encoded in the *type*, not chosen per record. |
| **No soft nodes** — every family member is a full persona | The user explicitly chose this for simplicity over the sketching power of placeholder nodes. |
| **Family tree is a real genealogy** | Generations stack G1→G2→G3; horizontal grey bars = unions; dashed blue bars = siblings. Parent links per member drive the layout. |
| **Type taxonomy is categorized + granular** | "Friend" is insufficient — friendship is a ladder (best/close/good/friend/casual/acquaintance/familiar/drifted). Other categories have their own granularities. |
| **Closeness 1–5 field is dropped** | Type already encodes closeness for friendship; was awkward for family/work types. The structured quick-facts now hold only Cadence · Since · Status · Family. |
| **Knowledge-graph view deferred** | Reserved as a disabled tab in the top bar; built once the data + detail pages exist. |
| **Existing schema is untouched** | Only new tables. Existing personas continue to render the same way; the new "Relationships" section appears empty until populated. |

## 3. Data model

All additions to `db/init.sql` (existing tables unchanged).

```sql
-- ============================================================
-- Families
-- ============================================================
CREATE TABLE families (
    id              UUID PRIMARY KEY,
    name            TEXT NOT NULL,
    lore            TEXT,
    photo_id        UUID REFERENCES images(id) ON DELETE SET NULL,
    location        TEXT,
    established     TEXT,                 -- "1958" or "Spring 2018" — freeform
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX families_name_idx ON families (lower(name));

CREATE TRIGGER families_touch BEFORE UPDATE ON families
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Family membership — links a persona into a family with a role.
-- One persona can belong to multiple families (chosen family, in-laws, etc.).
-- ============================================================
CREATE TABLE family_members (
    id                  UUID PRIMARY KEY,
    family_id           UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    persona_id          UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    role                TEXT,             -- "matriarch" | "mother" | "daughter" | "uncle" | …
    generation          INTEGER NOT NULL DEFAULT 0,   -- drives the tree-layout y-axis
    parent_member_ids   UUID[] NOT NULL DEFAULT '{}', -- 0..2 entries; FK enforced in API
    position            INTEGER NOT NULL DEFAULT 0,   -- horizontal order within generation
    UNIQUE (family_id, persona_id)
);
CREATE INDEX family_members_family_idx ON family_members (family_id);
CREATE INDEX family_members_persona_idx ON family_members (persona_id);

-- ============================================================
-- Relationships — exactly two personas, with a category + type + narrative.
-- ============================================================
CREATE TABLE relationships (
    id                  UUID PRIMARY KEY,
    from_persona_id     UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    to_persona_id       UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    category            TEXT NOT NULL,    -- 'friendship' | 'family' | 'romantic' | 'professional' | 'other'
    type                TEXT NOT NULL,    -- 'best_friend' | 'sister' | 'mentor' | … | 'custom'
    custom_label        TEXT,             -- populated when type='custom'
    is_directional      BOOLEAN NOT NULL DEFAULT FALSE,

    -- structured quick-facts
    cadence             TEXT,             -- 'daily' | 'weekly' | 'monthly' | 'rarely' | 'never'
    since               TEXT,             -- freeform: "Birth" | "2018" | "After their fight"
    status              TEXT,             -- 'active_close' | 'active_complicated' | 'drifted' | 'estranged' | 'ended'
    family_id           UUID REFERENCES families(id) ON DELETE SET NULL,

    -- narrative blocks (all nullable, all rich text)
    origin              TEXT,
    dynamic             TEXT,
    bonding_moments     TEXT,
    tensions            TEXT,
    mutual_influence    TEXT,
    inside_jokes        TEXT,
    current_arc         TEXT,
    content_seeds       TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (from_persona_id <> to_persona_id),                     -- no self-loops
    UNIQUE (from_persona_id, to_persona_id, category, type)       -- prevents duplicates
);
CREATE INDEX relationships_from_idx ON relationships (from_persona_id);
CREATE INDEX relationships_to_idx   ON relationships (to_persona_id);
CREATE INDEX relationships_family_idx ON relationships (family_id);

CREATE TRIGGER relationships_touch BEFORE UPDATE ON relationships
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Photos of two personas together — separate gallery from each persona's own.
-- ============================================================
CREATE TABLE relationship_images (
    id                  UUID PRIMARY KEY,
    relationship_id     UUID NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
    position            INTEGER NOT NULL DEFAULT 0,
    image_id            UUID REFERENCES images(id) ON DELETE SET NULL,
    caption             TEXT,
    taken               TEXT              -- "PCH road trip '20" or "2024-10-31"
);
CREATE INDEX relationship_images_rel_idx ON relationship_images (relationship_id);
```

### Notes on the model

- **`from_persona_id` / `to_persona_id` ordering matters for directional types only.** For symmetric types (e.g. `sister`) the API normalizes so the lower UUID is always `from_persona_id`, which makes the UNIQUE constraint do real work (one Maya↔Sofia sister-link, not two).
- **`parent_member_ids`** is a UUID array rather than a join table because the typical cardinality is 0 or 2 (the two biological parents within the same family). The API validates that the IDs reference rows in the same family.
- **`is_directional`** is denormalized from the type catalog (next section) so we don't have to lookup the catalog every render. The catalog is the source of truth on create/update.

## 4. Type taxonomy

Stored as a frontend JS module (`web/rel-types.js`) — single source of truth, importable from both form + detail components. The API does *not* validate against the catalog (so users can extend it without backend changes), but it enforces `category ∈ {friendship, family, romantic, professional, other}`.

```js
// shape: { key, label, category, directional, inverse_label?, friendship_level? }
window.REL_TYPES = [
  // friendship — symmetric, scaled
  { key: 'best_friend',    label: 'Best friend',    category: 'friendship', directional: false, friendship_level: 5 },
  { key: 'close_friend',   label: 'Close friend',   category: 'friendship', directional: false, friendship_level: 4 },
  { key: 'good_friend',    label: 'Good friend',    category: 'friendship', directional: false, friendship_level: 3 },
  { key: 'friend',         label: 'Friend',         category: 'friendship', directional: false, friendship_level: 2 },
  { key: 'casual_friend',  label: 'Casual friend',  category: 'friendship', directional: false, friendship_level: 1 },
  { key: 'acquaintance',   label: 'Acquaintance',   category: 'friendship', directional: false, friendship_level: 0 },
  { key: 'familiar_face',  label: 'Familiar face',  category: 'friendship', directional: false, friendship_level: 0 },
  { key: 'drifted',        label: 'Drifted apart',  category: 'friendship', directional: false },

  // family — mostly directional
  { key: 'mother_child',   label: 'Mother',         inverse_label: 'Child',        category: 'family', directional: true  },
  { key: 'father_child',   label: 'Father',         inverse_label: 'Child',        category: 'family', directional: true  },
  { key: 'sister',         label: 'Sister',                                          category: 'family', directional: false },
  { key: 'brother',        label: 'Brother',                                         category: 'family', directional: false },
  { key: 'sibling',        label: 'Sibling',                                         category: 'family', directional: false },
  { key: 'grandparent',    label: 'Grandparent',    inverse_label: 'Grandchild',   category: 'family', directional: true  },
  { key: 'aunt_uncle',     label: 'Aunt/Uncle',     inverse_label: 'Niece/Nephew', category: 'family', directional: true  },
  { key: 'cousin',         label: 'Cousin',                                          category: 'family', directional: false },
  { key: 'in_law',         label: 'In-law',         inverse_label: 'In-law',       category: 'family', directional: true  },
  { key: 'step_parent',    label: 'Step-parent',    inverse_label: 'Step-child',   category: 'family', directional: true  },
  { key: 'chosen_family',  label: 'Chosen family',                                   category: 'family', directional: false },

  // romantic
  { key: 'crush_on',       label: 'Crush on',       inverse_label: 'Crushed on by', category: 'romantic', directional: true  },
  { key: 'situationship',  label: 'Situationship',                                    category: 'romantic', directional: false },
  { key: 'dating',         label: 'Dating',                                           category: 'romantic', directional: false },
  { key: 'partner',        label: 'Partner',                                          category: 'romantic', directional: false },
  { key: 'engaged',        label: 'Engaged',                                          category: 'romantic', directional: false },
  { key: 'spouse',         label: 'Spouse',                                           category: 'romantic', directional: false },
  { key: 'ex_partner',     label: 'Ex-partner',                                       category: 'romantic', directional: false },
  { key: 'unrequited',     label: 'Unrequited',     inverse_label: 'Unaware',       category: 'romantic', directional: true  },
  { key: 'affair',         label: 'Affair',                                           category: 'romantic', directional: false },

  // professional
  { key: 'mentor',         label: 'Mentor',         inverse_label: 'Mentee',       category: 'professional', directional: true  },
  { key: 'manager',        label: 'Manager',        inverse_label: 'Report',       category: 'professional', directional: true  },
  { key: 'teacher',        label: 'Teacher',        inverse_label: 'Student',      category: 'professional', directional: true  },
  { key: 'colleague',      label: 'Colleague',                                       category: 'professional', directional: false },
  { key: 'business_partner', label: 'Business partner',                              category: 'professional', directional: false },
  { key: 'client',         label: 'Client',         inverse_label: 'Service',      category: 'professional', directional: true  },
  { key: 'collaborator',   label: 'Collaborator',                                    category: 'professional', directional: false },
  { key: 'rival',          label: 'Rival',                                           category: 'professional', directional: false },
  { key: 'competitor',     label: 'Competitor',                                      category: 'professional', directional: false },

  // other / social
  { key: 'neighbor',       label: 'Neighbor',                                        category: 'other', directional: false },
  { key: 'roommate',       label: 'Roommate',                                        category: 'other', directional: false },
  { key: 'online_only',    label: 'Online-only',                                     category: 'other', directional: false },
  { key: 'fan_of',         label: 'Fan of',         inverse_label: 'Has fan',      category: 'other', directional: true  },
  { key: 'frenemy',        label: 'Frenemy',                                         category: 'other', directional: false },
  { key: 'antagonist',     label: 'Antagonist',                                      category: 'other', directional: false },

  // user-extensible
  { key: 'custom',         label: 'Custom…',        category: 'other',  directional: false },
];
```

### Render rules

- **Symmetric** types: same `label` shown on both personas' profile cards. Render with `↔` glyph in the pill.
- **Directional** types: `from_persona` shows `label` (e.g., "Mentor of Aiko"); `to_persona` shows `inverse_label` (e.g., "Mentee of Maya"). Render with `→` glyph.
- **Friendship rungs** also render the 5-dot intensity scale derived from `friendship_level`.
- **Custom** types render the user's `custom_label` verbatim, treated as symmetric.

## 5. API surface (additions to `api/server.js`)

```
GET    /api/families                       list — id, name, photo_id, member_count, location
GET    /api/families/:id                   full — incl. members (with persona refs) + lore + photo
POST   /api/families                       create
PUT    /api/families/:id                   update
DELETE /api/families/:id                   cascades members; relationships keep family_id=null

POST   /api/families/:id/members           add { persona_id, role, generation, parent_member_ids, position }
PUT    /api/families/:id/members/:mid      update
DELETE /api/families/:id/members/:mid      remove

GET    /api/relationships                  list — supports ?persona_id=, ?family_id=, ?category=, ?status=
GET    /api/relationships/:id              single (incl. both personas summary + images)
POST   /api/relationships                  create
PUT    /api/relationships/:id              update
DELETE /api/relationships/:id              delete

POST   /api/relationships/:id/images       multipart upload, attaches to this relationship
DELETE /api/relationships/:id/images/:iid  remove a photo from this relationship
```

### Important API behavior

- **Symmetric normalization**: on POST/PUT of a symmetric-type relationship, the server reorders `from_persona_id`/`to_persona_id` so the lexicographically smaller UUID is always `from`. This makes the UNIQUE constraint reject true duplicates regardless of which side the user added it from. Concrete behavior on collision: **POST returns 409** with the existing row's id, so the client can route the user to the existing record instead of silently overwriting; **PUT** to a given relationship id is always an in-place update (no normalization conflict possible because the row is identified by primary key).
- **Existing `GET /api/personas/:id`** gains an inline `relationships` summary so the persona detail page can render the new section in one round-trip (no extra fetch). Summary shape: `{ id, type, category, family_id, other: { id, name, photo_id } }`.
- **Existing `GET /api/personas` (list)** stays unchanged — relationships are NOT included in the gallery payload (would bloat it).

## 6. Frontend additions

### 6.1 Top bar — navigation

Three tabs replace the current single-purpose header: `Personas | Families | Graph`. **Graph is a disabled pill** with a small "soon" badge — present in the layout from day 1 so the user gets the conceptual map, even though it's not built.

### 6.2 Families gallery (`web/families.jsx`)

Card grid mirroring the Personas gallery. Each card: cover photo (or placeholder), name, member count, location chip. Search + sort like the personas page.

### 6.3 Family detail (`web/family-detail.jsx`)

Overlay sheet (same `Overlay` primitive). Sections:

- **Header**: cover photo, family name, lore preview, pills (member count, location, established), Edit / Delete actions
- **Family tree** (SVG): renders from `family_members` ordered by `(generation, position)` with descent lines from `parent_member_ids`. Each node is a circle showing the persona's reference photo cropped into the circle (falling back to the diagonal-stripe placeholder used elsewhere in the app if the persona has no photo), with name + role labels beneath. Click → opens that persona's profile.
- **Family lore** (rich text block)
- **Member list** as a flat list below the tree for accessibility

### 6.4 Family editor (`web/family-form.jsx`)

Overlay sheet. Fields: name, cover photo (reuses `Photo` + upload), location, established, lore (textarea). Members section: add personas (typeahead picker), assign role, generation number, and pick 0–2 parents from already-added members. Validation: parents must already be in the same family.

### 6.5 Persona detail additions (`web/detail.jsx`)

A new "Relationships · N" block appears between the existing biography blocks and the image library. Renders a responsive grid of relationship cards:

```
┌───────────────────────────────┐
│ [avatar]  Sofia Rivera         │
│           sister · The Riveras │
└───────────────────────────────┘
```

Clicking a card opens the relationship detail. A `+ Add relationship` button sits in the section header.

### 6.6 Relationship detail (`web/relationship-detail.jsx`)

Overlay sheet:
- **Header**: both portraits, type pill (with directional flip applied based on which persona "side" you came from), family chip, status pill, Edit / Delete actions
- **Quick-facts strip**: Cadence · Since · Status · Family (4 cells)
- **Narrative grid**: Origin, Dynamic, Mutual influence, Bonding moments, Tensions, Inside jokes, Current arc — each block only rendered if populated
- **Photos together** (mini gallery, same `useImageUrl` pattern)
- **Content seeds** (highlighted violet block, like a callout)

### 6.7 Relationship form (`web/relationship-form.jsx`)

Three-step UX inside one overlay (steps stacked, not navigated):

1. **Pick the other persona** — typeahead over existing personas, with a small inline "+ Create persona" shortcut (opens the persona editor and returns the new persona's ID)
2. **Pick category + type** — category tabs at top; within Friendship, the 8-rung ladder UI; other categories show chip grids
3. **Fill structured + narrative fields** — same shape as the detail view, all optional

Submit POSTs the relationship; if a family is selected and at least one of the two personas isn't yet a member, prompt: *"Also add Aiko to The Riveras as friend-of-family?"*

## 7. Data layer (client)

Extend `web/db.js`:

```js
window.DB.families = {
  all: () => …,
  get: (id) => …,
  put: (family) => …,      // upload pending photo blob, then upsert
  del: (id) => …,
  addMember:    (familyId, member)             => …,
  updateMember: (familyId, memberId, member)   => …,
  removeMember: (familyId, memberId)           => …,
};

window.DB.relationships = {
  forPersona: (personaId) => …,
  get: (id) => …,
  put: (rel) => …,
  del: (id) => …,
  uploadImage: (relId, blob, caption, taken) => …,
};
```

Existing `window.DB.{all,get,put,del,seed}` for personas remains.

## 8. Seed updates

`api/samples.js` gains one family ("The Riveras") with Maya as a member (generation 3). No new personas added in seed — the family demonstrates the structure with one real member; the user adds more (or promotes the soft-node mockup characters Sofia/Elena/Abuela as they wish).

A single sample relationship (Maya ↔ Aiko, `close_friend`) is added so the empty state of the new sections is non-empty out of the box.

## 9. Out of scope (deferred)

- **Knowledge-graph visualization** (force-directed canvas with nodes + edges). Reserved nav slot; built next.
- **Bulk relationship operations** (e.g., "mark all rivals as drifted").
- **Auto-derived relationships** (if A is sibling of B and B is sibling of C, suggest A↔C). Manual only for now.
- **Soft nodes** (placeholder family members not yet personas) — user chose against this.
- **Per-relationship symmetric/directional override** — type alone decides.
- **Export/import** — separate concern.

## 10. Migration & compatibility

- No changes to existing tables — pure additions.
- The new schema goes into `db/init.sql`. Because this file only runs when the volume is first created, **existing users need to either**:
  - `docker-compose down -v` (wipes data) and `up -d` (fresh init); or
  - Run the new DDL manually via `docker-compose exec db psql -U ugc -d ugc -f /path/to/migration.sql`.
- The implementation plan will ship a separate `db/migrations/001-relationships.sql` file with idempotent `IF NOT EXISTS` guards so it can be applied to an existing database without resetting.

## 11. Implementation phasing (high-level)

The plan-writer will break these out further; this is the rough order:

1. **Schema + migration script** (`db/init.sql` + `db/migrations/001-relationships.sql`)
2. **API endpoints + samples** (families, family_members, relationships, relationship_images) with curl tests verifying CRUD + symmetric normalization
3. **Frontend data layer** (`db.js` additions)
4. **Type catalog module** (`rel-types.js`)
5. **Top-bar navigation** (Personas/Families/Graph tabs)
6. **Families gallery + family-form + family-detail (with SVG tree)**
7. **Relationship form + relationship-detail**
8. **Persona-detail integration** (Relationships block + Add relationship CTA)
9. **End-to-end verification** (replay the brainstorm scenario: build The Riveras, add Maya↔Aiko, navigate the graph by clicking)

## 12. Open questions resolved during brainstorm

- Q: Pairwise only, or pairwise + family groups? → **Family groups** (Option B from screen 01).
- Q: Symmetric, directional, or both? → **Both, encoded in the type.**
- Q: Soft nodes for un-built family members? → **No** — every family member is a full persona.
- Q: How granular is "type"? → **Categorized + granular**, with friendship as an 8-rung ladder.
- Q: Where does closeness live? → **Folded into type** for friendship; structured `status` covers the rest.
- Q: Where does this live in the app? → **Top-bar tabs** with the graph view stubbed as "soon".

## 13. Reviewer checklist

When reviewing this spec, confirm:

- [ ] The data model captures what you want to express (especially `family_members.parent_member_ids` + `generation` for the tree)
- [ ] The type taxonomy covers your real cases (or notes which custom ones you'd add)
- [ ] The relationship-detail narrative blocks are the right set (none missing, none redundant)
- [ ] The migration story (down -v vs. manual SQL) is acceptable for your single-user local setup
- [ ] Deferring the graph view is OK for this round
