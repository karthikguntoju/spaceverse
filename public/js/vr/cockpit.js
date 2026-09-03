/**
 * Ship cockpit for the Deep Space Ride.
 *
 * A cabin built around the dolly origin — where the rider's head is — so
 * looking anywhere (mouse, touch, phone gyro, headset) shows a ship, not
 * empty space. Everything is a child of the dolly and rides the rails for
 * free.
 *
 * What's here:
 *   • curved canopy glass (physical material with real reflections from a
 *     small PMREM environment that only the cabin uses — planets untouched)
 *   • a tube-frame following the glass edge, A/B pillars, roof, floor,
 *     rear bulkhead with hatch, all with a procedural panel-seam texture
 *   • a wraparound dashboard: three rounded MFD screens with key rows,
 *     status lamps, switch banks, glowing light strips
 *   • a heads-up display projected on the canopy: boresight, artificial
 *     horizon that rolls with the ship, speed and heading tapes, a marker
 *     that tracks the segment's focus planet, alert flashes
 *   • proximity radar with live blips for incoming hazards
 *   • throttle that follows thrust, flight stick that leans into banks
 *   • seat with bolsters and headrest behind you
 *
 * Screens are canvas textures redrawn at ~15 Hz from whatever the ride
 * reports each frame.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;

/* ─── colour system: one accent, one warm warning, cool neutrals ───────── */
const C = {
    accent: '#5eead4', accentDim: 'rgba(94,234,212,0.55)', accentHex: 0x5eead4,
    blue: '#7dd3fc', violet: '#c4b5fd', warn: '#fb7185', amber: '#fbbf24',
    text: '#eef2ff', muted: '#8da2c0', muted2: '#5b6b85',
    panel: 'rgba(6,10,18,0.97)', panel2: 'rgba(10,16,28,0.97)'
};

/* ─── canvas helpers ────────────────────────────────────────────────────── */
function screenTexture(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return { canvas: c, ctx: c.getContext('2d'), tex, w, h };
}
function rr(x, X, Y, w, h, r) {
    x.beginPath();
    x.moveTo(X + r, Y); x.lineTo(X + w - r, Y); x.quadraticCurveTo(X + w, Y, X + w, Y + r);
    x.lineTo(X + w, Y + h - r); x.quadraticCurveTo(X + w, Y + h, X + w - r, Y + h);
    x.lineTo(X + r, Y + h); x.quadraticCurveTo(X, Y + h, X, Y + h - r);
    x.lineTo(X, Y + r); x.quadraticCurveTo(X, Y, X + r, Y);
    x.closePath();
}
function screenBase(x, w, h, tint) {
    x.clearRect(0, 0, w, h);
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, C.panel2); g.addColorStop(1, C.panel);
    x.fillStyle = g; rr(x, 0, 0, w, h, 22); x.fill();
    // inner glow at the edges
    x.save(); rr(x, 0, 0, w, h, 22); x.clip();
    const vg = x.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    x.fillStyle = vg; x.fillRect(0, 0, w, h);
    // scanlines
    x.fillStyle = 'rgba(255,255,255,0.028)';
    for (let y = 0; y < h; y += 4) x.fillRect(0, y, w, 1);
    x.restore();
    x.strokeStyle = tint; x.lineWidth = 2; rr(x, 1, 1, w - 2, h - 2, 21); x.stroke();
}
function label(x, txt, X, Y, size = 20, col = C.muted, weight = '', align = 'left', font = 'Inter, system-ui, sans-serif') {
    x.fillStyle = col; x.font = `${weight} ${size}px ${font}`.trim(); x.textAlign = align; x.fillText(txt, X, Y); x.textAlign = 'left';
}
const ORB = 'Orbitron, Inter, sans-serif';
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* ─── procedural hull texture: dark composite with panel seams and rivets ─ */
function hullTexture() {
    const S = 1024;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = '#1b2230'; x.fillRect(0, 0, S, S);
    // soft mottling
    for (let i = 0; i < 2600; i++) {
        x.fillStyle = `rgba(${200 + Math.random() * 55},${210 + Math.random() * 45},${255},${Math.random() * 0.035})`;
        const s = 6 + Math.random() * 40;
        x.fillRect(Math.random() * S, Math.random() * S, s, s);
    }
    // panel seams: a loose grid with offset rows
    x.strokeStyle = 'rgba(0,0,0,0.65)'; x.lineWidth = 3;
    const cell = 170;
    for (let r = 0; r < S / cell + 1; r++) {
        const y = r * cell;
        x.beginPath(); x.moveTo(0, y); x.lineTo(S, y); x.stroke();
        const off = (r % 2) * cell * 0.5;
        for (let cI = 0; cI < S / cell + 1; cI++) {
            const xx = cI * cell + off;
            x.beginPath(); x.moveTo(xx, y); x.lineTo(xx, y + cell); x.stroke();
            // rivets in the corners
            for (const [dx, dy] of [[14, 14], [cell - 14, 14], [14, cell - 14], [cell - 14, cell - 14]]) {
                x.fillStyle = 'rgba(0,0,0,0.5)'; x.beginPath(); x.arc(xx + dx, y + dy, 4, 0, Math.PI * 2); x.fill();
                x.fillStyle = 'rgba(255,255,255,0.12)'; x.beginPath(); x.arc(xx + dx - 1, y + dy - 1, 2, 0, Math.PI * 2); x.fill();
            }
        }
    }
    // seam highlight
    x.strokeStyle = 'rgba(255,255,255,0.05)'; x.lineWidth = 1;
    for (let r = 0; r < S / cell + 1; r++) { const y = r * cell + 3; x.beginPath(); x.moveTo(0, y); x.lineTo(S, y); x.stroke(); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    return tex;
}

/* ─── stencil-style caution label ───────────────────────────────────────── */
function stencil(text, col = C.amber, w = 256, h = 64) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.strokeStyle = col; x.lineWidth = 4; x.strokeRect(4, 4, w - 8, h - 8);
    x.fillStyle = col; x.font = `bold ${h * 0.5}px ${ORB}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, w / 2, h / 2 + 2);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85 });
}

export class Cockpit {
    constructor({ dolly, camera, renderer }) {
        this.dolly = dolly;
        this.camera = camera;
        this.renderer = renderer;
        this.group = new THREE.Group();
        this.group.name = 'cockpit';
        this.group.visible = false;
        dolly.add(this.group);

        this.t = 0;
        this._redrawT = 0;
        this.data = {
            speedNorm: 0, speedKmh: 0, progress: 0, time: 0, total: 1, paused: false,
            bank: 0, roll: 0, comfort: false, scares: true, radar: [], target: null, heading: 0
        };
        this.segment = { title: 'STANDBY', sub: 'Preparing track…', index: 0, n: 8, list: [] };
        this.alert = { text: '', kind: '', t: 0 };
        this.narration = { text: '', t: 0 };
        this.hull = 100;
        this.speedHist = new Array(72).fill(0);
        this._xrY = 0;
        this._radarSweep = 0;

        this._materials();
        this._buildShell();
        this._buildCanopy();
        this._buildDash();
        this._buildControls();
        this._buildSeat();
        this._buildLights();
        this._buildHUD();
        this.redraw(true);
    }

    /* ── materials ──────────────────────────────────────────────────── */
    _materials() {
        // A tiny neutral room, baked to a PMREM, gives the metals and glass
        // believable reflections. Assigned per material — the scene's own
        // environment stays untouched so the planets do not change.
        let env = null;
        try {
            const pmrem = new THREE.PMREMGenerator(this.renderer);
            env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
            pmrem.dispose();
        } catch (e) { /* no renderer or PMREM unsupported — matte materials still look fine */ }
        this.env = env;
        const hullTex = hullTexture();

        this.mHull = new THREE.MeshStandardMaterial({
            color: 0xa9b4c6, map: hullTex, roughness: 0.62, metalness: 0.4, envMap: env, envMapIntensity: 0.6
        });
        this.mHullDark = new THREE.MeshStandardMaterial({
            color: 0x6b7686, map: hullTex, roughness: 0.7, metalness: 0.35, envMap: env, envMapIntensity: 0.45
        });
        this.mMetal = new THREE.MeshStandardMaterial({
            color: 0x707a8a, roughness: 0.42, metalness: 0.9, envMap: env, envMapIntensity: 0.9
        });
        this.mMetalDark = new THREE.MeshStandardMaterial({
            color: 0x3b4454, roughness: 0.4, metalness: 0.9, envMap: env, envMapIntensity: 0.9
        });
        this.mBezel = new THREE.MeshStandardMaterial({
            color: 0x11161f, roughness: 0.35, metalness: 0.6, envMap: env, envMapIntensity: 0.7
        });
        this.mSoft = new THREE.MeshStandardMaterial({ color: 0x1c2333, roughness: 0.95, metalness: 0.0 });
        this.mSoftTrim = new THREE.MeshStandardMaterial({ color: 0x2b3448, roughness: 0.9, metalness: 0.05 });
        this.mAccent = new THREE.MeshStandardMaterial({
            color: 0x061014, emissive: C.accentHex, emissiveIntensity: 1.7, roughness: 0.4, metalness: 0.2
        });
        this.mAccentSoft = new THREE.MeshStandardMaterial({
            color: 0x061014, emissive: 0x2a8fa8, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.2
        });
        this.mGlass = new THREE.MeshPhysicalMaterial({
            color: 0xeaf6ff, transparent: true, opacity: 0.045, roughness: 0.03, metalness: 0.0,
            envMap: env, envMapIntensity: 0.28, clearcoat: 0.5, clearcoatRoughness: 0.05,
            side: THREE.BackSide, depthWrite: false
        });
        this.mLampOn = new THREE.MeshBasicMaterial({ color: C.accentHex });
        this.mLampBlue = new THREE.MeshBasicMaterial({ color: 0x7dd3fc });
        this.mLampWarn = new THREE.MeshBasicMaterial({ color: 0xfb7185 });
        this.mLampAmber = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
        this.mLampOff = new THREE.MeshStandardMaterial({ color: 0x1a2230, roughness: 0.5, metalness: 0.3, envMap: env });
        this.mKey = new THREE.MeshStandardMaterial({ color: 0x232b3a, roughness: 0.55, metalness: 0.4, envMap: env, envMapIntensity: 0.6 });
    }

    _box(w, h, d, x, y, z, m = this.mHull, r = 0.02) {
        const geo = r > 0 ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d);
        const mesh = new THREE.Mesh(geo, m);
        mesh.position.set(x, y, z);
        this.group.add(mesh);
        return mesh;
    }
    _tube(points, r = 0.03, m = this.mMetal, closed = false) {
        const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.3);
        const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 6), r, 12, closed), m);
        mesh.name = 'tube:' + points[0].toArray().map(n => n.toFixed(2)).join(',') + '→' + points[points.length - 1].toArray().map(n => n.toFixed(2)).join(',');
        this.group.add(mesh);
        return mesh;
    }
    _strut(from, to, r = 0.03, m = this.mMetal) {
        const dir = to.clone().sub(from);
        const len = dir.length();
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), m);
        mesh.position.copy(from).addScaledVector(dir, 0.5);
        mesh.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
        mesh.name = 'strut:' + from.toArray().map(n => n.toFixed(2)).join(',') + '→' + to.toArray().map(n => n.toFixed(2)).join(',');
        this.group.add(mesh);
        return mesh;
    }

    /* ── shell: floor, roof, rear, sides ─────────────────────────────── */
    _buildShell() {
        // floor with a lit grating strip and a subtle centre channel
        this._box(2.6, 0.08, 2.7, 0, -1.1, 0.1, this.mHull, 0.03);
        this._box(0.8, 0.02, 1.5, 0, -1.055, 0.35, this.mHullDark, 0.005);
        this._box(2.4, 0.012, 0.02, 0, -1.05, -0.62, this.mAccentSoft, 0);
        this._box(2.4, 0.012, 0.02, 0, -1.05, 1.15, this.mAccentSoft, 0);
        // roof: a full glass moon-roof from the canopy edge back to the bulkhead,
        // carried on two side rails, a rear rail and a centre spine
        const roofGlass = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 2.3), this.mGlass.clone());
        roofGlass.material.side = THREE.DoubleSide;
        roofGlass.position.set(0, 1.0, 0.16); roofGlass.rotation.x = Math.PI / 2; roofGlass.renderOrder = 5;
        this.group.add(roofGlass);
        this._strut(V(-1.25, 1.0, -0.2), V(-1.25, 1.0, 1.3), 0.03);
        this._strut(V(1.25, 1.0, -0.2), V(1.25, 1.0, 1.3), 0.03);
        this._strut(V(-1.25, 1.0, 1.3), V(1.25, 1.0, 1.3), 0.03);
        this._strut(V(0, 1.02, -0.97), V(0, 1.02, 1.3), 0.02, this.mMetalDark);
        this._strut(V(-1.25, 1.0, 0.55), V(1.25, 1.0, 0.55), 0.016, this.mMetalDark);
        // light channels on the rails
        this._box(0.03, 0.02, 1.45, -1.21, 0.97, 0.55, this.mAccentSoft, 0);
        this._box(0.03, 0.02, 1.45, 1.21, 0.97, 0.55, this.mAccentSoft, 0);
        this._box(1.4, 0.02, 0.03, 0, 0.97, -0.2, this.mAccent, 0);
        // rear bulkhead + hatch
        this._box(2.6, 2.2, 0.08, 0, -0.05, 1.34, this.mHull, 0.03);
        const hatch = this._box(0.7, 1.45, 0.03, 0, -0.32, 1.295, this.mHullDark, 0.04);
        this._box(0.76, 0.02, 0.02, 0, 0.43, 1.28, this.mAccentSoft, 0);
        this._box(0.76, 0.02, 0.02, 0, -1.07, 1.28, this.mAccentSoft, 0);
        // hatch wheel
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.014, 10, 32), this.mMetal);
        wheel.position.set(0, -0.32, 1.27); this.group.add(wheel);
        for (let i = 0; i < 3; i++) {
            const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 8), this.mMetal);
            spoke.position.set(0, -0.32, 1.27); spoke.rotation.z = i * Math.PI / 3; this.group.add(spoke);
        }
        // caution decal on the hatch
        const dec = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.085), stencil('AIRLOCK · SEALED'));
        dec.position.set(0, 0.2, 1.275); dec.rotation.y = Math.PI; this.group.add(dec);
        // side walls behind the B-pillar
        this._box(0.08, 2.2, 1.3, -1.3, -0.05, 0.7, this.mHull, 0.03);
        this._box(0.08, 2.2, 1.3, 1.3, -0.05, 0.7, this.mHull, 0.03);
        // vent grilles on the side walls
        for (const sx of [-1, 1]) {
            for (let i = 0; i < 6; i++) {
                const slat = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.36), this.mMetalDark);
                slat.position.set(sx * 1.25, 0.45 - i * 0.03, 0.75); this.group.add(slat);
            }
            const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.055), stencil('O2 · ECLSS', C.blue));
            lab.position.set(sx * 1.25, 0.62, 0.75); lab.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2; this.group.add(lab);
        }
        // lower skirts under the window line, forward
        this._box(0.08, 0.7, 1.5, -1.3, -0.78, -0.6, this.mHull, 0.03);
        this._box(0.08, 0.7, 1.5, 1.3, -0.78, -0.6, this.mHull, 0.03);
        // nose plate below the dashboard, sloping away
        const nose = this._box(2.6, 0.08, 1.2, 0, -1.02, -1.45, this.mHull, 0.03);
        nose.rotation.x = -0.35;
    }

    /* ── canopy: curved glass + tube frame following its edge ────────── */
    _buildCanopy() {
        // Sphere segment centred a little behind and below the head so the
        // glass wraps around the pilot. phi runs around Y (front = 3π/2).
        const R = 1.62, CTR = V(0, -0.12, 0.18);
        const phi0 = 1.5 * Math.PI - 0.88, phiL = 1.76;     // ±50° each side — edges land on the pillars
        const th0 = 0.8, thL = 0.91;                          // top edge at the roof line, bottom at the dash sill
        const glass = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 32, phi0, phiL, th0, thL), this.mGlass);
        glass.position.copy(CTR);
        glass.renderOrder = 5;
        this.group.add(glass);

        // frame along the four edges of the glass
        const pt = (phi, th) => V(-R * Math.cos(phi) * Math.sin(th), R * Math.cos(th), R * Math.sin(phi) * Math.sin(th)).add(CTR);
        const edge = (f, n = 18) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
        const top = edge(k => pt(phi0 + phiL * k, th0));
        const bot = edge(k => pt(phi0 + phiL * k, th0 + thL));
        const left = edge(k => pt(phi0, th0 + thL * k), 10);
        const right = edge(k => pt(phi0 + phiL, th0 + thL * k), 10);
        this._tube(top, 0.034); this._tube(bot, 0.03); this._tube(left, 0.032); this._tube(right, 0.032);
        // two slim ribs, well clear of the boresight
        this._tube(edge(k => pt(phi0 + phiL * 0.2, th0 + thL * k), 10), 0.011, this.mMetalDark);
        this._tube(edge(k => pt(phi0 + phiL * 0.8, th0 + thL * k), 10), 0.011, this.mMetalDark);
        // A-pillars from the glass top corners back to the roof
        for (const c of [top[0], top[top.length - 1]]) this._strut(c, V(Math.sign(c.x) * 1.25, 1.0, -0.2), 0.036);
        this._strut(V(-1.25, 1.0, -0.2), V(1.25, 1.0, -0.2), 0.03);
        // B-pillars
        this._strut(V(-1.27, 1.0, 0.06), V(-1.27, -1.08, 0.06), 0.036);
        this._strut(V(1.27, 1.0, 0.06), V(1.27, -1.08, 0.06), 0.036);
        // side glass between the canopy edge and the B-pillar
        for (const sx of [-1, 1]) {
            const sg = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.3), this.mGlass);
            sg.position.set(sx * 1.24, 0.28, -0.42); sg.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
            sg.material = this.mGlass.clone(); sg.material.side = THREE.DoubleSide;
            this.group.add(sg);
        }
        // sill from the glass bottom corners along to the pillars
        for (const c of [bot[0], bot[bot.length - 1]]) this._strut(c, V(Math.sign(c.x) * 1.27, -0.36, 0.06), 0.026);

        // overhead console with a switch bank and a lamp row
        this._box(0.78, 0.09, 0.52, 0, 0.94, 0.16, this.mHullDark, 0.02);
        this.overheadLamps = [];
        for (let i = 0; i < 8; i++) {
            const l = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 10), this.mLampOff);
            l.position.set(-0.28 + i * 0.08, 0.893, -0.02); this.group.add(l); this.overheadLamps.push(l);
        }
        for (let i = 0; i < 6; i++) {
            const sw = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.045, 8), this.mMetal);
            sw.position.set(-0.22 + i * 0.09, 0.885, 0.2);
            sw.rotation.x = i % 2 ? 0.55 : -0.55; this.group.add(sw);
            const base = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.01, 12), this.mBezel);
            base.position.set(-0.22 + i * 0.09, 0.892, 0.2); this.group.add(base);
        }
        const oLab = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.05), stencil('MASTER · PWR', C.blue));
        oLab.position.set(0, 0.892, 0.34); oLab.rotation.x = Math.PI / 2; oLab.rotation.z = Math.PI; this.group.add(oLab);
    }

    /* ── dashboard: curved shelf, three MFDs, lamps, key rows ─────────── */
    _buildDash() {
        // curved shelf: an inside-facing cylinder segment around the head
        const shelf = new THREE.Mesh(
            new THREE.CylinderGeometry(1.14, 1.2, 0.34, 48, 1, true, -1.32, 2.64),
            new THREE.MeshStandardMaterial({
                color: 0x9aa5b8, map: this.mHull.map, roughness: 0.6, metalness: 0.4, envMap: this.env, envMapIntensity: 0.55, side: THREE.BackSide
            })
        );
        shelf.position.set(0, -0.62, 0.02);
        shelf.rotation.y = Math.PI;
        this.group.add(shelf);
        // top lip of the shelf (glare shield) with a light strip
        const lip = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.035, 12, 64, 2.64), this.mBezel);
        lip.position.set(0, -0.45, 0.02); lip.rotation.set(Math.PI / 2, 0, -Math.PI / 2 - 1.32);   // arc centred on -Z
        this.group.add(lip);
        const strip = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.008, 8, 64, 2.64), this.mAccent);
        strip.position.set(0, -0.415, 0.02); strip.rotation.copy(lip.rotation);
        this.group.add(strip);
        // lower fascia under the shelf
        const fascia = new THREE.Mesh(
            new THREE.CylinderGeometry(1.2, 1.32, 0.42, 48, 1, true, -1.32, 2.64),
            new THREE.MeshStandardMaterial({ color: 0x6f7a8c, map: this.mHull.map, roughness: 0.7, metalness: 0.35, envMap: this.env, envMapIntensity: 0.4, side: THREE.BackSide })
        );
        fascia.position.set(0, -0.99, 0.02); fascia.rotation.y = Math.PI;
        this.group.add(fascia);

        // MFD builder: rounded bezel, recessed screen, key rows on the bezel
        const mfd = (w, h, pos, rot, texObj, keys = true) => {
            const bezel = new THREE.Mesh(new RoundedBoxGeometry(w + 0.07, h + 0.07, 0.04, 4, 0.02), this.mBezel);
            bezel.position.copy(pos); bezel.rotation.copy(rot);
            const normal = V(0, 0, 1).applyEuler(rot);
            bezel.position.addScaledVector(normal, -0.022);
            this.group.add(bezel);
            const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texObj.tex, transparent: true }));
            screen.position.copy(pos); screen.rotation.copy(rot);
            this.group.add(screen);
            // faint glass over the screen for a reflection
            const gl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshPhysicalMaterial({
                color: 0xffffff, transparent: true, opacity: 0.06, roughness: 0.08, metalness: 0, envMap: this.env, envMapIntensity: 0.6, depthWrite: false
            }));
            gl.position.copy(pos).addScaledVector(normal, 0.003); gl.rotation.copy(rot);
            this.group.add(gl);
            if (keys) {
                const n = Math.round(w / 0.07);
                for (let i = 0; i < n; i++) {
                    const k = new THREE.Mesh(new RoundedBoxGeometry(0.036, 0.016, 0.014, 2, 0.004), this.mKey);
                    const off = V(-w / 2 + 0.05 + i * ((w - 0.1) / Math.max(1, n - 1)), -h / 2 - 0.028, 0.006).applyEuler(rot);
                    k.position.copy(pos).add(off); k.rotation.copy(rot);
                    this.group.add(k);
                }
            }
            return screen;
        };

        this.main = screenTexture(1024, 512);
        mfd(0.86, 0.43, V(0, -0.29, -1.02), new THREE.Euler(0.4, 0, 0), this.main);
        this.left = screenTexture(512, 512);
        mfd(0.36, 0.36, V(-0.72, -0.35, -0.8), new THREE.Euler(0.35, 0.68, 0, 'YXZ'), this.left);
        this.right = screenTexture(512, 512);
        mfd(0.36, 0.36, V(0.72, -0.35, -0.8), new THREE.Euler(0.35, -0.68, 0, 'YXZ'), this.right);

        // status lamps under the main screen (8, chase with thrust / flash on alert)
        this.dashLamps = [];
        for (let i = 0; i < 8; i++) {
            const holder = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.01, 12), this.mBezel);
            holder.position.set(-0.32 + i * 0.09, -0.585, -0.66); holder.rotation.x = 0.4; this.group.add(holder);
            const l = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 10), this.mLampOff);
            l.position.set(-0.32 + i * 0.09, -0.58, -0.655); this.group.add(l); this.dashLamps.push(l);
        }
        // switch banks either side of the lamps
        for (const sx of [-1, 1]) {
            for (let i = 0; i < 4; i++) {
                const base = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 12), this.mBezel);
                base.position.set(sx * (0.48 + i * 0.045), -0.585, -0.66); base.rotation.x = 0.4; this.group.add(base);
                const sw = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.04, 8), this.mMetal);
                sw.position.set(sx * (0.48 + i * 0.045), -0.565, -0.655);
                sw.rotation.x = (i % 2 ? 0.7 : -0.5); this.group.add(sw);
            }
        }
        // small caution placards
        const p1 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.05), stencil('CAUTION · HI-G'));
        p1.position.set(-0.55, -0.5, -0.86); p1.rotation.x = 0.4; p1.rotation.y = 0.35; this.group.add(p1);
        const p2 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.05), stencil('NAV · AUTO', C.blue));
        p2.position.set(0.55, -0.5, -0.86); p2.rotation.x = 0.4; p2.rotation.y = -0.35; this.group.add(p2);
    }

    /* ── throttle + stick on side consoles ──────────────────────────── */
    _buildControls() {
        // left console + throttle quadrant
        this._box(0.2, 0.1, 0.42, -0.5, -0.66, -0.2, this.mHullDark, 0.02);
        this._box(0.03, 0.06, 0.26, -0.5, -0.6, -0.2, this.mBezel, 0.005);          // slot
        this.throttle = new THREE.Group(); this.throttle.position.set(-0.5, -0.62, -0.2); this.group.add(this.throttle);
        const tArm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.2, 12), this.mMetal);
        tArm.position.y = 0.1; this.throttle.add(tArm);
        const tGrip = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.05, 0.06, 3, 0.02), this.mSoft);
        tGrip.position.y = 0.21; this.throttle.add(tGrip);
        const tLamp = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 8), this.mLampOn);
        tLamp.position.set(-0.056, 0.21, 0); this.throttle.add(tLamp);
        const tLab = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.04), stencil('THRUST', C.blue));
        tLab.position.set(-0.5, -0.608, -0.44); tLab.rotation.x = -Math.PI / 2; this.group.add(tLab);

        // right console + flight stick
        this._box(0.2, 0.1, 0.42, 0.5, -0.66, -0.2, this.mHullDark, 0.02);
        const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.07, 20), this.mSoft);
        boot.position.set(0.5, -0.6, -0.2); this.group.add(boot);
        this.stick = new THREE.Group(); this.stick.position.set(0.5, -0.6, -0.2); this.group.add(this.stick);
        const sArm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.22, 14), this.mMetalDark);
        sArm.position.y = 0.11; this.stick.add(sArm);
        const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.1, 6, 14), this.mSoft);
        grip.position.y = 0.28; grip.rotation.x = -0.15; this.stick.add(grip);
        const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 12), this.mMetal);
        hat.position.set(0, 0.35, -0.02); hat.rotation.x = -0.15; this.stick.add(hat);
        const trig = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.03, 0.014, 2, 0.005), this.mLampWarn);
        trig.position.set(0, 0.29, -0.036); this.stick.add(trig);
        const sLab = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.04), stencil('ATTITUDE', C.blue));
        sLab.position.set(0.5, -0.608, -0.44); sLab.rotation.x = -Math.PI / 2; this.group.add(sLab);
    }

    /* ── seat ───────────────────────────────────────────────────────── */
    _buildSeat() {
        const back = this._box(0.64, 1.1, 0.16, 0, -0.55, 0.6, this.mSoft, 0.05); back.rotation.x = -0.1;
        this._box(0.5, 0.9, 0.03, 0, -0.55, 0.512, this.mSoftTrim, 0.02).rotation.x = -0.1;   // centre panel
        this._box(0.62, 0.14, 0.62, 0, -1.0, 0.28, this.mSoft, 0.05);                         // squab
        this._box(0.12, 0.55, 0.24, -0.37, -0.15, 0.56, this.mSoft, 0.04);                    // bolsters
        this._box(0.12, 0.55, 0.24, 0.37, -0.15, 0.56, this.mSoft, 0.04);
        this._box(0.3, 0.2, 0.12, 0, 0.1, 0.6, this.mSoft, 0.04);                            // headrest
        this._box(0.1, 0.05, 0.56, -0.41, -0.72, 0.05, this.mHullDark, 0.02);                // armrests
        this._box(0.1, 0.05, 0.56, 0.41, -0.72, 0.05, this.mHullDark, 0.02);
        // harness straps
        for (const sx of [-0.13, 0.13]) {
            const strap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.012), this.mSoftTrim);
            strap.position.set(sx, -0.5, 0.51); strap.rotation.x = -0.1; strap.rotation.z = sx > 0 ? -0.08 : 0.08;
            this.group.add(strap);
        }
    }

    /* ── lighting ───────────────────────────────────────────────────── */
    _buildLights() {
        this.cabinLight = new THREE.PointLight(0x9fd8ff, 2.4, 6.5, 1.5);
        this.cabinLight.position.set(0, 0.7, 0.3);
        this.group.add(this.cabinLight);
        this.dashLight = new THREE.PointLight(0x5eead4, 1.1, 2.4, 1.8);
        this.dashLight.position.set(0, -0.3, -0.75);
        this.group.add(this.dashLight);
        this.floorLight = new THREE.PointLight(0x2a8fa8, 0.7, 2.6, 1.6);
        this.floorLight.position.set(0, -0.9, 0.3);
        this.group.add(this.floorLight);
        this.rearLight = new THREE.PointLight(0x7dd3fc, 0.9, 3.0, 1.6);
        this.rearLight.position.set(0, 0.6, 1.0);
        this.group.add(this.rearLight);
        this.alertLight = new THREE.PointLight(0xff3b4f, 0, 4.5, 1.5);
        this.alertLight.position.set(0, 0.6, -0.4);
        this.group.add(this.alertLight);
    }

    /* ── heads-up display on the canopy ─────────────────────────────── */
    _buildHUD() {
        this.hud = screenTexture(1024, 640);
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1.24, 0.775),
            new THREE.MeshBasicMaterial({
                map: this.hud.tex, transparent: true, opacity: 0.92, depthWrite: false,
                blending: THREE.AdditiveBlending, side: THREE.DoubleSide
            })
        );
        mesh.position.set(0, 0.06, -1.3);
        mesh.renderOrder = 6;
        this.group.add(mesh);
        this.hudMesh = mesh;
    }

    /* ── public API ─────────────────────────────────────────────────── */

    setVisible(v) { this.group.visible = !!v; if (v) this.redraw(true); }
    get visible() { return this.group.visible; }

    setSegment(title, sub, index, n, list) {
        this.segment = { title, sub, index, n, list: list || this.segment.list };
        this.redraw(true);
    }

    /** kind: 'warn' | 'hit' | 'ok' | '' */
    setAlert(text, kind = 'warn') {
        this.alert = { text: text || '', kind: text ? kind : '', t: 0 };
        if (kind === 'hit' && text) this.hull = Math.max(8, this.hull - 17);
        this.redraw(true);
    }

    setNarration(text) {
        this.narration = { text: text || '', t: 0 };
        this.redraw(true);
    }

    reset() {
        this.hull = 100;
        this.alert = { text: '', kind: '', t: 0 };
        this.narration = { text: '', t: 0 };
        this.speedHist.fill(0);
        this.redraw(true);
    }

    /**
     * Per-frame. `d` carries whatever the ride knows this frame:
     * { speedNorm, speedKmh, progress, time, total, paused, bank, roll,
     *   comfort, scares, radar:[{x,z,hit}], target:{x,y,name,dist}, heading }
     */
    update(dt, d) {
        Object.assign(this.data, d);
        this.t += dt;
        this.alert.t += dt;
        this.narration.t += dt;
        this._radarSweep = (this._radarSweep + dt * 1.6) % (Math.PI * 2);

        const sp = clamp(this.data.speedNorm, 0, 1);
        // throttle follows thrust; stick leans into the bank the rail applies
        const th = -0.5 + sp * 1.0;
        this.throttle.rotation.x += (th - this.throttle.rotation.x) * Math.min(1, dt * 4);
        const sz = clamp(-(this.data.bank || 0) * 0.55, -0.5, 0.5);
        const sx = clamp(-(this.data.roll || 0) * 0.15, -0.35, 0.35) - 0.08 * sp;
        this.stick.rotation.z += (sz - this.stick.rotation.z) * Math.min(1, dt * 5);
        this.stick.rotation.x += (sx - this.stick.rotation.x) * Math.min(1, dt * 5);

        // lamps
        const alerting = this.alert.kind === 'warn' || this.alert.kind === 'hit';
        const flash = alerting && Math.sin(this.t * 14) > 0;
        this.overheadLamps.forEach((l, i) => {
            const chase = Math.floor(this.t * 4) % 8 === i;
            l.material = alerting ? (flash ? this.mLampWarn : this.mLampOff) : (chase ? this.mLampBlue : this.mLampOff);
        });
        this.dashLamps.forEach((l, i) => {
            if (alerting) l.material = flash ? this.mLampWarn : this.mLampOff;
            else l.material = i < Math.round(sp * 8) ? (i > 5 ? this.mLampAmber : this.mLampOn) : this.mLampOff;
        });
        this.alertLight.intensity = alerting ? (flash ? 2.6 : 0.5) : 0;
        this.mAccent.emissiveIntensity = 1.5 + Math.sin(this.t * 2.2) * 0.15 + sp * 0.5;

        // headset: the camera sits ~1.6 m above the dolly origin in local-floor
        // space — lift the cabin to meet the head instead of leaving it around
        // the rider's ankles
        const camY = this.camera.position.y;
        const want = Math.abs(camY) > 0.3 ? camY : 0;
        this._xrY += (want - this._xrY) * Math.min(1, dt * 2);
        this.group.position.y = this._xrY;

        this._redrawT += dt;
        if (this._redrawT > 1 / 15) { this._redrawT = 0; this.redraw(); }
    }

    /* ── drawing ────────────────────────────────────────────────────── */

    redraw(force) {
        if (!this.group.visible && !force) return;
        this._drawMain();
        this._drawLeft();
        this._drawRight();
        this._drawHUD();
    }

    _drawMain() {
        const { ctx: x, w, h } = this.main, d = this.data;
        screenBase(x, w, h, C.accentDim);
        // header
        label(x, this.segment.title, 36, 66, 40, C.accent, 'bold', 'left', ORB);
        label(x, this.segment.sub, 36, 100, 22, C.muted);
        label(x, `SEG ${this.segment.index + 1}/${this.segment.n}`, w - 36, 60, 24, C.blue, 'bold', 'right', ORB);
        label(x, `T+ ${mmss(d.time)}  ·  ${mmss(d.total)}`, w - 36, 96, 20, C.muted, '', 'right');
        // divider
        x.fillStyle = 'rgba(94,234,212,0.18)'; x.fillRect(36, 116, w - 72, 1);

        // velocity block
        label(x, 'VELOCITY', 36, 156, 18, C.muted, '600');
        const spd = Math.round(d.speedKmh).toLocaleString();
        label(x, spd, 36, 238, 84, C.text, 'bold', 'left', ORB);
        x.font = `bold 84px ${ORB}`; const sw = x.measureText(spd).width;
        label(x, 'km/h', 36 + sw + 16, 238, 24, C.accent, '600');
        // thrust bar
        label(x, 'THRUST', 36, 286, 18, C.muted, '600');
        x.fillStyle = 'rgba(255,255,255,0.08)'; rr(x, 130, 270, 380, 16, 8); x.fill();
        const g = x.createLinearGradient(130, 0, 510, 0); g.addColorStop(0, C.blue); g.addColorStop(1, C.accent);
        x.fillStyle = g; rr(x, 130, 270, Math.max(8, 380 * clamp(d.speedNorm, 0, 1)), 16, 8); x.fill();
        for (let i = 1; i < 10; i++) { x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(130 + 38 * i, 270, 2, 16); }

        // attitude indicator (artificial horizon) — rolls with the ship
        const ax = 620, ay = 210, ar = 78;
        x.save(); x.beginPath(); x.arc(ax, ay, ar, 0, Math.PI * 2); x.clip();
        x.translate(ax, ay); x.rotate((d.roll || 0) + (d.bank || 0) * 0.6);
        x.fillStyle = 'rgba(56,120,190,0.55)'; x.fillRect(-ar * 2, -ar * 2, ar * 4, ar * 2);
        x.fillStyle = 'rgba(120,80,40,0.55)'; x.fillRect(-ar * 2, 0, ar * 4, ar * 2);
        x.strokeStyle = 'rgba(255,255,255,0.8)'; x.lineWidth = 2; x.beginPath(); x.moveTo(-ar, 0); x.lineTo(ar, 0); x.stroke();
        x.strokeStyle = 'rgba(255,255,255,0.4)'; x.lineWidth = 1;
        for (const py of [-40, -20, 20, 40]) { x.beginPath(); x.moveTo(-22, py); x.lineTo(22, py); x.stroke(); }
        x.restore();
        x.strokeStyle = C.accentDim; x.lineWidth = 3; x.beginPath(); x.arc(ax, ay, ar, 0, Math.PI * 2); x.stroke();
        // fixed aircraft symbol
        x.strokeStyle = C.amber; x.lineWidth = 3; x.beginPath();
        x.moveTo(ax - 34, ay); x.lineTo(ax - 10, ay); x.lineTo(ax, ay + 8); x.lineTo(ax + 10, ay); x.lineTo(ax + 34, ay); x.stroke();
        label(x, 'ATT', ax, ay + ar + 24, 15, C.muted, '600', 'center');
        label(x, `${Math.round(THREE.MathUtils.radToDeg((d.roll || 0) + (d.bank || 0) * 0.6))}°`, ax, ay - ar - 10, 15, C.text, '600', 'center');

        // gauges
        const gauge = (lab, val, X, Y, col) => {
            label(x, lab, X, Y, 16, C.muted, '600');
            label(x, Math.round(val) + '%', X + 240, Y, 16, C.text, 'bold', 'right');
            x.fillStyle = 'rgba(255,255,255,0.08)'; rr(x, X, Y + 8, 240, 10, 5); x.fill();
            x.fillStyle = col; rr(x, X, Y + 8, Math.max(6, 240 * clamp(val / 100, 0, 1)), 10, 5); x.fill();
        };
        gauge('HULL', this.hull, 740, 150, this.hull > 50 ? C.accent : C.warn);
        gauge('SHIELD', 100 - Math.max(0, d.speedNorm - 0.6) * 60, 740, 196, C.blue);
        gauge('COOLANT', 92 - Math.sin(this.t * 0.4) * 5, 740, 242, C.violet);
        gauge('REACTOR', 74 + d.speedNorm * 22, 740, 288, C.amber);

        // route bar with segment ticks
        label(x, 'ROUTE', 36, 340, 16, C.muted, '600');
        x.fillStyle = 'rgba(255,255,255,0.08)'; rr(x, 36, 350, w - 72, 14, 7); x.fill();
        x.fillStyle = g; rr(x, 36, 350, Math.max(6, (w - 72) * clamp(d.progress, 0, 1)), 14, 7); x.fill();
        const list = this.segment.list || [];
        if (list.length && d.total) {
            let acc = 0;
            list.forEach((s, i) => {
                const px = 36 + (w - 72) * (acc / d.total);
                x.fillStyle = i === this.segment.index ? C.accent : 'rgba(255,255,255,0.35)';
                x.fillRect(px - 1, 346, 2, 22);
                acc += s.dur;
            });
        }
        // ship marker
        const mx = 36 + (w - 72) * clamp(d.progress, 0, 1);
        x.fillStyle = C.text; x.beginPath(); x.moveTo(mx, 344); x.lineTo(mx - 6, 334); x.lineTo(mx + 6, 334); x.closePath(); x.fill();

        // status strip
        const A = this.alert;
        rr(x, 36, 392, w - 72, 60, 12);
        if (A.text) {
            const on = A.kind === 'ok' || Math.sin(A.t * 12) > -0.2;
            x.fillStyle = A.kind === 'ok' ? 'rgba(20,90,70,0.85)' : (A.kind === 'hit' ? 'rgba(120,10,20,0.9)' : 'rgba(90,20,30,0.85)');
            x.fill();
            if (on) label(x, (A.kind === 'ok' ? '✓  ' : '⚠  ') + A.text, w / 2, 432, 28, A.kind === 'ok' ? '#c9ffe6' : '#ffd2d2', 'bold', 'center', ORB);
        } else if (this.narration.text && this.narration.t < 6 && !d.paused) {
            x.fillStyle = 'rgba(20,40,70,0.85)'; x.fill();
            let txt = '◉ MISSION CTRL  ·  ' + this.narration.text;
            x.font = `22px Inter, sans-serif`;
            while (x.measureText(txt).width > w - 110 && txt.length > 8) txt = txt.slice(0, -2) + '…';
            label(x, txt, w / 2, 430, 22, '#dbe7ff', '', 'center');
        } else {
            x.fillStyle = 'rgba(255,255,255,0.05)'; x.fill();
            label(x, d.paused ? '⏸  HOLDING — tap or Space to resume' : '●  ALL SYSTEMS NOMINAL', w / 2, 430, 22, d.paused ? C.amber : C.accent, 'bold', 'center');
        }
        // footer
        label(x, 'SPACEVERSE FLIGHT SYSTEMS  ·  MFD-1', 36, 490, 13, C.muted2, '600');
        label(x, d.comfort ? 'COMFORT' : 'FULL MOTION', w - 36, 490, 13, C.muted2, '600', 'right');
        this.main.tex.needsUpdate = true;
    }

    _drawLeft() {
        const { ctx: x, w, h } = this.left;
        screenBase(x, w, h, 'rgba(125,211,252,0.5)');
        label(x, 'NAV · FLIGHT PLAN', 28, 50, 26, C.blue, 'bold', 'left', ORB);
        x.fillStyle = 'rgba(125,211,252,0.18)'; x.fillRect(28, 64, w - 56, 1);
        const list = this.segment.list || [];
        const rowH = 46;
        list.forEach((s, i) => {
            const y = 104 + i * rowH;
            const cur = i === this.segment.index, done = i < this.segment.index;
            if (cur) { x.fillStyle = 'rgba(94,234,212,0.12)'; rr(x, 18, y - 30, w - 36, 40, 8); x.fill(); x.fillStyle = C.accent; x.fillRect(18, y - 30, 4, 40); }
            label(x, `${String(i + 1).padStart(2, '0')}`, 34, y, 20, cur ? C.accent : C.muted2, 'bold', 'left', ORB);
            label(x, s.title, 76, y, 21, cur ? C.text : (done ? C.muted2 : C.muted), cur ? 'bold' : '');
            label(x, done ? '✓' : `${s.dur}s`, w - 30, y, 18, done ? C.accent : C.muted2, '', 'right');
        });
        if (!list.length) label(x, 'Awaiting route upload…', 30, 110, 22, C.muted2);
        label(x, 'ETA', 28, h - 30, 15, C.muted2, '600');
        const d = this.data;
        label(x, mmss(Math.max(0, d.total - d.time)), w - 28, h - 30, 18, C.text, 'bold', 'right', ORB);
        this.left.tex.needsUpdate = true;
    }

    _drawRight() {
        const { ctx: x, w, h } = this.right, d = this.data;
        screenBase(x, w, h, 'rgba(196,181,253,0.5)');
        label(x, 'PROXIMITY · RADAR', 28, 50, 26, C.violet, 'bold', 'left', ORB);
        x.fillStyle = 'rgba(196,181,253,0.18)'; x.fillRect(28, 64, w - 56, 1);

        // radar scope
        const cx = w / 2, cy = 218, R = 128;
        x.save(); x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.clip();
        x.fillStyle = 'rgba(30,60,60,0.35)'; x.fillRect(cx - R, cy - R, R * 2, R * 2);
        x.strokeStyle = 'rgba(94,234,212,0.25)'; x.lineWidth = 1;
        for (const rr2 of [R / 3, R * 2 / 3]) { x.beginPath(); x.arc(cx, cy, rr2, 0, Math.PI * 2); x.stroke(); }
        x.beginPath(); x.moveTo(cx - R, cy); x.lineTo(cx + R, cy); x.moveTo(cx, cy - R); x.lineTo(cx, cy + R); x.stroke();
        // sweep
        const sg = x.createConicGradient ? x.createConicGradient(this._radarSweep, cx, cy) : null;
        if (sg) { sg.addColorStop(0, 'rgba(94,234,212,0.55)'); sg.addColorStop(0.18, 'rgba(94,234,212,0)'); sg.addColorStop(1, 'rgba(94,234,212,0)'); x.fillStyle = sg; x.fillRect(cx - R, cy - R, R * 2, R * 2); }
        // blips: radar entries are dolly-local (x right, z forward negative)
        const RANGE = 70;
        (d.radar || []).forEach(b => {
            const px = cx + clamp(b.x / RANGE, -1, 1) * R, py = cy + clamp(b.z / RANGE, -1, 1) * R;
            const col = b.hit ? C.warn : C.amber;
            x.fillStyle = col; x.beginPath(); x.arc(px, py, 5, 0, Math.PI * 2); x.fill();
            x.strokeStyle = col; x.lineWidth = 1.5; x.beginPath(); x.arc(px, py, 9 + Math.sin(this.t * 6) * 3, 0, Math.PI * 2); x.stroke();
        });
        x.restore();
        x.strokeStyle = 'rgba(196,181,253,0.55)'; x.lineWidth = 2; x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.stroke();
        // own ship
        x.fillStyle = C.accent; x.beginPath(); x.moveTo(cx, cy - 9); x.lineTo(cx - 6, cy + 6); x.lineTo(cx + 6, cy + 6); x.closePath(); x.fill();
        label(x, `RNG ${RANGE}u`, cx + R, cy + R + 22, 14, C.muted2, '600', 'right');
        label(x, (d.radar || []).length ? `${(d.radar || []).length} CONTACT${(d.radar || []).length > 1 ? 'S' : ''}` : 'NO CONTACTS', cx - R, cy + R + 22, 14, (d.radar || []).length ? C.amber : C.muted2, '600');

        // system rows
        const row = (lab, val, y, col = C.text) => { label(x, lab, 28, y, 18, C.muted, '600'); label(x, val, w - 28, y, 18, col, 'bold', 'right'); };
        row('THRUSTERS', d.paused ? 'IDLE' : (d.speedNorm > 0.7 ? 'FULL BURN' : 'CRUISE'), 398, d.paused ? C.amber : C.accent);
        row('ATTITUDE', `${THREE.MathUtils.radToDeg(d.bank || 0).toFixed(0)}° BANK`, 428);
        row('HAZARDS', d.scares ? 'ARMED' : 'SAFE', 458, d.scares ? C.warn : C.accent);
        row('LINK', 'MISSION CTRL ●', 488, Math.sin(this.t * 3) > 0 ? C.accent : '#2d6b60');
        this.right.tex.needsUpdate = true;
    }

    _drawHUD() {
        const { ctx: x, w, h } = this.hud, d = this.data;
        x.clearRect(0, 0, w, h);
        const cx = w / 2, cy = h / 2;
        const g = 'rgba(120,255,220,0.85)', gd = 'rgba(120,255,220,0.45)';
        x.lineWidth = 2; x.strokeStyle = g; x.fillStyle = g;
        x.font = `600 18px ${ORB}`; x.textAlign = 'center';

        // boresight
        x.beginPath(); x.arc(cx, cy, 14, 0, Math.PI * 2); x.stroke();
        x.beginPath(); x.moveTo(cx - 44, cy); x.lineTo(cx - 20, cy); x.moveTo(cx + 20, cy); x.lineTo(cx + 44, cy); x.moveTo(cx, cy - 20); x.lineTo(cx, cy - 34); x.stroke();

        // artificial horizon: rolls with the ship
        x.save(); x.translate(cx, cy); x.rotate((d.roll || 0) + (d.bank || 0) * 0.6);
        x.strokeStyle = gd; x.lineWidth = 2;
        x.beginPath(); x.moveTo(-260, 0); x.lineTo(-70, 0); x.moveTo(70, 0); x.lineTo(260, 0); x.stroke();
        for (const p of [-2, -1, 1, 2]) {
            const py = p * 62;
            x.beginPath(); x.moveTo(-120, py); x.lineTo(-40, py); x.moveTo(40, py); x.lineTo(120, py); x.stroke();
            x.fillStyle = gd; x.font = `14px ${ORB}`; x.textAlign = 'right'; x.fillText(String(Math.abs(p * 5)), -128, py + 5); x.textAlign = 'left'; x.fillText(String(Math.abs(p * 5)), 128, py + 5);
        }
        x.restore();

        // speed tape (left)
        x.strokeStyle = g; x.fillStyle = g; x.lineWidth = 2;
        const tx = 150;
        x.beginPath(); x.moveTo(tx, cy - 150); x.lineTo(tx, cy + 150); x.stroke();
        const kmh = d.speedKmh || 0;
        for (let i = -3; i <= 3; i++) {
            const v = Math.round((kmh + i * -2000) / 1000) * 1000;
            const py = cy + i * 46;
            x.beginPath(); x.moveTo(tx, py); x.lineTo(tx + 12, py); x.stroke();
            if (i !== 0) { x.font = `14px ${ORB}`; x.textAlign = 'right'; x.fillStyle = gd; x.fillText(v.toLocaleString(), tx - 8, py + 5); }
        }
        x.fillStyle = 'rgba(0,0,0,0.5)'; rr(x, tx - 132, cy - 18, 124, 36, 4); x.fill();
        x.strokeStyle = g; rr(x, tx - 132, cy - 18, 124, 36, 4); x.stroke();
        x.fillStyle = g; x.font = `bold 20px ${ORB}`; x.textAlign = 'right'; x.fillText(Math.round(kmh).toLocaleString(), tx - 14, cy + 7);
        x.font = `12px ${ORB}`; x.textAlign = 'center'; x.fillText('KM/H', tx - 70, cy - 26);

        // range-to-go tape (right)
        const rx = w - 150;
        x.beginPath(); x.moveTo(rx, cy - 150); x.lineTo(rx, cy + 150); x.stroke();
        const remain = Math.max(0, (d.total || 0) - (d.time || 0));
        for (let i = -3; i <= 3; i++) {
            const py = cy + i * 46;
            x.beginPath(); x.moveTo(rx - 12, py); x.lineTo(rx, py); x.stroke();
        }
        x.fillStyle = 'rgba(0,0,0,0.5)'; rr(x, rx + 8, cy - 18, 124, 36, 4); x.fill();
        x.strokeStyle = g; rr(x, rx + 8, cy - 18, 124, 36, 4); x.stroke();
        x.fillStyle = g; x.font = `bold 20px ${ORB}`; x.textAlign = 'left'; x.fillText(mmss(remain), rx + 18, cy + 7);
        x.font = `12px ${ORB}`; x.textAlign = 'center'; x.fillText('TO GO', rx + 70, cy - 26);

        // heading tape (top)
        const hy = 46;
        x.beginPath(); x.moveTo(cx - 240, hy); x.lineTo(cx + 240, hy); x.stroke();
        const hdg = ((d.heading || 0) * 180 / Math.PI + 360) % 360;
        for (let i = -6; i <= 6; i++) {
            const deg = (Math.round(hdg / 10) * 10 + i * 10 + 360) % 360;
            const px = cx + (deg - hdg + 540) % 360 * 0 + i * 40 - ((hdg % 10) / 10) * 40;
            if (Math.abs(px - cx) > 240) continue;
            x.beginPath(); x.moveTo(px, hy); x.lineTo(px, hy + (i % 3 === 0 ? 12 : 7)); x.stroke();
            if (i % 3 === 0) { x.font = `13px ${ORB}`; x.textAlign = 'center'; x.fillStyle = gd; x.fillText(String(deg).padStart(3, '0'), px, hy + 30); }
        }
        x.fillStyle = g; x.beginPath(); x.moveTo(cx, hy - 2); x.lineTo(cx - 7, hy - 12); x.lineTo(cx + 7, hy - 12); x.closePath(); x.fill();
        x.font = `bold 16px ${ORB}`; x.textAlign = 'center'; x.fillText(String(Math.round(hdg)).padStart(3, '0') + '°', cx, hy - 18);

        // segment title + mode line (bottom)
        x.font = `600 16px ${ORB}`; x.fillStyle = gd; x.textAlign = 'left';
        x.fillText(`▸ ${this.segment.title}`, 60, h - 40);
        x.textAlign = 'right';
        x.fillText(d.paused ? 'HOLD' : (d.comfort ? 'AUTO-NAV · COMFORT' : 'AUTO-NAV'), w - 60, h - 40);

        // target marker for the segment's focus planet
        const T = d.target;
        if (T && T.visible) {
            const px = cx + clamp(T.x, -1, 1) * (w / 2 - 80), py = cy - clamp(T.y, -1, 1) * (h / 2 - 60);
            const off = Math.abs(T.x) > 1 || Math.abs(T.y) > 1;
            x.strokeStyle = off ? gd : g; x.lineWidth = 2;
            if (off) {
                // arrow at the edge pointing to it
                x.save(); x.translate(px, py); x.rotate(Math.atan2(-(T.y), T.x));
                x.beginPath(); x.moveTo(14, 0); x.lineTo(-8, -10); x.lineTo(-8, 10); x.closePath(); x.stroke(); x.restore();
            } else {
                x.beginPath(); x.rect(px - 22, py - 22, 44, 44); x.stroke();
                x.beginPath(); x.moveTo(px - 22, py); x.lineTo(px - 32, py); x.moveTo(px + 22, py); x.lineTo(px + 32, py); x.moveTo(px, py - 22); x.lineTo(px, py - 32); x.stroke();
            }
            x.fillStyle = g; x.font = `600 15px ${ORB}`; x.textAlign = 'center';
            x.fillText(String(T.name || '').toUpperCase(), px, py + 44);
            if (T.dist != null) { x.font = `12px ${ORB}`; x.fillStyle = gd; x.fillText(`${Math.round(T.dist)} u`, px, py + 62); }
        }

        // alert flash on the HUD
        const A = this.alert;
        if (A.text && (A.kind === 'ok' || Math.sin(A.t * 12) > -0.2)) {
            x.fillStyle = A.kind === 'ok' ? 'rgba(120,255,220,0.9)' : 'rgba(255,110,120,0.95)';
            x.font = `bold 26px ${ORB}`; x.textAlign = 'center';
            x.fillText((A.kind === 'ok' ? '✓ ' : '⚠ ') + A.text, cx, cy + 118);
        }
        this.hud.tex.needsUpdate = true;
    }
}
