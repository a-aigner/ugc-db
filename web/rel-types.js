/* ============================================================
   Relationship type catalog — the single source of truth for
   category → type → label/direction mapping.

   Each entry:
     {
       key:              "best_friend",         // stored in relationships.type
       label:            "Best friend",         // shown when viewing from the "from" side
       category:         "friendship" | "family" | "romantic" | "professional" | "other",
       directional:      false,                 // if true, the label flips
       inverse_label:    "Mentee",              // shown on the "to" side (directional only)
       friendship_level: 5,                     // 0-5 dot intensity (friendship only)
     }
   ============================================================ */
(function () {
  const TYPES = [
    // friendship — symmetric, with a closeness ladder
    { key: "best_friend",    label: "Best friend",     category: "friendship", directional: false, friendship_level: 5 },
    { key: "close_friend",   label: "Close friend",    category: "friendship", directional: false, friendship_level: 4 },
    { key: "good_friend",    label: "Good friend",     category: "friendship", directional: false, friendship_level: 3 },
    { key: "friend",         label: "Friend",          category: "friendship", directional: false, friendship_level: 2 },
    { key: "casual_friend",  label: "Casual friend",   category: "friendship", directional: false, friendship_level: 1 },
    { key: "acquaintance",   label: "Acquaintance",    category: "friendship", directional: false, friendship_level: 0 },
    { key: "familiar_face",  label: "Familiar face",   category: "friendship", directional: false, friendship_level: 0 },
    { key: "drifted",        label: "Drifted apart",   category: "friendship", directional: false },

    // family
    { key: "mother_child",   label: "Mother",          inverse_label: "Child",         category: "family", directional: true },
    { key: "father_child",   label: "Father",          inverse_label: "Child",         category: "family", directional: true },
    { key: "sister",         label: "Sister",                                          category: "family", directional: false },
    { key: "brother",        label: "Brother",                                         category: "family", directional: false },
    { key: "sibling",        label: "Sibling",                                         category: "family", directional: false },
    { key: "grandparent",    label: "Grandparent",     inverse_label: "Grandchild",    category: "family", directional: true },
    { key: "aunt_uncle",     label: "Aunt/Uncle",      inverse_label: "Niece/Nephew",  category: "family", directional: true },
    { key: "cousin",         label: "Cousin",                                          category: "family", directional: false },
    { key: "in_law",         label: "In-law",          inverse_label: "In-law",        category: "family", directional: true },
    { key: "step_parent",    label: "Step-parent",     inverse_label: "Step-child",    category: "family", directional: true },
    { key: "chosen_family",  label: "Chosen family",                                   category: "family", directional: false },

    // romantic
    { key: "crush_on",       label: "Crush on",        inverse_label: "Crushed on by", category: "romantic", directional: true },
    { key: "situationship",  label: "Situationship",                                   category: "romantic", directional: false },
    { key: "dating",         label: "Dating",                                          category: "romantic", directional: false },
    { key: "partner",        label: "Partner",                                         category: "romantic", directional: false },
    { key: "engaged",        label: "Engaged",                                         category: "romantic", directional: false },
    { key: "spouse",         label: "Spouse",                                          category: "romantic", directional: false },
    { key: "ex_partner",     label: "Ex-partner",                                      category: "romantic", directional: false },
    { key: "unrequited",     label: "Unrequited",      inverse_label: "Unaware",       category: "romantic", directional: true },
    { key: "affair",         label: "Affair",                                          category: "romantic", directional: false },

    // professional
    { key: "mentor",         label: "Mentor",          inverse_label: "Mentee",        category: "professional", directional: true },
    { key: "manager",        label: "Manager",         inverse_label: "Report",        category: "professional", directional: true },
    { key: "teacher",        label: "Teacher",         inverse_label: "Student",       category: "professional", directional: true },
    { key: "colleague",      label: "Colleague",                                       category: "professional", directional: false },
    { key: "business_partner", label: "Business partner",                              category: "professional", directional: false },
    { key: "client",         label: "Client of",       inverse_label: "Provides for",  category: "professional", directional: true },
    { key: "collaborator",   label: "Collaborator",                                    category: "professional", directional: false },
    { key: "rival",          label: "Rival",                                           category: "professional", directional: false },
    { key: "competitor",     label: "Competitor",                                      category: "professional", directional: false },

    // other / social
    { key: "neighbor",       label: "Neighbor",                                        category: "other", directional: false },
    { key: "roommate",       label: "Roommate",                                        category: "other", directional: false },
    { key: "online_only",    label: "Online-only",                                     category: "other", directional: false },
    { key: "fan_of",         label: "Fan of",          inverse_label: "Has fan",       category: "other", directional: true },
    { key: "frenemy",        label: "Frenemy",                                         category: "other", directional: false },
    { key: "antagonist",     label: "Antagonist",                                      category: "other", directional: false },

    // user-extensible
    { key: "custom",         label: "Custom",          category: "other", directional: false },
  ];

  const BY_KEY = Object.fromEntries(TYPES.map((t) => [t.key, t]));

  const CATEGORIES = [
    { key: "friendship",   label: "Friendship",   description: "From a barely-known face to a best friend." },
    { key: "family",       label: "Family",       description: "Blood, legal, or chosen." },
    { key: "romantic",     label: "Romantic",     description: "From a crush to a spouse to an ex." },
    { key: "professional", label: "Professional", description: "Mentorship, management, collaboration, rivalry." },
    { key: "other",        label: "Other",        description: "Neighbors, roommates, online-only, fans, frenemies." },
  ];

  const STATUS_OPTIONS = [
    { key: "active_close",       label: "Active & close" },
    { key: "active_complicated", label: "Active & complicated" },
    { key: "drifted",            label: "Drifted apart" },
    { key: "estranged",          label: "Estranged" },
    { key: "ended",              label: "Ended" },
  ];

  const CADENCE_OPTIONS = [
    { key: "daily",   label: "Daily" },
    { key: "weekly",  label: "Weekly" },
    { key: "monthly", label: "Monthly" },
    { key: "rarely",  label: "Rarely" },
    { key: "never",   label: "Never" },
  ];

  /* Render the appropriate label for a relationship when viewed from `personaId`.
     If you're on the FROM side and the type is directional, you see `label`.
     If you're on the TO side and the type is directional, you see `inverse_label`.
     Symmetric types always show `label`.
     Custom types show `customLabel` if provided. */
  function relationshipLabel({ type, customLabel, isDirectional, asFromSide }) {
    if (type === "custom" && customLabel) return customLabel;
    const t = BY_KEY[type];
    if (!t) return type;
    if (isDirectional && !asFromSide && t.inverse_label) return t.inverse_label;
    return t.label;
  }

  function typesByCategory(catKey) {
    return TYPES.filter((t) => t.category === catKey && t.key !== "custom");
  }

  Object.assign(window, {
    REL_TYPES: TYPES,
    REL_TYPES_BY_KEY: BY_KEY,
    REL_CATEGORIES: CATEGORIES,
    REL_STATUS_OPTIONS: STATUS_OPTIONS,
    REL_CADENCE_OPTIONS: CADENCE_OPTIONS,
    relationshipLabel,
    typesByCategory,
  });
})();
