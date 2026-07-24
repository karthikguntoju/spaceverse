/**
 * Solar system scene graph for the VR experience.
 *
 * Sun (animated granulation), eight textured planets with axial tilt, spin,
 * orbit inclination, atmospheres, Earth city lights on the night side, rings
 * for Saturn/Uranus/Neptune, ~20 named moons (each pickable, each with its
 * own procedurally painted surface), the main asteroid belt, the Kuiper belt,
 * the dwarf planets Ceres / Pluto / Makemake / Eris, a comet with a particle
 * dust tail, shooting stars and the star field.
 *
 * Textures are 2–4K on disk; they are downscaled on the client before they
 * hit the GPU because a headset cannot afford a dozen 4096x2048 maps.
 */
import * as THREE from 'three';

/* Moon `kind` selects a procedural surface painter (see moonTexture below).
   `lumpy` swaps the sphere for a deformed potato — Phobos and Deimos are
   nowhere near round. `retro` reverses the orbit (Triton). */
export const BODIES = [
    {
        key: 'sun', name: 'Sun', radius: 30, distance: 0, color: 0xffc55c,
        spin: 0.0009, orbit: 0, tilt: 0.13, emissive: true,
        fact: 'A 4.6-billion-year-old G-type star holding 99.86% of the mass in the solar system.'
    },
    {
        key: 'mercury', name: 'Mercury', radius: 3.2, distance: 58, color: 0x9a8f88,
        tex: '/public/textures/mercury.jpg', bump: 0.16, spin: 0.0022, orbit: 0.0130, tilt: 0.001,
        fact: 'One Mercury day lasts 59 Earth days. Surface swings from -180°C to 430°C.'
    },
    {
        key: 'venus', name: 'Venus', radius: 5.0, distance: 84, color: 0xd9a441,
        tex: '/public/textures/venus.jpg', clouds: '/public/textures/venus-clouds.jpg',
        cloudsOpaque: true, spin: -0.0009, orbit: 0.0095, tilt: 3.096,
        atmo: 0xffd9a0, fact: 'Hottest planet: 465°C under a crushing CO2 atmosphere. It spins backwards.'
    },
    {
        key: 'earth', name: 'Earth', radius: 5.6, distance: 116, color: 0x2f6ecb,
        tex: '/public/textures/earth.jpg', clouds: '/public/textures/earth-clouds.png',
        night: '/public/textures/earth-night.jpg',
        spin: 0.0060, orbit: 0.0072, tilt: 0.409, atmo: 0x69b7ff, roughness: 0.62,
        moons: [{
            name: 'Moon', radius: 1.5, distance: 12, speed: 0.020, color: 0xb9b6ae,
            tex: '/public/textures/moon.jpg', bump: 0.14,
            fact: 'Born from a giant impact 4.5 billion years ago. It drifts 3.8 cm away every year.'
        }],
        fact: 'The only world known to hold liquid-water oceans and life. 71% of it is sea.'
    },
    {
        key: 'mars', name: 'Mars', radius: 4.0, distance: 152, color: 0xc1440e,
        tex: '/public/textures/mars.jpg', bump: 0.16, spin: 0.0058, orbit: 0.0056, tilt: 0.440,
        atmo: 0xff8a5c,
        moons: [
            {
                name: 'Phobos', radius: 0.55, distance: 7.5, speed: 0.045, color: 0x8d7f74, lumpy: true,
                fact: 'Orbits Mars in 7.6 hours — faster than Mars spins. It is slowly falling in.'
            },
            {
                name: 'Deimos', radius: 0.4, distance: 10.5, speed: 0.030, color: 0x9f948a, lumpy: true,
                fact: 'A 12 km lump of rock. From Mars it would look like a bright star.'
            }
        ],
        fact: 'Home of Olympus Mons, 22 km tall — nearly three times the height of Everest.'
    },
    {
        key: 'jupiter', name: 'Jupiter', radius: 17, distance: 232, color: 0xc8a180,
        tex: '/public/textures/jupiter.jpg', spin: 0.0090, orbit: 0.0028, tilt: 0.055,
        moons: [
            {
                name: 'Io', radius: 1.6, distance: 25, speed: 0.024, color: 0xe8d16a, kind: 'io',
                fact: 'The most volcanic world known — over 400 active volcanoes, painted in sulfur.'
            },
            {
                name: 'Europa', radius: 1.4, distance: 31, speed: 0.017, color: 0xdfd8c8, kind: 'europa',
                fact: 'A cracked ice shell over a salty ocean holding twice the water of all Earth\'s seas.'
            },
            {
                name: 'Ganymede', radius: 2.1, distance: 38, speed: 0.012, color: 0x9d8f7d, kind: 'rockice',
                fact: 'The largest moon anywhere — bigger than Mercury, with its own magnetic field.'
            },
            {
                name: 'Callisto', radius: 1.9, distance: 46, speed: 0.009, color: 0x74695e, kind: 'cratered',
                fact: 'The most heavily cratered object in the solar system. Nothing has resurfaced it in aeons.'
            }
        ],
        fact: 'The Great Red Spot is a storm wider than Earth that has raged for centuries.'
    },
    {
        key: 'saturn', name: 'Saturn', radius: 14.5, distance: 305, color: 0xe0c07a,
        tex: '/public/textures/saturn.jpg', ring: '/public/textures/saturn-ring-alpha.png',
        spin: 0.0082, orbit: 0.0019, tilt: 0.466,
        moons: [
            {
                name: 'Mimas', radius: 0.7, distance: 23, speed: 0.026, color: 0xc9c5bd, kind: 'mimas',
                fact: 'Herschel crater spans a third of its face — the moon that looks like the Death Star.'
            },
            {
                name: 'Enceladus', radius: 0.8, distance: 27, speed: 0.021, color: 0xf2f6f8, kind: 'ice',
                fact: 'The whitest surface known. Geysers at its south pole vent a buried ocean into space.'
            },
            {
                name: 'Rhea', radius: 1.0, distance: 33, speed: 0.015, color: 0xcac4ba, kind: 'cratered',
                fact: 'Saturn\'s second-largest moon: ancient ice and rock with a whisper of oxygen.'
            },
            {
                name: 'Titan', radius: 2.0, distance: 42, speed: 0.011, color: 0xd9a441, kind: 'titan',
                atmo: 0xffb45c,
                fact: 'An atmosphere thicker than Earth\'s, with methane rain, rivers and polar lakes.'
            },
            {
                name: 'Iapetus', radius: 1.0, distance: 50, speed: 0.007, color: 0xbdb4a4, kind: 'twotone',
                fact: 'Two-faced: one hemisphere is coal-dark, the other bright ice. Nobody fully knows why.'
            }
        ],
        fact: 'Its rings are 280,000 km across but often less than 10 metres thick.'
    },
    {
        key: 'uranus', name: 'Uranus', radius: 9.5, distance: 372, color: 0x8fd3d8,
        tex: '/public/textures/uranus.jpg', ringThin: true, spin: -0.0050, orbit: 0.0013, tilt: 1.706,
        atmo: 0x9ff0f6,
        moons: [
            {
                name: 'Miranda', radius: 0.65, distance: 16, speed: 0.024, color: 0xbfc2c6, kind: 'cratered',
                fact: 'A patchwork of shattered terrain with 20 km ice cliffs — the tallest known.'
            },
            {
                name: 'Ariel', radius: 0.9, distance: 20, speed: 0.018, color: 0xd4d8dc, kind: 'ice',
                fact: 'The brightest of Uranus\'s moons, crossed by huge fault canyons.'
            },
            {
                name: 'Umbriel', radius: 0.85, distance: 24, speed: 0.014, color: 0x6f6d6b, kind: 'cratered',
                fact: 'The darkest Uranian moon — ancient, dim, with one bright crater ring.'
            },
            {
                name: 'Titania', radius: 1.1, distance: 29, speed: 0.011, color: 0xb8b2ac, kind: 'cratered',
                fact: 'The largest moon of Uranus, scarred by canyons from an expanding interior.'
            },
            {
                name: 'Oberon', radius: 1.05, distance: 34, speed: 0.009, color: 0xa89e94, kind: 'cratered',
                fact: 'The outermost big moon of Uranus, its craters floored with mysterious dark material.'
            }
        ],
        fact: 'Knocked on its side — Uranus rolls around the Sun at a 98° tilt.'
    },
    {
        key: 'neptune', name: 'Neptune', radius: 9.2, distance: 428, color: 0x3a5ecb,
        tex: '/public/textures/neptune.jpg', ringThin: true, spin: 0.0055, orbit: 0.0009, tilt: 0.494,
        atmo: 0x5f8bff,
        moons: [{
            name: 'Triton', radius: 1.4, distance: 19, speed: 0.013, color: 0xe3d5cd, kind: 'triton', retro: true,
            fact: 'Orbits backwards — a captured Kuiper Belt world with nitrogen geysers, slowly spiralling in.'
        }],
        fact: 'Supersonic winds reach 2,100 km/h — the fastest in the solar system.'
    },
    {
        key: 'ceres', name: 'Ceres', radius: 1.9, distance: 190, color: 0x9b948c, dwarf: true,
        tex: '/public/textures/ceres.jpg', spin: 0.0075, orbit: 0.0042, tilt: 0.07, incline: 0.18,
        fact: 'A dwarf planet inside the asteroid belt — the largest asteroid, with bright salt flats in Occator crater.'
    },
    {
        key: 'pluto', name: 'Pluto', radius: 2.6, distance: 472, color: 0xc9b2a0, dwarf: true,
        tex: '/public/textures/pluto.jpg', spin: -0.0016, orbit: 0.0006, tilt: 2.08, incline: 0.30,
        moons: [{
            name: 'Charon', radius: 0.95, distance: 7, speed: 0.016, color: 0x9a938e, kind: 'cratered',
            fact: 'Half the size of Pluto — close enough that the two orbit each other, a true double world.'
        }],
        fact: 'Demoted but not diminished: nitrogen glaciers, water-ice mountains and a heart-shaped plain.'
    },
    {
        key: 'makemake', name: 'Makemake', radius: 1.6, distance: 510, color: 0xb98a6d, dwarf: true,
        tex: '/public/textures/makemake.jpg', spin: 0.0040, orbit: 0.0005, tilt: 0.5, incline: 0.50,
        fact: 'A frozen Kuiper Belt dwarf coated in reddish methane ice.'
    },
    {
        key: 'eris', name: 'Eris', radius: 1.7, distance: 552, color: 0xd8d4cc, dwarf: true,
        tex: '/public/textures/eris.jpg', spin: 0.0035, orbit: 0.0004, tilt: 0.9, incline: 0.72,
        fact: 'The dwarf whose discovery demoted Pluto — more massive than Pluto, three times farther out.'
    }
];

/* ── downscaled texture loader ─────────────────────────────────────────── */
const texCache = new Map();

export async function loadTexture(url, maxW = 1024) {
    const key = url + '@' + maxW;
    if (texCache.has(key)) return texCache.get(key);
    const p = (async () => {
        let tex;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const blob = await res.blob();
            let bmp;
            try {
                bmp = await createImageBitmap(blob, {
                    resizeWidth: maxW, resizeHeight: Math.round(maxW / 2), resizeQuality: 'high'
                });
            } catch (e) {
                bmp = await createImageBitmap(blob);
            }
            tex = new THREE.Texture(bmp);
            tex.needsUpdate = true;
        } catch (e) {
            console.warn('[vr] texture fetch failed, falling back to loader:', url, e.message);
            tex = await new Promise((resolve, reject) =>
                new THREE.TextureLoader().load(url, resolve, undefined, reject));
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.wrapS = THREE.RepeatWrapping;
        return tex;
    })();
    texCache.set(key, p);
    return p;
}

/* small strip / square textures (ring alpha maps) load at native size */
async function loadRawTexture(url) {
    const key = url + '#raw';
    if (texCache.has(key)) return texCache.get(key);
    const p = new Promise((resolve, reject) =>
        new THREE.TextureLoader().load(url, t => {
            t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = 8;
            resolve(t);
        }, undefined, reject));
    texCache.set(key, p);
    return p;
}

/* ── shared shaders / helpers ──────────────────────────────────────────── */

// Limb-hugging atmosphere. The falloff is inverted compared to a naive
// backside fresnel so the glow peaks at the planet edge and dissolves
// outward instead of drawing a hard shell ring around the sphere.
function atmosphereMaterial(color, intensity, falloff = 0.34) {
    return new THREE.ShaderMaterial({
        uniforms: { glowColor: { value: new THREE.Color(color) } },
        vertexShader: `
            varying vec3 vNormal; varying vec3 vView;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vView = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: `
            uniform vec3 glowColor; varying vec3 vNormal; varying vec3 vView;
            void main() {
                float d = abs(dot(vNormal, vView));
                float f = smoothstep(0.0, ${falloff.toFixed(2)}, d);
                gl_FragColor = vec4(glowColor, f * f * ${intensity.toFixed(2)});
            }`,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false
    });
}

function radialSprite(size, inner, outer) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d').createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, outer);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    const ctx = c.getContext('2d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

function rockGeometry(seed, detail = 1) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const n = 0.62 + 0.55 * Math.abs(Math.sin(seed + v.x * 3.1 + v.y * 2.3 + v.z * 1.7));
        v.multiplyScalar(n);
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
}

export { rockGeometry };

/* ── procedural moon surfaces ──────────────────────────────────────────── */
/* Real maps for most moons don't exist as free 2:1 equirects, so each moon
   gets a painted 512x256 surface tuned to what it actually looks like. */

let _moonSeed = 7;
function mrand() {   // deterministic so reloads look identical
    _moonSeed = (_moonSeed * 16807) % 2147483647;
    return (_moonSeed - 1) / 2147483646;
}

function blotches(x, w, h, color, alpha, n, rMin, rMax) {
    for (let i = 0; i < n; i++) {
        const cx = mrand() * w, cy = mrand() * h;
        const r = rMin + mrand() * (rMax - rMin);
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, color.replace('A)', alpha + ')'));
        g.addColorStop(1, color.replace('A)', '0)'));
        x.fillStyle = g;
        x.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
}

function craters(x, w, h, n, rMin, rMax, floor = 'rgba(0,0,0,A)', rim = 'rgba(255,255,250,A)', depth = 0.30) {
    for (let i = 0; i < n; i++) {
        const cx = mrand() * w, cy = mrand() * h;
        const r = rMin + mrand() * (rMax - rMin);
        // dark floor
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, floor.replace('A)', depth + ')'));
        g.addColorStop(0.75, floor.replace('A)', (depth * 0.5) + ')'));
        g.addColorStop(1, floor.replace('A)', '0)'));
        x.fillStyle = g;
        x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
        // sun-lit rim arc (upper left)
        x.strokeStyle = rim.replace('A)', (depth * 0.55) + ')');
        x.lineWidth = Math.max(1, r * 0.16);
        x.beginPath(); x.arc(cx, cy, r * 0.92, Math.PI * 0.8, Math.PI * 1.7); x.stroke();
    }
}

function streaks(x, w, h, n, color, alpha, widthMax = 2.4) {
    for (let i = 0; i < n; i++) {
        const y0 = mrand() * h, x0 = mrand() * w;
        const len = w * (0.25 + mrand() * 0.6);
        const bow = (mrand() - 0.5) * h * 0.5;
        x.strokeStyle = color.replace('A)', alpha + ')');
        x.lineWidth = 0.6 + mrand() * widthMax;
        x.beginPath();
        x.moveTo(x0 - len / 2, y0);
        x.quadraticCurveTo(x0, y0 + bow, x0 + len / 2, y0 + (mrand() - 0.5) * h * 0.2);
        x.stroke();
    }
}

const moonTexCache = new Map();
function moonTexture(kind) {
    if (moonTexCache.has(kind)) return moonTexCache.get(kind);
    const w = 512, h = 256;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');

    switch (kind) {
        case 'io':
            x.fillStyle = '#e3cd6d'; x.fillRect(0, 0, w, h);
            blotches(x, w, h, 'rgba(214,120,44,A)', 0.5, 26, 18, 70);
            blotches(x, w, h, 'rgba(246,240,205,A)', 0.5, 18, 14, 60);
            blotches(x, w, h, 'rgba(120,140,66,A)', 0.35, 10, 10, 40);
            // volcanic vents: dark pit with an orange halo
            for (let i = 0; i < 22; i++) {
                const cx = mrand() * w, cy = mrand() * h, r = 2 + mrand() * 6;
                const g = x.createRadialGradient(cx, cy, 0, cx, cy, r * 3);
                g.addColorStop(0, 'rgba(40,20,10,0.85)');
                g.addColorStop(0.35, 'rgba(200,90,30,0.45)');
                g.addColorStop(1, 'rgba(200,90,30,0)');
                x.fillStyle = g;
                x.beginPath(); x.arc(cx, cy, r * 3, 0, 7); x.fill();
            }
            break;

        case 'europa':
            x.fillStyle = '#ddd6c6'; x.fillRect(0, 0, w, h);
            blotches(x, w, h, 'rgba(200,190,170,A)', 0.4, 20, 20, 80);
            streaks(x, w, h, 46, 'rgba(150,80,52,A)', 0.4, 2.2);   // lineae
            streaks(x, w, h, 24, 'rgba(120,60,40,A)', 0.25, 1.2);
            craters(x, w, h, 6, 2, 6, 'rgba(60,50,40,A)', 'rgba(255,255,250,A)', 0.2);
            break;

        case 'ice':
            x.fillStyle = '#eef4f6'; x.fillRect(0, 0, w, h);
            blotches(x, w, h, 'rgba(180,205,215,A)', 0.35, 22, 16, 70);
            streaks(x, w, h, 16, 'rgba(120,160,185,A)', 0.3, 1.6);  // tiger-stripe cracks
            craters(x, w, h, 10, 2, 8, 'rgba(90,120,140,A)', 'rgba(255,255,255,A)', 0.18);
            break;

        case 'titan':
            // a haze world — almost featureless orange with soft banding
            for (let i = 0; i < h; i++) {
                const k = i / h;
                const band = 0.9 + 0.1 * Math.sin(k * 9.0);
                x.fillStyle = `rgb(${Math.round(216 * band)},${Math.round(152 * band)},${Math.round(60 * band)})`;
                x.fillRect(0, i, w, 1);
            }
            blotches(x, w, h, 'rgba(120,90,40,A)', 0.22, 10, 30, 90);  // dark dune seas
            break;

        case 'twotone': {
            x.fillStyle = '#d9d3c4'; x.fillRect(0, 0, w, h);
            craters(x, w, h, 30, 2, 10, 'rgba(70,60,50,A)', 'rgba(255,255,250,A)', 0.25);
            // coal-dark leading hemisphere with a ragged boundary
            x.fillStyle = 'rgba(46,34,24,0.92)';
            x.beginPath();
            x.moveTo(0, 0);
            for (let i = 0; i <= 16; i++) {
                x.lineTo(w * 0.38 + (mrand() - 0.5) * 60, (i / 16) * h);
            }
            x.lineTo(0, h);
            x.closePath(); x.fill();
            craters(x, w, h * 1, 10, 2, 8, 'rgba(20,14,10,A)', 'rgba(120,90,60,A)', 0.3);
            break;
        }

        case 'triton':
            x.fillStyle = '#e9dcd6'; x.fillRect(0, 0, w, h);
            // pink nitrogen polar cap
            const cap = x.createLinearGradient(0, 0, 0, h * 0.45);
            cap.addColorStop(0, 'rgba(235,190,185,0.85)');
            cap.addColorStop(1, 'rgba(235,190,185,0)');
            x.fillStyle = cap; x.fillRect(0, 0, w, h * 0.45);
            // cantaloupe terrain: shallow dimples
            craters(x, w, h, 60, 2, 6, 'rgba(140,120,115,A)', 'rgba(255,250,248,A)', 0.14);
            streaks(x, w, h, 10, 'rgba(60,55,60,A)', 0.3, 1.4);      // geyser fallout
            break;

        case 'mimas':
            x.fillStyle = '#c9c5bd'; x.fillRect(0, 0, w, h);
            craters(x, w, h, 70, 2, 9, 'rgba(70,66,60,A)', 'rgba(255,255,250,A)', 0.26);
            // Herschel — one absurdly large crater
            craters(x, w * 0.5, h, 1, 44, 46, 'rgba(60,56,50,A)', 'rgba(255,255,252,A)', 0.4);
            break;

        case 'rockice':
            x.fillStyle = '#a79b89'; x.fillRect(0, 0, w, h);
            blotches(x, w, h, 'rgba(70,60,50,A)', 0.4, 16, 24, 90);   // dark ancient terrain
            blotches(x, w, h, 'rgba(210,205,195,A)', 0.4, 14, 18, 70); // bright grooved terrain
            streaks(x, w, h, 20, 'rgba(190,185,175,A)', 0.28, 1.4);    // grooves
            craters(x, w, h, 40, 2, 8, 'rgba(50,44,38,A)', 'rgba(255,255,248,A)', 0.24);
            break;

        case 'cratered':
        default:
            x.fillStyle = '#b9b3a9'; x.fillRect(0, 0, w, h);
            blotches(x, w, h, 'rgba(90,84,76,A)', 0.30, 18, 20, 80);
            blotches(x, w, h, 'rgba(220,215,205,A)', 0.22, 12, 16, 60);
            craters(x, w, h, 85, 2, 11, 'rgba(60,54,48,A)', 'rgba(255,255,250,A)', 0.26);
            break;
    }

    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = 4;
    moonTexCache.set(kind, t);
    return t;
}

/* floating name tag */
function makeLabel(text, accent = '#9fd8ff') {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const x = c.getContext('2d');
    x.textAlign = 'center';
    x.font = '600 58px Inter, Segoe UI, sans-serif';
    x.shadowColor = accent; x.shadowBlur = 22;
    x.fillStyle = 'rgba(230,244,255,0.96)';
    x.fillText(text.toUpperCase(), 256, 74);
    x.shadowBlur = 0;
    x.fillStyle = accent;
    x.fillRect(196, 96, 120, 3);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: t, transparent: true, opacity: 0.9, depthWrite: false
    }));
    return s;
}

/* ring with radial UVs so a 1D alpha strip maps outward from the inner edge */
function ringMesh(inner, outer, material) {
    const geo = new THREE.RingGeometry(inner, outer, 160, 1);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        uv.setXY(i, (v.length() - inner) / (outer - inner), 0.5);
    }
    const m = new THREE.Mesh(geo, material);
    m.rotation.x = Math.PI / 2;
    return m;
}

/* faint procedural strip for the thin rings of Uranus / Neptune */
function thinRingTexture(lines) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 4;
    const x = c.getContext('2d');
    x.clearRect(0, 0, 256, 4);
    lines.forEach(([p, wdt, a]) => {
        x.fillStyle = `rgba(210,230,240,${a})`;
        x.fillRect(Math.round(p * 256), 0, Math.max(1, wdt), 4);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

/* ── the scene ─────────────────────────────────────────────────────────── */
export class SolarSystem {
    constructor(scene, opts = {}) {
        this.scene = scene;
        this.bodies = new Map();
        this.moonIndex = new Map();    // 'jupiter/Io' -> { mesh, data, parent }
        this.orbitRate = 1;            // slowed down during the ride
        this.quality = opts.quality || 'high';
        this.elapsed = 0;
        this.pickTargets = [];
        this.belts = [];
        this.labels = [];
        this.root = new THREE.Group();
        scene.add(this.root);
        this._camPos = new THREE.Vector3();
    }

    async build(onStatus = () => {}) {
        onStatus('Assembling star field…');
        this._starfield();
        onStatus('Igniting the Sun…');
        this._sun();
        onStatus('Placing planets and moons…');
        BODIES.filter(b => b.key !== 'sun').forEach(b => this._planet(b));
        onStatus('Seeding the asteroid belt…');
        this._belt({
            count: this.quality === 'low' ? 800 : 3200,
            rMin: 170, rMax: 208, ySpread: 9,
            colors: [0x6d6259, 0x7a6c5d, 0x585049, 0x8a7a66],
            sMin: 0.3, sMax: 2.0, spinBase: 0.0007
        });
        onStatus('Scattering the Kuiper belt…');
        this._belt({
            count: this.quality === 'low' ? 500 : 2200,
            rMin: 480, rMax: 585, ySpread: 26,
            colors: [0x9fb2bd, 0x8593a3, 0xb8c4cb, 0x7e8a99],
            sMin: 0.4, sMax: 2.6, spinBase: 0.00028
        });
        this._comet();
        this._meteors();
        onStatus('Streaming surface maps…');
        await this._loadTextures(onStatus);
    }

    /* ---------- static content ---------- */

    _starfield() {
        // distant point stars give parallax that a skybox alone cannot
        const n = this.quality === 'low' ? 3000 : 9000;
        const pos = new Float32Array(n * 3);
        const col = new Float32Array(n * 3);
        const c = new THREE.Color();
        for (let i = 0; i < n; i++) {
            const r = 1600 + Math.random() * 1400;
            const th = Math.random() * Math.PI * 2;
            const ph = Math.acos(2 * Math.random() - 1);
            pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
            pos[i * 3 + 1] = r * Math.cos(ph) * 0.55;
            pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
            c.setHSL(0.55 + Math.random() * 0.12, 0.5 * Math.random(), 0.6 + Math.random() * 0.4);
            col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const stars = new THREE.Points(g, new THREE.PointsMaterial({
            size: 4.5, sizeAttenuation: true, vertexColors: true,
            transparent: true, opacity: 0.95, depthWrite: false
        }));
        stars.frustumCulled = false;
        this.root.add(stars);
        this.stars = stars;
    }

    _sun() {
        const d = BODIES[0];
        const group = new THREE.Group();

        // The ride flies within 10 units of the surface, so a flat basic
        // material is not enough — this is animated granulation with limb
        // darkening, which is what stops it reading as a cream-coloured disc.
        const coreMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uHot: { value: new THREE.Color(0xfff4d0) },
                uMid: { value: new THREE.Color(0xffae33) },
                uCool: { value: new THREE.Color(0xd2510d) }
            },
            vertexShader: `
                varying vec3 vPos; varying vec3 vNormal; varying vec3 vView;
                void main() {
                    vPos = position;
                    vNormal = normalize(normalMatrix * normal);
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    vView = normalize(-mv.xyz);
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: `
                uniform float uTime; uniform vec3 uHot; uniform vec3 uMid; uniform vec3 uCool;
                varying vec3 vPos; varying vec3 vNormal; varying vec3 vView;

                float hash(vec3 p) { return fract(sin(dot(p, vec3(17.1, 31.7, 74.3))) * 43758.5453); }
                float noise(vec3 p) {
                    vec3 i = floor(p), f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    float n = mix(
                        mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
                    return n;
                }
                float fbm(vec3 p) {
                    float v = 0.0, a = 0.5;
                    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.07; a *= 0.5; }
                    return v;
                }
                void main() {
                    vec3 p = normalize(vPos) * 4.0;
                    // two counter-drifting layers give the surface a boiling motion
                    float g = fbm(p * 2.4 + vec3(0.0, uTime * 0.04, 0.0));
                    float h = fbm(p * 6.0 - vec3(uTime * 0.06, 0.0, uTime * 0.03));
                    float cells = mix(g, h, 0.45);
                    vec3 col = mix(uCool, uMid, smoothstep(0.20, 0.50, cells));
                    col = mix(col, uHot, smoothstep(0.46, 0.76, cells));
                    // limb darkening — the edge of a star is cooler than its centre
                    float limb = pow(max(dot(normalize(vNormal), normalize(vView)), 0.0), 0.42);
                    col *= mix(0.55, 1.35, limb);
                    gl_FragColor = vec4(col * 1.25, 1.0);
                }`
        });
        const core = new THREE.Mesh(new THREE.SphereGeometry(d.radius, 96, 64), coreMat);
        group.add(core);
        this.sunMat = coreMat;

        // two corona shells: a tight bright rim and a wide soft halo
        const corona = new THREE.Mesh(
            new THREE.SphereGeometry(d.radius * 1.22, 48, 32),
            atmosphereMaterial(0xff9d2e, 0.9, 0.45)
        );
        group.add(corona);
        // wide halo needs a very gradual falloff or its own silhouette shows up
        // as a hard orange disc edge when you are close to the star
        const halo = new THREE.Mesh(
            new THREE.SphereGeometry(d.radius * 1.9, 48, 32),
            atmosphereMaterial(0xff7a18, 0.34, 0.95)
        );
        group.add(halo);

        // with bloom in the chain this must stay subtle or a close approach
        // washes the whole frame to cream
        const flare = new THREE.Sprite(new THREE.SpriteMaterial({
            map: radialSprite(256, 'rgba(255,240,200,0.45)', 'rgba(255,150,40,0.14)'),
            blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
        }));
        flare.scale.setScalar(d.radius * 3.6);
        group.add(flare);
        this.sunFlare = flare;

        // decay 0 keeps every planet lit in a scene this compressed
        const light = new THREE.PointLight(0xfff0d0, 3.2, 0, 0);
        group.add(light);
        this.root.add(group);
        this.root.add(new THREE.AmbientLight(0x2a3550, 1.1));

        this.bodies.set('sun', { data: d, group, mesh: core, spinner: core, orbitAngle: 0 });
        this.pickTargets.push(core);
        core.userData.bodyKey = 'sun';
    }

    _planet(d) {
        // orbit inclination wraps the whole pivot so the traced orbit line,
        // the planet and its moons all share the same tilted plane
        const inclined = new THREE.Group();
        inclined.rotation.z = d.incline || 0;
        this.root.add(inclined);

        const pivot = new THREE.Group();          // orbit pivot at the Sun
        const holder = new THREE.Group();         // planet position on the orbit
        holder.position.x = d.distance;
        pivot.add(holder);
        inclined.add(pivot);

        const spinner = new THREE.Group();        // axial tilt + spin
        spinner.rotation.z = d.tilt || 0;
        holder.add(spinner);

        const matOpts = { color: d.color, roughness: d.roughness != null ? d.roughness : 0.95, metalness: 0.0 };
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(d.radius, this.quality === 'low' ? 48 : 80, this.quality === 'low' ? 32 : 56),
            new THREE.MeshStandardMaterial(matOpts)
        );
        mesh.userData.bodyKey = d.key;
        spinner.add(mesh);
        this.pickTargets.push(mesh);

        // Earth's city lights: the emissive map only shows on the side that
        // faces away from the Sun. The Sun sits at the world origin, so the
        // day/night mask is just dot(worldNormal, -worldPos).
        if (d.night) {
            mesh.material.emissive = new THREE.Color(0xffffff);
            mesh.material.emissiveIntensity = 1.0;
            mesh.material.onBeforeCompile = shader => {
                shader.vertexShader = 'varying vec3 vWNorm;\nvarying vec3 vWPos;\n' +
                    shader.vertexShader.replace('#include <fog_vertex>',
                        `#include <fog_vertex>
                        vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
                        vWNorm = normalize(mat3(modelMatrix) * normal);`);
                shader.fragmentShader = 'varying vec3 vWNorm;\nvarying vec3 vWPos;\n' +
                    shader.fragmentShader.replace('#include <emissivemap_fragment>',
                        `#ifdef USE_EMISSIVEMAP
                            vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
                            float sunFacing = dot(normalize(vWNorm), normalize(-vWPos));
                            float nightSide = 1.0 - smoothstep(-0.22, 0.12, sunFacing);
                            totalEmissiveRadiance *= emissiveColor.rgb * nightSide * 1.7;
                        #endif`);
            };
        }

        let clouds = null;
        if (d.clouds) {
            clouds = new THREE.Mesh(
                new THREE.SphereGeometry(d.radius * (d.cloudsOpaque ? 1.018 : 1.012), 48, 32),
                d.cloudsOpaque
                    // Venus: the cloud deck IS the planet's visible face
                    ? new THREE.MeshStandardMaterial({
                        color: 0xffffff, transparent: true, opacity: 0.94,
                        roughness: 1, depthWrite: false
                    })
                    : new THREE.MeshBasicMaterial({
                        color: 0xffffff, transparent: true, opacity: 0.5,
                        blending: THREE.AdditiveBlending, depthWrite: false
                    })
            );
            clouds.visible = false;               // shown once the map arrives
            spinner.add(clouds);
        }

        if (d.atmo) {
            const atmo = new THREE.Mesh(
                new THREE.SphereGeometry(d.radius * 1.055, 48, 32),
                atmosphereMaterial(d.atmo, d.key === 'earth' ? 0.75 : 0.55)
            );
            spinner.add(atmo);
        }

        let ring = null;
        if (d.ring) {
            ring = ringMesh(d.radius * 1.24, d.radius * 2.27, new THREE.MeshBasicMaterial({
                color: 0xfff6e2, side: THREE.DoubleSide,
                transparent: true, opacity: 0.96, depthWrite: false
            }));
            spinner.add(ring);
        } else if (d.ringThin) {
            const lines = d.key === 'uranus'
                ? [[0.15, 2, 0.5], [0.42, 1, 0.3], [0.68, 3, 0.7], [0.9, 1, 0.35]]
                : [[0.2, 2, 0.4], [0.55, 1, 0.25], [0.85, 2, 0.5]];
            ring = ringMesh(d.radius * 1.55, d.radius * 2.0, new THREE.MeshBasicMaterial({
                map: thinRingTexture(lines), color: 0xdfeef6, side: THREE.DoubleSide,
                transparent: true, opacity: 0.42, depthWrite: false
            }));
            spinner.add(ring);
        }

        const moons = (d.moons || []).map((m, mi) => {
            const mp = new THREE.Group();
            let mesh2;
            if (m.lumpy) {
                mesh2 = new THREE.Mesh(
                    rockGeometry(3.3 + mi * 2.1, 2),
                    new THREE.MeshStandardMaterial({ color: m.color, roughness: 1, flatShading: true })
                );
                mesh2.scale.setScalar(m.radius);
            } else {
                const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97 });
                if (m.kind) mat.map = moonTexture(m.kind);
                else mat.color.set(m.color);
                mesh2 = new THREE.Mesh(new THREE.SphereGeometry(m.radius, 36, 24), mat);
            }
            mesh2.position.x = m.distance;
            mp.add(mesh2);

            if (m.atmo) {   // Titan's orange haze
                const haze = new THREE.Mesh(
                    new THREE.SphereGeometry(m.radius * 1.14, 24, 16),
                    atmosphereMaterial(m.atmo, 0.75)
                );
                haze.position.x = m.distance;
                mp.add(haze);
            }

            mp.rotation.x = (Math.random() - 0.5) * 0.35;
            holder.add(mp);

            const moonKey = d.key + '/' + m.name;
            mesh2.userData.bodyKey = moonKey;
            this.pickTargets.push(mesh2);
            this.moonIndex.set(moonKey, { mesh: mesh2, data: m, parent: d });

            return {
                pivot: mp, mesh: mesh2, data: m,
                angle: Math.random() * Math.PI * 2,
                dir: m.retro ? -1 : 1
            };
        });

        // faint orbit trace (drawn in the inclined plane)
        const pts = [];
        for (let i = 0; i <= 200; i++) {
            const a = (i / 200) * Math.PI * 2;
            pts.push(new THREE.Vector3(Math.cos(a) * d.distance, 0, Math.sin(a) * d.distance));
        }
        const orbitLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({
                color: d.dwarf ? 0x574f6b : 0x3d5680,
                transparent: true, opacity: d.dwarf ? 0.22 : 0.32
            })
        );
        inclined.add(orbitLine);

        // floating name tag, scaled each frame against camera distance
        const label = makeLabel(d.name, d.dwarf ? '#c9a7ff' : '#9fd8ff');
        label.position.y = d.radius * 1.75 + 1.2;
        holder.add(label);
        this.labels.push({ sprite: label, data: d, holder });

        const angle = Math.random() * Math.PI * 2;
        pivot.rotation.y = angle;
        this.bodies.set(d.key, {
            data: d, pivot, holder, spinner, mesh, clouds, ring, moons, orbitLine, label, orbitAngle: angle
        });
    }

    _belt({ count, rMin, rMax, ySpread, colors, sMin, sMax, spinBase }) {
        const geo = rockGeometry(1.7);
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
        const mesh = new THREE.InstancedMesh(geo, mat, count);
        mesh.frustumCulled = false;
        const rocks = [];
        const col = new THREE.Color();
        for (let i = 0; i < count; i++) {
            rocks.push({
                r: rMin + Math.random() * (rMax - rMin),
                a: Math.random() * Math.PI * 2,
                y: (Math.random() - 0.5) * ySpread * 2,
                s: sMin + Math.random() * (sMax - sMin),
                sp: spinBase + Math.random() * spinBase * 1.6,
                rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
                rs: (Math.random() - 0.5) * 0.01
            });
            col.set(colors[(Math.random() * colors.length) | 0]);
            col.offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);
            mesh.setColorAt(i, col);
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        const belt = { mesh, rocks, dummy: new THREE.Object3D() };
        this.belts.push(belt);
        if (!this.belt) this.belt = belt;         // main belt alias
        this.root.add(mesh);
    }

    _comet() {
        const g = new THREE.Group();
        const head = new THREE.Mesh(
            rockGeometry(4.2),
            new THREE.MeshStandardMaterial({ color: 0xcfd8e8, roughness: 0.8, emissive: 0x24406b, emissiveIntensity: 0.6 })
        );
        head.scale.setScalar(2.4);
        g.add(head);

        // ion tail: a stretched additive sprite always pointing away from the Sun
        const tail = new THREE.Sprite(new THREE.SpriteMaterial({
            map: radialSprite(256, 'rgba(190,230,255,0.85)', 'rgba(90,160,255,0.25)'),
            blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
        }));
        tail.scale.set(20, 90, 1);
        tail.position.y = 40;
        g.add(tail);

        // dust tail: particles strewn along the anti-sunward direction with a
        // slight curve, re-positioned every frame from per-particle scalars
        const N = 110;
        const dustPos = new Float32Array(N * 3);
        const dust = new THREE.Points(
            new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(dustPos, 3)),
            new THREE.PointsMaterial({
                map: radialSprite(64, 'rgba(230,240,255,0.9)', 'rgba(150,190,255,0.3)'),
                color: 0xdfeaff, size: 2.4, sizeAttenuation: true,
                transparent: true, opacity: 0.75,
                blending: THREE.AdditiveBlending, depthWrite: false
            })
        );
        dust.frustumCulled = false;
        this.dustSeeds = [];
        for (let i = 0; i < N; i++) {
            this.dustSeeds.push({
                d: Math.pow(Math.random(), 1.4),                 // crowd near the head
                lat: (Math.random() - 0.5) * 2,
                lift: (Math.random() - 0.5) * 2,
                tw: Math.random() * Math.PI * 2
            });
        }
        g.add(dust);

        g.position.set(-260, 40, 190);
        this.root.add(g);
        this.comet = { group: g, angle: 2.1, tail, dust, dustPos };
    }

    /* shooting stars — short-lived bright streaks near the viewer */
    _meteors() {
        this.meteors = [];
        for (let i = 0; i < 5; i++) {
            const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
            const line = new THREE.Line(g, new THREE.LineBasicMaterial({
                color: 0xdfefff, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false
            }));
            line.frustumCulled = false;
            this.root.add(line);
            this.meteors.push({ line, life: 0, ttl: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3() });
        }
        this._meteorNext = 3 + Math.random() * 5;
    }

    _spawnMeteor(camPos) {
        const m = this.meteors.find(m => m.life <= 0);
        if (!m) return;
        const dir = new THREE.Vector3().randomDirection();
        m.pos.copy(camPos).addScaledVector(dir, 150 + Math.random() * 220);
        m.vel.randomDirection().multiplyScalar(240 + Math.random() * 260);
        m.ttl = m.life = 0.8 + Math.random() * 0.7;
    }

    _updateMeteors(dt, camPos) {
        if (!this.meteors) return;
        this._meteorNext -= dt;
        if (this._meteorNext <= 0 && camPos) {
            this._spawnMeteor(camPos);
            this._meteorNext = 2.5 + Math.random() * 6;
        }
        for (const m of this.meteors) {
            if (m.life <= 0) { m.line.material.opacity = 0; continue; }
            m.life -= dt;
            m.pos.addScaledVector(m.vel, dt);
            const k = m.life / m.ttl;
            m.line.material.opacity = Math.sin(Math.min(1, Math.max(0, k)) * Math.PI) * 0.9;
            const arr = m.line.geometry.attributes.position.array;
            arr[0] = m.pos.x; arr[1] = m.pos.y; arr[2] = m.pos.z;
            arr[3] = m.pos.x - m.vel.x * 0.055;
            arr[4] = m.pos.y - m.vel.y * 0.055;
            arr[5] = m.pos.z - m.vel.z * 0.055;
            m.line.geometry.attributes.position.needsUpdate = true;
        }
    }

    /* ---------- async texture streaming ---------- */
    async _loadTextures(onStatus) {
        const jobs = [];
        const planetRes = this.quality === 'low' ? 768 : 2048;

        for (const d of BODIES) {
            if (!d.tex) continue;
            const b = this.bodies.get(d.key);
            jobs.push(loadTexture(d.tex, planetRes).then(t => {
                b.mesh.material.map = t;
                b.mesh.material.color.set(0xffffff);
                if (d.bump) {   // luminance-as-height: cheap relief for rocky worlds
                    b.mesh.material.bumpMap = t;
                    b.mesh.material.bumpScale = d.bump;
                }
                b.mesh.material.needsUpdate = true;
            }).catch(e => console.warn('[vr] texture failed', d.key, e)));

            if (d.night) {
                jobs.push(loadTexture(d.night, 1024).then(t => {
                    b.mesh.material.emissiveMap = t;
                    b.mesh.material.needsUpdate = true;
                }).catch(() => {}));
            }
            if (d.clouds) {
                jobs.push(loadTexture(d.clouds, 1024).then(t => {
                    b.clouds.material.map = t;
                    b.clouds.material.needsUpdate = true;
                    b.clouds.visible = true;
                }).catch(() => {}));
            }
            if (d.ring) {
                jobs.push(loadRawTexture(d.ring).then(t => {
                    b.ring.material.map = t;
                    b.ring.material.needsUpdate = true;
                }).catch(() => {}));
            }
        }

        // real map for Earth's Moon (procedural for every other moon)
        const moonInfo = this.moonIndex.get('earth/Moon');
        if (moonInfo && moonInfo.data.tex) {
            jobs.push(loadTexture(moonInfo.data.tex, 1024).then(t => {
                moonInfo.mesh.material.map = t;
                moonInfo.mesh.material.color.set(0xffffff);
                if (moonInfo.data.bump) {
                    moonInfo.mesh.material.bumpMap = t;
                    moonInfo.mesh.material.bumpScale = moonInfo.data.bump;
                }
                moonInfo.mesh.material.needsUpdate = true;
            }).catch(() => {}));
        }

        jobs.push(loadTexture('/public/textures/star-map.jpg', 2048).then(t => {
            t.mapping = THREE.EquirectangularReflectionMapping;
            this.scene.background = t;
            this.scene.backgroundIntensity = 0.5;
        }).catch(() => {}));

        let done = 0;
        await Promise.all(jobs.map(p => p.then(() => {
            onStatus(`Streaming surface maps… ${Math.round((++done / jobs.length) * 100)}%`);
        })));
    }

    /* ---------- per-frame ---------- */
    update(dt, camPos = null) {
        this.elapsed += dt;
        const rate = this.orbitRate;
        if (this.sunMat) this.sunMat.uniforms.uTime.value = this.elapsed;
        if (camPos) this._camPos.copy(camPos);

        // the additive flare washes the whole frame to cream when you get
        // close — fade it out and let the granulation shader carry the star
        if (this.sunFlare && camPos) {
            this.sunFlare.material.opacity = THREE.MathUtils.smoothstep(camPos.length(), 55, 170);
        }

        for (const [key, b] of this.bodies) {
            const d = b.data;
            if (b.spinner) b.spinner.rotation.y += d.spin * dt * 60;
            else if (b.mesh) b.mesh.rotation.y += d.spin * dt * 60;
            if (b.clouds) b.clouds.rotation.y += d.spin * 0.35 * dt * 60;
            if (b.pivot && d.orbit) {
                b.orbitAngle += d.orbit * rate * dt;
                b.pivot.rotation.y = b.orbitAngle;
            }
            if (b.moons) {
                // moons follow orbitRate too — during the ride they near-freeze,
                // so the pose set in poseForRide stays true to the track
                b.moons.forEach(m => {
                    // 0.07 keeps moons visibly orbiting yet slow enough that a
                    // 2-second fly-to tween can still land on one
                    m.angle += m.dir * m.data.speed * rate * dt * 60 * 0.07;
                    m.pivot.rotation.y = m.angle;
                    m.mesh.rotation.y += 0.004 * dt * 60;
                });
            }
            // labels keep a readable on-screen size at any distance
            if (b.label) {
                if (b.label.visible) {
                    b.holder.getWorldPosition(_lblPos);
                    const dist = _lblPos.distanceTo(this._camPos);
                    // constant angular size: readable far away, unobtrusive close up
                    const w = Math.min(46, Math.max(3, dist * 0.085));
                    b.label.scale.set(w, w * 0.25, 1);
                    b.label.material.opacity = dist < d.radius * 3.2 ? 0 : 0.9;
                }
            }
        }

        for (const belt of this.belts) {
            const { mesh, rocks, dummy } = belt;
            for (let i = 0; i < rocks.length; i++) {
                const r = rocks[i];
                r.a += r.sp * rate * dt;
                r.rot.x += r.rs * dt;
                r.rot.y += r.rs * 0.7 * dt;
                dummy.position.set(Math.cos(r.a) * r.r, r.y, Math.sin(r.a) * r.r);
                dummy.rotation.copy(r.rot);
                dummy.scale.setScalar(r.s);
                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);
            }
            mesh.instanceMatrix.needsUpdate = true;
        }

        if (this.comet) {
            const c = this.comet;
            c.angle += 0.035 * dt * rate;
            const r = 330;
            c.group.position.set(Math.cos(c.angle) * r, 55 + Math.sin(c.angle * 1.7) * 25, Math.sin(c.angle) * r * 0.75);
            // both tails point away from the Sun
            const away = c.group.position.clone().normalize();
            c.tail.position.copy(away.clone().multiplyScalar(45));
            const side = new THREE.Vector3(-away.z, 0, away.x);
            const up = new THREE.Vector3(0, 1, 0);
            for (let i = 0; i < this.dustSeeds.length; i++) {
                const s = this.dustSeeds[i];
                const len = s.d * 78;
                const spread = s.d * 9;
                const curve = s.d * s.d * 14;           // dust lags behind the orbit
                _dustV.copy(away).multiplyScalar(6 + len)
                    .addScaledVector(side, s.lat * spread - curve)
                    .addScaledVector(up, s.lift * spread * 0.6)
                    .addScaledVector(side, Math.sin(this.elapsed * 0.8 + s.tw) * 0.6);
                c.dustPos[i * 3] = _dustV.x;
                c.dustPos[i * 3 + 1] = _dustV.y;
                c.dustPos[i * 3 + 2] = _dustV.z;
            }
            c.dust.geometry.attributes.position.needsUpdate = true;
        }

        this._updateMeteors(dt, camPos);
    }

    /** world position of a body — accepts planet keys and 'planet/Moon' keys */
    worldPos(key, out = new THREE.Vector3()) {
        const b = this.bodies.get(key);
        if (b) { (b.holder || b.group).getWorldPosition(out); return out; }
        const m = this.moonIndex.get(key);
        if (m) { m.mesh.getWorldPosition(out); return out; }
        return out.set(0, 0, 0);
    }

    /** info for the scan card — planets, dwarfs and moons alike */
    getInfo(key) {
        const b = this.bodies.get(key);
        if (b) {
            const d = b.data;
            return {
                key, name: d.name, fact: d.fact, radius: d.radius,
                distance: d.distance ? d.distance + ' u' : '—',
                tiltDeg: ((d.tilt || 0) * 57.3).toFixed(1) + '°',
                moons: (d.moons || []).map(m => m.name),
                kind: d.dwarf ? 'DWARF PLANET' : (key === 'sun' ? 'STAR' : 'PLANET')
            };
        }
        const m = this.moonIndex.get(key);
        if (m) {
            return {
                key, name: m.data.name, fact: m.data.fact, radius: m.data.radius,
                distance: m.data.distance + ' u from ' + m.parent.name,
                tiltDeg: '—', moons: [],
                kind: 'MOON OF ' + m.parent.name.toUpperCase()
            };
        }
        return null;
    }

    /** deterministic orbital phases so ride waypoints always line up */
    poseForRide() {
        const phase = {
            mercury: 2.6, venus: 1.1, earth: 0.0, mars: 5.3,
            jupiter: 0.62, saturn: 2.05, uranus: 3.6, neptune: 4.35,
            // dwarfs parked away from the track: Ceres opposite the belt
            // gauntlet, the Kuiper trio far beyond every waypoint anyway
            ceres: 2.16, pluto: 1.0, makemake: 3.1, eris: 5.0
        };
        for (const [k, a] of Object.entries(phase)) {
            const b = this.bodies.get(k);
            if (!b) continue;
            b.orbitAngle = a;
            b.pivot.rotation.y = a;
        }
        // park every moon on its planet's anti-Sun side: the flyby corridors
        // all pass on the Sun side, and with orbitRate near-frozen during the
        // ride the moons stay parked there. Earth's Moon gets its own angle —
        // the ignition segment climbs out right through the anti-Sun corridor.
        const parkOffset = { earth: 2.4 };
        for (const [, b] of this.bodies) {
            (b.moons || []).forEach((m, i, arr) => {
                m.angle = (i - (arr.length - 1) / 2) * 0.55 + (parkOffset[b.data.key] || 0);
                m.pivot.rotation.y = m.angle;
            });
        }
        this.root.updateMatrixWorld(true);
    }

    setOrbitLinesVisible(v) {
        for (const [, b] of this.bodies) if (b.orbitLine) b.orbitLine.visible = v;
    }

    setLabelsVisible(v) {
        for (const [, b] of this.bodies) if (b.label) b.label.visible = v;
    }
}

const _lblPos = new THREE.Vector3();
const _dustV = new THREE.Vector3();
