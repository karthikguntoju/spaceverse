# Spaceverse

An interactive 3D and VR platform for exploring the solar system — with planet
quizzes, an eleven‑game arcade, live mission and space‑weather data, and an
AI‑assisted Space Traffic Simulator that models orbital congestion, collision
risk and the Kessler syndrome.

Everything runs in one browser tab. No install, no plugin.

## Features

- **3D Solar System Explorer** — Three.js planet models with textures, orbits and click‑through info
- **VR Solar System + Cockpit Ride** — WebXR, plus phone gyro / Google‑Cardboard stereo mode
- **Planet Quiz** — per‑body multiple choice with score tracking (AI‑generated questions when a Gemini key is set, curated bank otherwise)
- **The Arcade** — eleven self‑contained canvas games with medals and progression
- **Space Traffic Simulator** — set a launch / break‑up / collision scenario and see the change in orbital congestion, a 0–100 collision‑risk index, debris probability, and a safety / sustainability / efficiency score
- **Space Assistant** — ask space questions in plain English; answered by Gemini when configured, otherwise by a built‑in 45‑topic offline corpus
- **Mission Tracker & Launch Archive** — real agency missions and historic launch footage
- **Astronomical Events** — eclipse / meteor calendar with list and calendar views
- **Community** — share simulator scenarios, like and comment; star‑rated reviews with profanity filtering
- **Live data** — NASA DONKI space weather and CelesTrak catalogue counts feed the simulator

## Tech

- **Server**: Node.js ≥ 20, Express 4, `helmet`, `compression`, `express-rate-limit`
- **Data**: MongoDB (Mongoose) with a `planets.json` fallback when the DB is unreachable
- **Auth**: session‑based; bcrypt + Firebase for real accounts, or a passwordless demo mode
- **3D / VR**: Three.js, WebXR, `@react-three/fiber` + `@react-three/xr`
- **Astronomy**: `astronomy-engine` for ephemeris
- **AI**: `@google/genai` (Gemini) when a key is present; a local heuristic model + knowledge corpus otherwise
- **Tests**: Vitest + Supertest + `mongodb-memory-server` — 139 tests, `npm audit` clean

## Quick start

```bash
npm install
cp .env.example .env      # then edit .env (see below)
npm start
```

Open **http://localhost:5000**. In demo mode any callsign / access code signs you in.

| Script | What it does |
| --- | --- |
| `npm start` | Run the server (`app-enhanced.js`) on `PORT` (default 5000) |
| `npm run start:https` | Same, over HTTPS with a self‑signed cert — needed for **phone gyro / VR**, which browsers only allow on a secure origin. Prints a `https://<LAN-IP>:5000` URL for your phone; the cert is generated into `certs/` on first run. |
| `npm run dev` | Run with `nodemon` (reload on change) |
| `npm test` | Full Vitest suite |
| `npm run test:e2e` | The end‑to‑end smoke flow only |
| `npm run verify:vr` | Browser smoke check for desktop mouse, phone gyro, and phone split-screen (run while the server is up) |
| `npm run health-check` | Hit `/api/health` and report |
| `npm run migrate-atlas` / `migrate:scores` | One‑off data migrations |

## VR controls

- **Laptop:** Open `/vr-solar-system`, start free flight, drag the mouse to look, use W/A/S/D to fly, and click a planet to scan it. The same mouse look works in `/vr-ride`.
- **Phone without a viewer:** Open the site over HTTPS, tap **Gyro look**, then start free flight. Turn the phone to look, use **Fly forward / Stop flying** to move, and tap a planet to scan it. You can switch to **Split-screen VR** without restarting free flight or scan hunt.
- **Phone in a Cardboard-style viewer:** Tap **Phone VR**, rotate to landscape, and place the phone in the viewer. Turn your head to aim the centre pointer. Look well down (about **55°**) for **MENU**, then hold gaze for **1.4 seconds** to open **Fly/Stop** (or **Resume** in the game/ride), **Options**, **Recentre**, and **Close Menu**. The forward view has no control panels. Looking forward dismisses the menu; opening it stops flight and pauses the game/ride. Resume is always explicit. Look away to cancel or re-arm; menu changes also require looking away before another selection. Options offers Scan Hunt (outside a running mission), game/ride restart, and Exit Phone VR. Gaze at a world to scan it. Screen/viewer-button taps still work. Head aiming needs working gyro permission on a trusted secure origin; gaze does not bypass sensor restrictions. WebXR controllers keep their existing controls.
- **WebXR headset:** Enter VR from the launcher. The left thumbstick flies and the trigger scans. A phone viewer's Bluetooth remote is not a tracked WebXR controller.

### Cardboard lens layout and screen sleep

Phone VR draws matching top-bar controls and warnings in each eye. Floating buttons and status text use an eye-aligned overlay (no additional stereo disparity), while planets and planet scan markers retain stereo depth. Gaze targets remain anchored to the cabin, so turning your head still selects them. This is a software alignment fix, not a calibrated optical/distortion profile for a particular viewer; final fusion must be checked through the physical headset.

Cardboard defaults to larger **wide rounded** eye views (96% screen height), reducing the previous circular black corners. The circular shape remains selectable. Scene and UI use each viewport's actual aspect ratio, avoiding stretch. In **Cardboard lens fit**, adjust **Eye-centre spacing**, **View size**, and **Lens shape** outside the viewer. Settings are saved per browser/origin; **Reset lens fit** restores the larger defaults. Old v1 preferences migrate to the larger shape/size while preserving spacing. Values are screen percentages, not IPD millimetres. Width is limited to prevent overlapping eye images. UI textures are doubled in resolution with larger, higher-contrast text and no mipmap softening. This cannot correct optical focus or supply measured lens distortion correction; exit if images remain doubled or uncomfortable.

### Hands-free Asteroid Dodge

Choose **Arcade → Asteroid Dodge** (`/games/asteroid-dodge`), then start the game or choose **Phone VR**. This game is separate from the solar-system menus. Hold gaze on **START DODGE**, face the course during the three-second countdown, then turn your head gently left/right to steer. Stay seated: no physical ducking or walking is needed. Avoid incoming rocks for 60 seconds; three hits end the run. The HUD shows time, shields and rocks dodged. Gaze controls provide Pause/Resume, Replay, Recentre and Exit; Options offers Restart Game. Exit Phone VR and use **← Arcade** to return to the game catalog. A running game pauses when the browser loses focus, the page becomes hidden, the viewer exits, or you recenter. Resume includes another countdown. Simulation also stops while selecting gaze controls. Desktop/touch fallback uses drag-to-look and visible controls (Space pauses/resumes). This is **local practice**, not ranked XP or a leaderboard submission; existing Scan Hunt scoring is unchanged.

Phone VR requests a screen wake lock so hands-free viewing does not trigger normal screen sleep. The top bar shows **Screen awake** only after the browser grants it. It releases on exit/navigation and reacquires when you return to a visible VR tab. If it says **Screen may sleep**, use trusted HTTPS and check browser permission/power-saving settings; tap the status to retry. Browsers or the OS can refuse/revoke the request. This cannot prevent thermal brightness reduction, a browser crash, or a manual power-button lock.

### Bluetooth phone remotes (including Irusu)

Open **Controller test & setup** from the VR launcher, with the phone outside the viewer.
Tap the input test area and try each button and joystick direction. The panel shows keyboard,
mouse, scroll and browser-gamepad input separately; Bluetooth pairing does not prove button support.
Choose **Assign** beside an action, then send the desired input within 15 seconds. Assignments are
saved for this browser and site address; use the same HTTPS link each time. Testing does not trigger
ride or flight actions. An input can belong to only one action. **Clear** removes one assignment;
**Clear all mappings** restores normal unassigned behavior.

If only scrolling works, choose **Use scroll to move**: up moves forward, down moves backward, and
movement stops shortly after scrolling stops. Other actions can use the viewer's touch button and
gaze scanning. Ordinary gamepad axes/buttons are opt-in through Assign, with a joystick deadzone.
If no event appears for a trigger, try the remote manufacturer's documented modes; the app cannot
map signals intercepted by the phone or browser. No remote mode or Samsung compatibility is assumed.

Phone motion sensors require a secure origin and a phone with a gyroscope. `localhost` works for development on the same device; a phone accessing your laptop over Wi-Fi needs HTTPS and a certificate its browser trusts. Some mobile browsers do not allow fullscreen or orientation locking for ordinary pages, but split-screen still works after you rotate the phone manually.

## Environment

Copy `.env.example` to `.env`. Only `SESSION_SECRET` is required to boot in
production; everything else has a working default or a graceful fallback.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `5000` | Off‑prod the server scans upward if the port is busy; in production it binds exactly `PORT`. |
| `SESSION_SECRET` | dev‑only fallback | **Required in production** — the server refuses to boot without it. |
| `MONGODB_URI` | — | MongoDB connection string. Absent ⇒ file‑backed mode (static planet data, in‑memory sessions). |
| `DEMO_AUTH` | `true` | `true` = passwordless demo pilots (nothing written to Firebase). `false` = real Firebase + bcrypt login. |
| `GEMINI_API_KEY` | — | Google AI Studio key. Absent or invalid ⇒ quiz falls back to the curated bank and the assistant to the offline corpus. Leading/trailing spaces are trimmed. |
| `NASA_API_KEY` | `DEMO_KEY` | For NASA DONKI space‑weather. `DEMO_KEY` works but is rate‑limited. |
| `CORS_ORIGINS` | localhost dev ports | Comma‑separated allowlist of origins permitted to make credentialed API calls. |
| `FIREBASE_*` | bundled project | `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, … — only used when `DEMO_AUTH=false`. |
| `TRUST_PROXY` | off | Set `true` (or `NODE_ENV=production`) behind a TLS‑terminating proxy so secure cookies and per‑IP rate limiting work. |

## Security

- `helmet` — CSP, HSTS, `X-Frame-Options`, `nosniff`, no `X-Powered-By`
- CORS is an explicit allowlist (`CORS_ORIGINS`), not an origin mirror
- Rate limiting on `/api/login`, `/api/register`, `/api/google-login` and review submission
- Protected pages are gated server‑side; legacy `*.html` URLs 301 to the guarded route
- `npm audit` reports **0 vulnerabilities**; run `npm run audit:ci` in CI

## Optional: standalone ML microservice

`ai-service/` is an **optional** FastAPI service with scikit‑learn / TensorFlow
models for offline experimentation. The main app does **not** depend on it — all
simulator analysis runs in‑process. It pins older library versions and is not
guaranteed to install on Python 3.13; skip it unless you specifically want to
work on the ML side.

## Project layout

```
app-enhanced.js            Express server: routes, auth, middleware, planet seed
routes/
  simulator.js             Space Traffic Simulator: models, gamification, community, chatbot
  game.js  reviews.js       Arcade missions API; reviews + moderation
  nasa-api.js  celestrak.js  advanced-orbital-mechanics.js
services/
  space-knowledge.js       Offline assistant corpus + matcher
models/                    Mongoose schemas (review, user-score)
config/auth.js             ensureAuthenticated middleware
views/                     One HTML file per page (+ views/games/ for the arcade)
public/
  js/vr/                   VR scene, cockpit ride, gyro, audio
  js/arcade/               One file per game + shared shell
  css/  textures/  ...
models/*.glb               3D planet + spacecraft models
tests/                     Vitest suites (unit + API + e2e/)
```

## API (selected)

`POST /api/register` · `POST /api/login` · `POST /api/logout` · `GET /api/user`
· `GET /api/health` · `GET /api/planets` · `GET /api/ephemeris` ·
`GET /api/planets/:key/quiz` · `POST /api/quiz/submit` · `GET /api/reviews` ·
`POST /api/reviews` · `POST /api/simulator/run` · `GET /api/simulator/history` ·
`GET /api/simulator/leaderboard` · `GET /api/simulator/scores` ·
`GET /api/simulator/nasa-data` · `POST /api/simulator/real-time-prediction` ·
`POST /api/simulator/share-scenario` · `GET /api/simulator/community-scenarios` ·
`POST /api/simulator/chatbot` · `GET /api/game/missions` · `POST /api/game/run`

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

NASA (planetary data, DONKI, textures), CelesTrak (catalogue data), the Three.js
community, Express and MongoDB.
