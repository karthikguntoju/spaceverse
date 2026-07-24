/**
 * "Deep Field" — the space roller-coaster.
 *
 * The ride is a single Catmull-Rom curve threaded through the live solar
 * system. Because a Catmull-Rom curve passes exactly through its control
 * points at t = i/(n-1), every segment owns a known slice of the curve, which
 * makes scripting (durations, camera focus, barrel rolls, jumpscare timings)
 * straightforward.
 *
 * The rider never moves the camera directly — the camera is a child of the
 * dolly. That is what keeps it working in WebXR, where the headset owns the
 * camera pose and only the rig may be moved.
 */
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const easeInOut = p => p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
const easeIn = p => p * p;
const easeOut = p => 1 - Math.pow(1 - p, 2.2);
const linear = p => p;
const SHAPES = { easeInOut, easeIn, easeOut, linear };

/**
 * Builds the segment table against the *current* planet positions.
 * `sys` is the SolarSystem instance (already posed with poseForRide()).
 */
export function buildSegments(sys) {
    const P = k => sys.worldPos(k).clone();
    const sun = V(0, 0, 0);
    const earth = P('earth'), venus = P('venus'), mercury = P('mercury'), mars = P('mars');
    const jup = P('jupiter'), sat = P('saturn'), ura = P('uranus'), nep = P('neptune');

    // unit vector from the Sun to a body — used to place points "outside" or
    // "inside" of a planet without hand-tuning coordinates
    const out = v => v.clone().normalize();
    const side = v => V(-v.z, 0, v.x).normalize();       // tangential direction

    const eO = out(earth), eS = side(earth);
    const vO = out(venus), vS = side(venus);
    const mO = out(mars), mS = side(mars);
    const jO = out(jup), jS = side(jup);
    const sO = out(sat), sS = side(sat);
    const uO = out(ura), uS = side(ura);
    const nO = out(nep), nS = side(nep);

    const at = (base, o, s, y, os, ss) => base.clone().addScaledVector(o, os).addScaledVector(s, ss).add(V(0, y, 0));

    // The slingshot has to be described as a real arc: a Catmull-Rom spline
    // through two or three widely spaced points bows inwards badly enough to
    // put the ship inside the photosphere.
    const SLING_R = 64, SLING_N = 7;
    const sling = [];
    for (let i = 0; i <= SLING_N; i++) {
        const k = i / SLING_N;
        const a = 0.55 + k * Math.PI * 1.18;
        sling.push(V(Math.cos(a) * SLING_R, -8 + Math.sin(k * Math.PI) * 20, Math.sin(a) * SLING_R));
    }

    return [
        {
            id: 'ignition', title: 'IGNITION', subtitle: 'Departing Earth orbit',
            dur: 12, shape: 'easeIn', bank: 0.4, focus: 'earth', fov: 62,
            pts: [
                at(earth, eO, eS, 3, 16, 10),
                at(earth, eO, eS, 5, 13, 2),
                at(earth, eO, eS, 6, 4, -13),
                at(earth, eO, eS, 2, -12, -20),
                at(earth, eO, eS, -4, -28, -14)
            ],
            events: [{ at: 0.05, kind: 'narrate', text: 'Thrusters hot. Sunward burn in 3… 2… 1…' }]
        },
        {
            id: 'solar-dive', title: 'SOLAR DIVE', subtitle: 'Slingshot around the Sun',
            dur: 30, shape: 'easeIn', bank: 1.15, focus: 'sun', fov: 70,
            pts: [
                at(venus, vO, vS, -6, 26, 34),
                at(venus, vO, vS, -4, -6, 8),
                ...sling
            ],
            events: [
                { at: 0.30, kind: 'narrate', text: 'Corona temperature 1.1 million °C. Hull shields at maximum.' },
                { at: 0.62, kind: 'shake', amp: 0.02 },
                { at: 0.66, kind: 'narrate', text: 'Perihelion. Gravity assist locked — velocity climbing fast.' }
            ]
        },
        {
            id: 'inner-run', title: 'INNER RUN', subtitle: 'Mercury and Venus flyby',
            dur: 20, shape: 'linear', bank: 0.9, focus: 'ahead', fov: 74,
            pts: [
                at(mercury, out(mercury), side(mercury), 8, -24, -30),
                at(mercury, out(mercury), side(mercury), 4, 18, -10),
                at(venus, vO, vS, -8, 16, 22),
                // swing wide of the Sun and outside Earth's moon system: a
                // straight Venus→Mars leg cuts through both
                V(132, 8, -60),
                V(140, -6, 46),
                at(mars, mO, mS, 10, -26, 46)
            ],
            events: [
                { at: 0.18, kind: 'narrate', text: 'Mercury: 59 Earth days per rotation, no atmosphere to speak of.' },
                { at: 0.72, kind: 'narrate', text: 'Crossing Mars orbit. Debris density rising ahead.' }
            ]
        },
        {
            id: 'belt', title: 'ASTEROID GAUNTLET', subtitle: 'Threading the main belt',
            dur: 34, shape: 'linear', bank: 1.6, focus: 'ahead', fov: 80,
            pts: [
                V(mars.x * 1.12, 6, mars.z * 1.12),
                V(mO.x * 176 + 20, -4, mO.z * 176 - 30),
                V(mO.x * 186 - 34, 9, mO.z * 186 + 26),
                V(mO.x * 196 + 30, -8, mO.z * 196 + 8),
                V(mO.x * 206 - 8, 4, mO.z * 206 - 28),
                V(jup.x * 0.86, 2, jup.z * 0.86)
            ],
            events: [
                { at: 0.10, kind: 'narrate', text: 'Main belt. A million rocks, and we are flying between them.' },
                {
                    at: 0.26, kind: 'scare', label: 'INBOUND — BRACE',
                    spec: { kind: 'rock', from: 'front-left', size: 7, miss: 6, lead: 1.9 }
                },
                { at: 0.45, kind: 'narrate', text: 'Proximity alert. Second body on an intercept vector.' },
                {
                    at: 0.55, kind: 'scare', label: 'IMPACT — HULL BREACH',
                    spec: { kind: 'rock', from: 'front', size: 9, miss: 3.4, lead: 2.0, hit: true }
                },
                {
                    at: 0.82, kind: 'scare', label: 'TUMBLER ASTERN',
                    spec: { kind: 'rock', from: 'behind', size: 6, miss: 5, lead: 2.2, distance: 240 }
                }
            ]
        },
        {
            id: 'jupiter', title: 'JUPITER PLUNGE', subtitle: 'Past the Great Red Spot',
            dur: 28, shape: 'easeInOut', bank: 1.2, roll: Math.PI * 2, focus: 'jupiter', fov: 76,
            pts: [
                at(jup, jO, jS, 18, -70, 96),
                at(jup, jO, jS, 6, -34, 40),
                at(jup, jO, jS, -10, -26, -6),
                at(jup, jO, jS, -4, -40, -46),
                at(jup, jO, jS, 12, -74, -92)
            ],
            events: [
                { at: 0.22, kind: 'narrate', text: 'Jupiter. 1,300 Earths would fit inside it.' },
                { at: 0.48, kind: 'narrate', text: 'That storm is the Great Red Spot — wider than our whole planet.' },
                {
                    at: 0.70, kind: 'scare', label: 'MOON EJECTA',
                    spec: { kind: 'ice', from: 'above', size: 5.5, miss: 5, lead: 1.7 }
                }
            ]
        },
        {
            id: 'rings', title: 'RING SHOOT', subtitle: 'Through Saturn\'s ice fields',
            dur: 30, shape: 'easeInOut', bank: 1.5, focus: 'saturn', fov: 78,
            pts: [
                at(sat, sO, sS, -34, -46, 92),
                at(sat, sO, sS, -18, -30, 44),
                at(sat, sO, sS, 4, -26, 6),
                at(sat, sO, sS, 16, -30, -34),
                at(sat, sO, sS, -6, -52, -78)
            ],
            events: [
                { at: 0.20, kind: 'narrate', text: 'The rings are 280,000 km wide and thinner than a city block.' },
                {
                    at: 0.46, kind: 'scare', label: 'RING BOULDER — EVADE',
                    spec: { kind: 'ice', from: 'front-right', size: 8, miss: 3.2, lead: 1.8, hit: true }
                },
                { at: 0.74, kind: 'narrate', text: 'Ice and rock, some the size of houses, all in perfect orbit.' }
            ]
        },
        {
            id: 'ice-giants', title: 'ICE GIANTS', subtitle: 'Uranus roll, Neptune run',
            dur: 28, shape: 'linear', bank: 1.3, roll: Math.PI * 2, focus: 'ahead', fov: 74,
            pts: [
                at(ura, uO, uS, 20, -34, 70),
                at(ura, uO, uS, -6, -22, 4),
                at(ura, uO, uS, -16, -40, -60),
                at(nep, nO, nS, 12, -30, 54),
                at(nep, nO, nS, -8, -24, -18)
            ],
            events: [
                { at: 0.16, kind: 'narrate', text: 'Uranus rolls on its side — a 98° tilt, hit by something enormous.' },
                {
                    at: 0.58, kind: 'scare', label: 'DERELICT ON COLLISION COURSE',
                    spec: { kind: 'derelict', from: 'behind', size: 7, miss: 3.8, lead: 3.0, distance: 180 }
                },
                { at: 0.80, kind: 'narrate', text: 'Neptune. Winds here break 2,100 km/h — the fastest anywhere.' }
            ]
        },
        {
            id: 'return', title: 'RETURN BURN', subtitle: 'Warp home',
            dur: 18, shape: 'easeOut', bank: 0.5, focus: 'ahead', fov: 88,
            pts: [
                V(nep.x * 0.7, 20, nep.z * 0.7),
                V(earth.x * 2.1, 30, earth.z * 2.1),
                at(earth, eO, eS, 6, 34, 26),
                at(earth, eO, eS, 2, 15, 8)
            ],
            events: [
                { at: 0.04, kind: 'warp' },
                { at: 0.10, kind: 'narrate', text: 'Warp burn. Four billion kilometres in twelve seconds.' },
                { at: 0.86, kind: 'narrate', text: 'Home. Welcome back to Earth orbit.' }
            ]
        }
    ];
}

export class Ride {
    constructor({ scene, dolly, camera, audio, scares, system }) {
        this.scene = scene;
        this.dolly = dolly;
        this.camera = camera;
        this.audio = audio;
        this.scares = scares;
        this.system = system;

        this.playing = false;
        this.time = 0;
        this.segIndex = -1;
        this.comfort = false;
        this.speedScale = 1;
        this.onSegment = () => {};
        this.onNarrate = () => {};
        this.onProgress = () => {};
        this.onFinish = () => {};

        this._q = new THREE.Quaternion();
        this._m = new THREE.Matrix4();
        this._up = V(0, 1, 0);
        this._pos = V(0, 0, 0);
        this._look = V(0, 0, 0);
        this._roll = 0;
        this._bank = 0;
        this._speedNorm = 0;
        this._buildStreaks();
    }

    /** (re)build the track from live planet positions */
    prepare() {
        this.system.poseForRide();
        this.segments = buildSegments(this.system);

        const pts = [];
        this.segments.forEach(s => {
            s.startIdx = pts.length;
            s.pts.forEach(p => pts.push(p));
        });
        this.points = pts;
        this.curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
        const n = pts.length - 1;
        // a segment owns the curve from its own first point up to the next
        // segment's first point, so the ranges tile the track with no gaps
        this.segments.forEach((s, i) => {
            const next = this.segments[i + 1];
            s.t0 = s.startIdx / n;
            s.t1 = (next ? next.startIdx : n) / n;
            s.fired = new Set();

            // arc-length table: without it the ship lurches between waypoints,
            // because control points are not evenly spaced along the track
            const SAMPLES = 220;
            const ts = [], lens = [];
            let acc = 0, prev = this.curve.getPoint(s.t0);
            ts.push(s.t0); lens.push(0);
            for (let k = 1; k <= SAMPLES; k++) {
                const t = s.t0 + (s.t1 - s.t0) * (k / SAMPLES);
                const p = this.curve.getPoint(t);
                acc += p.distanceTo(prev);
                prev = p;
                ts.push(t); lens.push(acc);
            }
            s.ts = ts; s.lens = lens; s.length = acc;
        });
        this.total = this.segments.reduce((a, s) => a + s.dur, 0);
        this.time = 0;
        this.segIndex = -1;
    }

    get duration() { return this.total; }

    start() {
        if (!this.curve) this.prepare();
        this.time = 0;
        this.segIndex = -1;
        this.playing = true;
        this._lookInit = false;
        this._smoothQ = null;
        this._prevPos = null;
        this.segments.forEach(s => s.fired.clear());
        this.system.orbitRate = 0.06;         // near-freeze so the track stays true
        this.scares.clear();
        this.update(0.0001);
    }

    stop() {
        this.playing = false;
        this.system.orbitRate = 1;
        this.scares.clear();
        this.streaks.material.opacity = 0;
        if (this.audio) this.audio.setEngine(0);
    }

    pause() { this.playing = false; if (this.audio) this.audio.setEngine(0); }
    resume() { this.playing = true; }

    /** jump to an absolute time (used by the segment skip buttons and QA) */
    seek(sec) {
        this.time = Math.max(0, Math.min(this.total - 0.05, sec));
        this.scares.clear();
        this._prevPos = null;
        this._lookInit = false;
        this._smoothQ = null;
        // don't replay events we've skipped past
        let acc = 0;
        this.segments.forEach(s => {
            const local = (this.time - acc) / s.dur;
            s.fired.clear();
            if (local >= 1) (s.events || []).forEach((e, i) => s.fired.add(i));
            else if (local > 0) (s.events || []).forEach((e, i) => { if (e.at <= local) s.fired.add(i); });
            acc += s.dur;
        });
        this.update(0.0001);
    }

    skipSegment() {
        let acc = 0;
        for (const s of this.segments) {
            acc += s.dur;
            if (acc > this.time + 0.2) { this.seek(acc); return; }
        }
        this.seek(this.total - 0.1);
    }

    _buildStreaks() {
        // speed lines that live in the dolly's local space
        const N = 260;
        const arr = new Float32Array(N * 6);
        for (let i = 0; i < N; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = 4 + Math.random() * 26;
            const x = Math.cos(a) * r, y = Math.sin(a) * r;
            const z = -Math.random() * 260;
            arr[i * 6] = x; arr[i * 6 + 1] = y; arr[i * 6 + 2] = z;
            arr[i * 6 + 3] = x; arr[i * 6 + 4] = y; arr[i * 6 + 5] = z + 6;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        this.streakArr = arr;
        this.streakN = N;
        this.streaks = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
            color: 0xcfe2ff, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false
        }));
        this.streaks.frustumCulled = false;
        this.dolly.add(this.streaks);
    }

    _updateStreaks(dt, level) {
        this.streaks.material.opacity = level * 0.5;
        if (level < 0.02) return;
        const spd = 160 * level * dt;
        for (let i = 0; i < this.streakN; i++) {
            this.streakArr[i * 6 + 2] += spd;
            this.streakArr[i * 6 + 5] += spd;
            if (this.streakArr[i * 6 + 2] > 12) {
                const a = Math.random() * Math.PI * 2;
                const r = 4 + Math.random() * 26;
                const z = -240 - Math.random() * 60;
                const len = 5 + level * 26;
                this.streakArr[i * 6] = Math.cos(a) * r;
                this.streakArr[i * 6 + 1] = Math.sin(a) * r;
                this.streakArr[i * 6 + 2] = z;
                this.streakArr[i * 6 + 3] = Math.cos(a) * r;
                this.streakArr[i * 6 + 4] = Math.sin(a) * r;
                this.streakArr[i * 6 + 5] = z + len;
            }
        }
        this.streaks.geometry.attributes.position.needsUpdate = true;
    }

    /** arc-length fraction -> curve parameter inside one segment */
    _tAt(s, frac) {
        const want = frac * s.length;
        let lo = 0, hi = s.lens.length - 1;
        while (lo < hi - 1) {
            const mid = (lo + hi) >> 1;
            if (s.lens[mid] <= want) lo = mid; else hi = mid;
        }
        const span = s.lens[hi] - s.lens[lo];
        const k = span > 1e-6 ? (want - s.lens[lo]) / span : 0;
        return s.ts[lo] + (s.ts[hi] - s.ts[lo]) * k;
    }

    /** segment + eased local progress for a given absolute time */
    _resolve(time) {
        let acc = 0;
        for (let i = 0; i < this.segments.length; i++) {
            const s = this.segments[i];
            if (time < acc + s.dur || i === this.segments.length - 1) {
                const local = Math.max(0, Math.min(1, (time - acc) / s.dur));
                const eased = (SHAPES[s.shape] || linear)(local);
                return { i, s, local, t: this._tAt(s, eased) };
            }
            acc += s.dur;
        }
        return { i: 0, s: this.segments[0], local: 0, t: 0 };
    }

    /** where the rider will be in `lead` seconds — powers the near-miss maths */
    predict(lead) {
        const r = this._resolve(Math.min(this.total - 0.01, this.time + lead));
        return this.curve.getPoint(r.t);
    }

    update(dt) {
        if (!this.curve) return;
        if (this.playing) this.time += dt * this.speedScale;

        if (this.time >= this.total) {
            this.time = this.total;
            if (this.playing) { this.playing = false; this.onFinish(); }
        }

        const r = this._resolve(this.time);
        const s = r.s;

        if (r.i !== this.segIndex) {
            this.segIndex = r.i;
            this.onSegment(s, r.i, this.segments.length);
        }

        // ── position + orientation ────────────────────────────────────────
        const t = r.t;
        const pos = this.curve.getPoint(t, this._pos);
        const ahead = this.curve.getPoint(Math.min(1, t + 0.006));

        // real travel speed: distance covered since the previous frame
        let speed = 0;
        if (this._prevPos && dt > 0.0005) speed = this._prevPos.distanceTo(pos) / dt;
        this._prevPos = pos.clone();

        let lookTarget;
        if (s.focus && s.focus !== 'ahead' && this.system.bodies.has(s.focus)) {
            const bp = this.system.worldPos(s.focus, new THREE.Vector3());
            // blend planet-gazing with the direction of travel so it never
            // feels like the ship is flying sideways
            const w = 0.45 + 0.3 * Math.sin(r.local * Math.PI);
            lookTarget = ahead.clone().lerp(bp, w);
        } else {
            lookTarget = ahead.clone();
        }
        if (!this._lookInit) { this._look.copy(lookTarget); this._lookInit = true; }
        else this._look.lerp(lookTarget, 1 - Math.pow(0.001, dt));

        this._m.lookAt(pos, this._look, this._up);
        this._q.setFromRotationMatrix(this._m);

        // banking from curvature + scripted barrel roll
        const p0 = this.curve.getPoint(Math.max(0, t - 0.004));
        const p1 = ahead;
        const dir = p1.clone().sub(pos).normalize();
        const prev = pos.clone().sub(p0).normalize();
        const turn = dir.clone().cross(prev).dot(this._up);
        const bankTarget = THREE.MathUtils.clamp(turn * 26, -1.1, 1.1) * (s.bank || 1) * (this.comfort ? 0.3 : 1);
        this._bank += (bankTarget - this._bank) * Math.min(1, dt * 2.2);

        let roll = this._bank;
        if (s.roll && !this.comfort) roll += s.roll * easeInOut(r.local);
        this._roll += (roll - this._roll) * Math.min(1, dt * 3.5);
        this._q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), this._roll));

        this.dolly.position.copy(pos);
        // smoothed rail orientation is tracked separately so the shake below
        // never feeds back into the next frame's smoothing
        if (!this._smoothQ) this._smoothQ = this._q.clone();
        else this._smoothQ.slerp(this._q, Math.min(1, dt * 6));
        this.dolly.quaternion.copy(this._smoothQ);

        // shake from the scare director rides on top of the rail
        const sh = this.scares.shake;
        if (sh.amp > 0) {
            const mul = this.comfort ? 0.45 : 1;
            this.dolly.rotateX(sh.x * mul);
            this.dolly.rotateY(sh.y * mul);
            this.dolly.rotateZ(sh.z * mul);
        }

        // ── speed-driven feedback ────────────────────────────────────────
        // segments hold a steady 11–33 u/s now that pacing is arc-length based
        const norm = THREE.MathUtils.clamp((speed - 8) / 24, 0, 1);
        this._speedNorm += (norm - this._speedNorm) * Math.min(1, dt * 1.5);
        this.speedNorm = this._speedNorm;
        this._updateStreaks(dt, this._speedNorm);
        if (this.audio && this.playing) this.audio.setEngine(0.25 + this._speedNorm * 0.75);
        this.scares.setVignette(this.comfort
            ? Math.max(0, this._speedNorm - 0.15) * 0.85
            : Math.max(0, this._speedNorm - 0.55) * 0.5);

        if (s.fov && this.onFov) this.onFov(s.fov, this._speedNorm);

        // ── scripted events ──────────────────────────────────────────────
        (s.events || []).forEach((e, idx) => {
            if (s.fired.has(idx) || r.local < e.at) return;
            s.fired.add(idx);
            this._fire(e);
        });

        this.onProgress(this.time / this.total, this.time, this.total);
    }

    _fire(e) {
        switch (e.kind) {
            case 'narrate':
                this.onNarrate(e.text);
                if (this.audio) this.audio.blip(520);
                break;
            case 'scare':
                this.scares.trigger({ ...e.spec, label: e.label }, {
                    position: this.dolly.position.clone(),
                    quaternion: this.dolly.quaternion.clone(),
                    predict: lead => this.predict(lead)
                });
                break;
            case 'shake':
                this.scares.shake.amp = e.amp;
                break;
            case 'warp':
                if (this.audio) this.audio.warp(2.6);
                break;
        }
    }
}
