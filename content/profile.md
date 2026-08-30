<!-- BUILD COPY. Canonical source: planning/profile.md. Keep in sync until Phase 1.
     The Music deep-dive + inputs/ refs are trimmed at assembly time (lib/brain/prompt.ts). -->

# Profile — Calliad

*Standing facts the assistant should know about Noah without being told.
One fact per line. `(confirm?)` marks something still inferred rather than stated.
Blank lines are gaps no source has covered yet.*

*Sources: noaht425.github.io, course-schedule screenshot, PhD.xlsx, favorites/playtime lists,
Spotify playlists, `inputs/preferences-summary-from-claude.md`, and direct from Noah (2026-08-29).*

**Pending inputs (to fold in when they arrive):**
- **Spotify full data export** — completes the middle of the "Noah" playlist (~2022–2024 adds),
  which the playlist/screenshot pull didn't cover, plus play counts and full history.
- **Google Takeout** — Noah is downloading it; YouTube history / subscriptions / playlists will
  feed the Interests section (he uses YouTube a lot). Watch history is noisy, so subscriptions,
  likes, and saved playlists get weighted over raw watch logs.
- **LinkedIn** — login wall; paste the text if it should be included.

---

## Identity
- Full name: Noah Turner
- Email: noaht425@gmail.com
- Undergrad: Trinity College, Hartford, CT — senior
- Major: Classical Studies. Minor: English.
- GitHub: noaht425
- Websites: https://noaht425.github.io/ · LinkedIn: /in/noah-turner-00b842254/

## Health — and how it shapes the assistant
- Diagnosed with **ADHD, OCD, and anxiety**. (Private — Noah's own store; never surfaced to anyone else.)
- **Anosmia** — can't smell, so most flavour doesn't come through. Doesn't drink coffee, tea, or
  alcohol (no point). Affects food/restaurant suggestions: aroma-forward recommendations are
  wasted, wine/pairing features are moot, and "too spicy" is unpleasant with no aromatic payoff.
- **Allergic to dogs and cats** (not food). Relevant for lodging, and visiting people with pets.
- Recurring **counseling appointment, Wednesdays 3:45 PM, starting Sep 16, 2026**.
- Takes a **daily medication**. Has an 11:00 AM Apple Reminders entry for it, but **it doesn't
  work — he never marks it done**, so the checkbox is meaningless and the item just sits overdue.
  → Calliad should handle this as an *active check-in* ("did you take your meds?") that doesn't
  depend on him ticking anything, and should ignore the state of the Apple reminder.
- What this means for how Calliad should work:
  - **Reminders and next-action nudges are load-bearing**, not a nice-to-have. Externalize
    deadlines. Surface the *single next action*, not a wall of everything. Help with
    time-blindness ("you need to leave in 25 minutes").
  - **Answer factual "did I / is it" questions once**, clearly, and don't invite a re-check
    loop. Don't over-flag low-stakes things.
  - **Keep nudges calm and matter-of-fact.** No "URGENT," no "you're behind," no catastrophizing.
    Every nudge is a manageable next step, not a countdown.
  - Recurring self-care items (gym + PT, medication) tend to slip. Re-surface them gently, once,
    without piling on.

## Academics — current
- Class schedule Fall 2026 (full table in `inputs/course-schedule-fall2026.md`):
  - ANTH-222-01 Voodoo — Landry — TR 6:30–7:45 PM — MC-225
  - CLCV-390-01 New Troy — Staples — TR 10:50 AM–12:05 PM — HL-123
  - CLCV-401-01 Senior Seminar/Special Topics — Tomasso — W 6:30–9:00 PM — MC-313
  - LATN-201-01 Latin in Roman Daily Life — Brown — TR 1:30–2:45 PM — HL-121
  - Greek course — time TBD (schedule is incomplete until this is set)
- Senior thesis (proposal stage): **the use of dice in ancient Rome**
- **Fall 2026 term: classes Sep 8 – Dec 14; finals Dec 17–23.** Full calendar + senior-year
  milestones in `inputs/trinity-academic-calendar-2026-27.md`. Flags: **Oct 26** degree-application
  deadline for May 2027 grads; **Oct 12–13** Trinity Days; **Nov 24–29** Thanksgiving; possible
  **May 6–7** senior general exams; **May 23, 2027** Commencement.
- Research / academic work:
  - Pottery analysis & cataloguing at Isthmia, Greece — 7th–4th c. BCE pottery from the Ancient Corinth graveyard. **Wrapping up now (Aug 2026).**
  - Citation verification + source translation for *Roman Slavery and Emotional Labor* (forthcoming) — with Prof. Sarah Levin-Richardson (Univ. of Washington)
  - Collaborative work on classical epic with Prof. Vincent Tomasso
  - RA to Prof. Martha Risser; TA and Classical Studies department ambassador at Trinity

## Academics — focus / area
- **Core interest: the reception and adaptation of Classics** — how the ancient world gets
  reimagined in modern media, **especially games** (video games, board games, D&D).
- *Not* narrowly specialized — happy studying Greek and Roman culture broadly; loves mythology;
  cites *Percy Jackson*-style engagement with the fantastical side of Classics as a genuine
  touchstone, not just a research angle.
- Secondary: archaeology / material culture (the Isthmia fieldwork) and Roman social history.

## Academics — PhD applications
- Applying to Classics PhD programs, **Fall 2026 application cycle** (entry Fall 2027). Tracking sheet: `~/Desktop/PhD.xlsx`.
- Considering **both US and UK** programs. Schools in the sheet: Oxford, Cambridge, Yale, Harvard (Classical Philology / Philosophy), Princeton, Stanford, Chicago, Michigan, UC Berkeley, Columbia, UPenn, Brown, Notre Dame, Washington, Toronto, Edinburgh, St Andrews, Durham, Bristol, UCL.
- Most portals open Sept–Oct 2026; several UK programs are rolling.
- How Noah evaluates programs (from the PhD.xlsx work):
  - Wants tuition / funding / cost-of-living from **official pages**, cross-checked against real-world indicators (rent, groceries, transit) — not taken at face value.
  - "How respected a program is" = how a **hiring committee** would view the degree, not raw brand prestige. Will push back on a ranking (e.g. QS) when it conflicts with firsthand knowledge.
  - Cares about scoring/weighting methodology being right.
  - Will trade some prestige for genuine quality-of-life and location fit, within reason.

## Work — Trinity Admissions
- Paid job in the **Admissions building**: runs **info sessions** for prospective and accepted
  students, and **interviews** them. Mostly in person; some interviews are **virtual, and he
  sets his own hours** for those.
- **~10 hours/week.** Specific weekly hours not assigned yet.
- **Alternating Saturdays** (which set — TBD).
- Required to work **one set of Trinity Days — the spring ones: Feb 25–26, 2027.**
- **Timesheet every other Sunday**, starting **Aug 30, 2026** (already submitted). So: Sep 13,
  Sep 27, Oct 11, Oct 25, Nov 8, Nov 22, Dec 6, Dec 20… Paid the **Friday five days after** each
  submission (Sep 4, Sep 18, Oct 2, Oct 16, …).
- Good candidates for Calliad: the biweekly Sunday timesheet reminder, and knowing paydays land
  the following Friday.

## Languages
- Latin: advanced — Classics major, daily translation, taking LATN-201.
- Italian: **intermediate** — knows it notably better than Greek; wants idioms / natural phrasing (localize, don't transliterate) and conversation practice in Italian.
- Attic Greek: lower-intermediate — translates regularly but weaker than Italian. Taking a Greek course this term.
- French: basic reading comprehension.
- German: basic reading comprehension.
- Korean: very small amount.
- General: for Latin/Greek wants conjugation/declension lookups and parsing, **tool-backed** (see PLAN.md morphology idea). Correct me rather than let errors slide.

## Food
- No food allergies.
- **Dislikes:** olives, asparagus, roasted vegetables, and anything too spicy.
- **No coffee, tea, or alcohol** — anosmia (see Health), so the flavour doesn't land.
- Favorites: ramen / Japanese food, pho, Italian food. Leans Vietnamese / Japanese / Chinese
  (dim sum) / Italian — noodle soups and dumplings (pho, ramen, soup dumplings, ravioli).
  (Texture, broth, and umami over aroma — consistent with the anosmia.)

## Geographic / location
- Hometown: **Kirkland, WA** (Seattle area); family is there — PNW is his most-preferred region.
  Drives when he's home; no car at school.
- At Trinity (Hartford) he **walks everywhere** — campus is ~10 min end to end.
- Girlfriend Annalee lives in **NYC** — he travels there often, usually flying in/out of a NYC
  airport rather than Hartford so he can spend the extra time with her.
- Many friends and some family on the **East Coast** — also a strong preference.
- Does **not** want distance from home to weigh heavily in decisions — loves Edinburgh and would
  happily live there despite the distance.
- Values in a city: good food access, a real board-game / hobby-store scene (cited Mox Boarding
  House, Seattle), walkability, parks / green space.

## Travel preferences
- **Airports:** SEA on the PNW end. On the East Coast, prefers routing through a **NYC airport**
  (JFK / LGA / EWR) over Hartford/BDL, to get NYC time with Annalee.
- **Airlines:** likes **Alaska**; has flown Delta and American fine. **Avoid Lufthansa** (bad
  experiences).
- **Seat:** strongly prefers an **aisle**.
- **Times:** would rather avoid anything departing **midnight–9 AM**, but will take it if it's
  meaningfully cheaper.
- **Stops:** nonstop preferred. One stop is acceptable on a long trip; multiple stops, no.
- **Bags:** usually carry-on + underseat bag. Checks a bag only for longer trips / more stuff.
- **Budget:** aim for **≤ $800 round-trip**; flexible if needed.

## People
*Name — relationship — birthday — notes. Default gift budget ≈ **$100**.*
- Doug Turner — Dad — Feb 10
- Sonia Savelli — Mom — Jan 20
- Julia Turner — Sister — Jan 26
- Matt Klineman — Brother-in-law — Oct 30
- Annalee Debenport — Girlfriend (together since Dec 8, 2019 — that's the anniversary) — Nov 15
- Sam Ehlers — Friend — Nov 18
- Kai Brown — Friend — Oct 3
- Aanya Devburman — Friend — Dec 26
- Loretta Garcia — Friend — Feb 8
- Khai Christy-Stadlebauer — Friend — May 4 — pronouns: **any, mostly they/them**
- Jack Savelli — Cousin — Apr 27
- Jessica Brine — Cousin — Apr 20
- Sydney Ruth — Friend — Sep 30 — pronouns: **they/them**
- Isabelle Kohler — Friend — Jul 28
- Xiaowei Elias — Friend — Jun 30
- Malia Ruggiero — Friend — Jul 20
- Trish Gross — Sam Ehlers's mom — Nov 4
- Sue Turner — Aunt — Nov 21
- Ria Mehra — Friend — Feb 28
- Yuri Brine — Jessica Brine's daughter — Jul 31
- Annika Bjornstad — Friend — Jul 15
- Grandma — Jul 5
- Anya Nishanova — Friend — Aug 9
- Nick Diaconou — Friend — Mar 1
- Callie Bao — Friend — Jun 26
- Lori Gervais — Aunt — Feb 23
- Alex Savelli — Cousin — Dec 5
- Aru Mynbayeva — Friend — Oct 25
- Sylvia — Friend — Jul 19
- Judy Traboulsi — Friend — Apr 21

*Pronouns: Sydney → they/them; Khai → any (mostly they/them); everyone else he/him or she/her
as fits the person.*

## Recurring commitments
- **Counseling — Wednesdays 3:45 PM, starting Sep 16, 2026** (recurring).
- Classes: see Academics — current.
- Personal-admin reminders Noah keeps (from Apple Reminders): shut down computer every 2 weeks,
  pay credit card monthly, gym + PT every ~2 days, plus dated one-offs to cancel subscriptions
  before they renew (YouTube Premium, Prime).
- **Admissions job** (see Work): alternating Saturdays, ~10 hrs/week, biweekly Sunday timesheet
  (next: Sep 13), plus required work on spring Trinity Days (Feb 25–26, 2027).
- **D&D:** no fixed weekly cadence — sessions get scheduled around whoever's free. But some
  upcoming D&D things *will* have set times; add them as they're confirmed.

## Daily rhythm
- Left to his own devices: **bed around midnight, up around 9:30**. The whole schedule shifts
  around whatever time he actually has to be up.
- Bi-coastal time zones: Eastern during term (Hartford / NYC), Pacific at home (Kirkland). He
  sets reminders with explicit time zones because of this.
- **Do not disturb 1:00–7:00 AM** (local). Nothing in that window unless it's genuinely urgent.

## Projects & tools
- **Task manager: Apple Reminders.** Heavy user (5,800+ completed). Uses `!!` / `!!!` priority
  flags, timezone-stamped times, and lots of recurrence (daily, every 2 days, biweekly, monthly,
  yearly). Recurring self-care items sometimes go overdue. → Calliad should integrate with
  Apple Reminders rather than introduce a new to-do system (integration path TBD — see
  PLAN.md §11). Usage notes: `inputs/reminders-app-usage.md`.
- **A Bent Fork** (abentfork.com) — family recipe / meal-planning site, rebuilt from an old
  WordPress site (Next.js / Supabase / Vercel).
- **Project Vault** — self-designed D&D campaign-notes workspace (desktop + cloud + PWA).
- **MTG simulator** — Commander-deck simulation tool built in a Claude Cowork session.
- **Calliad** — this project.
- **Music transcription** — freelance, in MuseScore; has a published orchestral arrangement on
  Hal Leonard.
- Tools: GitHub (noaht425); a Linear project for A Bent Fork (ABF team).

## Interests (non-academic)
- Tabletop: **D&D** and **Magic: the Gathering** are central. Also Coup. Values a good local game store.
- Actual-play / TTRPG media: Dimension 20, Game Changer, Worlds Beyond Number, The Newest Olympian, Command Zone.
- Video games: heavy on 4X/strategy (Civilization), roguelikes (Hades I/II, Slay the Spire), CRPGs (Baldur's Gate 3 — 800+ hours).
- Greek myth runs through the fiction taste (Percy Jackson, *Song of Achilles*, *Circe*, *Katabasis*) — overlaps the academic focus.
- For "would I like this?": Noah rarely *hates* things, he **bails from boredom**. Turn-offs are
  non-evolving repetition, a steep sprawling learning curve with no mental model to hang it on,
  myth retellings that break canon/characterization (flag big liberties), and gratuitous
  character descriptions. Details + the negatives list in `taste-log.md`.
- Full favorites in `inputs/favorites.md`; playtime in `inputs/game-playtime-2026-08.md`.

### Music (from 5 playlists, 2026-08-29 — `inputs/spotify-playlists-2026-08.md`)

**There's a clear trajectory over the ~586-song main playlist ("Noah"):**

- **Older core** (adds through ~2023): anthemic, radio-friendly pop-rock / alt-pop / EDM-pop.
  OneRepublic, Bastille, AJR (heavily), Imagine Dragons, Livingston, ILLENIUM, The Chainsmokers,
  Avicii, X Ambassadors, Andy Grammer, Alec Benjamin. Big choruses, "keep going" themes.
- **Recent adds** (2025–2026) shift toward **literary indie-folk and narrative music**:
  - *Chamber / mythic folk:* The Oh Hellos, The Crane Wives, Yaelokre, Vian Izak, Juniper Vale,
    The Head and the Heart, Radical Face, Run River North, Gang of Youths ("Achilles Come Down").
  - *Myth-driven musical theatre* — and these are all **Greek myth**: **EPIC: The Musical**
    (Odyssey — "God Games," "We'll Be Fine"), **Hadestown** (Orpheus — "Wait for Me," "Chant"),
    **The Lightning Thief** musical ("Take the Weight"). Plus *The Greatest Showman*, Hazbin Hotel.
  - *TTRPG / story-song / "bardcore":* Colm R. McGuinness ("Bottom of the Bottle," "Tavern Crawl"
    — Inspired-by-D&D), Fish in a Birdcage (the "Rule #" series), "Three Kobolds in a Trenchcoat,"
    Janani K. Jha, PEGGY.
  - *Current favorite artists* (by frequency in recent adds): **The Astronomers, Alex Warren,
    ISHAN, John Michael Howell**, plus Vinny Marchi, Aimee Carty, Marino, Raynes.
  - *Italian-language pop* creeping in (tracks the Italian study): Pinguini Tattici Nucleari,
    Federico Rossi, Damiano David.
  - Some nostalgic 2000s rock too: Goo Goo Dolls, MCR, Fall Out Boy, Rolling Stones.
- **The Arcane soundtrack is the constant** across both eras and every playlist.

**Playlists are built around a concept or mood:**
- **"Pirates"** (27) — sea shanties + Celtic/Irish folk (Nathan Evans, Colm R. McGuinness, Home Free). Says the kick is fading.
- **"Theros Aestathis"** (48) — a **D&D character** playlist (name = the Greek-myth *Magic* plane). Fiery, proud, villain-swagger: Barns Courtney, bbno$, Måneskin, The Offspring, "It's Tough to Be a God."
- **"Just in Case"** (9) — his **stress / calm-down** playlist (ADHD/anxiety). Soft folk-pop: SAINT PHNX "Happy Place," "You Will Be Okay (Stolas' Lullaby)," LAUV, Jonah Kagen, The Oh Hellos.

**Through-line:** the music tracks the same interests as everything else — Greek myth, TTRPG,
narrative. Light on hip-hop, country, metal, jazz.

**Caveat:** the middle of the main playlist (~2022–2024 adds) is still unseen; the pending
Spotify export will complete it.

## Working style (how Noah likes to collaborate)
- When handed a formula / config / SQL / command change, prefers being given the **literal text
  to paste himself** over invisible edits made on his behalf.
- Wants sources cited and numbers cross-checked, not asserted.
- Fine questioning an authoritative source when it conflicts with what he knows firsthand.
- On his personal academic site: wanted a "classic academic manuscript" aesthetic; academic
  content primary, side projects understated.
