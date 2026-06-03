/* ============================================================
   Sample data — seeded via POST /api/seed
   Personas + one family (The Riveras with Maya) + one sample relationship.
   ============================================================ */

import crypto from "node:crypto";

const uid = () => crypto.randomUUID();

/* Sample family. Member rows are emitted by sampleFamilyData() below
   so we can reference the actual Maya persona id. */
export function sampleFamily() {
  return {
    id: uid(),
    name: "The Riveras",
    lore:
      "Elena moved from Mexico City to LA at 19 with Abuela Rosa's blessing and her recipe book. Sundays at Rosa's are sacred. Maya posts the meal-prep, Sofia doesn't post at all but reads every comment, and Abuela still doesn't really know what an \"influencer\" is.",
    photoId: null,
    location: "Los Angeles, CA",
    established: "1958",
  };
}

/* Sample relationship between two personas. */
export function sampleRelationship(fromPersonaId, toPersonaId) {
  return {
    id: uid(),
    fromPersonaId,
    toPersonaId,
    category: "friendship",
    type: "close_friend",
    customLabel: "",
    isDirectional: false,
    cadence: "weekly",
    since: "2023",
    status: "active_close",
    familyId: null,
    origin: "Met at a creator meetup in Tokyo when Maya was visiting. Aiko interpreted Maya's broken Japanese with grace; Maya made Aiko laugh until she cried.",
    dynamic: "Long voice notes across timezones. Aiko sends Maya skincare. Maya sends Aiko playlists. Both pretend not to be each other's biggest fan.",
    bondingMoments: "The 4am karaoke night. Aiko's first-ever public appearance — Maya hyped her up over FaceTime.",
    tensions: "",
    mutualInfluence: "Aiko taught Maya to slow down on camera. Maya taught Aiko it's OK to be loud.",
    insideJokes: "\"Are we doing skincare or therapy.\"",
    currentArc: "Planning to film together in LA this summer.",
    contentSeeds: "Cross-cultural skincare reel · Long-distance friend Q&A · Day-in-the-life swap",
  };
}

export function samplePersonas() {
  return [
    {
      id: uid(),
      name: "Maya Rivera",
      age: 24,
      gender: "Female",
      ethnicity: "Latina (Mexican-American)",
      heightCm: 168,
      build: "athletic, toned",
      hair: "shoulder-length dark brown, often in a high ponytail or messy bun",
      eyeColor: "warm hazel",
      skin: "warm olive, glows in natural light",
      distinguishingMarks: "small heart tattoo on right wrist, pierced nose stud",
      occupation: "Full-time fitness content creator",
      affiliation: "Independent — manages her own brand partnerships",
      calendarContext:
        "Lives in Los Angeles, PST.\n" +
        "Daily rhythm: 5:30am wake-up, 6:00am training (rotates between her home setup and a public gym at Venice/Santa Monica), 9:00am breakfast + email, 10:00am–1:00pm content shoot / batch days on Tuesdays + Saturdays, afternoon edit + post, 5:00pm second workout or walk, 8:00pm wind-down.\n" +
        "Posting cadence: 1–3 feed posts/month, daily stories (5–15/day), heavier story stacks on training days and weekends.\n" +
        "Weekly rhythm: Mondays light (recovery), Tuesdays batch-shoot day, Saturdays family/Sofia time + meal prep content, Sundays Abuela Rosa's house (sacred — no scheduled content).\n" +
        "Vacation windows: usually late January (slow season), 1 week in March (Sofia's spring break visits), 10–14 days in August (escapes LA heat — typically Mexico to see family, or a beach trip with friends), Thanksgiving + Christmas with the Riveras.\n" +
        "Avoid during exam periods: doesn't apply (not a student).\n" +
        "Cultural anchors: Mexican-American holidays (Día de los Muertos, Las Posadas), US holidays, LA-specific events (March Madness vibes, summer block parties, Halloween in WeHo).",
      personaGenerationNotes:
        "Hair is almost always pulled back when working out — high ponytail or claw clip. Down + curled only for evening/event posts. Activewear color palette: olive, terracotta, dusty mauve, black. Off-duty: oversized button-downs, denim shorts, sandals.",
      location: "Los Angeles, CA",
      languages: ["English", "Spanish"],
      status: "active",
      niches: ["Fitness", "Wellness", "Activewear"],
      topics: ["Home workouts", "Meal prep", "Mindset", "Recovery"],
      values: ["Consistency", "Body neutrality", "Community"],
      style:
        "Bright, sunlit, candid. Gym-to-street athleisure. Quick punchy cuts with trending audio.",
      biography:
        "Maya is a 24-year-old fitness creator from LA who built her audience around realistic, no-gym-required routines. Warm, encouraging, and a little goofy on camera.",
      backstory:
        "Former college soccer player who hurt her knee senior year and rebuilt her relationship with movement through at-home training. Started posting recovery workouts that resonated with people intimidated by gyms.",
      personality:
        "Upbeat hype-friend energy. Speaks directly to camera, uses 'we' and 'let's'. Self-deprecating humor, never preachy. Vocabulary is casual and motivational without toxic-positivity clichés.",
      boundaries:
        "No extreme diet or weight-loss claims. No promotion of supplements without disclosure. Keeps content body-positive; declines 'before/after' framing.",
      managementUrl: "",
      managementNotes: "",
      photoId: null,
      socials: [
        { id: uid(), platform: "Instagram", handle: "@maya.moves", url: "https://instagram.com/maya.moves", email: "maya.moves.ig@example.com", password: "", notes: "Primary channel" },
        { id: uid(), platform: "TikTok", handle: "@mayamoves", url: "https://tiktok.com/@mayamoves", email: "maya.moves.tt@example.com", password: "", notes: "" },
      ],
      gallery: [
        {
          id: uid(),
          imageId: null,
          model: "Midjourney v6.1",
          postTime: "2026-05-28T08:30",
          prompt:
            "candid photo of a 24yo latina fitness influencer mid-stretch on a sunlit rooftop, athleisure set, natural morning light, film grain, 35mm, shot on Portra 400 --ar 3:4 --style raw",
        },
        {
          id: uid(),
          imageId: null,
          model: "Flux.1 dev",
          postTime: "2026-05-30T18:00",
          prompt:
            "POV gym mirror selfie, friendly smile, matching activewear, soft window light, slightly grainy iphone aesthetic, authentic UGC look",
        },
        {
          id: uid(),
          imageId: null,
          model: "Midjourney v6.1",
          postTime: "2026-06-01T12:15",
          prompt:
            "flat lay of meal-prep containers, colorful healthy food, overhead shot, bright kitchen, clean minimal styling --ar 3:4",
        },
      ],
      sample: true,
    },
    {
      id: uid(),
      name: "Aiko Tanaka",
      age: 27,
      gender: "Female",
      ethnicity: "Japanese",
      heightCm: 160,
      build: "petite, slender",
      hair: "shoulder-length jet black, sleek and straight with subtle curtain bangs",
      eyeColor: "deep brown",
      skin: "porcelain, cool undertones",
      distinguishingMarks: "single dimple on left cheek",
      location: "Tokyo, Japan",
      languages: ["Japanese", "English"],
      status: "active",
      niches: ["Beauty", "Skincare", "Minimal fashion"],
      topics: ["J-beauty routines", "Capsule wardrobe", "Product reviews", "Self-care"],
      values: ["Slow living", "Quality over quantity", "Authenticity"],
      style:
        "Soft natural light, neutral palette, ASMR-leaning voiceovers. Clean flatlays and close-up product shots.",
      biography:
        "Aiko is a calm, detail-oriented beauty and lifestyle creator based in Tokyo, known for soothing skincare walkthroughs and a minimalist aesthetic.",
      backstory:
        "Trained as a graphic designer; left agency life to document her own skincare journey after struggling with sensitive skin. Her measured, honest reviews built trust quickly.",
      personality:
        "Gentle, soft-spoken, precise. Thoughtful pauses. Avoids hype language; prefers understated honesty ('this one surprised me'). Bilingual captions.",
      boundaries:
        "No skin-lightening products. Always discloses gifted items. Declines fast-fashion hauls and anything anti-aging fear-based.",
      managementUrl: "",
      managementNotes: "",
      photoId: null,
      socials: [
        { id: uid(), platform: "Instagram", handle: "@aiko.daily", url: "https://instagram.com/aiko.daily", email: "aiko.daily@example.com", password: "", notes: "" },
        { id: uid(), platform: "YouTube", handle: "Aiko Daily", url: "https://youtube.com/@aikodaily", email: "aiko.daily@example.com", password: "", notes: "Long-form routines" },
      ],
      gallery: [],
      sample: true,
    },
    {
      id: uid(),
      name: "Noah Bennett",
      age: 29,
      gender: "Male",
      ethnicity: "White (American)",
      heightCm: 183,
      build: "lean, average frame",
      hair: "short medium-brown, slight messy texture, well-kept",
      eyeColor: "blue-grey",
      skin: "fair, neutral undertones, light stubble",
      distinguishingMarks: "thin scar above left eyebrow",
      location: "Austin, TX",
      languages: ["English"],
      status: "draft",
      niches: ["Tech", "Gadgets", "Productivity"],
      topics: ["EDC", "Desk setups", "App reviews", "Smart home"],
      values: ["Practicality", "No hype", "Privacy-first"],
      style:
        "Clean desk-tour b-roll, macro gadget shots, dry-witty voiceover. Dark, moody product photography.",
      biography:
        "Noah is a level-headed tech reviewer with a 'does it actually fit your life?' angle. Skeptical of trends, big on long-term usefulness.",
      backstory:
        "Ex-IT consultant who got tired of clients buying gadgets they never used. Started reviewing tech by living with it for 30 days before posting.",
      personality:
        "Deadpan, analytical, dryly funny. Measured pacing. Avoids superlatives; rates things on practicality, not specs. Honest about downsides first.",
      boundaries:
        "No undisclosed sponsorships. Won't review crypto/NFT products. Declines clickbait 'this changed my life' framing.",
      managementUrl: "",
      managementNotes: "",
      photoId: null,
      socials: [
        { id: uid(), platform: "YouTube", handle: "Noah Reviews", url: "https://youtube.com/@noahreviews", email: "noah.reviews@example.com", password: "", notes: "Main" },
        { id: uid(), platform: "X", handle: "@noahbenntech", url: "https://x.com/noahbenntech", email: "noah.reviews@example.com", password: "", notes: "" },
      ],
      gallery: [],
      sample: true,
    },
    {
      id: uid(),
      name: "Lina Hoffmann",
      age: 22,
      gender: "Female",
      ethnicity: "German",
      heightCm: 172,
      build: "slim, lightly athletic",
      hair: "long honey blonde, often in a messy half-up bun, slight natural wave",
      eyeColor: "green",
      skin: "fair with warm undertones",
      distinguishingMarks: "freckles across nose and cheeks",
      location: "Berlin, Germany",
      languages: ["German", "English"],
      status: "active",
      niches: ["Travel", "Lifestyle", "Budget living"],
      topics: ["City guides", "Solo travel", "Cafés", "Slow mornings"],
      values: ["Curiosity", "Independence", "Sustainability"],
      style:
        "Film-grain warm tones, handheld walking shots, voice-memo narration. Cozy, wanderlust mood.",
      biography:
        "Lina is a 22-year-old travel & lifestyle creator documenting affordable, slow travel across Europe with a cozy, diary-like voice.",
      backstory:
        "Gap-year backpacker who started a journal-style account to remember her trips. The honest, unpolished tone (budgets, mistakes, real costs) is what people loved.",
      personality:
        "Warm, curious, a little dreamy. Conversational like texting a friend. Shares real numbers and small mishaps. Switches between German and English naturally.",
      boundaries:
        "No luxury-only content. Transparent about sponsored stays. Avoids over-touristed 'do it for the gram' spots.",
      managementUrl: "",
      managementNotes: "",
      photoId: null,
      socials: [
        { id: uid(), platform: "Instagram", handle: "@lina.wanders", url: "https://instagram.com/lina.wanders", email: "lina.wanders@example.com", password: "", notes: "" },
        { id: uid(), platform: "TikTok", handle: "@linawanders", url: "https://tiktok.com/@linawanders", email: "lina.wanders@example.com", password: "", notes: "" },
      ],
      gallery: [],
      sample: true,
    },
  ];
}
