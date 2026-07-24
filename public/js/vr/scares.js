/**
 * Jumpscare director.
 *
 * Spawns objects on a genuine collision course with the rider and makes them
 * miss by a hair. Because the ride camera position is known ahead of time
 * (the track is a curve), the near miss is computed rather than faked: we ask
 * the ride where the camera *will* be, aim the rock at a point a couple of
 * metres beside that spot, and let it fly.
 *
 * Everything is camera-attached so the effects work identically on a flat
 * screen and inside a headset.
 */
import * as THREE from 'three';
import { rockGeometry } from './solar-system.js';

function crackTexture(size = 1024) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    x.clearRect(0, 0, size, size);
    // off-centre so the break reads as a strike on the canopy, not a screen effect
    const cx = size * (0.24 + Math.random() * 0.26), cy = size * (0.3 + Math.random() * 0.3);
    x.lineCap = 'round';
    for (let i = 0; i < 13; i++) {
        const a0 = (i / 13) * Math.PI * 2 + Math.random() * 0.5;
        let px = cx, py = cy, a = a0;
        x.beginPath();
        x.moveTo(px, py);
        const segs = 3 + Math.floor(Math.random() * 4);
        for (let s = 0; s < segs; s++) {
            a += (Math.random() - 0.5) * 0.85;
            const len = size * (0.025 + Math.random() * 0.055);
            px += Math.cos(a) * len;
            py += Math.sin(a) * len;
            x.lineTo(px, py);
        }
        x.strokeStyle = 'rgba(198,226,255,0.5)';
        x.lineWidth = 2.2;
        x.stroke();
        x.strokeStyle = 'rgba(120,190,255,0.28)';
        x.lineWidth = 0.9;
        x.stroke();
    }
    // frosted impact star
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, size * 0.075);
    g.addColorStop(0, 'rgba(220,240,255,0.42)');
    g.addColorStop(1, 'rgba(220,240,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, size, size);

    // fade the whole sheet toward the edges so it never looks like a full-screen filter
    const mask = x.createRadialGradient(cx, cy, size * 0.05, cx, cy, size * 0.55);
    mask.addColorStop(0, 'rgba(0,0,0,1)');
    mask.addColorStop(0.75, 'rgba(0,0,0,0.35)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    x.globalCompositeOperation = 'destination-in';
    x.fillStyle = mask;
    x.fillRect(0, 0, size, size);
    x.globalCompositeOperation = 'source-over';

    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

function sparkTexture(size = 128) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,242,214,1)');
    g.addColorStop(0.3, 'rgba(255,176,92,0.65)');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

function vignetteTexture(size = 512) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(size / 2, size / 2, size * 0.16, size / 2, size / 2, size * 0.52);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    x.fillStyle = g;
    x.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
}

export class ScareDirector {
    constructor({ scene, camera, audio, haptics }) {
        this.scene = scene;
        this.camera = camera;
        this.audio = audio;
        this.haptics = haptics || (() => {});
        this.enabled = true;
        this.intensity = 1;
        this.actors = [];
        this.shake = { x: 0, y: 0, z: 0, amp: 0 };
        this.onEvent = () => {};
        this._tmp = new THREE.Vector3();
        this._buildOverlays();
        this._pool();
    }

    _buildOverlays() {
        // full-FOV quads parented to the camera; z = -0.4 keeps them inside the
        // near plane for both the desktop camera and XR eye cameras
        const mk = (mat) => {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), mat);
            m.position.z = -0.42;
            m.renderOrder = 999;
            m.frustumCulled = false;
            m.visible = false;
            this.camera.add(m);
            return m;
        };
        // the alarm flash is shaped like a vignette: red pushed to the edges of
        // vision, centre left clear. A flat red wash over the whole frame reads
        // as a broken renderer, and in a headset it is genuinely unpleasant.
        this.flash = mk(new THREE.MeshBasicMaterial({
            map: vignetteTexture(), color: 0xff3524, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false
        }));
        this.flash.scale.set(1.4, 1.4, 1);
        this.crack = mk(new THREE.MeshBasicMaterial({
            map: crackTexture(), transparent: true, opacity: 0,
            depthTest: false, depthWrite: false
        }));
        this.vignette = mk(new THREE.MeshBasicMaterial({
            map: vignetteTexture(), transparent: true, opacity: 0,
            depthTest: false, depthWrite: false
        }));
        this.vignette.scale.set(1.35, 1.35, 1);
        this.vignette.visible = true;
        this.flashT = 0; this.crackT = 0;
    }

    _pool() {
        // scare rocks fill the frame, so they carry more detail than belt rocks
        this.geoRock = rockGeometry(9.3, 3);
        this.matRock = new THREE.MeshStandardMaterial({ color: 0x6f665e, roughness: 1, flatShading: true });
        this.matIce = new THREE.MeshStandardMaterial({ color: 0x9db0c6, roughness: 0.85, flatShading: true });
        this.matMetal = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.85, flatShading: true });

        // debris burst shared particle system — soft round sparks, not quads
        const n = 140;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        this.debris = {
            pts: new THREE.Points(g, new THREE.PointsMaterial({
                map: sparkTexture(), color: 0xffcf9a, size: 0.32, sizeAttenuation: true,
                transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
            })),
            vel: new Float32Array(n * 3), n, life: 0
        };
        this.debris.pts.frustumCulled = false;
        this.debris.pts.visible = false;
        this.scene.add(this.debris.pts);
    }

    setEnabled(v) { this.enabled = v; }
    setIntensity(v) { this.intensity = v; }

    /**
     * @param spec  { kind, from, size, miss, lead, label, hit }
     * @param ctx   { position, quaternion, predict(dtSeconds) -> Vector3 }
     */
    trigger(spec, ctx) {
        if (!this.enabled) return;
        const lead = spec.lead || 1.6;
        const size = spec.size || 5;
        const miss = (spec.miss || 3) * (1 + (1 - this.intensity) * 1.6);

        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ctx.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(ctx.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ctx.quaternion);

        // where the rider will be when the rock arrives
        const meet = ctx.predict ? ctx.predict(lead) : ctx.position.clone();

        const dirs = {
            'front': fwd.clone().negate(),
            'front-left': fwd.clone().negate().addScaledVector(right, -0.55),
            'front-right': fwd.clone().negate().addScaledVector(right, 0.55),
            'above': fwd.clone().negate().addScaledVector(up, 0.85),
            'below': fwd.clone().negate().addScaledVector(up, -0.8).addScaledVector(right, 0.3),
            'behind': fwd.clone().addScaledVector(right, 0.25).addScaledVector(up, 0.15)
        };
        const approach = (dirs[spec.from] || dirs.front).normalize();

        // sideways offset so it shaves past instead of hitting
        const lat = right.clone().multiplyScalar((spec.from === 'front-left' ? 1 : -1) * miss)
            .addScaledVector(up, (Math.random() - 0.5) * miss * 0.6);
        const target = meet.clone().add(lat);

        const travel = spec.distance || (spec.from === 'behind' ? 260 : 420);
        const start = target.clone().addScaledVector(approach, travel);

        const mat = spec.kind === 'derelict' ? this.matMetal : (spec.kind === 'ice' ? this.matIce : this.matRock);
        let mesh;
        if (spec.kind === 'derelict') {
            mesh = new THREE.Group();
            const body = new THREE.Mesh(new THREE.BoxGeometry(size * 1.6, size * 0.8, size * 0.8), mat);
            mesh.add(body);
            const panel = new THREE.Mesh(
                new THREE.BoxGeometry(size * 0.12, size * 2.6, size * 1.1),
                new THREE.MeshStandardMaterial({ color: 0x1d3b6e, roughness: 0.4, metalness: 0.6 })
            );
            panel.position.x = size * 1.1;
            mesh.add(panel);
            const panel2 = panel.clone();
            panel2.position.x = -size * 1.1;
            mesh.add(panel2);
        } else {
            mesh = new THREE.Mesh(this.geoRock, mat);
            mesh.scale.set(size, size * (0.7 + Math.random() * 0.5), size * (0.8 + Math.random() * 0.4));
        }
        mesh.position.copy(start);
        this.scene.add(mesh);

        const vel = target.clone().sub(start).divideScalar(lead);
        this.actors.push({
            mesh, vel, t: 0, lead, spec,
            spin: new THREE.Vector3((Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 2.2),
            firedWarn: false, firedNear: false, ttl: lead + 2.4
        });

        if (this.audio) {
            this.audio.alarm(spec.from === 'behind' ? 2 : 3);
            // the whoosh peaks right as the rock passes the canopy
            setTimeout(() => this.audio.whoosh(1.2, spec.from === 'front-left' ? -0.9 : 0.9, this.intensity),
                Math.max(0, (lead - 0.75) * 1000));
        }
        this.onEvent({ type: 'incoming', label: spec.label || 'COLLISION WARNING' });
    }

    /** camera-attached shake + overlays; returns nothing, read this.shake */
    update(dt, cameraWorldPos) {
        // actors
        for (let i = this.actors.length - 1; i >= 0; i--) {
            const a = this.actors[i];
            a.t += dt;
            a.mesh.position.addScaledVector(a.vel, dt);
            a.mesh.rotation.x += a.spin.x * dt;
            a.mesh.rotation.y += a.spin.y * dt;
            a.mesh.rotation.z += a.spin.z * dt;

            const d = cameraWorldPos ? a.mesh.position.distanceTo(cameraWorldPos) : 999;
            if (!a.firedNear && (d < (a.spec.size || 5) * 3.2 || a.t > a.lead)) {
                a.firedNear = true;
                this._impact(a.spec, a.mesh.position);
            }
            if (a.t > a.ttl) {
                this.scene.remove(a.mesh);
                if (a.mesh.isMesh) { /* geometry is shared, only dispose clones */ }
                this.actors.splice(i, 1);
            }
        }

        // shake decay
        if (this.shake.amp > 0.0001) {
            this.shake.amp *= Math.pow(0.045, dt);
            const a = this.shake.amp;
            this.shake.x = (Math.random() - 0.5) * a;
            this.shake.y = (Math.random() - 0.5) * a;
            this.shake.z = (Math.random() - 0.5) * a * 1.6;
        } else {
            this.shake.amp = 0; this.shake.x = this.shake.y = this.shake.z = 0;
        }

        // overlays
        if (this.flashT > 0) {
            this.flashT = Math.max(0, this.flashT - dt);
            this.flash.material.opacity = Math.pow(this.flashT / 0.55, 2) * 0.55 * this.intensity;
            this.flash.visible = this.flash.material.opacity > 0.001;
        } else this.flash.visible = false;

        if (this.crackT > 0) {
            this.crackT = Math.max(0, this.crackT - dt);
            const k = this.crackT / 2.6;
            this.crack.material.opacity = Math.min(1, k * 1.6) * 0.62 * this.intensity;
            this.crack.visible = true;
        } else this.crack.visible = false;

        // debris
        const db = this.debris;
        if (db.life > 0) {
            db.life -= dt;
            const p = db.pts.geometry.attributes.position;
            for (let i = 0; i < db.n; i++) {
                p.array[i * 3] += db.vel[i * 3] * dt;
                p.array[i * 3 + 1] += db.vel[i * 3 + 1] * dt;
                p.array[i * 3 + 2] += db.vel[i * 3 + 2] * dt;
            }
            p.needsUpdate = true;
            db.pts.material.opacity = Math.max(0, db.life / 1.1) * 0.85;
            db.pts.visible = true;
        } else db.pts.visible = false;
    }

    _impact(spec, where) {
        const inten = this.intensity;
        this.shake.amp = (spec.hit ? 0.075 : 0.038) * inten;
        this.flashT = spec.hit ? 0.55 : 0.34;
        if (spec.hit) this.crackT = 2.6;
        if (this.audio) {
            if (spec.hit) this.audio.impact(inten);
            else this.audio.whoosh(0.5, 0, inten * 0.7);
        }
        this.haptics(spec.hit ? 1 : 0.6, spec.hit ? 220 : 110);
        this.onEvent({ type: spec.hit ? 'hit' : 'nearmiss', label: spec.label || 'NEAR MISS' });
        if (spec.hit) this._burst(where);
    }

    _burst(where) {
        const db = this.debris;
        const p = db.pts.geometry.attributes.position;
        const origin = new THREE.Vector3();
        if (where) {
            origin.copy(where);
        } else {
            this.camera.getWorldPosition(origin);
            const fwd = new THREE.Vector3(0, 0, -1)
                .applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
            origin.addScaledVector(fwd, 14);
        }
        for (let i = 0; i < db.n; i++) {
            // scatter the origin a little so the burst has volume up close
            p.array[i * 3] = origin.x + (Math.random() - 0.5) * 2.5;
            p.array[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 2.5;
            p.array[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 2.5;
            const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
                .normalize().multiplyScalar(22 + Math.random() * 55);
            db.vel[i * 3] = v.x; db.vel[i * 3 + 1] = v.y; db.vel[i * 3 + 2] = v.z;
        }
        p.needsUpdate = true;
        db.life = 1.1;
    }

    /** comfort tunnelling — call every frame with 0..1 speed */
    setVignette(level) {
        this.vignette.material.opacity = Math.max(0, Math.min(0.92, level));
        this.vignette.visible = level > 0.01;
    }

    clear() {
        this.actors.forEach(a => this.scene.remove(a.mesh));
        this.actors.length = 0;
        this.shake.amp = 0;
        this.flashT = this.crackT = 0;
        this.debris.life = 0;
    }
}
