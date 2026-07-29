/**
 * Host page for Kessler Run.
 *
 * The mission is pure state and pure maths; this file is the only part that
 * knows Three.js exists. It reads the mission's object list each frame and draws
 * it, and it owns the frame loop, because the core deliberately does not.
 *
 * A plain requestAnimationFrame is correct here: this page has no WebXR session.
 * The VR page pumps the same core from renderer.setAnimationLoop instead, which
 * is exactly the flexibility the renderer-agnostic core buys.
 */
import * as THREE from 'three';
import MissionCore from './core.js';
import { createKesslerRun } from './missions/kessler.js';
import { SHELL_HEIGHT } from '../shared/kessler-risk.mjs';

const $ = (id) => document.getElementById(id);

const EARTH_RADIUS = 14;
const SCALE = 1.6;   // scene units per altitude unit

let renderer, scene, camera, earth;
let mission = null;
let rafId = null;
let lastT = 0;
let meshes = new Map();     // object id -> mesh
let selectionRing = null;
let raycaster, pointer;

/* ── scene ─────────────────────────────────────────────────────────── */

function initScene() {
    const host = $('scene');
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03060f);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.position.set(0, 62, 128);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x668bbb, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(60, 40, 60);
    scene.add(sun);

    earth = new THREE.Mesh(
        new THREE.SphereGeometry(EARTH_RADIUS, 48, 32),
        new THREE.MeshStandardMaterial({ color: 0x1c4b8a, roughness: 0.85, metalness: 0.05 })
    );
    scene.add(earth);

    // Shell guides, so a player can SEE which band is filling up. The whole
    // mission is about crowding, and crowding you cannot see is just bad luck.
    for (let s = 0; s < 6; s++) {
        const r = EARTH_RADIUS + (s * SHELL_HEIGHT + SHELL_HEIGHT / 2) * SCALE * 0.35;
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(r - 0.12, r + 0.12, 128),
            new THREE.MeshBasicMaterial({ color: 0x2a4a7a, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
        );
        ring.rotation.x = Math.PI / 2;
        scene.add(ring);
    }

    const stars = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 1400; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(400 + Math.random() * 500);
        pts.push(v.x, v.y, v.z);
    }
    stars.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0x8fa6c8, size: 1.4 })));

    selectionRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.9, 0.12, 8, 32),
        new THREE.MeshBasicMaterial({ color: 0x64ffda })
    );
    selectionRing.visible = false;
    scene.add(selectionRing);

    raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 2;
    pointer = new THREE.Vector2();

    window.addEventListener('resize', onResize);
    renderer.domElement.addEventListener('pointerdown', onPick);
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

/** Position on screen -> the satellite under the cursor, if any. */
function onPick(e) {
    if (!mission) return;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(Array.from(meshes.values()), false);
    const hit = hits.find((h) => h.object.userData.satellite);
    if (!hit) return;
    MissionCore.input({ type: 'select', id: hit.object.userData.id });
    updateSelectionLabel();
}

function positionFor(o) {
    const r = EARTH_RADIUS + o.altitude * SCALE * 0.35;
    // Inclination tilts the orbital plane; angle is the position along it.
    const x = Math.cos(o.angle) * r;
    const z = Math.sin(o.angle) * r * Math.cos(o.inclination);
    const y = Math.sin(o.angle) * r * Math.sin(o.inclination) * 0.75;
    return { x, y, z };
}

const satGeo = new THREE.SphereGeometry(0.85, 12, 10);
const debrisGeo = new THREE.SphereGeometry(0.42, 6, 5);
const satMat = new THREE.MeshStandardMaterial({ color: 0x7aa2ff, emissive: 0x1b3a6b, emissiveIntensity: 0.7 });
const debrisMat = new THREE.MeshStandardMaterial({ color: 0xff7a7a, emissive: 0x5a1010, emissiveIntensity: 0.6 });
// A pair on a predicted collision course lights up amber. Without this the
// player is told a warning exists and left to guess which of a hundred dots it
// is about — the highlight is what turns the alert into a decision.
const warnMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0x7a5410, emissiveIntensity: 1.2 });

function syncMeshes() {
    const objects = mission.objects();
    const live = new Set();

    const warned = mission.warnedIds();
    for (const o of objects) {
        live.add(o.id);
        let m = meshes.get(o.id);
        if (!m) {
            m = new THREE.Mesh(o.debris ? debrisGeo : satGeo, o.debris ? debrisMat : satMat);
            m.userData = { id: o.id, satellite: !o.debris };
            scene.add(m);
            meshes.set(o.id, m);
        }
        m.material = warned.has(o.id) ? warnMat : (o.debris ? debrisMat : satMat);
        const p = positionFor(o);
        m.position.set(p.x, p.y, p.z);
    }

    for (const [id, m] of meshes) {
        if (live.has(id)) continue;
        scene.remove(m);
        meshes.delete(id);
    }

    const selId = mission.selected();
    const selMesh = selId ? meshes.get(selId) : null;
    selectionRing.visible = !!selMesh;
    if (selMesh) {
        selectionRing.position.copy(selMesh.position);
        selectionRing.lookAt(camera.position);
    }
}

/* ── HUD ───────────────────────────────────────────────────────────── */

const fmtTime = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const hud = {
    setRisk(risk) {
        $('risk-val').textContent = `${risk.toFixed(1)}%`;
        $('risk-fill').style.width = `${risk}%`;
    },
    setFuel(fuel, max) {
        $('fuel-val').textContent = String(fuel);
        $('fuel-fill').style.width = `${(fuel / max) * 100}%`;
    },
    setStats({ alive, debris, lost, survivedMs }) {
        $('alive-val').textContent = String(alive);
        $('debris-val').textContent = String(debris);
        $('lost-val').textContent = String(lost);
        $('time-val').textContent = fmtTime(survivedMs);
    },
    flash(kind) {
        const el = $('flash');
        el.className = `hud show ${kind}`;
        el.textContent = kind === 'collision' ? '💥 COLLISION'
            : kind === 'conjunction' ? '⚠ CONJUNCTION WARNING'
            : '⛽ OUT OF FUEL';
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.className = 'hud'; }, kind === 'conjunction' ? 1100 : 700);
    }
};

function updateSelectionLabel() {
    const id = mission.selected();
    $('sel-label').textContent = id ? `Satellite #${id} selected` : 'No satellite selected';
}

/* ── run control ───────────────────────────────────────────────────── */

function loop(t) {
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
    lastT = t;
    MissionCore.tick(dt);
    if (mission) syncMeshes();
    earth.rotation.y += dt * 0.06;
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(loop);
}

function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    lastT = 0;
}

async function startRun() {
    $('brief').style.display = 'none';
    $('done').style.display = 'none';

    MissionCore.unregister('kessler-run');
    mission = createKesslerRun({ hud });
    MissionCore.register(mission);

    try {
        await MissionCore.run('kessler-run');
    } catch (err) {
        console.error('[kessler] could not start:', err);
        window.alert('Could not start the run: ' + err.message);
        return;
    }
    updateSelectionLabel();
    stopLoop();
    rafId = requestAnimationFrame(loop);
}

MissionCore.on('result', (result) => {
    if (result.abandoned) {
        window.location.href = '/app';
        return;
    }
    $('done').style.display = 'flex';
    $('done-title').textContent = result.won ? '✅ FIELD HELD' : '💥 FIELD LOST';
    $('done-detail').textContent =
        `${result.facts.satellitesAlive} satellites still flying · ` +
        `${result.facts.satellitesLost} lost · ` +
        `${fmtTime(result.facts.survivedMs)} survived · peak risk ${result.facts.peakRisk}%`;
    $('done-score').textContent = typeof result.score === 'number' ? `${result.score} XP` : '';

    if (result.saved === false) {
        $('done-note').style.display = '';
        $('done-note').textContent = '⚠ Not saved — no connection. It will retry automatically.';
    } else {
        $('done-note').style.display = 'none';
    }
});

MissionCore.on('warning', (w) => {
    if (w.code === 'no-tick') {
        console.error('[kessler] the page is not pumping the core — the run will not advance.');
    }
});

function quit() {
    if (MissionCore.snapshot().running) {
        if (!window.confirm('Abandon this run? It will not be scored.')) return;
        MissionCore.abort('player-left');
        return;
    }
    window.location.href = '/app';
}

/* ── wiring ────────────────────────────────────────────────────────── */

initScene();
renderer.render(scene, camera);

$('btn-start').onclick = () => startRun();
$('btn-again').onclick = () => startRun();
$('btn-quit').onclick = () => quit();
$('btn-up').onclick = () => MissionCore.input({ type: 'burn', direction: 1 });
$('btn-down').onclick = () => MissionCore.input({ type: 'burn', direction: -1 });

// One key to grab the most urgent threat. Asking a player to click a
// three-pixel dot while a collision clock runs is a dexterity test, not a
// decision; this keeps the decision and drops the dexterity.
function selectThreat() {
    if (!mission) return;
    const threat = mission.topThreat();
    if (!threat) return;
    // Prefer whichever of the pair is a satellite (debris cannot be selected).
    MissionCore.input({ type: 'select', id: threat.a });
    if (!mission.selected()) MissionCore.input({ type: 'select', id: threat.b });
    updateSelectionLabel();
}
$('btn-threat').onclick = () => selectThreat();

window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowUp') { e.preventDefault(); MissionCore.input({ type: 'burn', direction: 1 }); }
    if (e.code === 'ArrowDown') { e.preventDefault(); MissionCore.input({ type: 'burn', direction: -1 }); }
    if (e.code === 'KeyT') selectThreat();
    if (e.code === 'Escape') quit();
});

// QA handle, same convention as the VR page.
window.__kessler = { core: MissionCore, mission: () => mission, start: startRun };
