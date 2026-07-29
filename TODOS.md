# TODOS

Deferred work, captured with enough context to pick up cold.

---

## Retire the 8 dead VR spike routes

**What:** Delete `/vr-simple`, `/vr-bundled`, `/vr-esm`, `/vr-pure-html`,
`/vr-standalone`, `/vr-debug`, `/vr-diagnostics`, `/vr-component-test` and their
view files.

**Why:** All 8 are abandoned WebXR experiments from before `vr-working.html` won.
All are still routed and served behind auth. During the 2026-07-29 eng review an
independent reviewer cited them as evidence of this codebase's failure pattern:
infrastructure that never gets a second consumer. One of them
(`views/vr-solar-system.html:166`) also pulls a third Three.js version
(`three@0.160.0` from unpkg), which is why the runtime audit initially missed a
version and reported two instead of three.

**Pros:** Eight fewer routes. One fewer Three.js version in tree. Addresses the
pattern rather than repeating it.

**Cons:** They are reference material for WebXR approaches that were tried and
abandoned. Git history preserves them, but you have to know to go looking.

**Context:** Routed in `app-enhanced.js:215-235`. `vr-working.html` is the only
VR page actually in use — both `/vr-solar-system` and `/vr-working` serve it, and
`/vr-ride` serves it too with the ride launcher scoped by URL.

**Depends on / blocked by:** Nothing. Independent of the game layer.

---

## Split routes/simulator.js properly, once tests exist

**What:** Break the 1782-line router into `models/`, `services/` and thin route
handlers.

**Why:** It currently holds four Mongoose schemas, the gamification engine,
orbital math, community scenarios (share/like/comment) and the Gemini chatbot.
The 2026-07-29 eng review chose the narrow option (extract only what the game
layer touches) purely because there was no test suite to verify a wider refactor.
That review also added Vitest, so the blocker is being removed.

**Pros:** `UserScore` stops being owned by a file named after one feature while
four features depend on it. The chatbot stops living in a simulator router. New
contributors find things where they expect them.

**Cons:** Large diff on working code. The community-scenario and chatbot paths
need coverage first, or the split is still unverified — just verified-adjacent.

**Context:** Schemas at `:20` (simulation), `:84` (userScore), `:121`
(scenarioHistory), `:159` (sharedScenario). Gamification `:285-370`. Orbital math
`:250-283` and `:1634-1700`. Community scenarios `:1168-1449`. Chatbot
`:1450-1633`.

**Depends on / blocked by:** Vitest harness landing first, plus coverage for the
chatbot and community-scenario paths.

---

## Playwright E2E for the 7 browser flows

**What:** Playwright specs for full mission run, fail-retry, offline save badge,
queue flush, and the simulator leaderboard regression.

**Why:** The eng review's test decision covers logic and API but leaves 18 user
flows manual, including the offline-finish path — the single most important flow
at an expo and the hardest to verify by hand.

**Pros:** Covers the flows that matter most in the room where you demo. Catches
the simulator leaderboard regression automatically instead of by memory.

**Cons:** Puppeteer's bundled Chrome has no working WebGL on this machine;
Playwright's chromium binary is the known workaround. WebGL-dependent specs need
that binary pinned, which is real setup friction.

**Context:** Seven flows are marked `[→E2E]` in the coverage diagram in the
2026-07-29 eng review. Pinned binary:
`C:\Users\mahendhar\AppData\Local\ms-playwright\chromium-1228\chrome-win64\chrome.exe`.

**Depends on / blocked by:** The Vitest harness landing first. Sequence after the
missions are playable so specs are written against real flows, not imagined ones.
