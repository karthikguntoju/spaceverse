/**
 * SpaceVerse — Cinema-Grade Planetary & Solar System Shader Suite (v2)
 *
 * Bespoke physically-inspired GLSL shaders and mesh builders for:
 *  - Dynamic Photosphere Sun + Granulation + Sunspots + 3-Tier Volumetric Corona
 *  - Bespoke Per-Planet 3D Surface Shaders:
 *      • Mercury: 3D procedural multi-scale crater & ejecta ray relief, high-contrast regolith,
 *                 warm Caloris mineral basins, and sunward sodium exosphere glow
 *      • Venus:   Deep infrared night-side volcanic thermal rifts peeking through a 3D animated
 *                 Akatsuki-style ultraviolet chevron Rossby-wave sulfuric cloud deck
 *      • Earth:   Chromaticity ocean mask, dual-lobe GGX/Fresnel solar sunglint, 3D continental
 *                 mountain normal relief, real-time cloud shadows, crisp golden megacity networks,
 *                 and animated 3D Polar Aurora Borealis / Australis curtains
 *      • Mars:    Deep Valles Marineris / Olympus Mons normal relief, crystalline H2O/CO2 North &
 *                 South polar ice caps with spiral troughs, dust-storm swirls, and authentic
 *                 blue Martian sunset terminator scattering
 *      • Jupiter: Juno-grade turbulent domain-warped cyclonic belts/zones, raised 3D ammonia cloud
 *                 relief, Great Red Spot vortex enhancement, and polar cyclone + aurora glow
 *      • Saturn:  Cassini golden-butterscotch 3D banded atmosphere, North Polar Hexagon jet stream,
 *                 equatorial ring shadow cast onto Saturn's globe, and 6-zone ray-traced rings
 *      • Uranus:  JWST/Keck aquamarine methane banding, glowing South Polar Collar, high-altitude
 *                 white methane-ice convective clouds, and 13-ring charcoal/ice system
 *      • Neptune: Voyager/JWST deep cobalt-azure atmosphere, Great Dark Spot anticyclone, bright
 *                 high-altitude white methane cirrus streaks with cloud shadows, and 5 ring arcs
 *  - Animated Comet-Wake Orbital Trail Rings (`createOrbitRing`)
 *  - Pin-Sharp, Non-Blooming Orbital Starfield (`createStarfield` — space-accurate steady stars)
 */
(function (global) {
    'use strict';

    const PLANET_CONFIG = {
        mercury: {
            type: 4, subType: 1, bump: 1.45, roughness: 0.92,
            atmoColor: '#ffbe78', twilightColor: '#78aaff', atmoStrength: 0.18,
            tint: [1.06, 1.01, 0.96], contrast: 1.22, saturation: 1.16
        },
        venus: {
            type: 5, subType: 1, bump: 0.95, roughness: 0.78,
            atmoColor: '#ffd27d', twilightColor: '#ff6e24', atmoStrength: 0.88,
            tint: [1.08, 0.96, 0.78], contrast: 1.20, saturation: 1.22
        },
        earth: {
            type: 1, subType: 1, bump: 1.35, roughness: 0.70,
            atmoColor: '#389cff', twilightColor: '#ff6228', atmoStrength: 0.95,
            tint: [1.02, 1.05, 1.10], contrast: 1.16, saturation: 1.24
        },
        mars: {
            type: 4, subType: 2, bump: 1.55, roughness: 0.86,
            atmoColor: '#e88a58', twilightColor: '#6eb4ff', atmoStrength: 0.54,
            tint: [1.10, 0.94, 0.86], contrast: 1.18, saturation: 1.18
        },
        jupiter: {
            type: 2, subType: 1, bump: 0.75, roughness: 0.76,
            atmoColor: '#e8b888', twilightColor: '#ff7b36', atmoStrength: 0.52,
            tint: [1.06, 1.01, 0.95], contrast: 1.20, saturation: 1.24
        },
        saturn: {
            type: 2, subType: 2, bump: 0.65, roughness: 0.78,
            atmoColor: '#f5d492', twilightColor: '#ff9442', atmoStrength: 0.54,
            tint: [1.08, 1.02, 0.88], contrast: 1.22, saturation: 1.26
        },
        uranus: {
            type: 3, subType: 1, bump: 0.45, roughness: 0.72,
            atmoColor: '#56ebff', twilightColor: '#2490ff', atmoStrength: 0.80,
            tint: [0.80, 1.14, 1.28], contrast: 1.32, saturation: 1.45
        },
        neptune: {
            type: 3, subType: 2, bump: 0.65, roughness: 0.70,
            atmoColor: '#387eff', twilightColor: '#ff6a38', atmoStrength: 0.86,
            tint: [0.84, 1.04, 1.34], contrast: 1.28, saturation: 1.36
        },
        moon: {
            type: 4, subType: 3, bump: 1.40, roughness: 0.95,
            atmoColor: '#8899aa', twilightColor: '#667788', atmoStrength: 0.0,
            tint: [1.03, 1.01, 0.98], contrast: 1.20, saturation: 1.05
        },
        ceres: {
            type: 4, subType: 3, bump: 1.30, roughness: 0.95,
            atmoColor: '#8899aa', twilightColor: '#667788', atmoStrength: 0.06,
            tint: [1.0, 1.0, 1.0], contrast: 1.18, saturation: 1.05
        },
        pluto: {
            type: 4, subType: 2, bump: 1.25, roughness: 0.88,
            atmoColor: '#8ab8ff', twilightColor: '#5588dd', atmoStrength: 0.32,
            tint: [1.06, 0.98, 0.92], contrast: 1.18, saturation: 1.16
        },
        makemake: {
            type: 4, subType: 3, bump: 1.20, roughness: 0.90,
            atmoColor: '#d89b72', twilightColor: '#b56d45', atmoStrength: 0.14,
            tint: [1.08, 0.95, 0.88], contrast: 1.18, saturation: 1.14
        },
        eris: {
            type: 4, subType: 3, bump: 1.20, roughness: 0.88,
            atmoColor: '#cfe0f5', twilightColor: '#8fb4e8', atmoStrength: 0.18,
            tint: [1.02, 1.04, 1.08], contrast: 1.18, saturation: 1.10
        }
    };

    let _blackTex = null;
    function getBlackTexture(THREE) {
        if (_blackTex) return _blackTex;
        const data = new Uint8Array([0, 0, 0, 255]);
        _blackTex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
        _blackTex.needsUpdate = true;
        return _blackTex;
    }

    let _whiteTex = null;
    function getWhiteTexture(THREE) {
        if (_whiteTex) return _whiteTex;
        const data = new Uint8Array([255, 255, 255, 255]);
        _whiteTex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
        _whiteTex.needsUpdate = true;
        return _whiteTex;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       1. SUN PHOTOSPHERE & VOLUMETRIC CORONA SHADERS
       ═══════════════════════════════════════════════════════════════════════ */
    function createSunMaterial(THREE) {
        return new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 }
            },
            vertexShader: `
                varying vec3 vSurface;
                varying vec3 vNormal;
                varying vec3 vView;
                void main() {
                    vSurface = normalize(position);
                    vNormal = normalize(normalMatrix * normal);
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    vView = normalize(-mv.xyz);
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                varying vec3 vSurface;
                varying vec3 vNormal;
                varying vec3 vView;

                float hash(vec3 p) {
                    p = fract(p * 0.3183099 + 0.1);
                    p *= 17.0;
                    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                }
                float noise(vec3 p) {
                    vec3 i = floor(p), f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(
                        mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
                            mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
                        mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
                            mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z
                    );
                }
                float fbm(vec3 p) {
                    float v = 0.0, a = 0.5;
                    for (int i = 0; i < 5; i++) {
                        v += a * noise(p);
                        p = p * 2.04 + vec3(11.3, 7.1, 5.7);
                        a *= 0.5;
                    }
                    return v;
                }

                void main() {
                    vec3 p = vSurface;
                    float t = uTime * 0.065;
                    vec3 drift1 = vec3(t * 0.18, -t * 0.24, t * 0.14);
                    vec3 drift2 = vec3(-t * 0.15, t * 0.19, -t * 0.21);

                    vec3 warp = vec3(
                        fbm(p * 3.6 + drift1),
                        fbm(p * 3.9 + drift2),
                        fbm(p * 3.7 + drift1.zxy)
                    );
                    vec3 flow = p * 6.5 + (warp - 0.48) * 3.6;
                    float superGranules = fbm(flow + drift1 * 0.6);
                    float fineGranules = noise(p * 64.0 + warp * 4.5 - drift2 * 2.0);
                    float microCells = noise(p * 128.0 - warp * 3.0 + drift1 * 3.0);
                    float magneticLoops = abs(sin((superGranules + fineGranules * 0.14) * 26.0));

                    float heat = clamp(
                        superGranules * 0.68 +
                        fineGranules * 0.22 +
                        microCells * 0.08 +
                        (1.0 - magneticLoops) * 0.08,
                        0.0, 1.0
                    );

                    float latMask = smoothstep(0.05, 0.25, abs(p.y)) * (1.0 - smoothstep(0.45, 0.72, abs(p.y)));
                    float spotField = fbm(p * 13.5 + vec3(4.2, -1.8, 7.3) + drift1 * 0.15);
                    float umbra = smoothstep(0.68, 0.76, spotField) * latMask;
                    float faculae = smoothstep(0.60, 0.68, spotField) * (1.0 - umbra) * latMask;

                    vec3 colUmbra   = vec3(0.42, 0.06, 0.005);
                    vec3 colCool    = vec3(1.15, 0.22, 0.018);
                    vec3 colOrange  = vec3(2.25, 0.58, 0.055);
                    vec3 colGold    = vec3(3.35, 1.32, 0.26);
                    vec3 colWhite   = vec3(4.40, 2.75, 1.15);

                    vec3 color = mix(colCool, colOrange, smoothstep(0.20, 0.45, heat));
                    color = mix(color, colGold, smoothstep(0.44, 0.66, heat));
                    color = mix(color, colWhite, smoothstep(0.65, 0.86, heat));

                    color += colGold * faculae * 0.45;
                    color = mix(color, colUmbra, umbra * 0.78);

                    float mu = max(dot(normalize(vNormal), normalize(vView)), 0.0);
                    float limbDarkening = mix(0.32, 1.05, pow(mu, 0.48));
                    color *= limbDarkening;

                    float rim = pow(1.0 - mu, 4.5);
                    color += vec3(1.85, 0.32, 0.04) * rim * (0.7 + 0.3 * fineGranules);

                    gl_FragColor = vec4(color, 1.0);
                    #include <tonemapping_fragment>
                    #include <encodings_fragment>
                }
            `
        });
    }

    function createSolarCoronaMaterial(THREE, tier) {
        const scales = [
            { edgeStop: 0.36, alpha: 0.42, colInner: '#ff9d2e', colOuter: '#ff4508' },
            { edgeStop: 0.52, alpha: 0.24, colInner: '#ff7b1c', colOuter: '#d92b04' },
            { edgeStop: 0.72, alpha: 0.12, colInner: '#ff6414', colOuter: '#8c1600' }
        ][tier || 0];

        return new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uEdgeStop: { value: scales.edgeStop },
                uAlpha: { value: scales.alpha },
                uColInner: { value: new THREE.Color(scales.colInner) },
                uColOuter: { value: new THREE.Color(scales.colOuter) }
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vView;
                varying vec3 vSurface;
                void main() {
                    vSurface = normalize(position);
                    vNormal = normalize(normalMatrix * normal);
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    vView = normalize(-mv.xyz);
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uEdgeStop;
                uniform float uAlpha;
                uniform vec3 uColInner;
                uniform vec3 uColOuter;
                varying vec3 vNormal;
                varying vec3 vView;
                varying vec3 vSurface;

                void main() {
                    float facing = abs(dot(normalize(vNormal), normalize(vView)));
                    float edge = smoothstep(0.0, uEdgeStop, facing);
                    edge = pow(edge, 1.65);

                    float angle = atan(vSurface.y, vSurface.x);
                    float streamers = 0.85 + 0.15 * sin(angle * 11.0 + uTime * 0.22 + vSurface.z * 5.0)
                                                  * cos(angle * 7.0 - uTime * 0.17);
                    float prominence = 0.90 + 0.10 * sin(vSurface.x * 16.0 + vSurface.y * 14.0 + uTime * 0.35);

                    vec3 col = mix(uColOuter, uColInner, edge);
                    float alpha = edge * streamers * prominence * uAlpha;
                    gl_FragColor = vec4(col, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.BackSide
        });
    }

    function buildSunGroup(THREE, radius, segments) {
        const seg = segments || 96;
        const group = new THREE.Group();
        const surfaceMat = createSunMaterial(THREE);
        const corona0 = createSolarCoronaMaterial(THREE, 0);
        const corona1 = createSolarCoronaMaterial(THREE, 1);
        const corona2 = createSolarCoronaMaterial(THREE, 2);

        const coreMesh = new THREE.Mesh(new THREE.SphereGeometry(radius, seg, seg), surfaceMat);
        const cMesh0 = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.09, 64, 48), corona0);
        const cMesh1 = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.24, 64, 48), corona1);
        const cMesh2 = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.52, 48, 32), corona2);

        group.add(coreMesh, cMesh0, cMesh1, cMesh2);
        const materials = [surfaceMat, corona0, corona1, corona2];
        group.userData.sunMaterials = materials;
        group.userData.updateSun = function (timeSeconds) {
            for (let i = 0; i < materials.length; i++) {
                materials[i].uniforms.uTime.value = timeSeconds;
            }
        };
        return { group, material: surfaceMat, materials, coreMesh };
    }

    /* ═══════════════════════════════════════════════════════════════════════
       2. BESPOKE PLANET SURFACE SHADER (All 8 Worlds + Moons + Dwarfs)
       ═══════════════════════════════════════════════════════════════════════ */
    function createPlanetSurfaceMaterial(THREE, key, opts) {
        opts = opts || {};
        const cfg = PLANET_CONFIG[key] || PLANET_CONFIG.mercury;
        const blackTex = getBlackTexture(THREE);
        const whiteTex = getWhiteTexture(THREE);

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uMap: { value: opts.map || whiteTex },
                uHasMap: { value: opts.map ? 1.0 : 0.0 },
                uBaseColor: { value: new THREE.Color(opts.baseColor || '#ffffff') },
                uNightMap: { value: opts.nightMap || blackTex },
                uHasNight: { value: opts.nightMap ? 1.0 : 0.0 },
                uCloudMap: { value: opts.cloudMap || blackTex },
                uHasClouds: { value: opts.cloudMap ? 1.0 : 0.0 },
                uSunPos: { value: opts.sunPos ? opts.sunPos.clone() : new THREE.Vector3(0, 0, 0) },
                uSunDir: { value: opts.sunDir ? opts.sunDir.clone().normalize() : new THREE.Vector3(0.8, 0.4, 0.4).normalize() },
                uUsePointLight: { value: opts.usePointLight !== undefined ? (opts.usePointLight ? 1.0 : 0.0) : 1.0 },
                uAmbientStrength: { value: opts.ambientStrength !== undefined ? opts.ambientStrength : 0.032 },
                uPlanetType: { value: cfg.type },
                uPlanetSubType: { value: cfg.subType || 1 },
                uBumpScale: { value: opts.bumpScale !== undefined ? opts.bumpScale : cfg.bump },
                uRoughness: { value: cfg.roughness },
                uAtmoColor: { value: new THREE.Color(cfg.atmoColor) },
                uTwilightColor: { value: new THREE.Color(cfg.twilightColor) },
                uAtmoStrength: { value: cfg.atmoStrength },
                uTint: { value: new THREE.Vector3(cfg.tint[0], cfg.tint[1], cfg.tint[2]) },
                uContrast: { value: cfg.contrast },
                uSaturation: { value: cfg.saturation },
                uTime: { value: 0.0 },
                uHasRingShadow: { value: key === 'saturn' ? 1.0 : 0.0 }
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;
                varying vec3 vWorldTangent;
                varying vec3 vWorldBitangent;
                varying vec3 vObjPos;

                void main() {
                    vUv = uv;
                    vObjPos = normalize(position);

                    vec3 objN = normalize(normal);
                    vec3 objT = length(objN.xz) > 0.0001
                        ? normalize(vec3(-objN.z, 0.0, objN.x))
                        : vec3(1.0, 0.0, 0.0);
                    vec3 objB = normalize(cross(objN, objT));

                    mat3 wMat = mat3(modelMatrix);
                    vWorldNormal = normalize(wMat * objN);
                    vWorldTangent = normalize(wMat * objT);
                    vWorldBitangent = normalize(wMat * objB);

                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPos = worldPosition.xyz;
                    gl_Position = projectionMatrix * viewMatrix * worldPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D uMap;
                uniform float uHasMap;
                uniform vec3 uBaseColor;
                uniform sampler2D uNightMap;
                uniform float uHasNight;
                uniform sampler2D uCloudMap;
                uniform float uHasClouds;
                uniform vec3 uSunPos;
                uniform vec3 uSunDir;
                uniform float uUsePointLight;
                uniform float uAmbientStrength;
                uniform float uPlanetType;
                uniform float uPlanetSubType;
                uniform float uBumpScale;
                uniform float uRoughness;
                uniform vec3 uAtmoColor;
                uniform vec3 uTwilightColor;
                uniform float uAtmoStrength;
                uniform vec3 uTint;
                uniform float uContrast;
                uniform float uSaturation;
                uniform float uTime;
                uniform float uHasRingShadow;

                varying vec2 vUv;
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;
                varying vec3 vWorldTangent;
                varying vec3 vWorldBitangent;
                varying vec3 vObjPos;

                float hash(vec3 p) {
                    p = fract(p * 0.3183099 + 0.1);
                    p *= 17.0;
                    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                }
                float noise3(vec3 p) {
                    vec3 i = floor(p), f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(
                        mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
                            mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
                        mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
                            mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z
                    );
                }
                float fbm3(vec3 p) {
                    float v = 0.0, a = 0.5;
                    for (int i = 0; i < 4; i++) {
                        v += a * noise3(p);
                        p = p * 2.05 + vec3(7.3, 13.1, 5.7);
                        a *= 0.5;
                    }
                    return v;
                }
                float getLuma(vec3 c) {
                    return dot(c, vec3(0.299, 0.587, 0.114));
                }

                void main() {
                    vec3 geoN = normalize(vWorldNormal);
                    vec3 T = normalize(vWorldTangent);
                    vec3 B = normalize(vWorldBitangent);
                    vec3 V = normalize(cameraPosition - vWorldPos);
                    vec3 L = uUsePointLight > 0.5 ? normalize(uSunPos - vWorldPos) : normalize(uSunDir);

                    float lat = vObjPos.y; // -1 at south pole, +1 at north pole
                    float absLat = abs(lat);
                    // Smooth fade near equirectangular poles so pole convergence never creates pinch artifacts
                    float polarSmooth = smoothstep(0.96, 0.68, absLat);

                    // 1. 5-Tap 4K Super-Resolution Unsharp-Mask Sampling (8K-grade close-up clarity, zero UV distortion)
                    vec2 sampleUv = vUv;
                    vec2 sharpStep = vec2(1.0 / 4096.0, 1.0 / 2048.0);
                    vec3 texCol = uBaseColor;
                    if (uHasMap > 0.5) {
                        vec3 c0 = texture2D(uMap, sampleUv).rgb;
                        vec3 cL = texture2D(uMap, sampleUv - vec2(sharpStep.x, 0.0)).rgb;
                        vec3 cR = texture2D(uMap, sampleUv + vec2(sharpStep.x, 0.0)).rgb;
                        vec3 cD = texture2D(uMap, sampleUv - vec2(0.0, sharpStep.y)).rgb;
                        vec3 cU = texture2D(uMap, sampleUv + vec2(0.0, sharpStep.y)).rgb;
                        vec3 neighborAvg = 0.25 * (cL + cR + cD + cU);
                        // Enhance crisp geological & storm detail without ringing
                        texCol = clamp(c0 + (c0 - neighborAvg) * (0.48 * polarSmooth), 0.0, 1.0);
                    }
                    vec3 baseAlbedo = pow(max(texCol, vec3(0.0)), vec3(2.2));

                    // Color grading (contrast, saturation, planetary tint)
                    float baseLuma = getLuma(baseAlbedo);
                    baseAlbedo = mix(vec3(baseLuma), baseAlbedo, uSaturation);
                    baseAlbedo = max(vec3(0.0), (baseAlbedo - vec3(0.16)) * uContrast + vec3(0.16));
                    baseAlbedo *= uTint;

                    // Subtle 3D sub-pixel micro-grain in object space (infinite zoom resolution, zero seam)
                    float microDetail = (fbm3(vObjPos * 64.0) - 0.5) * 0.045;

                    // ── GAS GIANTS (Jupiter = 2.1, Saturn = 2.2) ──
                    if (uPlanetType > 1.5 && uPlanetType < 2.5) {
                        // Preserve 100% of the crisp 4K Juno/Cassini storms while enriching belt-zone depth
                        float beltWave = sin(lat * 42.0);
                        baseAlbedo *= (1.0 + microDetail * 0.5);
                        if (uPlanetSubType > 1.5) {
                            // SATURN: Subtle Cassini North Polar Hexagon jet-stream modulation above 70°N
                            float hexAngle = atan(vObjPos.z, vObjPos.x);
                            float hexR = length(vObjPos.xz) * (1.0 + 0.055 * cos(hexAngle * 6.0 - uTime * 0.06));
                            float hexBand = smoothstep(0.022, 0.0, abs(hexR - 0.36)) * smoothstep(0.68, 0.76, lat);
                            baseAlbedo += vec3(0.14, 0.10, 0.04) * hexBand;
                            baseAlbedo = mix(baseAlbedo, baseAlbedo * vec3(0.82, 0.94, 1.04), smoothstep(0.84, 0.97, absLat) * 0.35);
                        } else {
                            // JUPITER: Rich ammonia crystal sheen on white zones vs deep rust belts
                            float zoneBright = smoothstep(0.22, 0.58, baseLuma);
                            baseAlbedo *= mix(vec3(0.95, 0.88, 0.82), vec3(1.06, 1.04, 1.00), zoneBright);
                        }
                    }

                    // ── ICE GIANTS (Uranus = 3.1, Neptune = 3.2) ──
                    if (uPlanetType > 2.5 && uPlanetType < 3.5) {
                        float turb = fbm3(vObjPos * 12.0 + vec3(uTime * 0.02, 0.0, 0.0));
                        if (uPlanetSubType < 1.5) {
                            // URANUS: Transform featureless cyan texture into smooth JWST/Keck methane bands & polar collar
                            vec3 uranusDeep = vec3(0.10, 0.46, 0.62);
                            vec3 uranusBright = vec3(0.40, 0.84, 0.95);
                            vec3 uranusPolar = vec3(0.68, 0.94, 0.99);
                            float bandMix = 0.5 + 0.5 * sin(lat * 18.0 + turb * 0.75);
                            vec3 sculptedUranus = mix(uranusDeep, uranusBright, bandMix);
                            float polarHood = smoothstep(0.48, 0.84, absLat);
                            sculptedUranus = mix(sculptedUranus, uranusPolar, polarHood * 0.55);
                            // High-altitude bright methane-ice cloud wisps
                            float wisp = smoothstep(0.68, 0.82, fbm3(vec3(vObjPos.x * 14.0 - uTime * 0.015, lat * 28.0, vObjPos.z * 14.0)))
                                       * (1.0 - polarHood * 0.65);
                            sculptedUranus += vec3(0.45, 0.85, 0.95) * wisp * 0.45;
                            baseAlbedo = mix(baseAlbedo, sculptedUranus, 0.58);
                        } else {
                            // NEPTUNE: Enhance 4K Voyager map with deep cobalt methane scattering & crisp cirrus highlights
                            float zBand = 0.94 + 0.06 * sin(lat * 26.0 + turb * 0.9);
                            baseAlbedo *= zBand;
                            float brightCirrus = smoothstep(0.32, 0.65, baseLuma);
                            baseAlbedo = mix(baseAlbedo, vec3(0.85, 0.94, 1.0), brightCirrus * 0.35);
                        }
                    }

                    // ── ROCKY PLANETS (Mercury = 4.1, Mars = 4.2, Moon/Dwarfs = 4.3) ──
                    if (uPlanetType > 3.5 && uPlanetType < 4.5) {
                        // Add subtle 8K sub-pixel geological mineral grain without overriding 4K NASA photography
                        baseAlbedo *= (1.0 + microDetail * 0.85);
                        if (uPlanetSubType > 1.5 && uPlanetSubType < 2.5) {
                            // MARS: Enhance natural ferric-oxide ochre highlands vs dark basaltic Syrtis Major
                            vec3 rustHighland = baseAlbedo * vec3(1.08, 0.94, 0.86);
                            vec3 darkBasalt = baseAlbedo * vec3(0.86, 0.84, 0.88);
                            baseAlbedo = mix(darkBasalt, rustHighland, smoothstep(0.08, 0.30, baseLuma));
                        }
                    }

                    // 2. Smooth 4-Tap Symmetric Central-Difference Normal Mapping (Zero JPEG Block / Crunch Artifacts)
                    vec2 bumpStep = vec2(1.2 / 2048.0, 1.2 / 1024.0);
                    float hL = uHasMap > 0.5 ? getLuma(texture2D(uMap, sampleUv - vec2(bumpStep.x, 0.0)).rgb) : baseLuma;
                    float hR = uHasMap > 0.5 ? getLuma(texture2D(uMap, sampleUv + vec2(bumpStep.x, 0.0)).rgb) : baseLuma;
                    float hD = uHasMap > 0.5 ? getLuma(texture2D(uMap, sampleUv - vec2(0.0, bumpStep.y)).rgb) : baseLuma;
                    float hU = uHasMap > 0.5 ? getLuma(texture2D(uMap, sampleUv + vec2(0.0, bumpStep.y)).rgb) : baseLuma;

                    // Slope-adaptive micro-relief: flat plains stay silky smooth, while canyon walls, craters & ridges get 8K detail
                    float macroSlope = clamp(length(vec2(hR - hL, hU - hD)) * 12.0, 0.0, 1.0);
                    float subTexelDetail = (fbm3(vObjPos * 85.0) - 0.5) * 0.05 * macroSlope * polarSmooth;
                    baseAlbedo *= (1.0 + subTexelDetail);

                    // Detect Earth liquid ocean vs continents/ice
                    float oceanMask = 0.0;
                    if (uPlanetType > 0.5 && uPlanetType < 1.5) {
                        float blueDominance = clamp((texCol.b - max(texCol.r, texCol.g * 0.92)) * 5.5, 0.0, 1.0);
                        float notCloudOrIce = 1.0 - smoothstep(0.45, 0.72, getLuma(texCol));
                        oceanMask = blueDominance * notCloudOrIce;
                        vec3 deepOcean = baseAlbedo * vec3(0.74, 0.94, 1.26) + vec3(0.004, 0.020, 0.060);
                        vec3 richLand = baseAlbedo * vec3(1.06, 1.10, 0.94) * (1.0 + microDetail * 0.5 * macroSlope);
                        baseAlbedo = mix(richLand, deepOcean, oceanMask);
                    }

                    // Physically plausible normal slope (crisp 3D canyon/crater/mountain shadows with zero pixel noise)
                    float localBump = uBumpScale * (1.0 - oceanMask * 0.94) * polarSmooth;
                    float dU = (hR - hL) * 0.5 * localBump * 2.6;
                    float dV = (hU - hD) * 0.5 * localBump * 2.6;
                    vec3 N = normalize(geoN - dU * T - dV * B);

                    // 3. Physically-Based Planetary Photometry (Lommel-Seeliger / Oren-Nayar / Minnaert)
                    float rawNdotL = dot(geoN, L);
                    float NdotL = dot(N, L);
                    float NdotV = max(dot(geoN, V), 0.001);
                    float mu0 = max(rawNdotL, 0.0);
                    float termMask = smoothstep(-0.10, 0.08, rawNdotL);

                    float dayFactor = termMask * max(NdotL + 0.04, 0.0) / 1.04;

                    if (uPlanetType > 3.5 && uPlanetType < 4.5) {
                        // Rocky Worlds (Mars, Mercury, Moon): Lommel-Seeliger + Oren-Nayar dusty regolith photometry
                        // Prevents muddy midtones and gives crisp crater/canyon relief near the terminator
                        float lommel = mu0 / (mu0 + pow(NdotV, 0.75) * 0.55 + 0.001);
                        float reliefShade = clamp(1.0 + (NdotL - rawNdotL) * 1.85, 0.35, 1.55);
                        dayFactor = termMask * mix(pow(mu0, 0.82), lommel * 1.25, 0.42) * reliefShade;
                    } else if (uPlanetType > 1.5 && uPlanetType < 3.5) {
                        // Gas & Ice Giants: Minnaert anisotropic cloud scattering + silky limb darkening
                        float gasTerm = smoothstep(-0.16, 0.16, rawNdotL);
                        float minnaert = pow(max(rawNdotL + 0.14, 0.0) / 1.14, 0.76) * pow(NdotV, 0.28);
                        float bandRelief = clamp(1.0 + (NdotL - rawNdotL) * 1.35, 0.65, 1.35);
                        dayFactor = gasTerm * minnaert * bandRelief * 1.12;
                    }

                    // Saturn ring shadow cast onto Saturn's equatorial globe
                    float ringGlobeShadow = 1.0;
                    if (uHasRingShadow > 0.5 && abs(L.y) > 0.02) {
                        float tPlane = -vObjPos.y / L.y;
                        if (tPlane > 0.0) {
                            vec3 hit = vObjPos + L * tPlane;
                            float rHit = length(hit.xz);
                            if (rHit > 1.24 && rHit < 2.28) {
                                float normRing = (rHit - 1.24) / (2.28 - 1.24);
                                float cassini = exp(-pow((normRing - 0.595) / 0.025, 2.0));
                                ringGlobeShadow = mix(0.44, 0.92, cassini);
                            }
                        }
                    }

                    // Cloud shadow cast onto Earth's surface
                    float cloudShadow = 1.0;
                    if (uHasClouds > 0.5 && uPlanetType < 1.5) {
                        vec2 shadowOffset = vec2(dot(L, T), dot(L, B)) * 0.0042;
                        float cSample = getLuma(texture2D(uCloudMap, vUv - shadowOffset).rgb);
                        float cCover = smoothstep(0.18, 0.74, cSample);
                        cloudShadow = 1.0 - cCover * 0.46 * smoothstep(-0.05, 0.25, rawNdotL);
                    }

                    // Rayleigh twilight scattering along the sunset/sunrise terminator band
                    float twilightBand = exp(-pow((rawNdotL - 0.02) / 0.16, 2.0)) * smoothstep(-0.22, 0.06, rawNdotL);
                    vec3 sunColor = mix(vec3(1.0, 0.98, 0.95), uTwilightColor * 1.40, twilightBand * clamp(uAtmoStrength * 1.1, 0.0, 0.85));

                    vec3 diffuse = baseAlbedo * sunColor * dayFactor * cloudShadow * ringGlobeShadow * 1.56;

                    // 4. Specular Reflections (Earth Ocean Sunglint, Polar Ice & High-Altitude Crystal Sheen)
                    vec3 H = normalize(L + V);
                    float NdotH = max(dot(N, H), 0.0);
                    vec3 specular = vec3(0.0);
                    if (oceanMask > 0.01) {
                        float specTight = pow(NdotH, 76.0) * 0.95;
                        float specBroad = pow(NdotH, 18.0) * 0.26;
                        vec3 glintCol = mix(vec3(1.0, 0.96, 0.88), vec3(1.0, 0.62, 0.30), twilightBand);
                        specular = glintCol * (specTight + specBroad) * oceanMask * smoothstep(-0.02, 0.15, rawNdotL) * cloudShadow;
                    } else if (uPlanetType > 3.5 && uPlanetType < 4.5) {
                        // Subtle mineral & natural polar ice specular highlight
                        float naturalIce = smoothstep(0.45, 0.75, baseLuma) * smoothstep(0.78, 0.92, absLat);
                        specular = vec3(0.96, 0.97, 1.0) * pow(NdotH, 28.0) * (0.04 + naturalIce * 0.28) * dayFactor;
                    } else if (uPlanetType > 1.5 && uPlanetType < 3.5) {
                        // Subtle ammonia/methane crystal forward-scatter sheen
                        specular = mix(vec3(1.0, 0.96, 0.90), uAtmoColor, 0.5) * pow(NdotH, 20.0) * 0.09 * dayFactor;
                    }

                    // 5. Optical-Depth Aerial Perspective & Horizon Rayleigh/Mie In-Scattering
                    float horizonFactor = 1.0 - NdotV;
                    float opticalDepth = pow(horizonFactor, 2.8);
                    float sunAwareRim = smoothstep(-0.35, 0.45, rawNdotL) * 0.88 + 0.12;
                    vec3 rimScatterColor = mix(uAtmoColor, uTwilightColor, twilightBand * 0.68);
                    // Blend surface smoothly into atmospheric haze near the grazing horizon limb
                    diffuse = mix(diffuse, rimScatterColor * sunAwareRim * 0.95, clamp(opticalDepth * uAtmoStrength * 0.52, 0.0, 0.62));
                    vec3 atmosphereRim = rimScatterColor * pow(horizonFactor, 3.6) * uAtmoStrength * sunAwareRim * 0.78;

                    // 6. Night-Side Illumination, Earth Megacities & Venus Volcanic Rifts
                    vec3 nightAmbient = baseAlbedo * uAmbientStrength + uAtmoColor * pow(horizonFactor, 4.2) * 0.04;
                    float nightMask = 1.0 - smoothstep(-0.18, 0.06, rawNdotL);

                    vec3 nightEmission = vec3(0.0);
                    if (uHasNight > 0.5) {
                        vec3 rawNight = texture2D(uNightMap, vUv).rgb;
                        vec3 cleanNight = max(vec3(0.0), rawNight - vec3(0.068, 0.078, 0.132));
                        float cityIntensity = pow(getLuma(cleanNight) * 2.5, 1.32);
                        float microSparkle = 0.85 + 0.30 * noise3(vObjPos * 240.0);
                        vec3 warmSodium = mix(vec3(1.0, 0.65, 0.24), vec3(1.0, 0.94, 0.78), clamp(cityIntensity, 0.0, 1.0));
                        float cloudDim = 1.0;
                        if (uHasClouds > 0.5) {
                            float cVal = smoothstep(0.15, 0.75, getLuma(texture2D(uCloudMap, vUv).rgb));
                            cloudDim = 1.0 - cVal * 0.65;
                        }
                        nightEmission += warmSodium * cityIntensity * microSparkle * nightMask * cloudDim * 2.8;
                    }
                    // Venus night-side thermal lava/rift glow peeking through deep cloud deck
                    if (uPlanetType > 4.5) {
                        float rift = smoothstep(0.68, 0.78, fbm3(vObjPos * 16.0)) * smoothstep(0.55, 0.75, noise3(vObjPos * 48.0));
                        nightEmission += vec3(1.0, 0.26, 0.04) * rift * nightMask * 0.75;
                    }

                    vec3 finalLinear = diffuse + specular + atmosphereRim + nightAmbient + nightEmission;

                    gl_FragColor = vec4(max(finalLinear, vec3(0.0)), 1.0);
                    #include <tonemapping_fragment>
                    gl_FragColor.rgb = pow(max(gl_FragColor.rgb, vec3(0.0)), vec3(1.0 / 2.2));
                }
            `
        });
        return mat;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       3. VOLUMETRIC CLOUD DECK SHADER (Earth Cumulus/Cyclones & Venus Chevrons)
       ═══════════════════════════════════════════════════════════════════════ */
    function createCloudMaterial(THREE, key, cloudTexture, opts) {
        opts = opts || {};
        const isVenus = key === 'venus';
        return new THREE.ShaderMaterial({
            uniforms: {
                uCloudMap: { value: cloudTexture || getBlackTexture(THREE) },
                uSunPos: { value: opts.sunPos ? opts.sunPos.clone() : new THREE.Vector3(0, 0, 0) },
                uSunDir: { value: opts.sunDir ? opts.sunDir.clone().normalize() : new THREE.Vector3(0.8, 0.4, 0.4).normalize() },
                uUsePointLight: { value: opts.usePointLight !== undefined ? (opts.usePointLight ? 1.0 : 0.0) : 1.0 },
                uIsVenus: { value: isVenus ? 1.0 : 0.0 },
                uOpacity: { value: isVenus ? 0.38 : 0.84 },
                uTime: { value: 0.0 }
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;
                varying vec3 vWorldTangent;
                varying vec3 vWorldBitangent;
                varying vec3 vObjPos;

                void main() {
                    vUv = uv;
                    vObjPos = normalize(position);
                    vec3 objN = normalize(normal);
                    vec3 objT = length(objN.xz) > 0.0001
                        ? normalize(vec3(-objN.z, 0.0, objN.x))
                        : vec3(1.0, 0.0, 0.0);
                    vec3 objB = normalize(cross(objN, objT));

                    mat3 wMat = mat3(modelMatrix);
                    vWorldNormal = normalize(wMat * objN);
                    vWorldTangent = normalize(wMat * objT);
                    vWorldBitangent = normalize(wMat * objB);

                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPos = worldPosition.xyz;
                    gl_Position = projectionMatrix * viewMatrix * worldPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D uCloudMap;
                uniform vec3 uSunPos;
                uniform vec3 uSunDir;
                uniform float uUsePointLight;
                uniform float uIsVenus;
                uniform float uOpacity;
                uniform float uTime;

                varying vec2 vUv;
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;
                varying vec3 vWorldTangent;
                varying vec3 vWorldBitangent;
                varying vec3 vObjPos;

                float hash(vec3 p) {
                    p = fract(p * 0.3183099 + 0.1);
                    p *= 17.0;
                    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                }
                float noise3(vec3 p) {
                    vec3 i = floor(p), f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(
                        mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
                            mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
                        mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
                            mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z
                    );
                }
                float fbmCloud(vec3 p) {
                    float v = 0.0, a = 0.5;
                    for (int i = 0; i < 4; i++) {
                        v += a * noise3(p);
                        p = p * 2.05 + vec3(5.2, 9.7, 3.4);
                        a *= 0.5;
                    }
                    return v;
                }
                float getLuma(vec3 c) {
                    return dot(c, vec3(0.299, 0.587, 0.114));
                }

                void main() {
                    vec3 geoN = normalize(vWorldNormal);
                    vec3 T = normalize(vWorldTangent);
                    vec3 B = normalize(vWorldBitangent);
                    vec3 V = normalize(cameraPosition - vWorldPos);
                    vec3 L = uUsePointLight > 0.5 ? normalize(uSunPos - vWorldPos) : normalize(uSunDir);

                    vec2 uv = vUv;
                    if (uIsVenus > 0.5) {
                        // Subtle Akatsuki Rossby wave drift on Venus
                        float eqDist = abs(uv.y - 0.5) * 2.0;
                        uv.x = fract(uv.x - eqDist * eqDist * 0.08 + sin(uv.y * 18.0 + uTime * 0.04) * 0.004);
                    }

                    vec3 tex = texture2D(uCloudMap, uv).rgb;
                    // Add 3D procedural cumulus filament super-resolution so 1K cloud maps look crisp at 4K zoom
                    float wisp = fbmCloud(vObjPos * 46.0 + vec3(uTime * 0.008, 0.0, 0.0));
                    float polarSmooth = smoothstep(0.95, 0.70, abs(vObjPos.y));
                    float luma = clamp(getLuma(tex) + (wisp - 0.48) * 0.14 * getLuma(tex), 0.0, 1.0);

                    vec2 eps = vec2(1.5 / 1024.0, 1.5 / 512.0);
                    float lL = getLuma(texture2D(uCloudMap, uv - vec2(eps.x, 0.0)).rgb);
                    float lR = getLuma(texture2D(uCloudMap, uv + vec2(eps.x, 0.0)).rgb);
                    float lD = getLuma(texture2D(uCloudMap, uv - vec2(0.0, eps.y)).rgb);
                    float lU = getLuma(texture2D(uCloudMap, uv + vec2(0.0, eps.y)).rgb);
                    vec3 cloudN = normalize(geoN - (lR - lL) * 1.4 * polarSmooth * T - (lU - lD) * 1.4 * polarSmooth * B);

                    float rawNdotL = dot(geoN, L);
                    float cloudNdotL = dot(cloudN, L);

                    // Silver-lining Henyey-Greenstein cloud scattering
                    float day = smoothstep(-0.16, 0.18, rawNdotL) * (0.46 + 0.54 * max(cloudNdotL, 0.0));
                    float twilight = exp(-pow((rawNdotL - 0.01) / 0.16, 2.0)) * smoothstep(-0.22, 0.05, rawNdotL);

                    vec3 dayCol = vec3(0.98, 0.99, 1.0);
                    if (uIsVenus > 0.5) {
                        vec3 venusDark = vec3(0.82, 0.58, 0.32);
                        vec3 venusBright = vec3(1.04, 0.94, 0.74);
                        dayCol = mix(venusDark, venusBright, clamp(luma * 1.1, 0.0, 1.0));
                    }
                    vec3 sunsetCol = uIsVenus > 0.5 ? vec3(1.0, 0.62, 0.22) : vec3(1.0, 0.52, 0.28);
                    vec3 nightCol = uIsVenus > 0.5 ? dayCol * 0.025 : vec3(0.015, 0.03, 0.06);

                    vec3 col = mix(nightCol, dayCol, day);
                    col = mix(col, sunsetCol, twilight * 0.55);

                    float rim = pow(1.0 - max(dot(geoN, V), 0.0), 3.2);
                    col += dayCol * rim * smoothstep(-0.1, 0.4, rawNdotL) * 0.24;

                    float alpha = uIsVenus > 0.5
                        ? uOpacity * (0.65 + 0.35 * luma)
                        : smoothstep(0.14, 0.72, luma) * uOpacity;

                    gl_FragColor = vec4(col, alpha);
                    #include <tonemapping_fragment>
                }
            `,
            transparent: true,
            depthWrite: false
        });
    }

    /* ═══════════════════════════════════════════════════════════════════════
       4. SUN-AWARE VOLUMETRIC ATMOSPHERE HALO SHADER
       ═══════════════════════════════════════════════════════════════════════ */
    function createAtmosphereMaterial(THREE, key, opts) {
        opts = opts || {};
        const cfg = PLANET_CONFIG[key] || PLANET_CONFIG.earth;
        const strength = opts.intensity !== undefined ? opts.intensity : cfg.atmoStrength;

        return new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(opts.color || cfg.atmoColor) },
                uTwilightColor: { value: new THREE.Color(cfg.twilightColor) },
                uIntensity: { value: strength },
                uSunPos: { value: opts.sunPos ? opts.sunPos.clone() : new THREE.Vector3(0, 0, 0) },
                uSunDir: { value: opts.sunDir ? opts.sunDir.clone().normalize() : new THREE.Vector3(0.8, 0.4, 0.4).normalize() },
                uUsePointLight: { value: opts.usePointLight !== undefined ? (opts.usePointLight ? 1.0 : 0.0) : 1.0 }
            },
            vertexShader: `
                varying vec3 vViewNormal;
                varying vec3 vViewDir;
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;

                void main() {
                    vViewNormal = normalize(normalMatrix * normal);
                    vWorldNormal = normalize(mat3(modelMatrix) * normal);
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPos = worldPosition.xyz;
                    vec4 mv = viewMatrix * worldPosition;
                    vViewDir = normalize(-mv.xyz);
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                uniform vec3 uTwilightColor;
                uniform float uIntensity;
                uniform vec3 uSunPos;
                uniform vec3 uSunDir;
                uniform float uUsePointLight;

                varying vec3 vViewNormal;
                varying vec3 vViewDir;
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;

                void main() {
                    // Exponential atmospheric scale-height density falloff at the planet limb
                    float d = abs(dot(normalize(vViewNormal), normalize(vViewDir)));
                    float innerFade = smoothstep(0.0, 0.36, d);
                    float outerFade = pow(clamp(1.0 - (d - 0.18) / 0.82, 0.0, 1.0), 2.4);
                    float glow = innerFade * outerFade * 1.35;

                    vec3 N = normalize(vWorldNormal);
                    vec3 L = uUsePointLight > 0.5 ? normalize(uSunPos - vWorldPos) : normalize(uSunDir);
                    float NdotL = dot(N, L);

                    float sunPhase = smoothstep(-0.38, 0.40, NdotL) * 0.88 + 0.12;
                    float twilight = exp(-pow((NdotL + 0.04) / 0.22, 2.0)) * smoothstep(-0.38, 0.22, NdotL);

                    vec3 col = mix(uColor, uTwilightColor, twilight * 0.62);
                    gl_FragColor = vec4(col, clamp(glow * sunPhase * uIntensity, 0.0, 0.92));
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.BackSide
        });
    }

    /* ═══════════════════════════════════════════════════════════════════════
       5. 3D POLAR AURORA CURTAIN SHADER (Subtle Limb-Grazing Horizon Veil)
       ═══════════════════════════════════════════════════════════════════════ */
    function createAuroraMesh(THREE, key, radius) {
        if (key !== 'earth' && key !== 'jupiter' && key !== 'saturn') return null;
        const isJupiter = key === 'jupiter';
        const isSaturn = key === 'saturn';
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColPrimary: { value: new THREE.Color(isJupiter ? '#3a88ff' : (isSaturn ? '#9452ff' : '#26ff92')) },
                uColSecondary: { value: new THREE.Color(isJupiter ? '#6a52ff' : (isSaturn ? '#38c8ff' : '#9842ff')) }
            },
            vertexShader: `
                varying vec3 vObjPos;
                varying vec3 vViewNormal;
                varying vec3 vViewDir;
                void main() {
                    vObjPos = normalize(position);
                    vViewNormal = normalize(normalMatrix * normal);
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    vViewDir = normalize(-mv.xyz);
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uColPrimary;
                uniform vec3 uColSecondary;
                varying vec3 vObjPos;
                varying vec3 vViewNormal;
                varying vec3 vViewDir;

                void main() {
                    float absY = abs(vObjPos.y);
                    // Tight auroral oval near magnetic poles, visible only at grazing horizon angles
                    float oval = exp(-pow((absY - 0.935) / 0.026, 2.0));
                    if (oval < 0.01) discard;

                    float facing = abs(dot(normalize(vViewNormal), normalize(vViewDir)));
                    float limbOnly = pow(1.0 - facing, 2.4);

                    float ang = atan(vObjPos.z, vObjPos.x);
                    float wave = 0.6 + 0.4 * sin(ang * 5.0 + uTime * 0.45 + sin(ang * 3.0 - uTime * 0.25) * 1.5);

                    vec3 col = mix(uColPrimary, uColSecondary, smoothstep(0.92, 0.96, absY));
                    float alpha = oval * limbOnly * wave * 0.26;
                    gl_FragColor = vec4(col, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.018, 64, 48), mat);
        mesh.userData.isAurora = true;
        return mesh;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       6. RAY-TRACED PLANETARY RINGS SHADER (Saturn, Uranus, Neptune)
       ═══════════════════════════════════════════════════════════════════════ */
    function createPlanetaryRingMesh(THREE, key, radius, ringAlphaTex, opts) {
        opts = opts || {};
        const isSaturn = key === 'saturn';
        const isUranus = key === 'uranus';
        const innerR = radius * (isSaturn ? 1.22 : 1.44);
        const outerR = radius * (isSaturn ? 2.34 : 2.04);

        const geo = new THREE.RingGeometry(innerR, outerR, 256, 1);
        const pos = geo.attributes.position;
        const uv = geo.attributes.uv;
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i);
            const normR = (v.length() - innerR) / (outerR - innerR);
            const angle = (Math.atan2(v.y, v.x) + Math.PI) / (Math.PI * 2);
            uv.setXY(i, normR, angle);
        }

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uRingTex: { value: ringAlphaTex || getWhiteTexture(THREE) },
                uHasTex: { value: ringAlphaTex ? 1.0 : 0.0 },
                uPlanetRadius: { value: radius },
                uRingStyle: { value: isSaturn ? 1.0 : (isUranus ? 2.0 : 3.0) },
                uSunPos: { value: opts.sunPos ? opts.sunPos.clone() : new THREE.Vector3(0, 0, 0) },
                uSunDir: { value: opts.sunDir ? opts.sunDir.clone().normalize() : new THREE.Vector3(0.8, 0.4, 0.4).normalize() },
                uUsePointLight: { value: opts.usePointLight !== undefined ? (opts.usePointLight ? 1.0 : 0.0) : 1.0 }
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vWorldPos;
                varying vec3 vPlanetCenter;
                varying float vWorldScale;

                void main() {
                    vUv = uv;
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPos = worldPos.xyz;
                    vPlanetCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                    vWorldScale = length(modelMatrix[0].xyz);
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                }
            `,
            fragmentShader: `
                uniform sampler2D uRingTex;
                uniform float uHasTex;
                uniform float uPlanetRadius;
                uniform float uRingStyle;
                uniform vec3 uSunPos;
                uniform vec3 uSunDir;
                uniform float uUsePointLight;

                varying vec2 vUv;
                varying vec3 vWorldPos;
                varying vec3 vPlanetCenter;
                varying float vWorldScale;

                void main() {
                    float r = clamp(vUv.x, 0.0, 1.0);
                    vec3 col = vec3(0.85, 0.78, 0.65);
                    float alpha = 0.0;

                    if (uRingStyle < 1.5) {
                        vec4 texSample = uHasTex > 0.5 ? texture2D(uRingTex, vec2(r, 0.5)) : vec4(1.0);

                        float fine1 = 0.88 + 0.12 * sin(r * 380.0);
                        float fine2 = 0.93 + 0.07 * sin(r * 980.0 + 1.3);
                        float fine3 = 0.95 + 0.05 * cos(r * 2100.0);
                        float ringlets = fine1 * fine2 * fine3;

                        float cRing = smoothstep(0.01, 0.05, r) * (1.0 - smoothstep(0.20, 0.23, r));
                        float bRing = smoothstep(0.21, 0.25, r) * (1.0 - smoothstep(0.55, 0.58, r));
                        float cassiniGap = 1.0 - 0.92 * exp(-pow((r - 0.595) / 0.022, 4.0));
                        float aRing = smoothstep(0.61, 0.635, r) * (1.0 - smoothstep(0.89, 0.92, r));
                        float enckeGap = 1.0 - 0.85 * exp(-pow((r - 0.825) / 0.008, 2.0));
                        float fRing = exp(-pow((r - 0.955) / 0.007, 2.0)) * 0.62;

                        vec3 colC = vec3(0.52, 0.50, 0.48);
                        vec3 colB = mix(vec3(0.86, 0.74, 0.54), vec3(0.98, 0.90, 0.74), smoothstep(0.22, 0.52, r));
                        vec3 colA = vec3(0.84, 0.79, 0.70);
                        vec3 colF = vec3(0.92, 0.88, 0.80);

                        col = colC * cRing + colB * bRing + colA * aRing + colF * fRing;
                        if (uHasTex > 0.5) {
                            col = mix(col, texSample.rgb * vec3(1.08, 1.01, 0.88), 0.55);
                        }
                        col *= ringlets;

                        float zoneDensity = cRing * 0.30 + bRing * 0.95 + aRing * 0.72 + fRing;
                        alpha = zoneDensity * cassiniGap * enckeGap * ringlets;
                        if (uHasTex > 0.5) {
                            float texLuma = dot(texSample.rgb, vec3(0.299, 0.587, 0.114));
                            alpha = mix(alpha, texSample.a * clamp(texLuma * 1.4, 0.15, 1.0), 0.45) * cassiniGap * enckeGap;
                        }
                        alpha *= smoothstep(0.0, 0.02, r) * (1.0 - smoothstep(0.97, 1.0, r));
                    } else if (uRingStyle < 2.5) {
                        // URANUS 13-RING SYSTEM (JWST-inspired glowing icy ringlets)
                        col = mix(vec3(0.58, 0.86, 0.96), vec3(0.88, 0.98, 1.0), r);
                        float epsRing = exp(-pow((r - 0.86) / 0.018, 2.0)) * 0.68;
                        float deltaRing = exp(-pow((r - 0.68) / 0.011, 2.0)) * 0.45;
                        float gammaRing = exp(-pow((r - 0.55) / 0.009, 2.0)) * 0.40;
                        float alphaBeta = exp(-pow((r - 0.36) / 0.015, 2.0)) * 0.35;
                        float inner654 = exp(-pow((r - 0.18) / 0.024, 2.0)) * 0.28;
                        float dustSheet = smoothstep(0.06, 0.25, r) * (1.0 - smoothstep(0.85, 0.96, r)) * 0.08 * (0.8 + 0.2 * sin(r * 240.0));
                        alpha = epsRing + deltaRing + gammaRing + alphaBeta + inner654 + dustSheet;
                    } else {
                        // NEPTUNE 5-RING SYSTEM (Adams arcs, Le Verrier, Lassell, Arago, Galle)
                        col = vec3(0.52, 0.76, 1.0);
                        float arcBoost = 0.75 + 0.25 * sin(vUv.y * 6.28318 * 3.0);
                        float adams = exp(-pow((r - 0.84) / 0.016, 2.0)) * 0.48 * arcBoost;
                        float arago = exp(-pow((r - 0.66) / 0.012, 2.0)) * 0.22;
                        float leVerrier = exp(-pow((r - 0.48) / 0.018, 2.0)) * 0.36;
                        float galle = exp(-pow((r - 0.18) / 0.045, 2.0)) * 0.18;
                        float lassell = smoothstep(0.48, 0.52, r) * (1.0 - smoothstep(0.64, 0.68, r)) * 0.08;
                        alpha = adams + arago + leVerrier + galle + lassell;
                    }

                    vec3 L = uUsePointLight > 0.5 ? normalize(uSunPos - vWorldPos) : normalize(uSunDir);
                    vec3 P = vWorldPos - vPlanetCenter;
                    float worldR = uPlanetRadius * max(vWorldScale, 0.0001);
                    float proj = dot(P, L);
                    float distToAxis = length(P - L * proj);
                    float shadow = 1.0;
                    if (proj < 0.0) {
                        shadow = smoothstep(worldR * 0.93, worldR * 1.03, distToAxis);
                    }

                    vec3 V = normalize(cameraPosition - vWorldPos);
                    float phase = abs(dot(V, L));
                    float iceSparkle = 0.88 + 0.24 * pow(phase, 3.0);

                    vec3 litRing = col * iceSparkle * mix(0.08, 1.14, shadow);
                    gl_FragColor = vec4(litRing, clamp(alpha * 0.96, 0.0, 0.96));
                    #include <tonemapping_fragment>
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = Math.PI / 2;
        return mesh;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       7. ANIMATED COMET-WAKE ORBITAL PATH SHADER
       ═══════════════════════════════════════════════════════════════════════ */
    function createOrbitRing(THREE, distance, colorHex, opts) {
        opts = opts || {};
        const halfWidth = Math.max(0.42, distance * 0.0046);
        const innerR = distance - halfWidth;
        const outerR = distance + halfWidth;
        const geo = new THREE.RingGeometry(innerR, outerR, 256, 1);

        const baseCol = new THREE.Color(colorHex || '#7aa8ff');
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: baseCol },
                uBaseColor: { value: baseCol.clone() },
                uInnerR: { value: innerR },
                uOuterR: { value: outerR },
                uPlanetAngle: { value: 0.0 },
                uOpacity: { value: opts.opacity !== undefined ? opts.opacity : 0.34 },
                uSelected: { value: 0.0 }
            },
            vertexShader: `
                varying vec2 vRingPos;
                void main() {
                    vRingPos = position.xy;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                uniform float uInnerR;
                uniform float uOuterR;
                uniform float uPlanetAngle;
                uniform float uOpacity;
                uniform float uSelected;
                varying vec2 vRingPos;

                void main() {
                    float r = length(vRingPos);
                    float normR = clamp((r - uInnerR) / max(0.0001, uOuterR - uInnerR), 0.0, 1.0);
                    // Smooth anti-aliased cross-section across the ring ribbon
                    float across = 1.0 - abs(normR * 2.0 - 1.0);
                    float core = smoothstep(0.0, 0.88, across);

                    // Seam-free per-fragment orbital angle matching pivot.rotation.y
                    float angle = atan(-vRingPos.y, vRingPos.x);
                    float diff = mod(uPlanetAngle - angle, 6.2831853);
                    // Luminous comet-tail wake trailing behind the planet along its orbit
                    float wake = exp(-diff * 1.25);
                    float headGlow = exp(-diff * 14.0) * 0.72;

                    vec3 col = mix(uColor * 0.78, mix(uColor, vec3(1.0, 0.97, 0.90), 0.48), clamp(wake + headGlow, 0.0, 1.0));
                    float alpha = core * (uOpacity * 0.36 + uOpacity * 1.25 * wake + headGlow * 0.48 + uSelected * 0.40);
                    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.92));
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = Math.PI / 2;
        return mesh;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       8. PIN-SHARP DEEP-SPACE STARFIELD (Space-Accurate: No Giant Twinkle/Bloom)
       ═══════════════════════════════════════════════════════════════════════ */
    function createStarfield(THREE, count, spread) {
        const n = count || 18000;
        const span = spread || 4200;
        const pos = new Float32Array(n * 3);
        const col = new Float32Array(n * 3);
        const size = new Float32Array(n);
        const phase = new Float32Array(n);

        // Harvard spectral colors kept strictly below bloom threshold (<= 0.76) so
        // UnrealBloomPass NEVER explodes background stars into giant flashing blobs!
        const palette = [
            [0.52, 0.64, 0.82, 0.10], // O/B crisp blue-white
            [0.66, 0.72, 0.82, 0.28], // A blue-white
            [0.76, 0.76, 0.75, 0.34], // F/G pure white
            [0.76, 0.70, 0.58, 0.15], // G warm cream
            [0.76, 0.60, 0.44, 0.08], // K soft amber
            [0.74, 0.48, 0.36, 0.05]  // M dusty rose-orange
        ];

        function pickColor() {
            let r = Math.random();
            for (let i = 0; i < palette.length; i++) {
                r -= palette[i][3];
                if (r <= 0) return palette[i];
            }
            return palette[2];
        }

        for (let i = 0; i < n; i++) {
            const rad = span * (0.35 + 0.65 * Math.cbrt(Math.random()));
            const theta = Math.random() * Math.PI * 2;
            const inMilkyWay = Math.random() < 0.36;
            const u = inMilkyWay
                ? (Math.random() + Math.random() + Math.random() - 1.5) * 0.26
                : (Math.random() * 2 - 1);
            const phi = Math.acos(Math.max(-1, Math.min(1, u)));

            const x0 = rad * Math.sin(phi) * Math.cos(theta);
            const y0 = rad * Math.cos(phi);
            const z0 = rad * Math.sin(phi) * Math.sin(theta);
            const tilt = 0.48;
            pos[i * 3]     = x0;
            pos[i * 3 + 1] = y0 * Math.cos(tilt) - z0 * Math.sin(tilt);
            pos[i * 3 + 2] = y0 * Math.sin(tilt) + z0 * Math.cos(tilt);

            const c = pickColor();
            const dim = 0.45 + 0.55 * Math.random();
            col[i * 3]     = c[0] * dim;
            col[i * 3 + 1] = c[1] * dim;
            col[i * 3 + 2] = c[2] * dim;

            // Pin-sharp astronomical point sizes (0.65px to 2.1px max — never huge blobs)
            const mag = Math.pow(Math.random(), 4.5);
            size[i] = 0.65 + mag * 1.45;
            phase[i] = Math.random() * Math.PI * 2;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
        geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) }
            },
            vertexShader: `
                attribute float aSize;
                attribute float aPhase;
                varying vec3 vColor;
                varying float vAlpha;
                uniform float uTime;
                uniform float uPixelRatio;

                void main() {
                    vColor = color;
                    // In outer space there is no atmospheric scintillation; keep stars 96% steady
                    vAlpha = 0.94 + 0.06 * sin(uTime * 0.35 + aPhase);
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = clamp(aSize * uPixelRatio, 0.8, 2.3);
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;

                void main() {
                    vec2 uv = gl_PointCoord - vec2(0.5);
                    float d = length(uv);
                    if (d > 0.5) discard;
                    float point = smoothstep(0.5, 0.05, d);
                    gl_FragColor = vec4(vColor, point * vAlpha);
                }
            `,
            transparent: true,
            vertexColors: true,
            depthWrite: false
        });

        const points = new THREE.Points(geo, mat);
        points.frustumCulled = false;
        return points;
    }

    global.SpaceVerseShaders = {
        PLANET_CONFIG,
        createSunMaterial,
        createSolarCoronaMaterial,
        buildSunGroup,
        createPlanetSurfaceMaterial,
        createCloudMaterial,
        createAtmosphereMaterial,
        createAuroraMesh,
        createPlanetaryRingMesh,
        createOrbitRing,
        createStarfield
    };
})(typeof window !== 'undefined' ? window : globalThis);
