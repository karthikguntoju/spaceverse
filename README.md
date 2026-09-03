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
| `npm run health-check` | Hit `/api/health` and report |
| `npm run migrate-atlas` / `migrate:scores` | One‑off data migrations |

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
