import * as THREE from 'three';
import { DodgeRun } from './dodge-run.js?v=20261015-1';

// Bake relief and mineral variation once. Shared lit meshes avoid per-pixel
// procedural noise, extra render passes or downloaded textures on phone GPUs.
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
        base.setRGB(0.31 + ridge * 0.07, 0.25 + ridge * 0.06, 0.21 + ridge * 0.05);
        base.multiplyScalar(1 + grain * 0.22 - depression * 0.5);
        colors.set([base.r, base.g, base.b], i * 3);
        positions.setXYZ(i, p.x * radius, p.y * radius * (0.9 + seed * 0.035), p.z * radius);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
}

/** Reuses the host scene, camera, clock, sound and gaze controls. */
export class DodgeGame {
    constructor(scene) {
        this.run = new DodgeRun();
        this.root = new THREE.Group(); this.root.visible = false; scene.add(this.root);
        this.origin = new THREE.Vector3(); this.rotation = new THREE.Quaternion();
        this.direction = new THREE.Vector3(); this.offset = new THREE.Vector3();
        this.pool = [];
        this.root.add(new THREE.HemisphereLight(0xbedcff, 0x171327, 1.5));
        const light = new THREE.DirectionalLight(0xffd6a5, 3.2); light.position.set(-8, 9, 4); this.root.add(light);
        const rim = new THREE.DirectionalLight(0x55bfff, 2.2); rim.position.set(6, 3, -20); this.root.add(rim);
        const geometries = [1, 2, 3, 4].map(asteroidGeometry);
        const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.12 });
        for (let i = 0; i < 10; i++) {
            const rock = new THREE.Mesh(geometries[i % geometries.length], material);
            rock.visible = false; this.root.add(rock); this.pool.push(rock);
        }
        const guideMaterial = new THREE.LineBasicMaterial({ color: 0x245f76 });
        for (const x of [-4.8, -1.6, 1.6, 4.8]) {
            const g = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(x, -1.5, 3), new THREE.Vector3(x, -1.5, -90)
            ]);
            this.root.add(new THREE.Line(g, guideMaterial));
        }
        this.rings = [];
        const ringGeometry = new THREE.TorusGeometry(6, 0.025, 4, 64);
        const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x246582 });
        for (let z = -12; z >= -84; z -= 12) {
            const ring = new THREE.Mesh(ringGeometry, ringMaterial);
            ring.position.z = z; this.root.add(ring);
            this.rings.push(ring);
        }
        const stars = new Float32Array(600);
        for (let i = 0; i < stars.length; i += 3) {
            const angle = i * 2.39996;
            stars[i] = Math.cos(angle) * (10 + i % 19);
            stars[i + 1] = Math.sin(angle) * (10 + i % 19);
            stars[i + 2] = -8 - i % 110;
        }
        const starGeometry = new THREE.BufferGeometry();
        starGeometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
        this.root.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xb6ddff, size: 0.09 })));
        // Thin peripheral streaks give speed cues without camera shake or roll.
        this.streakPositions = new Float32Array(72 * 6);
        const streakGeometry = new THREE.BufferGeometry();
        streakGeometry.setAttribute('position', new THREE.BufferAttribute(this.streakPositions, 3).setUsage(THREE.DynamicDrawUsage));
        this.streaks = new THREE.LineSegments(streakGeometry,
            new THREE.LineBasicMaterial({ color: 0x70bbdd, transparent: true, opacity: 0.45, depthWrite: false }));
        this.streaks.frustumCulled = false; this.root.add(this.streaks);
        // Distant banded planet is scenery, outside the three playable lanes.
        const planetGeometry = new THREE.SphereGeometry(22, 48, 32);
        const planetColors = new Float32Array(planetGeometry.attributes.position.count * 3);
        const tint = new THREE.Color();
        for (let i = 0; i < planetGeometry.attributes.position.count; i++) {
            const y = planetGeometry.attributes.position.getY(i) / 22;
            const band = Math.sin(y * 34 + Math.sin(y * 13) * 1.8);
            tint.setRGB(0.16 + band * 0.045, 0.32 + band * 0.06, 0.44 + band * 0.08);
            planetColors.set([tint.r, tint.g, tint.b], i * 3);
        }
        planetGeometry.setAttribute('color', new THREE.BufferAttribute(planetColors, 3));
        const planet = new THREE.Mesh(planetGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
        planet.position.set(48, 25, -135); planet.rotation.z = -0.3; this.root.add(planet);
    }
    start(dolly) {
        this.run.reset(); this.root.visible = true;
        this.origin.copy(dolly.position); this.rotation.copy(dolly.quaternion);
        this.root.position.copy(this.origin); this.root.quaternion.copy(this.rotation);
        this.pool.forEach(rock => { rock.visible = false; });
        this.updateScenery();
    }
    stop() { this.run.pause(); this.root.visible = false; }
    update(dt, camera, dolly, suspended = false) {
        if (!this.root.visible) return;
        this.direction.set(0, 0, -1).applyQuaternion(camera.quaternion);
        // Gentle ~17-degree head turns steer full width; no physical dodging needed.
        const steering = Math.atan2(this.direction.x, -this.direction.z) / 0.3;
        if (!suspended) this.run.update(dt, steering);
        this.offset.set(this.run.x, 0, 0).applyQuaternion(this.rotation);
        dolly.position.copy(this.origin).add(this.offset);
        this.pool.forEach((rock, i) => {
            const hazard = this.run.hazards[i];
            rock.visible = !!hazard;
            if (!hazard) return;
            rock.position.set(hazard.x, 0, hazard.z);
            rock.rotation.set(hazard.id * 0.7 + this.run.elapsed * 0.2, hazard.id + this.run.elapsed * 0.13, 0);
        });
        this.updateScenery();
    }
    updateScenery() {
        const travel = this.run.elapsed * 16;
        this.rings.forEach((ring, i) => { ring.position.z = -84 + ((i * 12 + travel) % 84); });
        for (let i = 0; i < 72; i++) {
            const angle = i * 2.39996, radius = 7 + (i % 13);
            const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
            const z = -110 + ((i * 17 + travel) % 114);
            this.streakPositions.set([x, y, z, x, y, z - 0.8 - (i % 3) * 0.5], i * 6);
        }
        this.streaks.geometry.attributes.position.needsUpdate = true;
    }
}
