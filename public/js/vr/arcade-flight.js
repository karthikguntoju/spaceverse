import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ArcadeRun, SYSTEMS, SAMPLE_X, roverRocks, roverCrystals } from './arcade-run.js?v=20261125-q3';
import {
    buildMissionCabin,
    buildSpaceBackdrop,
    createFoilTexture,
    createGlowTexture,
    createHullTexture,
    createPadTexture,
    createSolarTexture,
    createSpaceEnvMap,
    ParticlePool,
    safeCanvas,
    safeLoadTexture
} from './quest-assets.js?v=20261125-q3';
import { setRayFromObject } from './xr-support.js?v=20261125-q3';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function makePanelGeometry(w, h) {
    const hw = w / 2, hh = h / 2;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
        -hw, -hh, 0,
        hw, -hh, 0,
        hw, hh, 0,
        0, hh, 0,
        -hw, hh, 0
    ], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([
        0, 0,
        1, 0,
        1, 1,
        0.5, 1,
        0, 1
    ], 2));
    geo.setIndex([0, 1, 3, 0, 3, 4, 1, 2, 3]);
    geo.computeVertexNormals();
    return geo;
}

function makePart(parent, geometry, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
}

function buildLunarSurface(parent, envMap) {
    const geo = new THREE.PlaneGeometry(160, 160, 84, 84);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        // PlaneGeometry rotates -PI/2 on X, so local +y maps to world -z (pad at z = -18 -> y = +18).
        const flatCenter = clamp((Math.hypot(x, y - 18) - 4.2) / 9, 0, 1);
        const ridge = Math.sin(x * 0.22 + y * 0.16) * Math.cos(y * 0.27) + Math.sin(x * 1.15 + Math.cos(y)) * 0.28;
        const craterDist = Math.hypot(x - 10, y - 26);
        const crater = Math.exp(-Math.pow((craterDist - 6.5) / 1.8, 2)) * 1.1 - Math.exp(-(craterDist * craterDist) / 28) * 1.6;
        const crater2 = Math.exp(-Math.pow((Math.hypot(x + 14, y + 12) - 5) / 1.5, 2)) * 0.85;
        pos.setZ(i, flatCenter * (ridge * 2.1 + crater + crater2));
        const shade = 0.72 + ridge * 0.15 + (crater + crater2) * 0.08;
        c.setRGB(shade * 0.62, shade * 0.63, shade * 0.67);
        colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const moonTex = safeLoadTexture('/public/textures/moon.jpg', { repeat: true });
    if (moonTex) moonTex.repeat.set(8, 8);
    const mat = new THREE.MeshStandardMaterial({
        map: moonTex || null,
        vertexColors: true,
        roughness: 0.94,
        metalness: 0.04,
        envMap
    });
    const ground = makePart(parent, geo, mat, 0, 0, 0, -Math.PI / 2);

    // Scattered lunar boulders outside the landing pad
    const boulderMat = new THREE.MeshStandardMaterial({ color: 0x7e808a, roughness: 0.92, envMap });
    for (let i = 0; i < 16; i++) {
        const angle = i * 2.39996;
        const rad = 5.5 + (i % 5) * 4.4;
        const bx = Math.cos(angle) * rad;
        const bz = -18 + Math.sin(angle) * rad;
        const s = 0.25 + (i % 4) * 0.18;
        const lunarRockGeo = new THREE.IcosahedronGeometry(s, 1);
        const lPos = lunarRockGeo.attributes.position;
        for (let k = 0; k < lPos.count; k++) {
            const vx = lPos.getX(k), vy = lPos.getY(k), vz = lPos.getZ(k);
            const j = 0.78 + 0.32 * Math.abs(Math.sin(vx * 8.1 + vy * 6.3 - vz * 5.9 + i));
            lPos.setXYZ(k, vx * j, vy * j, vz * j);
        }
        lunarRockGeo.computeVertexNormals();
        const rock = makePart(parent, lunarRockGeo, boulderMat, bx, s * 0.4, bz, i * 0.5, i * 0.9, 0);
        rock.scale.set(1.2, 0.72, 0.95);
    }
    return ground;
}

function buildMarsTerrain(parent, envMap) {
    const geo = new THREE.PlaneGeometry(160, 240, 82, 92);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        const canyonEdge = clamp((Math.abs(x) - 5.6) / 11, 0, 1);
        const dune = Math.sin(x * 0.35 + y * 0.18) * 0.35 + Math.cos(y * 0.42) * 0.14;
        const cliff = (Math.sin(x * 0.19 + y * 0.11) + 1.2) * 3.8 * canyonEdge;
        pos.setZ(i, canyonEdge ? cliff + dune : dune * 0.35);
        const shade = 0.76 + canyonEdge * 0.24 + dune * 0.12;
        c.setRGB(shade * 0.78, shade * 0.42, shade * 0.26);
        colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const marsTex = safeLoadTexture('/public/textures/mars.jpg', { repeat: true });
    if (marsTex) marsTex.repeat.set(9, 13);
    const ground = makePart(
        parent,
        geo,
        new THREE.MeshStandardMaterial({
            map: marsTex || null,
            vertexColors: true,
            roughness: 0.93,
            metalness: 0.05,
            envMap
        }),
        0, 0, -58, -Math.PI / 2
    );
    return ground;
}

function buildISSStation(parent, envMap, docking) {
    const station = new THREE.Group();
    parent.add(station);

    const hullTex = createHullTexture('#8a98ab', '#1e2838');
    const foil = createFoilTexture();
    const solarTex = createSolarTexture();

    const mHull = new THREE.MeshStandardMaterial({ color: 0xc2d0e0, map: hullTex, metalness: 0.62, roughness: 0.38, envMap });
    const mDark = new THREE.MeshStandardMaterial({ color: 0x263447, metalness: 0.5, roughness: 0.55, envMap });
    const mGold = new THREE.MeshStandardMaterial({
        color: 0xe3b455,
        map: foil.map,
        bumpMap: foil.bump,
        bumpScale: 0.03,
        metalness: 0.78,
        roughness: 0.32,
        envMap
    });
    const mSolar = new THREE.MeshStandardMaterial({
        color: 0x3b6cb8,
        map: solarTex,
        metalness: 0.48,
        roughness: 0.26,
        envMap
    });
    const mCyan = new THREE.MeshBasicMaterial({ color: 0x64ffda });
    const mRed = new THREE.MeshBasicMaterial({ color: 0xfb7185 });
    const mGreen = new THREE.MeshBasicMaterial({ color: 0x34d399 });

    // Central pressurized habitat & node modules
    makePart(station, new THREE.CylinderGeometry(1.05, 1.05, docking ? 8.2 : 3.2, 24), docking ? mHull : mGold, 0, 0, -3.2, Math.PI / 2);
    makePart(station, new THREE.CylinderGeometry(0.95, 0.95, 0.5, 24), mDark, 0, 0, -0.05, Math.PI / 2);
    makePart(station, new THREE.TorusGeometry(0.76, 0.085, 10, 42), mHull, 0, 0, 0.22);

    if (docking) {
        const collarGlow = makePart(station, new THREE.TorusGeometry(0.65, 0.032, 8, 42), mCyan, 0, 0, 0.27);
        // 3D COAS optical alignment cross protruding from docking collar
        const coas = new THREE.Group();
        coas.position.set(0, 0, 0.36);
        makePart(coas, new THREE.BoxGeometry(0.45, 0.02, 0.02), mCyan, 0, 0, 0);
        makePart(coas, new THREE.BoxGeometry(0.02, 0.45, 0.02), mCyan, 0, 0, 0);
        makePart(coas, new THREE.BoxGeometry(0.024, 0.024, 0.35), mCyan, 0, 0, 0.16);
        station.add(coas);

        // Twin side habitat pressurized nodes + cupola dome + thermal radiators
        for (const side of [-1, 1]) {
            makePart(station, new THREE.CylinderGeometry(0.62, 0.62, 3.4, 20), mHull, side * 1.75, 0.28, -4.5, Math.PI / 2);
            makePart(station, new THREE.CylinderGeometry(0.55, 0.55, 1.8, 18), mGold, side * 2.55, -0.58, -5.2, Math.PI / 2);
            // White thermal radiator wings
            makePart(station, new THREE.BoxGeometry(0.06, 2.5, 1.15), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.45, envMap }), side * 2.2, 1.9, -3.1);
        }
        // Navigation beacons
        const portLight = makePart(station, new THREE.SphereGeometry(0.075, 10, 8), mRed, -1.35, 0.35, 0.15);
        const stbdLight = makePart(station, new THREE.SphereGeometry(0.075, 10, 8), mGreen, 1.35, 0.35, 0.15);
        station.userData.beacons = [portLight, stbdLight, collarGlow];
    }

    // Integrated Truss Mast & Twin Solar Array Wings
    makePart(station, new RoundedBoxGeometry(13.6, 0.22, 0.24, 2, 0.03), mHull, 0, 0, -2.35);
    for (const side of [-1, 1]) {
        makePart(station, new THREE.BoxGeometry(5.1, 1.95, 0.08), mSolar, side * 4.35, 0, -2.35);
        for (const y of [-0.98, 0.98]) {
            makePart(station, new THREE.BoxGeometry(5.15, 0.05, 0.11), mHull, side * 4.35, y, -2.35);
        }
    }
    return station;
}

function buildObservatorySatellite(parent, envMap) {
    const sat = new THREE.Group();
    parent.add(sat);

    const foil = createFoilTexture();
    const solarTex = createSolarTexture();
    const hullTex = createHullTexture('#738298', '#1c2432');

    const mGold = new THREE.MeshStandardMaterial({
        color: 0xeab954,
        map: foil.map,
        bumpMap: foil.bump,
        bumpScale: 0.04,
        metalness: 0.78,
        roughness: 0.32,
        envMap
    });
    const mHull = new THREE.MeshStandardMaterial({ color: 0xaab9cc, map: hullTex, metalness: 0.65, roughness: 0.38, envMap });
    const mDark = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.55, roughness: 0.5, envMap });
    const mSolar = new THREE.MeshStandardMaterial({ color: 0x3b6cb8, map: solarTex, metalness: 0.5, roughness: 0.26, envMap });

    // Octagonal satellite service bus facing the astronaut
    makePart(sat, new THREE.CylinderGeometry(0.88, 0.88, 1.35, 8), mGold, 0, 0, -0.68, Math.PI / 2);
    makePart(sat, new RoundedBoxGeometry(1.72, 1.05, 0.22, 3, 0.03), mHull, 0, 0, 0.02);

    // Top High-Gain Parabolic Dish + Feed Horn
    const dish = makePart(sat, new THREE.SphereGeometry(0.58, 22, 12, 0, Math.PI * 2, 0, 0.9), mHull, 0, 1.06, -0.5, Math.PI + 0.35);
    dish.material = mHull.clone();
    dish.material.side = THREE.DoubleSide;
    makePart(sat, new THREE.CylinderGeometry(0.03, 0.05, 0.42, 10), mDark, 0, 0.95, -0.34, 0.35);

    // Bottom Optical Telescope Barrel + Coated Sapphire Lens
    makePart(sat, new THREE.CylinderGeometry(0.32, 0.36, 0.75, 20), mDark, 0, -0.82, -0.45, Math.PI / 2);
    makePart(sat, new THREE.CircleGeometry(0.29, 20), new THREE.MeshStandardMaterial({
        color: 0x38bdf8, metalness: 0.85, roughness: 0.15, envMap
    }), 0, -0.82, -0.07);

    // Twin glinting solar wings
    for (const side of [-1, 1]) {
        makePart(sat, new THREE.CylinderGeometry(0.04, 0.04, 0.8, 10), mHull, side * 1.15, 0, -0.68, 0, 0, Math.PI / 2);
        makePart(sat, new THREE.BoxGeometry(2.65, 1.08, 0.05), mSolar, side * 2.55, 0, -0.68);
    }

    // 3 Recessed Physical Service Bays (POWER, COMMS, OPTICS)
    const bays = {};
    const baySpecs = [
        { name: 'POWER', x: -0.54, color: 0xfbbf24 },
        { name: 'COMMS', x: 0, color: 0x38bdf8 },
        { name: 'OPTICS', x: 0.54, color: 0xc084fc }
    ];

    for (const spec of baySpecs) {
        const bayGroup = new THREE.Group();
        bayGroup.position.set(spec.x, 0.02, 0.14);
        sat.add(bayGroup);

        // Recessed bay housing + inner core
        makePart(bayGroup, new RoundedBoxGeometry(0.44, 0.64, 0.14, 2, 0.02), mDark, 0, 0, -0.04);
        const coreMesh = makePart(
            bayGroup,
            new RoundedBoxGeometry(0.28, 0.36, 0.06, 2, 0.015),
            new THREE.MeshStandardMaterial({ color: spec.color, emissive: spec.color, emissiveIntensity: 0.35, metalness: 0.5, roughness: 0.35 }),
            0, -0.04, -0.015
        );

        // Hinged door panel that swings open during repair (clear of recessed coreMesh)
        const doorPivot = new THREE.Group();
        doorPivot.position.set(-0.21, 0, 0.048);
        bayGroup.add(doorPivot);
        const doorMesh = makePart(doorPivot, new RoundedBoxGeometry(0.42, 0.56, 0.024, 2, 0.008), mHull, 0.21, 0, 0);

        // Bay header plate + label
        const labelSurface = safeCanvas(256, 96);
        let labelTex = null;
        if (labelSurface) {
            const { ctx } = labelSurface;
            ctx.fillStyle = '#0a1626';
            ctx.fillRect(0, 0, 256, 96);
            ctx.strokeStyle = '#' + spec.color.toString(16).padStart(6, '0');
            ctx.lineWidth = 6;
            ctx.strokeRect(4, 4, 248, 88);
            ctx.fillStyle = '#f8fafc';
            ctx.font = 'bold 42px Inter, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(spec.name, 128, 48);
            labelTex = new THREE.CanvasTexture(labelSurface.canvas);
            labelTex.colorSpace = THREE.SRGBColorSpace;
        }
        makePart(
            bayGroup,
            new THREE.PlaneGeometry(0.36, 0.12),
            new THREE.MeshBasicMaterial({ map: labelTex, color: labelTex ? 0xffffff : spec.color, toneMapped: false }),
            0, 0.39, 0.05
        );

        // Status dome LED (proud of bay door bevel)
        const led = makePart(
            bayGroup,
            new THREE.SphereGeometry(0.048, 12, 10),
            new THREE.MeshBasicMaterial({ color: 0xfb7185, toneMapped: false }),
            0, 0.24, 0.072
        );

        // Animated fault electrical spark arc
        const arcPositions = new Float32Array([-0.1, 0.12, 0.08, 0.04, 0.02, 0.12, -0.05, -0.08, 0.09, 0.11, -0.14, 0.08]);
        const arcGeo = new THREE.BufferGeometry();
        arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3).setUsage(THREE.DynamicDrawUsage));
        const arcLine = new THREE.Line(
            arcGeo,
            new THREE.LineBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false })
        );
        arcLine.renderOrder = 25;
        bayGroup.add(arcLine);

        // Generous raycast hitbox for controller aiming
        const hitbox = makePart(
            bayGroup,
            new THREE.BoxGeometry(0.46, 0.72, 0.26),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
            0, 0.02, 0.05
        );
        hitbox.userData.arcadeAction = 'system:' + spec.name;
        hitbox.userData.repairRole = 'bay';
        hitbox.userData.systemName = spec.name;

        bays[spec.name] = { bayGroup, doorPivot, doorMesh, coreMesh, led, arcLine, hitbox, spec };
    }

    return { sat, bays };
}

function buildAstronaut(parent, envMap) {
    const person = new THREE.Group();
    parent.add(person);

    const mSuit = new THREE.MeshStandardMaterial({ color: 0xeef3f8, roughness: 0.68, metalness: 0.08, envMap });
    const mVisor = new THREE.MeshStandardMaterial({ color: 0xf5b942, emissive: 0x452605, emissiveIntensity: 0.35, metalness: 0.92, roughness: 0.12, envMap });
    const mDark = new THREE.MeshStandardMaterial({ color: 0x243244, roughness: 0.55, metalness: 0.35, envMap });
    const mBeacon = new THREE.MeshBasicMaterial({ color: 0xfb7185 });
    const mLamp = new THREE.MeshBasicMaterial({ color: 0xe0f7ff });

    // Helmet + gold sun visor + twin helmet lamps
    makePart(person, new THREE.SphereGeometry(0.3, 24, 16), mSuit, 0, 0.78, 0);
    makePart(person, new THREE.SphereGeometry(0.24, 24, 16), mVisor, 0, 0.78, 0.145);
    for (const side of [-1, 1]) {
        makePart(person, new THREE.CylinderGeometry(0.035, 0.035, 0.08, 10), mDark, side * 0.29, 0.84, 0.08, Math.PI / 2);
        makePart(person, new THREE.SphereGeometry(0.03, 10, 8), mLamp, side * 0.29, 0.84, 0.12);
    }

    // Torso + Display & Control Module (DCM) chest pack + glowing telemetry
    makePart(person, new RoundedBoxGeometry(0.54, 0.62, 0.36, 3, 0.06), mSuit, 0, 0.3, 0);
    makePart(person, new RoundedBoxGeometry(0.28, 0.22, 0.1, 2, 0.02), mDark, 0, 0.34, 0.2);
    makePart(person, new THREE.BoxGeometry(0.18, 0.07, 0.02), new THREE.MeshBasicMaterial({ color: 0x34d399 }), 0, 0.35, 0.255);

    // PLSS Backpack + red distress beacon
    makePart(person, new RoundedBoxGeometry(0.4, 0.54, 0.24, 2, 0.04), mDark, 0, 0.32, -0.25);
    const distress = makePart(person, new THREE.SphereGeometry(0.055, 10, 8), mBeacon, 0, 0.65, -0.24);
    person.userData.distress = distress;

    for (const side of [-1, 1]) {
        makePart(person, new THREE.CapsuleGeometry(0.11, 0.46, 5, 10), mSuit, side * 0.39, 0.26, 0.05, -0.2, 0, side * 0.32);
        makePart(person, new THREE.CapsuleGeometry(0.125, 0.48, 5, 10), mSuit, side * 0.16, -0.3, 0, 0, 0, side * 0.14);
        makePart(person, new RoundedBoxGeometry(0.23, 0.16, 0.3, 2, 0.03), mDark, side * 0.19, -0.62, 0.05);
    }
    return person;
}

export class ArcadeFlight {
    constructor(scene, slug, options = {}) {
        this.run = new ArcadeRun(slug);
        this.slug = slug;
        this.title = this.run.config.title;
        this.renderer = options.renderer || null;
        this.audio = options.audio || null;
        this.haptics = options.haptics || (() => {});
        this.envMap = options.envMap || createSpaceEnvMap(this.renderer);

        this.root = new THREE.Group();
        this.root.visible = false;
        this.targets = [];
        this.heading = new THREE.Euler(0, 0, 0, 'YXZ');
        this.forward = new THREE.Euler(0, 0, 0, 'YXZ');
        this.cabin = new THREE.Group();
        this.root.add(this.cabin);
        this.scene = scene;
        this._marsFog = null;
        this._savedSceneFog = undefined;
        scene.add(this.root);

        this.particles = new ParticlePool(this.root, 320, 0.26);
        this.crystals = [];
        this._weldSoundTick = 0;
        this._burnSoundTick = 0;
        this._drillArmAngle = 0;
        this.buildScene();
    }

    buildScene() {
        const root = this.root;
        root.add(new THREE.HemisphereLight(0xd8ecff, 0x3b2a22, 1.35));
        const sun = new THREE.DirectionalLight(0xffe7c2, 3.0);
        sun.position.set(-28, 42, 16);
        root.add(sun);
        const fill = new THREE.DirectionalLight(0x63b3ed, 0.9);
        fill.position.set(22, -10, 18);
        root.add(fill);

        const backdropPreset = this.slug === 'lunar-landing'
            ? 'lunar-earthrise'
            : this.slug === 'mars-rover'
                ? 'mars-surface'
                : 'earth-orbit';
        this.backdrop = buildSpaceBackdrop(root, backdropPreset, this.envMap);

        const cabinStyle = this.slug === 'lunar-landing'
            ? 'lander'
            : this.slug === 'mars-rover'
                ? 'rover'
                : this.slug === 'orbital-docking'
                    ? 'capsule'
                    : 'eva';
        this.cockpitShell = buildMissionCabin({
            style: cabinStyle,
            accent: this.run.config.accent,
            envMap: this.envMap
        });
        this.cabin.add(this.cockpitShell.group);


        if (this.slug === 'lunar-landing') this._buildLunarLanding();
        if (this.slug === 'orbital-docking') this._buildOrbitalDocking();
        if (this.slug === 'satellite-repair') this._buildSatelliteRepair();
        if (this.slug === 'mars-rover') this._buildMarsRover();
        if (this.slug === 'space-rescue') this._buildSpaceRescue();
    }

    _buildLunarLanding() {
        this.ground = new THREE.Group();
        this.root.add(this.ground);
        buildLunarSurface(this.ground, this.envMap);

        const pad = new THREE.Group();
        pad.position.set(0, 0.07, -18);
        this.ground.add(pad);

        const padTex = createPadTexture();
        makePart(pad, new THREE.CylinderGeometry(2.65, 2.85, 0.14, 48), new THREE.MeshStandardMaterial({
            color: 0x334155,
            map: padTex || null,
            metalness: 0.45,
            roughness: 0.55,
            envMap: this.envMap
        }));

        // 8 perimeter beacon lamps around PAD 01
        this.padBeacons = [];
        const mBeacon = new THREE.MeshBasicMaterial({ color: 0x64ffda });
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const lamp = makePart(pad, new THREE.SphereGeometry(0.11, 10, 8), mBeacon, Math.cos(a) * 2.52, 0.14, Math.sin(a) * 2.52);
            this.padBeacons.push(lamp);
        }

        // Translucent vertical holographic landing corridor
        this.padBeamMat = new THREE.MeshBasicMaterial({
            color: 0x64ffda,
            transparent: true,
            opacity: 0.18,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const padBeam = makePart(pad, new THREE.CylinderGeometry(2.4, 2.4, 22, 32, 1, true), this.padBeamMat, 0, 11, 0);
        padBeam.renderOrder = 12;

        // Engine flare point light underneath lander
        this.engineLight = new THREE.PointLight(0xffb454, 0, 18);
        this.engineLight.position.set(0, -1.6, -2.5);
        this.cabin.add(this.engineLight);

        // Primary interactive panel (kept as targets[0] for Quest ray + gaze + tests)
        this.panel('BRAKE', 'Right Trigger · Retro burn', 'brake', 0, -0.66, -2.05, 0.72);
    }

    _buildOrbitalDocking() {
        this.craft = buildISSStation(this.root, this.envMap, true);
        this.craft.position.set(0, 0, -11);

        const aim = makePart(
            this.cabin,
            new THREE.RingGeometry(0.08, 0.095, 36),
            new THREE.MeshBasicMaterial({ color: 0x64ffda, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false, depthTest: false, toneMapped: false }),
            0, 0, -2.1
        );
        aim.renderOrder = 30;
        this.aimReticle = aim;

        // Docking corridor guide rings turning emerald when aligned
        this.corridorRings = [];
        for (let i = 0; i < 5; i++) {
            const r = makePart(
                this.craft,
                new THREE.TorusGeometry(0.86 + i * 0.24, 0.025, 6, 36),
                new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45, depthWrite: false }),
                0, 0, 1.4 + i * 2.2
            );
            r.renderOrder = 12;
            this.corridorRings.push(r);
        }

        this.panel('BRAKE', 'Left Trigger · Slow closing', 'brake', -0.52, -0.64, -2.05, 0.68);
        this.panel('THRUST', 'Right Trigger · Increase speed', 'thrust', 0.52, -0.64, -2.05, 0.68);
    }

    _buildSatelliteRepair() {
        const obs = buildObservatorySatellite(this.root, this.envMap);
        this.craft = obs.sat;
        this.craft.position.set(0.18, 0.18, -2.15);
        this.repairBays = obs.bays;

        // Register bay hitboxes in targets (step 0: diagnose, step 2: reconnect/weld)
        for (const name of SYSTEMS) {
            this.targets.push(this.repairBays[name].hitbox);
        }

        // Ergonomic floating EVA Spare Parts Rack on the player's lower left
        this.spareRack = new THREE.Group();
        this.spareRack.position.set(-0.76, -0.35, -1.42);
        this.spareRack.rotation.y = 0.52;
        this.cabin.add(this.spareRack);

        const mRack = new THREE.MeshStandardMaterial({ color: 0x263244, metalness: 0.7, roughness: 0.35, envMap: this.envMap });
        makePart(this.spareRack, new RoundedBoxGeometry(0.95, 0.34, 0.14, 2, 0.02), mRack, 0, 0, -0.05);

        this.spareModules = {};
        const spareColors = { POWER: 0xfbbf24, COMMS: 0x38bdf8, OPTICS: 0xc084fc };
        SYSTEMS.forEach((name, idx) => {
            const sx = (idx - 1) * 0.3;
            const mod = makePart(
                this.spareRack,
                new RoundedBoxGeometry(0.22, 0.22, 0.12, 2, 0.02),
                new THREE.MeshStandardMaterial({
                    color: spareColors[name],
                    emissive: spareColors[name],
                    emissiveIntensity: 0.45,
                    metalness: 0.55,
                    roughness: 0.3,
                    envMap: this.envMap
                }),
                sx, 0, 0.04
            );
            mod.userData.arcadeAction = 'system:' + name;
            mod.userData.repairRole = 'spare';
            mod.userData.systemName = name;
            this.targets.push(mod);
            this.spareModules[name] = mod;
        });

        // Legacy fallback panels kept invisible during normal VR play? No — physical 3D bays + spares ARE this.targets!
        this.welderLight = new THREE.PointLight(0x70f8ff, 0, 6);
        this.welderLight.position.set(0.18, 0.25, -1.6);
        this.root.add(this.welderLight);
    }

    _buildMarsRover() {
        this._marsFog = new THREE.FogExp2(0x361912, 0.011);
        this.ground = new THREE.Group();
        this.root.add(this.ground);
        buildMarsTerrain(this.ground, this.envMap);

        // Basalt rocks on track (faceted craggy boulders)
        this.rocks = [];
        const stone = new THREE.MeshStandardMaterial({ color: 0x7c4632, roughness: 0.92, flatShading: true, envMap: this.envMap });
        const rockGeo = new THREE.IcosahedronGeometry(1.0, 1);
        const rPos = rockGeo.attributes.position;
        for (let k = 0; k < rPos.count; k++) {
            const vx = rPos.getX(k), vy = rPos.getY(k), vz = rPos.getZ(k);
            const j = 0.78 + 0.34 * Math.abs(Math.sin(vx * 7.3 + vy * 5.1 - vz * 6.7));
            rPos.setXYZ(k, vx * j, vy * j, vz * j);
        }
        rockGeo.computeVertexNormals();
        for (let i = 0; i < 6; i++) {
            const rock = makePart(this.root, rockGeo, stone, 0, -1.5, -10, 0.3 + i, 1.2 + i * 0.6, 0.6);
            rock.scale.set(1.28, 0.68, 0.88);
            this.rocks.push(rock);
        }

        // Solar Crystal bonus pickups (1 per leg)
        const mCrystal = new THREE.MeshStandardMaterial({
            color: 0x64ffda, emissive: 0x1ea896, emissiveIntensity: 0.85, roughness: 0.18, metalness: 0.3
        });
        for (let i = 0; i < 3; i++) {
            const cry = makePart(this.root, new THREE.OctahedronGeometry(0.42, 0), mCrystal, 0, -1.1, -15);
            this.crystals.push(cry);
        }

        // Sample Site Beacon + Crystalline Outcrop
        this.sample = new THREE.Group();
        this.root.add(this.sample);
        makePart(this.sample, rockGeo, new THREE.MeshStandardMaterial({ color: 0xa16244, roughness: 0.82, flatShading: true }), 0, 0.22, 0).scale.setScalar(0.45);
        makePart(this.sample, new THREE.CylinderGeometry(0.05, 0.05, 1.5, 10), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.7 }), 0, 0.75, 0);
        this.sampleCrystal = makePart(this.sample, new THREE.OctahedronGeometry(0.24), new THREE.MeshBasicMaterial({ color: 0x64ffda, toneMapped: false }), 0, 1.56, 0);
        const sampleRing = makePart(
            this.sample,
            new THREE.RingGeometry(0.95, 1.15, 32),
            new THREE.MeshBasicMaterial({ color: 0x64ffda, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
            0, 0.22, 0, -Math.PI / 2
        );
        sampleRing.renderOrder = 11;

        // Animated 3D Robotic Core Drill Arm extending from rover hood
        this.drillArm = new THREE.Group();
        this.drillArm.position.set(0.65, -0.98, -1.95);
        this.cabin.add(this.drillArm);
        const mArm = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.6, roughness: 0.35, envMap: this.envMap });
        makePart(this.drillArm, new RoundedBoxGeometry(0.1, 0.1, 0.95, 2, 0.02), mArm, 0, 0, -0.45);
        this.drillBit = makePart(this.drillArm, new THREE.ConeGeometry(0.065, 0.35, 8), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9, roughness: 0.2 }), 0, -0.15, -0.95, Math.PI);

        // Twin rover headlights
        const headLight = new THREE.SpotLight(0xfff1d6, 5.5, 42, 0.55, 0.45);
        headLight.position.set(0, -0.7, -2.2);
        headLight.target.position.set(0, -1.8, -18);
        this.cabin.add(headLight);
        this.cabin.add(headLight.target);

        this.panel('COLLECT', 'Right Trigger on beacon · Drill', 'collect', 0, -0.62, -1.95, 0.72);
    }

    _buildSpaceRescue() {
        this.astronaut = buildAstronaut(this.root, this.envMap);
        this.lockMarker = makePart(
            this.astronaut,
            new THREE.TorusGeometry(0.98, 0.03, 8, 42),
            new THREE.MeshBasicMaterial({ color: 0x64ffda }),
            0, 0.25, 0.15
        );
        const hit = makePart(
            this.astronaut,
            new THREE.SphereGeometry(1.1, 12, 8),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
            0, 0.25, 0
        );
        hit.userData.arcadeAction = 'tether';
        this.targets.push(hit);

        this.panel('MATCH DRIFT', 'Left Trigger near 11 m', 'match', 0, -0.62, -1.95, 0.72);

        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -0.45, -1.6, 0, 0, -12]), 3));
        this.tether = new THREE.Line(
            lineGeo,
            new THREE.LineBasicMaterial({ color: 0x8ff2d9, transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false })
        );
        this.tether.renderOrder = 25;
        this.tether.frustumCulled = false;
        this.root.add(this.tether);

        // Magnetic tether grapple claw head attached at astronaut end of tether
        this.tetherClaw = makePart(
            this.root,
            new THREE.OctahedronGeometry(0.14, 0),
            new THREE.MeshBasicMaterial({ color: 0x64ffda })
        );
        this.tetherClaw.visible = false;
    }

    panel(title, hint, action, x, y, z, width = 0.78) {
        const surface = safeCanvas(512, 208);
        let tex = null;
        if (surface) {
            const { ctx, canvas } = surface;
            ctx.fillStyle = '#091627';
            ctx.fillRect(0, 0, 512, 208);
            ctx.strokeStyle = this.run.config.accent;
            ctx.lineWidth = 8;
            ctx.strokeRect(4, 4, 504, 200);
            ctx.textAlign = 'center';
            ctx.fillStyle = '#f3faff';
            ctx.font = 'bold 54px system-ui';
            ctx.fillText(title, 256, 88, 470);
            ctx.fillStyle = '#b9d2e8';
            ctx.font = '32px system-ui';
            ctx.fillText(hint, 256, 150, 470);
            tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.generateMipmaps = false;
            tex.minFilter = THREE.LinearFilter;
        }
        const button = makePart(
            this.cabin,
            makePanelGeometry(width, width * 0.406),
            new THREE.MeshBasicMaterial({
                map: tex,
                color: tex ? 0xffffff : 0x0b1f38,
                toneMapped: false
            }),
            x, y, z
        );
        button.userData.arcadeAction = action;
        this.targets.push(button);
        return button;
    }

    start(dolly, orientation, position) {
        this.run.reset();
        this.haul = 0;
        if (this._marsFog) {
            this._savedSceneFog = this.scene.fog;
            this.scene.fog = this._marsFog;
        }
        this.root.position.copy(dolly.position);
        if (position) this.root.position.add(position);
        this.recenter(orientation);
        this.root.visible = true;
        this.syncScene();
    }

    recenter(orientation) {
        if (orientation) this.forward.setFromQuaternion(orientation, 'YXZ');
        else this.forward.set(0, 0, 0, 'YXZ');
        this.root.rotation.y = this.forward.y;
    }

    stop() {
        this.run.pause();
        this.root.visible = false;
        if (this._marsFog && this._savedSceneFog !== undefined) {
            this.scene.fog = this._savedSceneFog;
            this._savedSceneFog = undefined;
        }
    }

    pick(raycaster) {
        if (!this.root.visible || this.run.state !== 'playing') return null;
        this.root.updateWorldMatrix(true, true);
        return raycaster.intersectObjects(this.targets, false).find(hit => {
            if (!hit.object.visible) return false;
            if (this.slug === 'satellite-repair' && hit.object.userData?.repairRole === 'spare') {
                return this.run.repairStep === 1;
            }
            return true;
        }) || null;
    }

    highlight(target) {
        for (const item of this.targets) {
            if (!item?.material) continue;
            if (item.material.map) item.material.color.set(item === target ? 0xa9ffe2 : 0xffffff);
            else if (item.material.emissive) item.material.emissiveIntensity = item === target ? 0.95 : 0.45;
        }
    }

    _processQuestDualHands(dt, input, rig) {
        const left = input?.left;
        const right = input?.right;
        if (!left && !right) return null;

        const simInput = {
            x: left?.stick?.x || 0,
            y: -(left?.stick?.y || 0),
            z: left?.stick?.y || 0
        };

        if (this.slug === 'lunar-landing') {
            simInput.throttle = right?.trigger || 0;
            simInput.stabilize = Boolean(left?.triggerPressed || left?.gripPressed);
        } else if (this.slug === 'orbital-docking') {
            simInput.thrustAxis = -(right?.stick?.y || 0);
            simInput.rollAxis = right?.stick?.x || 0;
            if (left?.triggerJustPressed) this.run.action('brake');
            if (right?.triggerJustPressed) {
                const slot = rig?.rightHand?.controller;
                const hit = slot ? this.pick(setRayFromObject(new THREE.Raycaster(), slot)) : null;
                if (hit?.object?.userData?.arcadeAction) this.run.action(hit.object.userData.arcadeAction);
                else this.run.action('thrust');
            }
        } else if (this.slug === 'mars-rover') {
            simInput.throttle = right?.trigger || 0;
            simInput.brake = left?.trigger || 0;
            simInput.drill = Boolean((right?.triggerPressed || right?.gripPressed) && this.run.sampleAligned);
        } else if (this.slug === 'space-rescue') {
            if (left?.triggerJustPressed) this.run.action('match');
            if (right?.triggerJustPressed) {
                if (this.run.matched && this.run.closing <= 0.22) {
                    const slot = rig?.rightHand?.controller;
                    const hit = slot ? this.pick(setRayFromObject(new THREE.Raycaster(), slot)) : null;
                    if (hit?.object?.userData?.arcadeAction === 'tether' || Math.hypot(this.run.targetX - this.run.podX, this.run.targetY - this.run.podY) < 2.2) {
                        this.run.action('tether');
                    }
                } else {
                    this.run.action('tether');
                }
            }
        } else if (this.slug === 'satellite-repair') {
            const rc = new THREE.Raycaster();
            if (left?.triggerJustPressed && rig?.leftHand?.controller && this.run.repairStep === 1) {
                const hit = this.pick(setRayFromObject(rc, rig.leftHand.controller));
                if (hit?.object?.userData?.repairRole === 'spare') {
                    this.run.grabSpare(hit.object.userData.systemName);
                }
            }
            if (right?.triggerPressed && rig?.rightHand?.controller) {
                const hit = this.pick(setRayFromObject(rc, rig.rightHand.controller));
                const role = hit?.object?.userData?.repairRole;
                const sysName = hit?.object?.userData?.systemName;
                if (this.run.repairStep === 0 && right.triggerJustPressed && role === 'bay') {
                    this.run.action('system:' + sysName);
                } else if (this.run.repairStep === 1 && right.triggerJustPressed && role === 'spare') {
                    this.run.grabSpare(sysName);
                } else if (this.run.repairStep === 2 && role === 'bay') {
                    this.run.weldStep(dt, sysName);
                    if (hit.point) {
                        const localPt = this.root.worldToLocal(hit.point.clone());
                        this.particles.burst(localPt.x, localPt.y, localPt.z, 3, 2.2, 0x70f8ff, 0.28);
                    }
                }
            }
        }

        return simInput;
    }

    _handleEvents(dt) {
        for (const ev of this.run.events) {
            if (ev.type === 'thrust') {
                this._burnSoundTick -= dt;
                if (this._burnSoundTick <= 0) {
                    this._burnSoundTick = 0.08;
                    this.haptics('right', 0.12 + ev.level * 0.28, 45);
                }
            } else if (ev.type === 'burn' || ev.type === 'rcs') {
                this.audio?.rcsPuff?.(ev.dir || 0, 0.65);
                this.haptics('both', 0.3, 45);
            } else if (ev.type === 'rock-hit') {
                this.audio?.impact?.(0.7);
                this.haptics('both', 0.75, 110);
                this.particles.burst(0, -1.2, -2.5, 18, 4.5, 0xff8b5a, 0.5);
            } else if (ev.type === 'bonus' || ev.type === 'sample-collected') {
                this.audio?.lockChord?.(true);
                this.haptics('right', 0.45, 70);
                this.particles.burst(0, -1.1, -2.4, 22, 3.8, 0x64ffda, 0.65);
            } else if (ev.type === 'grab-spare') {
                this.audio?.blip?.(780);
                this.haptics('left', 0.4, 55);
            } else if (ev.type === 'part-diagnosed' || ev.type === 'part-fixed') {
                this.audio?.lockChord?.(true);
                this.haptics('right', 0.5, 80);
            } else if (ev.type === 'weld') {
                this._weldSoundTick -= dt;
                if (this._weldSoundTick <= 0) {
                    this._weldSoundTick = 0.09;
                    this.audio?.weldSpark?.(0.25);
                    this.haptics('right', 0.25, 35);
                }
            } else if (ev.type === 'tether-latch') {
                this.audio?.lockChord?.(true);
                this.haptics('both', 0.65, 120);
            } else if (ev.type === 'error') {
                this.audio?.lockChord?.(false);
                this.haptics('both', 0.35, 65);
            } else if (ev.type === 'countdown') {
                this.audio?.countdown?.(false);
            } else if (ev.type === 'go') {
                this.audio?.countdown?.(true);
                this.haptics('both', 0.3, 55);
            } else if (ev.type === 'won' || ev.type === 'lost') {
                this.audio?.fanfare?.(ev.type === 'won');
                this.haptics('both', ev.type === 'won' ? 0.6 : 0.8, 160);
            }
        }
    }

    update(dt, camera, _dolly, suspended, input, rig = null) {
        if (!this.root.visible) return;
        this.backdrop.update(dt);
        this.particles.update(dt);
        if (suspended) return;

        let simInput = null;
        if (input && (input.left || input.right)) {
            simInput = this._processQuestDualHands(dt, input, rig);
        } else if (input) {
            simInput = input;
        } else {
            this.heading.setFromQuaternion(camera.quaternion, 'YXZ');
            const turn = this.forward.y - this.heading.y;
            const steer = value => Math.abs(value) < 0.025 ? 0 : value / 0.22;
            simInput = { x: steer(Math.atan2(Math.sin(turn), Math.cos(turn))), y: steer(this.heading.x - this.forward.x) };
        }

        this.run.update(dt, simInput);
        if (this.slug === 'space-rescue' && this.run.state === 'won') {
            this.haul = Math.min(1, this.haul + dt / 3);
            this.run.tetherReel = this.haul;
        }

        this._handleEvents(dt);
        this._spawnContinuousEffects(dt, simInput);
        this.syncScene(dt, rig);
    }

    _spawnContinuousEffects(dt, simInput) {
        if (this.run.state !== 'playing') return;
        if (this.slug === 'lunar-landing' && this.run.throttleLevel > 0.1) {
            // Dust kick-up below 14 m altitude
            if (this.run.altitude < 14 && Math.random() < 0.75) {
                const a = Math.random() * Math.PI * 2;
                const s = 2.8 + Math.random() * 2.5;
                this.particles.spawn(-this.run.x + Math.cos(a) * 0.8, -1.9, -18 + Math.sin(a) * 0.8, Math.cos(a) * s, 0.5 + Math.random(), Math.sin(a) * s, 0xd4d4d8, 0.6, 0.92);
            }
            this.particles.spawn(0, -1.5, -2.3, (Math.random() - 0.5) * 0.6, -4.5, (Math.random() - 0.5) * 0.6, 0xffb454, 0.28, 0.96);
        }
        if (this.slug === 'orbital-docking' && simInput && (Math.abs(simInput.x) > 0.2 || Math.abs(simInput.y) > 0.2)) {
            if (Math.random() < 0.35) {
                this.particles.spawn(-simInput.x * 0.9, -0.4 - simInput.y * 0.5, -1.8, -simInput.x * 2.8, -simInput.y * 2.4, -0.4, 0xe0f7ff, 0.25, 0.93);
            }
        }
        if (this.slug === 'mars-rover' && this.run.drillProgress > 0.05) {
            if (Math.random() < 0.65) {
                this.particles.spawn(0.65, -1.55, -3.0, (Math.random() - 0.5) * 2.2, 1.4 + Math.random() * 1.4, (Math.random() - 0.5) * 2.2, 0xfb923c, 0.38, 0.92);
            }
        }
    }

    syncScene(dt = 0.016, rig = null) {
        const run = this.run;
        this.cockpitShell.setControls(run.vx * 0.3, run.vy * 0.3, run.throttleLevel || (run.burn > 0 ? 0.85 : 0));

        if (this.slug === 'lunar-landing') {
            this.ground.position.set(-run.x, -2.05 - run.altitude * 0.31, -run.z);
            const safe = run.descent <= 2.7 && Math.hypot(run.x, run.z) <= 2.4;
            this.padBeamMat.color.setHex(safe ? 0x34d399 : run.descent > 3.5 ? 0xfb7185 : 0xfbbf24);
            this.engineLight.intensity = (run.throttleLevel || (run.burn > 0 ? 1 : 0)) * 3.8;
            this.padBeacons.forEach((b, i) => {
                b.material.color.setHex(Math.floor(run.elapsed * 4 + i) % 2 ? 0x64ffda : 0xfbbf24);
            });
            this.cockpitShell.drawMFD(
                'LUNAR LANDER · PAD 01',
                [`ALT  ${Math.ceil(run.altitude)} m    V-SPD  ${run.descent.toFixed(1)} m/s`, `PAD OFFSET  ${Math.hypot(run.x, run.z).toFixed(1)} m`, `H-VEL  ${Math.hypot(run.vx, run.vz).toFixed(1)} m/s`],
                `FUEL ${Math.ceil(run.fuel)}%`,
                run.fuel / 100,
                run.altitude < 10 && run.descent > 2.7
            );
        }

        if (this.slug === 'orbital-docking') {
            this.craft.position.set(-run.x, -run.y, -Math.max(1.65, run.range + 1.65));
            this.craft.rotation.z = run.roll;
            const aligned = Math.hypot(run.x, run.y) <= 0.75 && run.closing <= 0.65;
            this.corridorRings.forEach((ring, i) => {
                ring.material.color.setHex(aligned ? 0x34d399 : 0x38bdf8);
                ring.material.opacity = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(run.elapsed * 3 - i * 0.7));
            });
            if (this.aimReticle) {
                this.aimReticle.material.color.setHex(aligned ? 0x34d399 : 0x64ffda);
            }
            this.cockpitShell.drawMFD(
                'ISS DOCKING GUIDANCE',
                [`RANGE  ${run.range.toFixed(1)} m    CLOSING  ${run.closing.toFixed(2)} m/s`, `ALIGN OFFSET  ${Math.hypot(run.x, run.y).toFixed(2)} m`, `ROLL  ${(run.roll * 57.3).toFixed(0)} deg`],
                `CLOSING RATE (TARGET <= 0.65)`,
                clamp(run.closing / 2, 0, 1),
                run.range < 6 && run.closing > 0.65
            );
        }

        if (this.slug === 'satellite-repair') {
            const fault = run.fault;
            const restored = run.faults.slice(0, run.repairRound).map(idx => SYSTEMS[idx]);
            for (const name of SYSTEMS) {
                const bay = this.repairBays[name];
                const isRestored = restored.includes(name);
                const isActive = name === fault && run.state === 'playing';
                const doorOpen = isActive && run.repairStep >= 1;
                const wantRot = doorOpen ? -1.45 : 0;
                bay.doorPivot.rotation.y += (wantRot - bay.doorPivot.rotation.y) * Math.min(1, dt * 8);
                bay.led.material.color.setHex(isRestored ? 0x34d399 : isActive ? 0xfbbf24 : 0xfb7185);
                bay.arcLine.visible = isActive && (run.repairStep < 2 || run.weldProgress > 0);
                if (bay.arcLine.visible) {
                    const posAttr = bay.arcLine.geometry.attributes.position;
                    const t = run.elapsed * 26;
                    posAttr.setXYZ(1, 0.04 + Math.sin(t) * 0.04, 0.02 + Math.cos(t * 1.3) * 0.04, 0.12);
                    posAttr.setXYZ(2, -0.05 + Math.cos(t * 1.7) * 0.04, -0.08 + Math.sin(t * 1.1) * 0.04, 0.09);
                    posAttr.needsUpdate = true;
                    bay.arcLine.material.color.setHex(run.repairStep === 2 ? 0x70f8ff : 0xffb454);
                    bay.arcLine.material.opacity = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.9));
                }
                bay.coreMesh.visible = !isActive || run.repairStep !== 1;
                bay.hitbox.visible = run.repairStep === 0 || (run.repairStep === 2 && isActive);
            }
            for (const name of SYSTEMS) {
                const mod = this.spareModules[name];
                mod.visible = run.repairStep !== 2 || run.carryingSpare !== name;
                mod.scale.setScalar(run.repairStep === 1 ? 1.05 : 0.85);
                if (run.repairStep === 1) mod.rotation.y += dt * 1.4;
            }
            this.welderLight.intensity = run.weldProgress > 0 ? 3.2 : 0;
            this.cockpitShell.drawMFD(
                `EVA REPAIR · ${run.repairRound}/3 SYSTEMS`,
                [`ACTIVE FAULT: ${fault}`, `STEP: ${['1. SCAN BAY (R-TRIG)', '2. GRAB SPARE (L-TRIG)', '3. WELD BAY (HOLD R-TRIG)'][run.repairStep]}`, `CARRYING: ${run.carryingSpare || 'EMPTY CLAW'}`],
                run.repairStep === 2 ? `WELD PROGRESS ${Math.round(run.weldProgress * 100)}%` : `TIME REMAINING`,
                run.repairStep === 2 ? run.weldProgress : clamp(1 - run.elapsed / run.config.duration, 0, 1),
                false
            );
        }

        if (this.slug === 'mars-rover') {
            const bob = run.state === 'playing' ? Math.sin(run.distance * 2.4) * 0.035 : 0;
            this.ground.position.set(-run.x, -1.9 + bob, run.distance);
            this.sample.visible = run.samples < SAMPLE_X.length;
            if (this.sample.visible) {
                this.sample.position.set(SAMPLE_X[run.samples] - run.x, -1.78 + bob, -run.sampleDistance - 2);
                this.sampleCrystal.rotation.y += dt * 2.1;
            }
            for (let i = 0; i < 3; i++) {
                roverRocks(i).forEach((rock, index) => {
                    this.rocks[i * 2 + index].position.set(rock.x - run.x, -1.55 + bob, run.distance - rock.distance - 2);
                });
                roverCrystals(i).forEach(cry => {
                    const key = `${i}:${cry.distance}`;
                    const mesh = this.crystals[i];
                    mesh.visible = !run.collectedCrystals.has(key);
                    mesh.position.set(cry.x - run.x, -1.18 + bob + Math.sin(run.elapsed * 3 + i) * 0.1, run.distance - cry.distance - 2);
                    mesh.rotation.y += dt * 2.4;
                });
            }
            const wantArm = run.sampleAligned ? 0.35 : -0.6;
            this._drillArmAngle += (wantArm - this._drillArmAngle) * Math.min(1, dt * 6);
            this.drillArm.rotation.x = this._drillArmAngle;
            this.drillBit.rotation.y += dt * (run.drillProgress > 0 ? 18 : 1.5);

            this.cockpitShell.drawMFD(
                'MARS ROVER · JEZERO CANYON',
                [`SAMPLES  ${run.samples}/3    CRYSTALS  ${run.bonusCollected}`, `NEXT SAMPLE  ${Math.max(0, Math.ceil(run.sampleDistance))} m`, run.sampleAligned ? 'ALIGNED · HOLD R-TRIG TO DRILL' : 'AVOID BASALT BOULDERS'],
                `BATTERY ${Math.ceil(run.battery)}%`,
                run.battery / 100,
                run.battery < 22
            );
        }

        if (this.slug === 'space-rescue') {
            const hauling = run.state === 'won';
            const t = this.haul || 0;
            const ax = run.targetX * (1 - t) - run.podX;
            const ay = run.targetY - 0.45 * t - run.podY;
            const az = -run.range + (run.range - 3.2) * t;
            this.astronaut.position.set(ax, ay, az);
            this.astronaut.rotation.z = Math.sin(run.elapsed * 0.46) * 0.22 * (1 - t);
            this.astronaut.rotation.x = Math.cos(run.elapsed * 0.34) * 0.12 * (1 - t);
            if (this.astronaut.userData.distress) {
                const pulse = 0.55 + 0.45 * Math.sin(run.elapsed * 6);
                this.astronaut.userData.distress.scale.setScalar(0.85 + pulse * 0.45);
            }
            this.lockMarker.visible = !hauling && run.matched && run.closing <= 0.22;
            this.lockMarker.rotation.z += dt * 1.4;
            this.tether.visible = hauling;
            this.tetherClaw.visible = hauling;
            if (hauling) {
                const muzzle = rig?.rightHand?.tools?.right?.tools?.harpoon?.muzzleAnchor;
                const positions = this.tether.geometry.attributes.position;
                if (muzzle && rig.rightHand.tools.right.group.visible) {
                    const mpos = new THREE.Vector3();
                    muzzle.updateWorldMatrix(true, false);
                    muzzle.getWorldPosition(mpos);
                    this.root.worldToLocal(mpos);
                    positions.setXYZ(0, mpos.x, mpos.y, mpos.z);
                } else {
                    positions.setXYZ(0, 0.3, -0.35, -1.2);
                }
                positions.setXYZ(1, ax, ay + 0.28, az);
                positions.needsUpdate = true;
                this.tetherClaw.position.set(ax, ay + 0.28, az);
            }
            this.cockpitShell.drawMFD(
                'EVA SPACE RESCUE',
                [`RANGE  ${run.range.toFixed(1)} m    CLOSING  ${run.closing.toFixed(2)} m/s`, `DRIFT LOCK: ${run.matched ? 'SYNCHRONIZED' : run.canMatch ? 'PRESS L-TRIGGER!' : 'CLOSING...'}`, `TETHER: ${hauling ? 'REELING IN' : 'ARMED'}`],
                `RESCUE WINDOW`,
                clamp(1 - run.elapsed / run.config.duration, 0, 1),
                run.range < 8 && !run.matched
            );
        }

    }
}
