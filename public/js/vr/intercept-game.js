import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { InterceptRun } from './intercept-run.js?v=20261125-q3';
import {
    buildMissionCabin,
    buildSpaceBackdrop,
    createGlowTexture,
    createHullTexture,
    createSolarTexture,
    createSpaceEnvMap,
    ParticlePool
} from './quest-assets.js?v=20261125-q3';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function makeMesh(parent, geo, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
}

function buildDroneVisual(heavy = false, envMap = null) {
    const group = new THREE.Group();
    const hull = new THREE.MeshStandardMaterial({
        color: heavy ? 0x64748b : 0x334155,
        metalness: 0.72,
        roughness: 0.32,
        envMap
    });
    const wingMat = new THREE.MeshStandardMaterial({
        color: heavy ? 0xf59e0b : 0xf43f5e,
        emissive: heavy ? 0x92400e : 0x881337,
        emissiveIntensity: 0.5,
        metalness: 0.55,
        roughness: 0.35,
        envMap
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: heavy ? 0xfbbf24 : 0xff4d6d });

    const scale = heavy ? 1.35 : 0.95;
    group.scale.setScalar(scale);

    makeMesh(group, new THREE.OctahedronGeometry(0.42, 1), hull);
    makeMesh(group, new THREE.SphereGeometry(0.16, 12, 10), eyeMat, 0, 0, 0.36);
    const ring = makeMesh(group, new THREE.TorusGeometry(0.58, 0.045, 8, 24), wingMat);
    ring.rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) {
        makeMesh(group, new RoundedBoxGeometry(0.55, 0.14, 0.28, 2, 0.02), hull, side * 0.56, 0, -0.05);
    }
    group.userData.ring = ring;
    return group;
}

function buildBossVisual(envMap = null) {
    const boss = new THREE.Group();
    const mHull = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.78, roughness: 0.28, envMap });
    const mCore = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
    const mGold = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0x78350f, emissiveIntensity: 0.45, metalness: 0.75, roughness: 0.3, envMap });

    makeMesh(boss, new THREE.IcosahedronGeometry(1.45, 1), mHull);
    makeMesh(boss, new THREE.SphereGeometry(0.68, 20, 14), mCore, 0, 0, 0.85);
    const ring1 = makeMesh(boss, new THREE.TorusGeometry(2.15, 0.09, 10, 42), mGold);
    const ring2 = makeMesh(boss, new THREE.TorusGeometry(2.45, 0.06, 8, 42), mCore);
    ring2.rotation.x = Math.PI / 3;
    boss.userData.ring1 = ring1;
    boss.userData.ring2 = ring2;
    return boss;
}

/** Meta Quest 3 flagship dual-wield VR game: Orbital Intercept. */
export class InterceptGame {
    constructor(scene, options = {}) {
        this.run = new InterceptRun();
        this.renderer = options.renderer || null;
        this.audio = options.audio || null;
        this.haptics = options.haptics || (() => {});
        this.envMap = options.envMap || createSpaceEnvMap(this.renderer);

        this.root = new THREE.Group();
        this.root.visible = false;
        scene.add(this.root);

        this.origin = new THREE.Vector3();
        this.rotation = new THREE.Quaternion();
        this.offset = new THREE.Vector3();
        this.particles = new ParticlePool(this.root, 360, 0.28);

        this.targetMeshes = new Map();
        this.shotMeshes = new Map();
        this.beamLines = [];
        this.empTimer = 0;

        this.buildScene();
    }

    buildScene() {
        const root = this.root;
        root.add(new THREE.HemisphereLight(0xd4ecff, 0x162238, 1.4));
        const sun = new THREE.DirectionalLight(0xffe7c2, 3.0);
        sun.position.set(-25, 36, 18);
        root.add(sun);
        const rim = new THREE.DirectionalLight(0x38bdf8, 1.4);
        rim.position.set(18, -8, -14);
        root.add(rim);

        this.backdrop = buildSpaceBackdrop(root, 'earth-orbit', this.envMap);

        // Background Orbital Starbase Ring protecting Earth behind/below player
        const hullTex = createHullTexture('#6e7f96', '#1b2434');
        const solarTex = createSolarTexture();
        const starbase = new THREE.Group();
        starbase.position.set(0, -5.8, 3.5);
        root.add(starbase);
        makeMesh(
            starbase,
            new THREE.TorusGeometry(8.5, 0.55, 10, 48),
            new THREE.MeshStandardMaterial({ color: 0x94a3b8, map: hullTex, metalness: 0.65, roughness: 0.35, envMap: this.envMap })
        ).rotation.x = Math.PI / 2;
        for (const side of [-1, 1]) {
            makeMesh(
                starbase,
                new THREE.BoxGeometry(6.5, 0.08, 2.2),
                new THREE.MeshStandardMaterial({ color: 0x3b6cb8, map: solarTex, metalness: 0.5, roughness: 0.28, envMap: this.envMap }),
                side * 12, 0, 0
            );
        }
        this.starbase = starbase;

        // Player EVA Defense Platform & Cockpit Frame
        this.platform = new THREE.Group();
        root.add(this.platform);
        this.cockpitShell = buildMissionCabin({
            style: 'eva',
            accent: '#64ffda',
            envMap: this.envMap
        });
        this.platform.add(this.cockpitShell.group);

        // Armored deck floor ring under the pilot
        makeMesh(
            this.platform,
            new THREE.CylinderGeometry(1.5, 1.65, 0.14, 32),
            new THREE.MeshStandardMaterial({ color: 0x1e293b, map: hullTex, metalness: 0.6, roughness: 0.45, envMap: this.envMap }),
            0, -1.35, 0
        );
        this.hullRing = makeMesh(
            this.platform,
            new THREE.TorusGeometry(1.52, 0.032, 6, 48),
            new THREE.MeshBasicMaterial({ color: 0x64ffda }),
            0, -1.27, 0
        );
        this.hullRing.rotation.x = Math.PI / 2;


        // Expanding EMP shockwave ring + glow sphere
        this.empSphere = new THREE.Mesh(
            new THREE.SphereGeometry(1, 24, 18),
            new THREE.MeshBasicMaterial({
                color: 0x64ffda,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            })
        );
        this.empSphere.visible = false;
        this.root.add(this.empSphere);

        // Shared geometries/materials for dynamic targets & plasma bolts
        this.geoMeteor = new THREE.IcosahedronGeometry(0.95, 1);
        this.matMeteor = new THREE.MeshStandardMaterial({ color: 0x7c6f64, roughness: 0.88, metalness: 0.16, envMap: this.envMap });
        this.matMagma = new THREE.MeshStandardMaterial({
            color: 0x451a03, emissive: 0xf97316, emissiveIntensity: 0.9, roughness: 0.6, metalness: 0.25
        });
        this.matShard = new THREE.MeshStandardMaterial({
            color: 0x7c2d12, emissive: 0xfb923c, emissiveIntensity: 0.8, roughness: 0.5
        });
        this.matPylon = new THREE.MeshStandardMaterial({
            color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.85, metalness: 0.6, roughness: 0.25
        });
        this.geoEnemyShot = new THREE.SphereGeometry(0.18, 12, 10);
        this.matEnemyShot = new THREE.MeshBasicMaterial({ color: 0xff4d6d });
        this.glowTex = createGlowTexture('rgba(255,95,120,1)', 'rgba(255,40,80,0)');

        // Pool of glowing blaster/rail-lance tracer beams
        for (let i = 0; i < 10; i++) {
            const mat = new THREE.MeshBasicMaterial({ color: 0x64ffda, transparent: true, opacity: 0.9 });
            const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 8), mat);
            cyl.visible = false;
            this.root.add(cyl);
            this.beamLines.push(cyl);
        }
    }

    start(dolly, headOrientation) {
        this.run.reset();
        this.root.visible = true;
        this.origin.copy(dolly.position);
        this.rotation.copy(dolly.quaternion);
        if (headOrientation) {
            const yaw = new THREE.Euler().setFromQuaternion(headOrientation, 'YXZ').y;
            this.rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
        }
        this.root.position.copy(this.origin);
        this.root.quaternion.copy(this.rotation);
        this._clearDynamicMeshes();
        this.syncScene(0);
    }

    _clearDynamicMeshes() {
        for (const m of this.targetMeshes.values()) this.root.remove(m);
        for (const s of this.shotMeshes.values()) this.root.remove(s);
        this.targetMeshes.clear();
        this.shotMeshes.clear();
        for (const b of this.beamLines) b.visible = false;
        this.empSphere.visible = false;
    }

    stop() {
        this.run.pause();
        this.root.visible = false;
    }

    recenter(orientation) {
        if (!orientation) return;
        const yaw = new THREE.Euler().setFromQuaternion(orientation, 'YXZ').y;
        this.rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        this.root.quaternion.copy(this.rotation);
    }

    _createTargetMesh(t) {
        if (t.kind === 'meteor') return new THREE.Mesh(this.geoMeteor, this.matMeteor);
        if (t.kind === 'magma') {
            const m = new THREE.Mesh(this.geoMeteor, this.matMagma);
            m.scale.setScalar(1.18);
            return m;
        }
        if (t.kind === 'shard') {
            const m = new THREE.Mesh(this.geoMeteor, this.matShard);
            m.scale.setScalar(0.65);
            return m;
        }
        if (t.kind === 'scout') return buildDroneVisual(false, this.envMap);
        if (t.kind === 'heavy') return buildDroneVisual(true, this.envMap);
        if (t.kind === 'pylon') return new THREE.Mesh(new THREE.OctahedronGeometry(0.62, 0), this.matPylon);
        if (t.kind === 'boss') return buildBossVisual(this.envMap);
        return new THREE.Mesh(this.geoMeteor, this.matMeteor);
    }

    update(dt, _camera, dolly, suspended = false, input = null, rig = null) {
        if (!this.root.visible) return;
        this.backdrop.update(dt);
        this.particles.update(dt);
        this.starbase.rotation.y += dt * 0.04;

        if (this.empTimer > 0) {
            this.empTimer = Math.max(0, this.empTimer - dt);
            const p = 1 - this.empTimer / 0.65;
            this.empSphere.visible = true;
            this.empSphere.scale.setScalar(1 + p * 34);
            this.empSphere.material.opacity = (1 - p) * 0.45;
            if (this.empTimer <= 0) this.empSphere.visible = false;
        }

        if (!suspended) {
            const left = input?.left;
            const right = input?.right;
            const invQ = this.root.quaternion.clone().invert();

            // Right Trigger fires plasma blaster; releasing charged Right Grip fires Rail-Lance
            const wasCharged = this.run.railCharge >= 0.92;
            const releaseRail = wasCharged && !right?.gripPressed;
            if (right?.triggerJustPressed || releaseRail) {
                const pose = rig?.getMuzzlePose?.();
                let localOrigin, localDir;
                if (pose) {
                    localOrigin = pose.position.clone().sub(this.root.position).applyQuaternion(invQ);
                    localDir = pose.direction.clone().applyQuaternion(invQ).normalize();
                } else {
                    localOrigin = new THREE.Vector3(this.run.x + 0.35, -0.2, -0.6);
                    localDir = new THREE.Vector3(0, 0.05, -1).normalize();
                }
                const charged = releaseRail;
                if (charged) this.run.railCharge = 0;
                rig?.triggerBlasterRecoil?.(charged);
                this.run.fireBlaster(localOrigin, localDir, charged);
            }

            // Left Trigger Aegis Holo-Shield intercepts incoming plasma bolts
            if (left?.triggerPressed) {
                const shieldPose = rig?.getShieldPose?.();
                let sPos;
                if (shieldPose) {
                    sPos = shieldPose.position.clone().sub(this.root.position).applyQuaternion(invQ);
                } else {
                    sPos = new THREE.Vector3(this.run.x - 0.32, -0.1, -0.65);
                }
                const deflected = this.run.deflectWithShield(sPos, null, shieldPose?.radius || 0.65);
                if (deflected > 0) rig?.triggerShieldBlock?.();
            }

            // Left Grip unleashes EMP Shockwave at 100% charge
            if (left?.gripJustPressed && this.run.empCharge >= 100) {
                this.run.triggerEMP();
            }

            this.run.update(dt, {
                x: left?.stick?.x ?? (Number.isFinite(input?.x) ? input.x : 0),
                chargeHeld: Boolean(right?.gripPressed)
            });

            this._handleEvents();
        }

        this.offset.set(this.run.x, 0, 0).applyQuaternion(this.rotation);
        dolly.position.copy(this.origin).add(this.offset);
        this.platform.position.set(this.run.x, 0, 0);

        this.syncScene(dt);
    }

    _handleEvents() {
        for (const ev of this.run.events) {
            if (ev.type === 'laser') {
                this.audio?.laser?.(780, 0.3);
                this.haptics('right', 0.25, 30);
            } else if (ev.type === 'railgun') {
                this.audio?.railgun?.();
                this.haptics('right', 0.85, 110);
            } else if (ev.type === 'target-hit') {
                this.particles.burst(ev.x, ev.y, ev.z, 10, 3.2, 0x38bdf8, 0.35);
                this.audio?.blip?.(540);
            } else if (ev.type === 'target-destroyed') {
                const col = ev.kind === 'magma' ? 0xf97316 : ev.kind === 'boss' ? 0xff4d6d : 0x64ffda;
                this.particles.burst(ev.x, ev.y, ev.z, ev.kind === 'boss' ? 56 : 26, ev.kind === 'boss' ? 7 : 4.8, col, 0.72);
                this.audio?.explosion?.(ev.kind === 'boss' ? 1.3 : 0.85, clamp(ev.x / 6, -1, 1));
                this.haptics('right', ev.kind === 'boss' ? 0.9 : 0.45, 70);
            } else if (ev.type === 'shield-block') {
                this.particles.burst(ev.x, ev.y, ev.z, 18, 4.0, 0x70f8ff, 0.45);
                this.audio?.shieldBlock?.(-0.35);
                this.haptics('left', 0.65, 85);
            } else if (ev.type === 'emp') {
                this.empTimer = 0.65;
                this.audio?.warp?.(0.9);
                this.haptics('both', 0.9, 160);
            } else if (ev.type === 'hull-hit') {
                this.audio?.impact?.(0.9);
                this.haptics('both', 0.85, 140);
            } else if (ev.type === 'wave-start') {
                this.audio?.lockChord?.(true);
            } else if (ev.type === 'countdown') {
                this.audio?.countdown?.(false);
            } else if (ev.type === 'go') {
                this.audio?.countdown?.(true);
            } else if (ev.type === 'won' || ev.type === 'lost') {
                this.audio?.fanfare?.(ev.type === 'won');
                this.haptics('both', 0.85, 180);
            }
        }
    }

    syncScene(dt = 0.016) {
        const run = this.run;
        const activeIds = new Set();

        for (const t of run.targets) {
            activeIds.add(t.id);
            let mesh = this.targetMeshes.get(t.id);
            if (!mesh) {
                mesh = this._createTargetMesh(t);
                this.targetMeshes.set(t.id, mesh);
                this.root.add(mesh);
            }
            mesh.position.set(t.x, t.y, t.z);
            if (t.kind === 'meteor' || t.kind === 'magma' || t.kind === 'shard' || t.kind === 'pylon') {
                mesh.rotation.x += dt * 1.1;
                mesh.rotation.y += dt * 1.4;
            } else if (t.kind === 'boss') {
                mesh.userData.ring1.rotation.z += dt * 0.9;
                mesh.userData.ring2.rotation.y += dt * 1.3;
            } else if (mesh.userData.ring) {
                mesh.userData.ring.rotation.z += dt * 2.4;
            }
        }
        for (const [id, mesh] of this.targetMeshes.entries()) {
            if (!activeIds.has(id)) {
                this.root.remove(mesh);
                this.targetMeshes.delete(id);
            }
        }

        const shotIds = new Set();
        for (const s of run.enemyShots) {
            shotIds.add(s.id);
            let mesh = this.shotMeshes.get(s.id);
            if (!mesh) {
                mesh = new THREE.Mesh(this.geoEnemyShot, this.matEnemyShot);
                if (this.glowTex) {
                    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                        map: this.glowTex,
                        color: 0xff4d6d,
                        transparent: true,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false
                    }));
                    sprite.scale.set(0.9, 0.9, 1);
                    mesh.add(sprite);
                }
                this.shotMeshes.set(s.id, mesh);
                this.root.add(mesh);
            }
            mesh.position.set(s.x, s.y, s.z);
        }
        for (const [id, mesh] of this.shotMeshes.entries()) {
            if (!shotIds.has(id)) {
                this.root.remove(mesh);
                this.shotMeshes.delete(id);
            }
        }

        // Render blaster / rail-lance / deflected tracer beams
        const up = new THREE.Vector3(0, 1, 0);
        this.beamLines.forEach((cyl, idx) => {
            const shot = run.playerShots[idx];
            if (!shot) {
                cyl.visible = false;
                return;
            }
            cyl.visible = true;
            const start = new THREE.Vector3(shot.x, shot.y, shot.z);
            const end = shot.deflected
                ? new THREE.Vector3(shot.tx, shot.ty, shot.tz)
                : start.clone().addScaledVector(new THREE.Vector3(shot.dx, shot.dy, shot.dz), 28);
            const mid = start.clone().lerp(end, 0.5);
            const len = Math.max(0.2, start.distanceTo(end));
            cyl.position.copy(mid);
            cyl.scale.set(shot.charged ? 2.4 : 1, len, shot.charged ? 2.4 : 1);
            cyl.quaternion.setFromUnitVectors(up, end.sub(start).normalize());
            cyl.material.color.setHex(shot.charged ? 0xc084fc : shot.deflected ? 0x70f8ff : 0x64ffda);
            cyl.material.opacity = clamp(shot.ttl * 7, 0.15, 1);
        });

        this.hullRing.material.color.setHex(run.hull <= 30 ? 0xfb7185 : run.empCharge >= 100 ? 0xfbbf24 : 0x64ffda);
        this.cockpitShell.setControls(run.vx * 0.25, 0, run.railCharge);

        this.cockpitShell.drawMFD(
            `ORBITAL INTERCEPT · WAVE ${run.wave}/5`,
            [
                `SCORE  ${run.score.toLocaleString()}   COMBO  ${run.combo}x`,
                `HULL  ${run.hull}%   DEFLECTS  ${run.deflections}`,
                run.empCharge >= 100 ? 'EMP CHARGED! SQUEEZE LEFT GRIP' : `RAIL-LANCE: ${Math.round(run.railCharge * 100)}% (HOLD R-GRIP)`
            ],
            `EMP CAPACITOR ${Math.floor(run.empCharge)}%`,
            run.empCharge / 100,
            run.hull <= 30
        );

    }
}
