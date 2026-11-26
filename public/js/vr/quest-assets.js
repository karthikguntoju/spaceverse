import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const texCache = new Map();
const glowCache = new Map();

export function safeCanvas(w, h) {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    try {
        const canvas = document.createElement('canvas');
        if (!canvas || typeof canvas.getContext !== 'function') return null;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx || typeof ctx.createLinearGradient !== 'function' || typeof ctx.createRadialGradient !== 'function') {
            return null;
        }
        return { canvas, ctx };
    } catch {
        return null;
    }
}

function makeCanvasTex(key, w, h, draw, { srgb = true, repeat = false } = {}) {
    if (texCache.has(key)) return texCache.get(key);
    const surface = safeCanvas(w, h);
    if (!surface) return null;
    draw(surface.ctx, w, h);
    const tex = new THREE.CanvasTexture(surface.canvas);
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (repeat) {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
    }
    tex.anisotropy = 4;
    texCache.set(key, tex);
    return tex;
}

export function safeLoadTexture(url, { srgb = true, repeat = false } = {}) {
    if (typeof window === 'undefined' || typeof Image === 'undefined') return null;
    const cacheKey = `url:${url}:${srgb ? 1 : 0}:${repeat ? 1 : 0}`;
    if (texCache.has(cacheKey)) return texCache.get(cacheKey);
    try {
        const loader = new THREE.TextureLoader();
        const tex = loader.load(url);
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        if (repeat) {
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
        }
        tex.anisotropy = 4;
        texCache.set(cacheKey, tex);
        return tex;
    } catch {
        return null;
    }
}

export function createSpaceEnvMap(renderer) {
    if (!renderer || typeof window === 'undefined') return null;
    try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();
        return env;
    } catch {
        return null;
    }
}

export function createHullTexture(baseHex = '#232c3d', lineHex = '#0a0f18') {
    return makeCanvasTex(`hull:${baseHex}:${lineHex}`, 512, 512, (ctx, w, h) => {
        ctx.fillStyle = baseHex;
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 900; i++) {
            const alpha = 0.015 + Math.random() * 0.03;
            ctx.fillStyle = i % 2 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
            ctx.fillRect(Math.random() * w, Math.random() * h, 4 + Math.random() * 24, 2 + Math.random() * 14);
        }
        const cell = 128;
        ctx.strokeStyle = lineHex;
        ctx.lineWidth = 3;
        for (let r = 0; r <= h / cell; r++) {
            const y = r * cell;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
            const off = (r % 2) * (cell * 0.5);
            for (let c = -1; c <= w / cell + 1; c++) {
                const x = c * cell + off;
                ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + cell); ctx.stroke();
                for (const [dx, dy] of [[10, 10], [cell - 10, 10], [10, cell - 10], [cell - 10, cell - 10]]) {
                    ctx.fillStyle = 'rgba(0,0,0,0.48)';
                    ctx.beginPath(); ctx.arc(x + dx, y + dy, 2.5, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = 'rgba(255,255,255,0.16)';
                    ctx.beginPath(); ctx.arc(x + dx - 0.8, y + dy - 0.8, 1.3, 0, Math.PI * 2); ctx.fill();
                }
            }
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        for (let r = 0; r <= h / cell; r++) {
            ctx.beginPath(); ctx.moveTo(0, r * cell + 2); ctx.lineTo(w, r * cell + 2); ctx.stroke();
        }
    }, { repeat: true });
}

export function createFoilTexture() {
    const map = makeCanvasTex('foil:color', 512, 512, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#c88c28');
        g.addColorStop(0.5, '#efc15b');
        g.addColorStop(1, '#a96c18');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 650; i++) {
            const x = Math.random() * w;
            const y = Math.random() * h;
            const s = 12 + Math.random() * 28;
            ctx.fillStyle = i % 2 ? 'rgba(255,244,190,0.16)' : 'rgba(85,48,8,0.18)';
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + s, y + (Math.random() - 0.5) * 14);
            ctx.lineTo(x + (Math.random() - 0.5) * 14, y + s);
            ctx.closePath();
            ctx.fill();
        }
        ctx.strokeStyle = 'rgba(70,38,6,0.35)';
        ctx.lineWidth = 2;
        for (let i = 0; i <= 4; i++) {
            ctx.beginPath(); ctx.moveTo(0, i * 128); ctx.lineTo(w, i * 128); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(i * 128, 0); ctx.lineTo(i * 128, h); ctx.stroke();
        }
    }, { repeat: true });
    const bump = makeCanvasTex('foil:bump', 512, 512, (ctx, w, h) => {
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 650; i++) {
            const x = Math.random() * w;
            const y = Math.random() * h;
            const s = 12 + Math.random() * 28;
            ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)';
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + s, y + (Math.random() - 0.5) * 14);
            ctx.lineTo(x + (Math.random() - 0.5) * 14, y + s);
            ctx.closePath();
            ctx.fill();
        }
    }, { srgb: false, repeat: true });
    return { map, bump };
}

export function createSolarTexture() {
    return makeCanvasTex('solar:grid', 512, 512, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#0c234d');
        g.addColorStop(0.5, '#173b78');
        g.addColorStop(1, '#091a3a');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        const cols = 8, rows = 16;
        const cw = w / cols, rh = h / rows;
        ctx.strokeStyle = 'rgba(180,220,255,0.35)';
        ctx.lineWidth = 2;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                ctx.strokeRect(c * cw + 2, r * rh + 2, cw - 4, rh - 4);
                ctx.fillStyle = 'rgba(140,205,255,0.12)';
                ctx.fillRect(c * cw + cw * 0.48, r * rh + 2, 1.5, rh - 4);
            }
        }
        ctx.strokeStyle = 'rgba(218,236,255,0.65)';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(w * 0.5, 0); ctx.lineTo(w * 0.5, h); ctx.stroke();
    }, { repeat: true });
}

export function createPadTexture() {
    return makeCanvasTex('lunar:pad', 512, 512, (ctx, w, h) => {
        const cx = w / 2, cy = h / 2;
        ctx.fillStyle = '#1b222e';
        ctx.fillRect(0, 0, w, h);
        const rad = ctx.createRadialGradient(cx, cy, 40, cx, cy, 250);
        rad.addColorStop(0, '#2a3444');
        rad.addColorStop(0.75, '#19202b');
        rad.addColorStop(1, '#0f141c');
        ctx.fillStyle = rad;
        ctx.beginPath(); ctx.arc(cx, cy, 248, 0, Math.PI * 2); ctx.fill();

        ctx.strokeStyle = '#64ffda';
        ctx.lineWidth = 10;
        ctx.beginPath(); ctx.arc(cx, cy, 224, 0, Math.PI * 2); ctx.stroke();

        ctx.strokeStyle = '#fbbf24';
        ctx.setLineDash([22, 16]);
        ctx.lineWidth = 8;
        ctx.beginPath(); ctx.arc(cx, cy, 174, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = 'rgba(148, 226, 255, 0.72)';
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(cx - 120, cy); ctx.lineTo(cx + 120, cy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, cy - 120); ctx.lineTo(cx, cy + 120); ctx.stroke();

        ctx.fillStyle = '#eef8ff';
        ctx.font = 'bold 58px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('PAD 01', cx, cy + 68);
    });
}

export function createGlowTexture(inner = 'rgba(120,245,255,1)', outer = 'rgba(34,211,238,0)') {
    const key = `${inner}|${outer}`;
    if (glowCache.has(key)) return glowCache.get(key);
    const surface = safeCanvas(128, 128);
    if (!surface) return null;
    const { canvas, ctx } = surface;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, inner);
    g.addColorStop(0.32, inner.replace(/[\d.]+\)$/, '0.62)'));
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    glowCache.set(key, tex);
    return tex;
}

export function createHexShieldTexture() {
    return makeCanvasTex('shield:hex', 512, 512, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        const cx = w / 2, cy = h / 2;
        const grad = ctx.createRadialGradient(cx, cy, 24, cx, cy, 252);
        grad.addColorStop(0, 'rgba(34, 211, 238, 0.16)');
        grad.addColorStop(0.75, 'rgba(56, 189, 248, 0.34)');
        grad.addColorStop(0.95, 'rgba(125, 255, 232, 0.92)');
        grad.addColorStop(1, 'rgba(34, 211, 238, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(cx, cy, 252, 0, Math.PI * 2); ctx.fill();

        const r = 34;
        const dx = r * 1.5;
        const dy = r * Math.sqrt(3);
        ctx.strokeStyle = 'rgba(165, 248, 255, 0.72)';
        ctx.lineWidth = 2.4;
        for (let row = -6; row <= 6; row++) {
            for (let col = -6; col <= 6; col++) {
                const px = cx + col * dx;
                const py = cy + row * dy + (Math.abs(col) % 2 ? dy * 0.5 : 0);
                if (Math.hypot(px - cx, py - cy) > 224) continue;
                ctx.beginPath();
                for (let s = 0; s < 6; s++) {
                    const a = (s / 6) * Math.PI * 2;
                    const vx = px + Math.cos(a) * (r * 0.88);
                    const vy = py + Math.sin(a) * (r * 0.88);
                    if (s === 0) ctx.moveTo(vx, vy);
                    else ctx.lineTo(vx, vy);
                }
                ctx.closePath();
                ctx.stroke();
            }
        }
        ctx.strokeStyle = 'rgba(195, 255, 245, 0.95)';
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(cx, cy, 236, 0, Math.PI * 2); ctx.stroke();
    });
}

function makeAtmosphereMaterial(colorHex = 0x5ec6ff, intensity = 0.85, power = 3.2) {
    return new THREE.ShaderMaterial({
        uniforms: {
            glowColor: { value: new THREE.Color(colorHex) },
            intensity: { value: intensity },
            power: { value: power }
        },
        vertexShader: `
            varying vec3 vNormalView;
            varying vec3 vPosView;
            void main() {
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vPosView = -mvPosition.xyz;
                vNormalView = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 glowColor;
            uniform float intensity;
            uniform float power;
            varying vec3 vNormalView;
            varying vec3 vPosView;
            void main() {
                float fresnel = pow(clamp(1.0 - abs(dot(normalize(vNormalView), normalize(vPosView))), 0.0, 1.0), power);
                gl_FragColor = vec4(glowColor, fresnel * intensity);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
        forceSinglePass: true
    });
}

export function buildSpaceBackdrop(parent, preset = 'earth-orbit', envMap = null) {
    const group = new THREE.Group();
    parent.add(group);

    // Rich starfield with O/B/A/F/G/K/M stellar hues
    const starCount = 1200;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const palette = [
        new THREE.Color(0xdbeafe),
        new THREE.Color(0xffffff),
        new THREE.Color(0xfff4d6),
        new THREE.Color(0xbae6fd),
        new THREE.Color(0xffd2a8)
    ];
    for (let i = 0; i < starCount; i++) {
        const y = (i + 0.5) * 2 / starCount - 1;
        const phi = i * 2.3999632;
        const r = Math.sqrt(Math.max(0, 1 - y * y)) * 185;
        positions[i * 3] = Math.cos(phi) * r;
        positions[i * 3 + 1] = y * 185;
        positions[i * 3 + 2] = Math.sin(phi) * r;
        const tint = palette[i % palette.length];
        const lum = 0.65 + (i % 5) * 0.08;
        colors[i * 3] = tint.r * lum;
        colors[i * 3 + 1] = tint.g * lum;
        colors[i * 3 + 2] = tint.b * lum;
    }
    const starsGeo = new THREE.BufferGeometry();
    starsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starsGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    group.add(new THREE.Points(starsGeo, new THREE.PointsMaterial({
        size: 0.36,
        vertexColors: true,
        transparent: true,
        opacity: 0.92,
        depthWrite: false
    })));

    const starMapTex = safeLoadTexture('/public/textures/star-map.jpg');
    if (starMapTex) {
        const sky = new THREE.Mesh(
            new THREE.SphereGeometry(220, 32, 20),
            new THREE.MeshBasicMaterial({ map: starMapTex, side: THREE.BackSide, transparent: true, opacity: 0.42, depthWrite: false })
        );
        group.add(sky);
    }

    // Sun flare sprite for crisp orbital silhouette rim lighting
    const glowTex = createGlowTexture('rgba(255,244,214,1)', 'rgba(255,175,90,0)');
    if (preset !== 'mars-surface') {
        const sunPos = preset === 'lunar-earthrise' ? [-76, 48, -145] : [-82, 54, -140];
        const sunOrb = new THREE.Mesh(
            new THREE.SphereGeometry(3.8, 16, 12),
            new THREE.MeshBasicMaterial({ color: 0xfff3d4 })
        );
        sunOrb.position.set(...sunPos);
        group.add(sunOrb);
        if (glowTex) {
            const corona = new THREE.Sprite(new THREE.SpriteMaterial({
                map: glowTex,
                color: 0xffd599,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            }));
            corona.position.copy(sunOrb.position);
            corona.scale.set(28, 28, 1);
            group.add(corona);
        }
    }

    const updaters = [];

    if (preset === 'earth-orbit' || preset === 'lunar-earthrise') {
        const isOrbit = preset === 'earth-orbit';
        const radius = isOrbit ? 64 : 13.5;
        const earthGroup = new THREE.Group();
        earthGroup.position.set(isOrbit ? 0 : -24, isOrbit ? -70 : 25, isOrbit ? -26 : -94);
        earthGroup.rotation.z = 0.38;
        group.add(earthGroup);

        const earthMap = safeLoadTexture('/public/textures/earth.jpg');
        const nightMap = safeLoadTexture('/public/textures/earth-night.jpg');
        const cloudMap = safeLoadTexture('/public/textures/earth-clouds.png');

        const earthMat = new THREE.MeshStandardMaterial({
            color: earthMap ? 0xffffff : 0x24569e,
            map: earthMap || null,
            emissive: nightMap ? 0xffcc7a : 0x051126,
            emissiveMap: nightMap || null,
            emissiveIntensity: nightMap ? 0.55 : 0.22,
            roughness: 0.72,
            metalness: 0.08,
            envMap
        });
        const globe = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), earthMat);
        earthGroup.add(globe);

        let clouds = null;
        if (cloudMap) {
            clouds = new THREE.Mesh(
                new THREE.SphereGeometry(radius * 1.014, 72, 48),
                new THREE.MeshStandardMaterial({
                    map: cloudMap,
                    transparent: true,
                    opacity: 0.82,
                    depthWrite: false,
                    roughness: 0.9
                })
            );
            earthGroup.add(clouds);
        }

        const atmo = new THREE.Mesh(
            new THREE.SphereGeometry(radius * 1.055, 96, 64),
            makeAtmosphereMaterial(0x4fc3ff, isOrbit ? 0.95 : 0.8, 3.0)
        );
        earthGroup.add(atmo);

        updaters.push(dt => {
            globe.rotation.y += dt * 0.012;
            if (clouds) clouds.rotation.y += dt * 0.017;
        });
    } else if (preset === 'mars-surface') {
        const skyMat = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec3 vDir;
                void main() {
                    vDir = normalize(position);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vDir;
                void main() {
                    float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
                    vec3 low = vec3(0.42, 0.21, 0.14);
                    vec3 mid = vec3(0.24, 0.11, 0.09);
                    vec3 top = vec3(0.05, 0.03, 0.06);
                    vec3 col = mix(low, mid, smoothstep(0.45, 0.65, h));
                    col = mix(col, top, smoothstep(0.62, 0.92, h));
                    gl_FragColor = vec4(col, 1.0);
                }
            `,
            side: THREE.BackSide,
            depthWrite: false,
            forceSinglePass: true
        });
        group.add(new THREE.Mesh(new THREE.SphereGeometry(170, 24, 16), skyMat));

        const sunGlow = createGlowTexture('rgba(255,214,170,1)', 'rgba(210,95,55,0)');
        if (sunGlow) {
            const sun = new THREE.Sprite(new THREE.SpriteMaterial({
                map: sunGlow,
                color: 0xffc899,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            }));
            sun.position.set(-48, 34, -128);
            sun.scale.set(36, 36, 1);
            group.add(sun);
        }

        // Phobos moonlet in the dusty sky
        const phobos = new THREE.Mesh(
            new THREE.DodecahedronGeometry(1.7, 1),
            new THREE.MeshStandardMaterial({ color: 0x9b8f84, roughness: 0.92 })
        );
        phobos.scale.set(1.25, 0.85, 0.95);
        phobos.position.set(32, 26, -110);
        group.add(phobos);
    } else if (preset === 'saturn-rings') {
        const saturnGroup = new THREE.Group();
        saturnGroup.position.set(44, 22, -132);
        saturnGroup.rotation.set(0.18, 0.2, -0.34);
        group.add(saturnGroup);

        const saturnMap = safeLoadTexture('/public/textures/saturn.jpg');
        const saturn = new THREE.Mesh(
            new THREE.SphereGeometry(24, 48, 32),
            new THREE.MeshStandardMaterial({
                color: saturnMap ? 0xffffff : 0xdcb97a,
                map: saturnMap || null,
                roughness: 0.85,
                metalness: 0.05
            })
        );
        saturnGroup.add(saturn);

        const ringAlpha = safeLoadTexture('/public/textures/saturn-ring-alpha.png');
        const ringGeo = new THREE.RingGeometry(29, 54, 128, 1);
        const pos = ringGeo.attributes.position;
        const uv = ringGeo.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i);
            const dist = Math.hypot(x, y);
            uv.setXY(i, (dist - 29) / 25, 0.5);
        }
        const ring = new THREE.Mesh(
            ringGeo,
            new THREE.MeshBasicMaterial({
                color: 0xfff2d6,
                map: ringAlpha || null,
                transparent: true,
                opacity: ringAlpha ? 0.92 : 0.45,
                side: THREE.DoubleSide,
                depthWrite: false
            })
        );
        ring.rotation.x = Math.PI / 2;
        saturnGroup.add(ring);

        const atmo = new THREE.Mesh(
            new THREE.SphereGeometry(25.2, 40, 26),
            makeAtmosphereMaterial(0xf5d493, 0.45, 3.4)
        );
        saturnGroup.add(atmo);

        updaters.push(dt => { saturn.rotation.y += dt * 0.015; });
    }

    return {
        group,
        update(dt) {
            for (const fn of updaters) fn(dt);
        }
    };
}

export class ParticlePool {
    constructor(parent, count = 260, size = 0.24) {
        this.count = count;
        this.positions = new Float32Array(count * 3);
        this.colors = new Float32Array(count * 3);
        this.velocities = new Float32Array(count * 3);
        this.life = new Float32Array(count);
        this.maxLife = new Float32Array(count);
        this.drag = new Float32Array(count);
        this.cursor = 0;
        this._tmpColor = new THREE.Color();

        for (let i = 0; i < count; i++) this.positions[i * 3 + 1] = -9999;

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));

        const tex = createGlowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
        this.points = new THREE.Points(geo, new THREE.PointsMaterial({
            size,
            map: tex || null,
            vertexColors: true,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        this.points.frustumCulled = false;
        parent.add(this.points);
    }

    spawn(x, y, z, vx, vy, vz, hex = 0x64ffda, ttl = 0.55, drag = 0.96) {
        const i = this.cursor;
        this.cursor = (this.cursor + 1) % this.count;
        this.positions[i * 3] = x;
        this.positions[i * 3 + 1] = y;
        this.positions[i * 3 + 2] = z;
        this.velocities[i * 3] = vx;
        this.velocities[i * 3 + 1] = vy;
        this.velocities[i * 3 + 2] = vz;
        this._tmpColor.setHex(hex);
        this.colors[i * 3] = this._tmpColor.r;
        this.colors[i * 3 + 1] = this._tmpColor.g;
        this.colors[i * 3 + 2] = this._tmpColor.b;
        this.life[i] = ttl;
        this.maxLife[i] = ttl;
        this.drag[i] = drag;
    }

    burst(x, y, z, n = 18, speed = 3.2, hex = 0xffb454, ttl = 0.65) {
        for (let k = 0; k < n; k++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const s = speed * (0.35 + Math.random() * 0.8);
            this.spawn(
                x, y, z,
                Math.sin(phi) * Math.cos(theta) * s,
                Math.cos(phi) * s,
                Math.sin(phi) * Math.sin(theta) * s,
                hex, ttl * (0.65 + Math.random() * 0.5), 0.94
            );
        }
    }

    update(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        let dirty = false;
        for (let i = 0; i < this.count; i++) {
            if (this.life[i] <= 0) continue;
            dirty = true;
            this.life[i] -= dt;
            if (this.life[i] <= 0) {
                this.positions[i * 3 + 1] = -9999;
                this.colors[i * 3] = 0;
                this.colors[i * 3 + 1] = 0;
                this.colors[i * 3 + 2] = 0;
                continue;
            }
            const d = Math.pow(this.drag[i], dt * 60);
            this.velocities[i * 3] *= d;
            this.velocities[i * 3 + 1] *= d;
            this.velocities[i * 3 + 2] *= d;
            this.positions[i * 3] += this.velocities[i * 3] * dt;
            this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
            this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
            const fade = Math.max(0, this.life[i] / this.maxLife[i]);
            if (fade < 0.45) {
                const scale = fade / 0.45;
                this.colors[i * 3] *= (0.94 + 0.06 * scale);
                this.colors[i * 3 + 1] *= (0.94 + 0.06 * scale);
                this.colors[i * 3 + 2] *= (0.94 + 0.06 * scale);
            }
        }
        if (dirty) {
            this.points.geometry.attributes.position.needsUpdate = true;
            this.points.geometry.attributes.color.needsUpdate = true;
        }
    }
}

export function buildMissionCabin({ style = 'capsule', accent = '#64ffda', envMap = null } = {}) {
    const group = new THREE.Group();
    const hullTex = createHullTexture();
    const accentHex = new THREE.Color(accent).getHex();

    const mHull = new THREE.MeshStandardMaterial({
        color: 0x3b485e,
        map: hullTex,
        metalness: 0.55,
        roughness: 0.45,
        envMap
    });
    const mDark = new THREE.MeshStandardMaterial({
        color: 0x161f2d,
        metalness: 0.42,
        roughness: 0.62,
        envMap
    });
    const mTrim = new THREE.MeshStandardMaterial({
        color: 0x62748e,
        metalness: 0.72,
        roughness: 0.32,
        envMap
    });
    const mGlow = new THREE.MeshBasicMaterial({ color: accentHex });

    const part = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.rotation.set(rx, ry, rz);
        group.add(mesh);
        return mesh;
    };

    // Lower dashboard console (strictly below y = -0.68 so central 80% sightline is unobstructed)
    const dashW = style === 'eva' ? 1.85 : 2.55;
    const dashZ = style === 'eva' ? -1.45 : -1.78;
    part(new RoundedBoxGeometry(dashW, 0.22, 0.52, 3, 0.04), mDark, 0, -0.96, dashZ, -0.22, 0, 0);
    part(new RoundedBoxGeometry(dashW - 0.14, 0.03, 0.03, 2, 0.01), mGlow, 0, -0.84, dashZ + 0.22);

    // Side armrests / consoles for seated Touch Plus immersion
    for (const side of [-1, 1]) {
        part(new RoundedBoxGeometry(0.28, 0.14, 1.35, 3, 0.03), mDark, side * 1.15, -0.88, -1.12, 0, side * 0.12, 0);
        part(new RoundedBoxGeometry(0.02, 0.025, 1.15, 2, 0.008), mGlow, side * 1.02, -0.81, -1.12, 0, side * 0.12, 0);
    }

    // Open-canopy A-pillars and overhead grab rail (wider on rover/lander for peripheral awareness)
    if (style !== 'eva') {
        const spread = style === 'interceptor' ? 1.35 : 1.55;
        for (const side of [-1, 1]) {
            part(new THREE.CylinderGeometry(0.042, 0.056, 2.05, 10), mHull, side * spread, 0.08, -1.35, 0.36, 0, side * -0.22);
            if (style === 'lander' || style === 'rover') {
                part(new THREE.CylinderGeometry(0.03, 0.038, 1.4, 8), mTrim, side * (spread * 0.92), -0.62, -1.55, 0.95, 0, side * -0.15);
            }
        }
        // Overhead grab rail + brow
        part(new RoundedBoxGeometry(2.55, 0.08, 0.26, 2, 0.02), mHull, 0, 1.02, -0.96);
        part(new THREE.CylinderGeometry(0.022, 0.022, 1.4, 10), mTrim, 0, 0.94, -0.9, 0, 0, Math.PI / 2);
    }

    // Rover rugged front hood / bumper frame visible down low
    if (style === 'rover') {
        part(new RoundedBoxGeometry(2.4, 0.12, 0.55, 3, 0.03), mHull, 0, -1.16, -2.18);
        for (const side of [-1, 1]) {
            part(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 14), mTrim, side * 0.98, -1.06, -2.26, Math.PI / 2, 0, 0);
            part(new THREE.CircleGeometry(0.075, 16), new THREE.MeshBasicMaterial({ color: 0xfff0d4 }), side * 0.98, -1.06, -2.335);
        }
    }

    // Animated Left Throttle Lever & Right Flight Stick mounted in the cockpit
    const throttlePivot = new THREE.Group();
    throttlePivot.position.set(-0.74, -0.78, dashZ + 0.15);
    group.add(throttlePivot);
    const thStem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.18, 10), mTrim);
    thStem.position.y = 0.09;
    throttlePivot.add(thStem);
    const thGrip = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.045, 0.065, 2, 0.014), mDark);
    thGrip.position.y = 0.19;
    throttlePivot.add(thGrip);
    const thGlow = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.01, 0.015), mGlow);
    thGlow.position.set(0, 0.195, 0.034);
    throttlePivot.add(thGlow);

    const stickPivot = new THREE.Group();
    stickPivot.position.set(0.74, -0.78, dashZ + 0.15);
    group.add(stickPivot);
    const stStem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.22, 10), mTrim);
    stStem.position.y = 0.11;
    stickPivot.add(stStem);
    const stHead = new THREE.Mesh(new RoundedBoxGeometry(0.055, 0.08, 0.065, 2, 0.015), mDark);
    stHead.position.y = 0.22;
    stickPivot.add(stHead);
    const stBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), mGlow);
    stBeacon.position.set(0, 0.26, 0.025);
    stickPivot.add(stBeacon);

    // Central Multi-Function Display (MFD) canvas screen
    const mfdSurface = safeCanvas(512, 256);
    const mfdTex = mfdSurface ? new THREE.CanvasTexture(mfdSurface.canvas) : null;
    if (mfdTex) {
        mfdTex.colorSpace = THREE.SRGBColorSpace;
        mfdTex.generateMipmaps = false;
        mfdTex.minFilter = THREE.LinearFilter;
    }
    const mfd = new THREE.Mesh(
        new THREE.PlaneGeometry(0.78, 0.36),
        new THREE.MeshBasicMaterial({ map: mfdTex, color: mfdTex ? 0xffffff : 0x091628, toneMapped: false })
    );
    mfd.position.set(0, -0.82, dashZ + 0.265);
    mfd.rotation.x = -0.38;
    group.add(mfd);

    let lastMfdKey = '';
    const drawMFD = (header, lines = [], barLabel = '', barRatio = 0, warn = false) => {
        if (!mfdSurface || !mfdTex) return;
        const key = `${header}|${lines.join(';')}|${barLabel}|${Math.round(barRatio * 50)}|${warn}`;
        if (key === lastMfdKey) return;
        lastMfdKey = key;
        const { ctx, canvas } = mfdSurface;
        const w = canvas.width, h = canvas.height;
        ctx.fillStyle = '#060e1c';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = warn ? '#fb7185' : accent;
        ctx.lineWidth = 4;
        ctx.strokeRect(4, 4, w - 8, h - 8);

        ctx.fillStyle = warn ? '#fda4af' : accent;
        ctx.font = 'bold 26px Inter, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(header, 22, 38);

        ctx.fillStyle = '#dbeafe';
        ctx.font = '22px Inter, system-ui, sans-serif';
        lines.slice(0, 3).forEach((ln, idx) => {
            ctx.fillText(ln, 22, 82 + idx * 36, w - 44);
        });

        if (barLabel) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = 'bold 18px Inter, system-ui, sans-serif';
            ctx.fillText(barLabel, 22, h - 46);
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fillRect(22, h - 34, w - 44, 16);
            ctx.fillStyle = warn ? '#fb7185' : accent;
            ctx.fillRect(22, h - 34, (w - 44) * Math.max(0, Math.min(1, barRatio)), 16);
        }
        mfdTex.needsUpdate = true;
    };

    const setControls = (stickX = 0, stickY = 0, throttle = 0) => {
        throttlePivot.rotation.x = -0.35 + Math.max(0, Math.min(1, throttle)) * 0.72;
        stickPivot.rotation.z = -Math.max(-1, Math.min(1, stickX)) * 0.32;
        stickPivot.rotation.x = Math.max(-1, Math.min(1, stickY)) * 0.28;
    };

    return { group, mfd, drawMFD, setControls };
}
