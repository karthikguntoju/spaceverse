import * as THREE from 'three';
import { DodgeRun } from './dodge-run.js?v=20261125-q3';
import {
    buildMissionCabin,
    buildSpaceBackdrop,
    createHexShieldTexture,
    createSpaceEnvMap,
    ParticlePool
} from './quest-assets.js?v=20261125-q3';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Bake relief and mineral variation once. Shared lit meshes avoid per-pixel
// procedural noise, extra render passes or downloaded textures.
function asteroidGeometry(seed) {
    const geometry = new THREE.IcosahedronGeometry(0.82, 3);
    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const p = new THREE.Vector3(), base = new THREE.Color();
    const crater = new THREE.Vector3(Math.sin(seed * 2.1), 0.45, Math.cos(seed * 1.7)).normalize();
    for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i).normalize();
        const grain = Math.sin(p.x * 19 + seed) * Math.sin(p.y * 23 - seed) * Math.cos(p.z * 21);
        const ridge = Math.sin(p.x * 5 + seed) * Math.cos(p.y * 7 + p.z * 4);
        const depression = Math.pow(Math.max(0, p.dot(crater)), 26);
        const radius = 0.82 * (1 + ridge * 0.13 + grain * 0.035 - depression * 0.22);
        base.setRGB(0.36 + ridge * 0.08, 0.29 + ridge * 0.07, 0.25 + ridge * 0.06);
        base.multiplyScalar(1 + grain * 0.22 - depression * 0.5);
        colors.set([base.r, base.g, base.b], i * 3);
        positions.setXYZ(i, p.x * radius, p.y * radius * (0.9 + seed * 0.035), p.z * radius);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
}

/** Meta Quest 3 Saturn-Ring Trench Asteroid Dodge with Touch Plus Blaster & Phase Shield. */
export class DodgeGame {
    constructor(scene, options = {}) {
        this.run = new DodgeRun();
        this.sensitivity = 1;
        this.renderer = options.renderer || null;
        this.audio = options.audio || null;
        this.haptics = options.haptics || (() => {});
        this.envMap = options.envMap || createSpaceEnvMap(this.renderer);

        this.root = new THREE.Group();
        this.root.visible = false;
        scene.add(this.root);

        this.origin = new THREE.Vector3();
        this.headOffset = new THREE.Vector3();
        this.rotation = new THREE.Quaternion();
        this.direction = new THREE.Vector3();
        this.offset = new THREE.Vector3();
        this.pool = [];
        this.crystalMeshes = [];
        this.bolts = [];

        this.root.add(new THREE.HemisphereLight(0xcbe6ff, 0x1b152a, 1.5));
        const light = new THREE.DirectionalLight(0xffdfb8, 3.2);
        light.position.set(-10, 12, 8);
        this.root.add(light);
        const rim = new THREE.DirectionalLight(0x55bfff, 2.2);
        rim.position.set(8, 4, -22);
        this.root.add(rim);

        this.backdrop = buildSpaceBackdrop(this.root, 'saturn-rings', this.envMap);
        this.particles = new ParticlePool(this.root, 260, 0.26);

        // Keep exact 4 geometries + 1 lit vertexColors material contract
        const geometries = [1, 2, 3, 4].map(asteroidGeometry);
        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.85,
            metalness: 0.14,
            envMap: this.envMap
        });
        for (let i = 0; i < 10; i++) {
            const rock = new THREE.Mesh(geometries[i % geometries.length], material);
            rock.visible = false;
            this.root.add(rock);
            this.pool.push(rock);
        }

        // Crystal targets pool
        const cryGeo = new THREE.OctahedronGeometry(0.48, 0);
        const cryMat = new THREE.MeshStandardMaterial({
            color: 0x64ffda,
            emissive: 0x22d3ee,
            emissiveIntensity: 0.85,
            roughness: 0.15,
            metalness: 0.2
        });
        for (let i = 0; i < 4; i++) {
            const cry = new THREE.Mesh(cryGeo, cryMat);
            cry.visible = false;
            this.root.add(cry);
            this.crystalMeshes.push(cry);
        }

        // Interceptor open-canopy sled cockpit
        this.cabinGroup = new THREE.Group();
        this.root.add(this.cabinGroup);
        this.cockpitShell = buildMissionCabin({
            style: 'interceptor',
            accent: '#ffb46b',
            envMap: this.envMap
        });
        this.cabinGroup.add(this.cockpitShell.group);


        // Hexagonal Phase Shield dome surrounding pilot sled
        this.phaseDome = new THREE.Mesh(
            new THREE.SphereGeometry(1.45, 24, 16),
            new THREE.MeshBasicMaterial({
                map: createHexShieldTexture(),
                color: 0x64ffda,
                transparent: true,
                opacity: 0.35,
                blending: THREE.AdditiveBlending,
                side: THREE.BackSide,
                depthWrite: false,
                toneMapped: false
            })
        );
        this.phaseDome.renderOrder = 16;
        this.phaseDome.visible = false;
        this.cabinGroup.add(this.phaseDome);

        // Warning lane indicators
        this.warningLanes = [-3.2, 0, 3.2].map(x => {
            const lane = new THREE.Mesh(
                new THREE.RingGeometry(0.65, 0.78, 32),
                new THREE.MeshBasicMaterial({ color: 0xffad67, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })
            );
            lane.position.set(x, -0.85, -9);
            lane.rotation.x = -Math.PI / 2;
            lane.renderOrder = 11;
            lane.visible = false;
            this.root.add(lane);
            return lane;
        });

        const guideMaterial = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55, depthWrite: false });
        for (const x of [-4.8, -1.6, 1.6, 4.8]) {
            const g = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(x, -1.5, 3), new THREE.Vector3(x, -1.5, -90)
            ]);
            const guideLine = new THREE.Line(g, guideMaterial);
            guideLine.renderOrder = 9;
            this.root.add(guideLine);
        }

        this.rings = [];
        const ringGeometry = new THREE.TorusGeometry(6.4, 0.032, 6, 64);
        const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x2c83a6, transparent: true, opacity: 0.7, depthWrite: false });
        for (let z = -12; z >= -84; z -= 12) {
            const ring = new THREE.Mesh(ringGeometry, ringMaterial);
            ring.position.z = z;
            ring.renderOrder = 8;
            this.root.add(ring);
            this.rings.push(ring);
        }

        // Thin peripheral streaks give speed cues without camera shake or roll.
        this.streakPositions = new Float32Array(72 * 6);
        const streakGeometry = new THREE.BufferGeometry();
        streakGeometry.setAttribute('position', new THREE.BufferAttribute(this.streakPositions, 3).setUsage(THREE.DynamicDrawUsage));
        this.streaks = new THREE.LineSegments(
            streakGeometry,
            new THREE.LineBasicMaterial({ color: 0x80d4ff, transparent: true, opacity: 0.5, depthWrite: false })
        );
        this.streaks.renderOrder = 18;
        this.streaks.frustumCulled = false;
        this.root.add(this.streaks);

        // Plasma bolt visuals pool
        const boltGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 8);
        boltGeo.rotateX(Math.PI / 2);
        const boltMat = new THREE.MeshBasicMaterial({ color: 0x64ffda, toneMapped: false });
        for (let i = 0; i < 6; i++) {
            const mesh = new THREE.Mesh(boltGeo, boltMat);
            mesh.renderOrder = 24;
            mesh.visible = false;
            this.root.add(mesh);
            this.bolts.push({ mesh, vel: new THREE.Vector3(), life: 0 });
        }
    }

    start(dolly, headOrientation, headPosition = null) {
        this.run.reset();
        this.root.visible = true;
        this.origin.copy(dolly.position);
        this.headOffset.set(headPosition?.x || 0, headPosition?.y || 0, headPosition?.z || 0);
        this.rotation.copy(dolly.quaternion);
        this.startHeading = 0;
        if (headOrientation) {
            const yaw = new THREE.Euler().setFromQuaternion(headOrientation, 'YXZ').y;
            this.startHeading = -yaw;
            this.rotation.multiply(new THREE.Quaternion().setFromAxisAngle(this.offset.set(0, 1, 0), yaw));
        }
        this.root.position.copy(this.origin).add(this.headOffset);
        this.root.quaternion.copy(this.rotation);
        this.pool.forEach(rock => { rock.visible = false; });
        this.crystalMeshes.forEach(cry => { cry.visible = false; });
        this.bolts.forEach(b => { b.mesh.visible = false; b.life = 0; });
        this.updateScenery(0);
    }

    stop() {
        this.run.pause();
        this.root.visible = false;
    }

    recenter(orientation, headPosition = null) {
        if (headPosition) {
            this.headOffset.set(headPosition.x || 0, headPosition.y || 0, headPosition.z || 0);
            this.root.position.copy(this.origin).add(this.headOffset);
        }
        if (!orientation) return;
        this.direction.set(0, 0, -1).applyQuaternion(orientation);
        this.startHeading = Math.atan2(this.direction.x, -this.direction.z);
        const yaw = new THREE.Euler().setFromQuaternion(orientation, 'YXZ').y;
        this.rotation.setFromAxisAngle(this.offset.set(0, 1, 0), yaw);
        this.root.quaternion.copy(this.rotation);
    }

    _spawnBolt(originLocal, dirLocal) {
        const slot = this.bolts.find(b => b.life <= 0) || this.bolts[0];
        slot.mesh.position.copy(originLocal);
        slot.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dirLocal);
        slot.vel.copy(dirLocal).multiplyScalar(65);
        slot.life = 0.75;
        slot.mesh.visible = true;
    }

    update(dt, camera, dolly, suspended = false, input = null, rig = null) {
        if (!this.root.visible) return;
        this.backdrop.update(dt);
        this.particles.update(dt);

        for (const b of this.bolts) {
            if (b.life <= 0) continue;
            b.life -= dt;
            b.mesh.position.addScaledVector(b.vel, dt);
            if (b.life <= 0) b.mesh.visible = false;
        }

        // Steering: Quest 3 Left Thumbstick takes priority when tilted, else head yaw
        this.direction.set(0, 0, -1).applyQuaternion(camera.quaternion);
        const angle = Math.atan2(this.direction.x, -this.direction.z) - this.startHeading;
        const headSteer = Math.atan2(Math.sin(angle), Math.cos(angle)) * this.sensitivity / 0.3;

        const stickX = input?.left?.stick?.x ?? (Number.isFinite(input?.x) ? input.x : 0);
        const steering = Math.abs(stickX) > 0.08 ? stickX * 1.15 : headSteer;

        if (!suspended) {
            if (input?.left?.triggerJustPressed) {
                if (this.run.triggerPhase()) {
                    this.audio?.shieldBlock?.(-0.3);
                    this.haptics('left', 0.45, 70);
                }
            }
            if (input?.right?.triggerJustPressed) {
                const pose = rig?.getMuzzlePose?.();
                let localOrigin, localDir;
                if (pose) {
                    const invQ = this.root.quaternion.clone().invert();
                    localOrigin = pose.position.clone().sub(this.root.position).applyQuaternion(invQ);
                    localDir = pose.direction.clone().applyQuaternion(invQ).normalize();
                } else {
                    localOrigin = new THREE.Vector3(this.run.x + 0.25, -0.2, -0.8);
                    localDir = new THREE.Vector3(0, 0, -1);
                }
                this._spawnBolt(localOrigin, localDir);
                rig?.triggerBlasterRecoil?.(false);
                this.audio?.laser?.(860, 0.25);
                this.haptics('right', 0.28, 35);
                this.run.fireBlaster(localOrigin, localDir);
            }

            this.run.update(dt, steering);

            for (const ev of this.run.events) {
                if (ev.type === 'crystal-hit') {
                    this.particles.burst(ev.x, ev.y, ev.z, 22, 4.5, 0x64ffda, 0.55);
                    this.audio?.lockChord?.(true);
                    this.haptics('right', 0.45, 60);
                } else if (ev.type === 'rock-shatter') {
                    this.particles.burst(ev.x, ev.y, ev.z, 28, 5.2, 0xffb46b, 0.65);
                    this.audio?.explosion?.(0.7, 0);
                    this.haptics('right', 0.6, 85);
                } else if (ev.type === 'phase-dodge') {
                    this.audio?.shieldBlock?.(0);
                    this.haptics('left', 0.5, 80);
                } else if (ev.type === 'hit') {
                    this.audio?.impact?.(0.8);
                    this.haptics('both', 0.85, 130);
                } else if (ev.type === 'won' || ev.type === 'lost') {
                    this.audio?.fanfare?.(ev.type === 'won');
                    this.haptics('both', 0.7, 150);
                }
            }
        }

        this.offset.set(this.run.x, 0, 0).applyQuaternion(this.rotation);
        dolly.position.copy(this.origin).add(this.offset);

        this.cabinGroup.position.set(this.run.x, 0, 0);
        this.cabinGroup.rotation.z = -clamp(steering, -1, 1) * 0.08;
        this.cockpitShell.setControls(steering, 0, this.run.state === 'playing' ? 0.85 : 0.1);
        this.phaseDome.visible = this.run.phaseTimer > 0;
        if (this.phaseDome.visible) this.phaseDome.rotation.y += dt * 1.4;

        this.pool.forEach((rock, i) => {
            const hazard = this.run.hazards[i];
            rock.visible = !!hazard;
            if (!hazard) return;
            rock.position.set(hazard.x, 0, hazard.z);
            rock.rotation.set(hazard.id * 0.7 + this.run.elapsed * 0.25, hazard.id + this.run.elapsed * 0.16, 0);
        });

        this.crystalMeshes.forEach((cry, i) => {
            const target = this.run.crystals[i];
            cry.visible = !!target;
            if (!target) return;
            cry.position.set(target.x, target.y, target.z);
            cry.rotation.y += dt * 2.5;
            cry.rotation.x += dt * 1.2;
        });

        this.updateScenery(dt);
    }

    updateScenery() {
        const threat = this.run.threat;
        const impact = threat && (-1 - threat.z) / threat.speed;
        const laneWarn = Boolean(threat && impact <= 2.2);
        this.warningLanes.forEach((lane, index) => {
            lane.visible = laneWarn && index === Math.round(threat.x / 3.2) + 1;
        });
        const travel = this.run.elapsed * 16;
        this.rings.forEach((ring, i) => {
            ring.position.z = -84 + ((i * 12 + travel) % 84);
        });
        for (let i = 0; i < 72; i++) {
            const angle = i * 2.39996, radius = 7 + (i % 13);
            const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
            const z = -110 + ((i * 17 + travel) % 114);
            this.streakPositions.set([x, y, z, x, y, z - 0.8 - (i % 3) * 0.5], i * 6);
        }
        this.streaks.geometry.attributes.position.needsUpdate = true;

        const run = this.run;
        const shieldStatus = run.phaseTimer > 0 ? 'PHASE ACTIVE' : run.phaseCooldown > 0 ? `PHASE ${Math.ceil(run.phaseCooldown)}s` : 'PHASE READY (L-TRIG)';
        const blasterStatus = run.blasterCooldown > 0 ? `ROCK SHOT ${run.blasterCooldown.toFixed(1)}s` : 'BLASTER READY (R-TRIG)';
        this.cockpitShell.drawMFD(
            `ASTEROID DODGE · ${run.difficulty.toUpperCase()}`,
            [
                `SCORE  ${run.score.toLocaleString()}   STREAK  ${run.streak}x`,
                `SHIELDS  ${'■'.repeat(Math.max(0, run.shields))}${'□'.repeat(Math.max(0, run.level.shields - run.shields))}`,
                `${shieldStatus} · ${blasterStatus}`
            ],
            `SURVIVAL  ${Math.ceil(run.duration - run.elapsed)}s`,
            clamp(run.elapsed / run.duration, 0, 1),
            laneWarn
        );
    }
}
