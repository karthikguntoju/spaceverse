// Register GSAP ScrollTrigger
gsap.registerPlugin(ScrollTrigger);

/* ======================================================================
   SPACE SHUTTLE DISCOVERY — Cinematic 3D Launch Engine
   - Loads discovery_space_shuttle.glb (actual 3D model)
   - UnrealBloom post-processing
   - 15,000 particle fire plume (shock diamond + SRB)
   - 6,000 particle volumetric smoke
   - Realistic heat-shimmer / ground exhaust glow
   - Dynamic point light + camera shake
   ====================================================================== */

class LaunchExperience {
    constructor() {
        this.frameCount     = 240;
        this.imageSeq       = { frame: 0 };
        this.progress       = 0;
        this.shuttleLoaded  = false;
        this.clock          = new THREE.Clock();

        // Legacy 2D canvas (nebula bg still rendered there)
        this.nebulaCanvas = document.getElementById('nebula-canvas');
        this.nebCtx       = this.nebulaCanvas.getContext('2d');
        this.shipCanvas   = document.getElementById('ship-canvas');

        // HUD
        this.phaseText = document.getElementById('phase-text');
        this.modeText  = document.getElementById('mode-text');
        this.telVel    = document.getElementById('telemetry-vel');
        this.telAlt    = document.getElementById('telemetry-alt');
        this.telFuel   = document.getElementById('telemetry-fuel');
        this.telThrust = document.getElementById('telemetry-thrust');
        this.timerElem = document.querySelector('.mission-timer');

        // Check if user has already seen the launch in this session
        this.isSkipped = sessionStorage.getItem('hasSeenLaunch') === 'true';

        // Mouse parallax tracking
        this.mouse = { x: 0, y: 0 };
        this.init();
    }

    /* ────────────────────────────────────────────────────────────
       BOOTSTRAP
    ──────────────────────────────────────────────────────────── */
    init() {
        this.setupLenis();
        this.setup3DScene();
        this.loadShuttle();
        this.buildVFX();
        this.setupScrollAnimation();
        this.setupParallax();
        this.startTimer();
        this.animate();

        if (this.isSkipped) {
            // Flicker-free restoration: remove skip class and jump scroll simultaneously
            const engine = document.querySelector('.launch-engine');
            document.body.classList.remove('is-skipping-launch');
            
            // Jump to the exact bottom of the launch engine
            const jumpPos = engine.offsetHeight || (8 * window.innerHeight);
            window.scrollTo(0, jumpPos);
            
            // Ensure ScrollTrigger and particles know we are at the end
            this.progress = 1;
            if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh();
        }

        window.addEventListener('resize', () => this.onResize());
    }

    /* ────────────────────────────────────────────────────────────
       STARFIELD PARALLAX
    ──────────────────────────────────────────────────────────── */
    setupParallax() {
        // Track mouse for parallax; nebulaCanvas stars shift subtly
        window.addEventListener('mousemove', (e) => {
            this.mouse.x = (e.clientX / window.innerWidth  - 0.5) * 2;  // -1..1
            this.mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
        });

        // Inject CSS for the phase text size once
        if (!document.getElementById('launch-polish-css')) {
            const style = document.createElement('style');
            style.id = 'launch-polish-css';
            style.textContent = `
                /* Smaller HUD phase text so it doesn't obscure the shuttle */
                .hud-phase, #phase-text {
                    font-size: clamp(1.2rem, 3vw, 2.2rem) !important;
                    letter-spacing: 0.4em;
                    opacity: 0.85;
                    margin: 0;
                }
                .hud-center {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 0.4rem;
                }
            `;
            document.head.appendChild(style);
        }
    }

    /* ────────────────────────────────────────────────────────────
       LENIS SMOOTH SCROLL
    ──────────────────────────────────────────────────────────── */
    setupLenis() {
        const lenis = new Lenis({ duration: 1.2, smooth: true });
        const raf = t => { lenis.raf(t); requestAnimationFrame(raf); };
        requestAnimationFrame(raf);
    }

    /* ────────────────────────────────────────────────────────────
       THREE.JS SCENE
    ──────────────────────────────────────────────────────────── */
    setup3DScene() {
        const W = window.innerWidth, H = window.innerHeight;

        this.scene  = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(38, W / H, 0.05, 5000);
        // Camera centered — shuttle fills the frame
        this.camera.position.set(0, 0, 18);
        this.camera.lookAt(0, 0, 0);

        /* Renderer */
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(W, H);
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.toneMapping         = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.9;
        this.renderer.outputEncoding      = THREE.sRGBEncoding;
        this.renderer.shadowMap.enabled   = true;
        this.renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
        this.renderer.domElement.style.cssText =
            'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';
        this.shipCanvas.parentElement.appendChild(this.renderer.domElement);

        /* ── Post-processing (Bloom) ── */
        this.composer = new THREE.EffectComposer(this.renderer);
        const renderPass = new THREE.RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        this.bloomPass = new THREE.UnrealBloomPass(
            new THREE.Vector2(W, H),
            /* strength */ 1.4,
            /* radius   */ 0.55,
            /* threshold*/ 0.22
        );
        this.composer.addPass(this.bloomPass);

        /* ── Lights ── */
        this.scene.add(new THREE.AmbientLight(0x283060, 0.55));

        const sunDir = new THREE.DirectionalLight(0xffeedd, 0.9);
        sunDir.position.set(8, 20, 5);
        this.scene.add(sunDir);

        const rimLight = new THREE.DirectionalLight(0x4477cc, 0.45);
        rimLight.position.set(-10, 5, -8);
        this.scene.add(rimLight);

        // Engine fire light (dynamic intensity)
        this.fireLight1 = new THREE.PointLight(0xff6600, 0, 40);
        this.fireLight1.position.set(0, 1, 0);
        this.scene.add(this.fireLight1);

        this.fireLight2 = new THREE.PointLight(0xff3300, 0, 30);
        this.fireLight2.position.set(0, -2, 0);
        this.scene.add(this.fireLight2);

        /* Groups — no ground, no pad */
        this.shuttleGroup = new THREE.Group();
        // Start in lower-center so engine section is at the bottom of the viewport
        this.shuttleGroup.position.set(0, -2, 0);
        this.scene.add(this.shuttleGroup);
    }

    /* ────────────────────────────────────────────────────────────
       LOAD SHUTTLE GLTF MODEL
    ──────────────────────────────────────────────────────────── */
    loadShuttle() {
        const loader = new THREE.GLTFLoader();
        loader.load(
            '/models/discovery_space_shuttle.glb',
            (gltf) => {
                const model = gltf.scene;

                /* Auto-scale and center */
                const box    = new THREE.Box3().setFromObject(model);
                const size   = new THREE.Vector3();
                box.getSize(size);
                const maxDim = Math.max(size.x, size.y, size.z);
                const scale  = 9.0 / maxDim;    // ~50% screen fill — full shuttle visible
                model.scale.setScalar(scale);

                /* Re-center to origin */
                box.setFromObject(model);
                const center = new THREE.Vector3();
                box.getCenter(center);
                model.position.sub(center);
                // Shift model down slightly so engine base sits near screen bottom
                model.position.y -= 2.5;

                /* Rotate to stand vertically — nose pointing UP */
                // Shuttle model is typically oriented along Z or X axis lying flat.
                // Rotate 90° around X so nose points toward +Y (up).
                model.rotation.x = Math.PI / 2;

                /* Improve material quality */
                model.traverse(child => {
                    if (child.isMesh) {
                        child.castShadow    = true;
                        child.receiveShadow = true;
                        if (child.material) {
                            child.material.envMapIntensity = 0.6;
                            if (child.material.isMeshStandardMaterial ||
                                child.material.isMeshPhysicalMaterial) {
                                child.material.roughness = Math.min(child.material.roughness + 0.05, 1);
                            }
                        }
                    }
                });

                this.shuttleGroup.add(model);
                this.shuttleLoaded = true;
                console.log('Space Shuttle Discovery loaded ✓');
            },
            (xhr) => {
                console.log(`Shuttle: ${Math.round(xhr.loaded / xhr.total * 100)}% loaded`);
            },
            (err) => {
                console.error('Failed to load shuttle model:', err);
                this.buildFallbackRocket();
            }
        );
    }

    /* ────────────────────────────────────────────────────────────
       FALLBACK simple rocket if GLTF fails
    ──────────────────────────────────────────────────────────── */
    buildFallbackRocket() {
        const mat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.3, metalness: 0.8 });
        const body  = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 6, 32), mat);
        const nose  = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2, 32), mat);
        nose.position.y = 4;
        const group = new THREE.Group();
        group.add(body); group.add(nose);
        this.shuttleGroup.add(group);
        this.shuttleLoaded = true;
    }

    /* ────────────────────────────────────────────────────────────
       ALL VFX SYSTEMS
    ──────────────────────────────────────────────────────────── */
    buildVFX() {
        this.buildFireParticles();
        this.buildSRBParticles();
        this.buildSmokeParticles();
        this.buildGlowSprites();
        this.buildSteamCloud();
    }

    /* ── Main Engine Fire (SSME × 3 near main nozzle) ── */
    buildFireParticles() {
        const COUNT = 15000;
        this.firePosArr  = new Float32Array(COUNT * 3);
        this.fireVelArr  = new Float32Array(COUNT * 3);
        this.fireLifeArr = new Float32Array(COUNT);
        this.fireSzArr   = new Float32Array(COUNT);
        this.FIRE_N      = COUNT;
        for (let i = 0; i < COUNT; i++) this._resetFire(i, true);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.firePosArr, 3));

        const mat = new THREE.PointsMaterial({
            map: this._makeGradientSprite(64,
                ['rgba(255,255,255,1)', 'rgba(255,200,60,0.9)', 'rgba(255,80,0,0.5)', 'rgba(0,0,0,0)']),
            size: 0.45,
            sizeAttenuation: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            color: 0xffffff,
        });
        this.firePts = new THREE.Points(geo, mat);
        this.firePts.renderOrder = 4;
        this.scene.add(this.firePts);
    }

    _resetFire(i, scatter = false) {
        const ang = Math.random() * Math.PI * 2;
        const r   = Math.random() * 0.20;
        this.firePosArr[i*3]   = Math.cos(ang) * r;
        this.firePosArr[i*3+1] = scatter ? (Math.random() * -8 - 1) : 0;
        this.firePosArr[i*3+2] = Math.sin(ang) * r;
        const spd = 3.5 + Math.random() * 4.5;
        this.fireVelArr[i*3]   = (Math.random() - 0.5) * 0.15;
        this.fireVelArr[i*3+1] = -spd;
        this.fireVelArr[i*3+2] = (Math.random() - 0.5) * 0.15;
        this.fireLifeArr[i]    = scatter ? Math.random() : 0;
        this.fireSzArr[i]      = 0.2 + Math.random() * 0.5;
    }

    /* ── SRB side booster plumes ── */
    buildSRBParticles() {
        const COUNT = 6000;
        this.srbPosArr  = new Float32Array(COUNT * 3);
        this.srbVelArr  = new Float32Array(COUNT * 3);
        this.srbLifeArr = new Float32Array(COUNT);
        this.SRB_N      = COUNT;
        for (let i = 0; i < COUNT; i++) this._resetSRB(i, true);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.srbPosArr, 3));

        const mat = new THREE.PointsMaterial({
            map: this._makeGradientSprite(64,
                ['rgba(255,220,100,1)', 'rgba(255,120,0,0.8)', 'rgba(200,50,0,0.4)', 'rgba(0,0,0,0)']),
            size: 0.55,
            sizeAttenuation: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            color: 0xffaa44,
        });
        this.srbPts = new THREE.Points(geo, mat);
        this.srbPts.renderOrder = 4;
        this.scene.add(this.srbPts);
    }

    _resetSRB(i, scatter = false) {
        // Two SRBs: offset left and right of shuttle
        const side = (i % 2 === 0) ? -1.8 : 1.8;
        const ang  = Math.random() * Math.PI * 2;
        const r    = Math.random() * 0.14;
        this.srbPosArr[i*3]   = side + Math.cos(ang) * r;
        this.srbPosArr[i*3+1] = scatter ? (Math.random() * -8) : 0;
        this.srbPosArr[i*3+2] = Math.sin(ang) * r;
        const spd = 4.5 + Math.random() * 5;
        this.srbVelArr[i*3]   = (Math.random() - 0.5) * 0.3;
        this.srbVelArr[i*3+1] = -spd;
        this.srbVelArr[i*3+2] = (Math.random() - 0.5) * 0.3;
        this.srbLifeArr[i]    = scatter ? Math.random() : 0;
    }

    /* ── Volumetric smoke cloud ── */
    buildSmokeParticles() {
        const COUNT = 8000;
        this.smkPosArr  = new Float32Array(COUNT * 3);
        this.smkVelArr  = new Float32Array(COUNT * 3);
        this.smkLifeArr = new Float32Array(COUNT);
        this.SMK_N      = COUNT;
        for (let i = 0; i < COUNT; i++) this._resetSmoke(i, true);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.smkPosArr, 3));

        const mat = new THREE.PointsMaterial({
            map: this._makeGradientSprite(128,
                ['rgba(200,210,220,0.4)', 'rgba(160,170,180,0.1)', 'rgba(100,110,120,0.02)', 'rgba(0,0,0,0)']),
            size: 5.5,          // Massive, realistic volumetric puffs
            sizeAttenuation: true,
            transparent: true,
            blending: THREE.NormalBlending,
            depthWrite: false,
            color: 0xaabbcc,
            opacity: 0.04,
        });
        this.smkPts = new THREE.Points(geo, mat);
        this.smkPts.renderOrder = 1;
        this.scene.add(this.smkPts);
    }

    _resetSmoke(i, scatter = false) {
        const ang = Math.random() * Math.PI * 2;
        const r   = Math.random() * 1.2;
        this.smkPosArr[i*3]   = Math.cos(ang) * r;
        this.smkPosArr[i*3+1] = scatter ? (Math.random() * -6 - 3) : -4;
        this.smkPosArr[i*3+2] = Math.sin(ang) * r;
        this.smkVelArr[i*3]   = (Math.random() - 0.5) * 1.8;
        this.smkVelArr[i*3+1] = -(0.15 + Math.random() * 0.25);
        this.smkVelArr[i*3+2] = (Math.random() - 0.5) * 1.8;
        this.smkLifeArr[i]    = scatter ? Math.random() : 0;
    }

    /* ── Bloom glow sprites ── */
    buildGlowSprites() {
        const make = (color, sx, sy) => {
            const mat = new THREE.SpriteMaterial({
                map: this._makeGradientSprite(128, [`rgba(${color},1)`, `rgba(${color},0.5)`, `rgba(${color},0.1)`, 'rgba(0,0,0,0)']),
                blending: THREE.AdditiveBlending,
                transparent: true,
                opacity: 0,
                depthWrite: false,
            });
            const sp = new THREE.Sprite(mat);
            sp.scale.set(sx, sy, 1);
            sp.renderOrder = 3;
            this.scene.add(sp);
            return sp;
        };

        this.glowCore    = make('255,255,200', 2.5, 4);
        this.glowOrange  = make('255,120,0',   5, 9);
        this.glowGround  = make('255,80,0',    12, 3);
        this.glowGround.position.y = -5.5;

        // Lens flare sprites (fixed screen positions driven in animate)
        this.flareStar   = make('255,240,200', 0.8, 0.8);
    }

    /* ── Steam / water suppression cloud ── */
    buildSteamCloud() {
        const COUNT = 3000;
        this.stmPosArr  = new Float32Array(COUNT * 3);
        this.stmVelArr  = new Float32Array(COUNT * 3);
        this.stmLifeArr = new Float32Array(COUNT);
        this.STM_N      = COUNT;
        for (let i = 0; i < COUNT; i++) this._resetSteam(i, true);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.stmPosArr, 3));
        const mat = new THREE.PointsMaterial({
            map: this._makeGradientSprite(64, ['rgba(255,255,255,0.8)', 'rgba(220,230,240,0.4)', 'rgba(180,190,200,0.1)', 'rgba(0,0,0,0)']),
            size: 2.0,
            sizeAttenuation: true,
            transparent: true,
            blending: THREE.NormalBlending,
            depthWrite: false,
            color: 0xeef4ff,
            opacity: 0.22,
        });
        this.stmPts = new THREE.Points(geo, mat);
        this.stmPts.renderOrder = 2;
        this.scene.add(this.stmPts);
    }

    _resetSteam(i, scatter = false) {
        const ang = Math.random() * Math.PI * 2;
        const r   = 0.5 + Math.random() * 2.5;
        this.stmPosArr[i*3]   = Math.cos(ang) * r;
        this.stmPosArr[i*3+1] = scatter ? (-3 + Math.random() * 4) : -4.5;
        this.stmPosArr[i*3+2] = Math.sin(ang) * r;
        this.stmVelArr[i*3]   = (Math.random() - 0.5) * 3.0;
        this.stmVelArr[i*3+1] = 0.4 + Math.random() * 0.8;   // rises upward
        this.stmVelArr[i*3+2] = (Math.random() - 0.5) * 3.0;
        this.stmLifeArr[i]    = scatter ? Math.random() : 0;
    }

    /* ── Canvas gradient sprite helper ── */
    _makeGradientSprite(size, stops) {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
        stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        return new THREE.CanvasTexture(c);
    }

    /* ────────────────────────────────────────────────────────────
       SCROLL ANIMATION SETUP
    ──────────────────────────────────────────────────────────── */
    setupScrollAnimation() {
        const tl = gsap.timeline({
            scrollTrigger: {
                trigger: '.launch-engine',
                start: 'top top',
                end: 'bottom bottom',
                scrub: 1.5,
                onUpdate: self => {
                    this.progress = self.progress;
                    this.updateHUD(self.progress);
                    const op = self.progress > 0.95
                        ? Math.max(0, 1 - (self.progress - 0.95) * 20)
                        : 1;
                    gsap.set('.launch-sticky', { opacity: op });
                    gsap.set('.hud-overlay',   { opacity: op });

                    // Once practically done, mark as seen in session
                    if (self.progress > 0.98) {
                        sessionStorage.setItem('hasSeenLaunch', 'true');
                    }
                }
            }
        });
        tl.to(this.imageSeq, { frame: this.frameCount - 1, snap: 'frame', ease: 'none' });
    }

    /* ────────────────────────────────────────────────────────────
       HUD UPDATE
    ──────────────────────────────────────────────────────────── */
    updateHUD(p) {
        if (this.telVel)    this.telVel.innerText  = (Math.pow(p, 2.5) * 28000 / 3600).toFixed(2);
        if (this.telAlt)    this.telAlt.innerText  = (Math.pow(p, 2) * 400).toFixed(1);
        if (this.telFuel)   this.telFuel.innerText = Math.max(20, Math.floor(100 - p * 80));
        if (this.telThrust) this.telThrust.style.width = (p > 0.05 && p < 0.8 ? 100 : (p >= 0.8 ? 10 : 0)) + '%';

        let phase = 'LAUNCH PAD IDLE', mode = 'STANDBY';
        if      (p < 0.05)  { phase = 'LAUNCH PAD IDLE';    mode = 'STANDBY'; }
        else if (p < 0.15)  { phase = 'IGNITION';           mode = 'LAUNCH MODE'; }
        else if (p < 0.30)  { phase = 'ENGINE RAMP';        mode = 'LAUNCH MODE'; }
        else if (p < 0.50)  { phase = 'LIFT OFF';           mode = 'LAUNCH MODE'; }
        else if (p < 0.70)  { phase = 'ATMOSPHERIC ASCENT'; mode = 'ASCENT TRAJECTORY'; }
        else if (p < 0.85)  { phase = 'ORBITAL ENTRY';      mode = 'ORBITAL INSERTION'; }
        else                { phase = 'DEEP SPACE';          mode = 'NAVIGATION MODE'; }

        if (this.phaseText) this.phaseText.innerText = phase;
        if (this.modeText)  this.modeText.innerText  = mode;
    }

    /* ────────────────────────────────────────────────────────────
       MAIN RENDER LOOP
    ──────────────────────────────────────────────────────────── */
    animate() {
        requestAnimationFrame(() => this.animate());
        const dt = Math.min(this.clock.getDelta(), 0.05);
        const p  = this.progress;
        const t  = this.clock.elapsedTime;
        const pxOff = this.mouse.x * 0.12;   // parallax horizontal offset
        const pyOff = this.mouse.y * 0.08;   // parallax vertical offset

        /* ── Thrust level ── */
        let thrust = 0;
        if (p > 0.04 && p < 0.82) {
            thrust = Math.min(1, (p - 0.04) / 0.08);
            if (p > 0.78) thrust = (0.82 - p) / 0.04;
        }

        /* ── Shuttle ascent:
             p=0  → y= 0   (shuttle centered on screen, no fire)
             p=0.1 → y≈1   (engines starting, barely moving)
             p=0.5 → y≈12  (mid-ascent)
             p=1.0 → y≈35  (out of frame above)
        ──────────────────────────────────────────────────────── */
        const ascentEase = Math.pow(Math.max(0, p), 1.8) * 35;
        this.shuttleGroup.position.y = ascentEase;

        /* Camera stays fixed and centered — no vertical drift */
        this.camera.position.y += (pyOff * 0.4 - this.camera.position.y) * 0.03;
        this.camera.lookAt(0, 0, 0);

        /* ── Idle micro-vibration (subtle breathing before ignition) ── */
        if (p < 0.04) {
            // Gentle camera oscillation at rest — feels alive
            this.camera.position.x = Math.sin(t * 0.9) * 0.018 + pxOff * 0.3;
            this.camera.position.z = 18 + Math.sin(t * 0.5) * 0.015;
        }

        /* ── Idle engine pre-glow heartbeat ── */
        if (p < 0.04 && this.glowCore) {
            const pulse = (Math.sin(t * 2.5) * 0.5 + 0.5);  // 0..1 oscillating
            this.glowCore.material.opacity  = pulse * 0.12;
            this.glowOrange.material.opacity = pulse * 0.05;
            this.glowCore.position.y = this.shuttleGroup.position.y - 3.0;
            this.glowOrange.position.y = this.shuttleGroup.position.y - 3.5;
        }

        /* ── Starfield parallax: offset shuttleGroup slightly toward mouse ── */
        if (p < 0.06) {
            // Subtle sway — shuttle gently follows mouse at idle
            this.shuttleGroup.position.x += (pxOff * 0.15 - this.shuttleGroup.position.x) * 0.04;
        } else {
            this.shuttleGroup.position.x += (0 - this.shuttleGroup.position.x) * 0.1;
        }

        /* ── Launch vibration system ──
             Three stacked layers for a realistic rumble:
             1. High-freq random jitter (engine combustion noise)
             2. Low-freq sine sway (structural resonance)
             3. Shuttle body tremor (vibrating on the thrust column)
        ──────────────────────────────────────────────────────── */
        if (p > 0.04 && thrust > 0.05) {
            // Shake envelope: peaks at ignition, sustained during ascent, fades above p=0.7
            const shakeEnv = thrust * Math.max(0, 1 - Math.max(0, p - 0.65) / 0.35);

            // Layer 1: high-frequency random jitter (combustion)
            const hfAmp = shakeEnv * 0.22;
            const camJitterX = (Math.random() - 0.5) * hfAmp;
            const camJitterZ = (Math.random() - 0.5) * hfAmp * 0.4;

            // Layer 2: low-frequency structural sway (14 Hz sawtooth approximated by fast sine)
            const lfAmp = shakeEnv * 0.10;
            const camSwayX = Math.sin(t * 88) * lfAmp;
            const camSwayY = Math.sin(t * 62) * lfAmp * 0.5;

            // Layer 3: ultra-fast micro-tremor (gives "engine rumble" texture)
            const ufAmp = shakeEnv * 0.06;
            const camTremorX = Math.sin(t * 220) * ufAmp;

            // Combine all layers
            this.camera.position.x = camJitterX + camSwayX + camTremorX + pxOff * 0.3;
            this.camera.position.z = 18 + camJitterZ;
            this.camera.position.y += camSwayY;

            // Camera roll tremor (tiny rotation — very cinematic)
            this.camera.rotation.z = (Math.random() - 0.5) * shakeEnv * 0.008;

            // Shuttle body tremor (separate from camera — the shuttle itself shakes)
            const stkAmp = shakeEnv * 0.04;
            this.shuttleGroup.position.x += (Math.random() - 0.5) * stkAmp;
            this.shuttleGroup.rotation.z  = (Math.random() - 0.5) * shakeEnv * 0.006;
        } else {
            // Smoothly return to neutral when not shaking
            this.camera.position.x  += (pxOff * 0.3 - this.camera.position.x) * 0.12;
            this.camera.position.z  += (18 - this.camera.position.z) * 0.12;
            this.camera.rotation.z  += (0 - this.camera.rotation.z) * 0.1;
            this.shuttleGroup.rotation.z += (0 - this.shuttleGroup.rotation.z) * 0.1;
        }

        /* No gravity-turn roll — keep shuttle vertical */

        /* ── Particle updates ── */
        // Offset deep underneath the center pivot to accurately hit the actual model nozzle
        const nozzleY = this.shuttleGroup.position.y - 6.0;
        const nozzleX = 0;

        // Fire
        this._updateParticles(
            this.firePosArr, this.fireVelArr, this.fireLifeArr, this.FIRE_N,
            dt, thrust, 1.8, nozzleX, nozzleY, 0.25,
            (i) => this._resetFire(i)
        );
        this.firePts.geometry.attributes.position.needsUpdate = true;
        this.firePts.material.visible = thrust > 0.02;
        this.firePts.material.opacity = thrust;

        // SRB
        this._updateParticles(
            this.srbPosArr, this.srbVelArr, this.srbLifeArr, this.SRB_N,
            dt, thrust, 2.0, nozzleX, nozzleY, 0.18,
            (i) => this._resetSRB(i)
        );
        this.srbPts.geometry.attributes.position.needsUpdate = true;
        this.srbPts.material.visible = thrust > 0.02 && p < 0.7;
        this.srbPts.material.opacity = thrust * (p < 0.65 ? 1 : Math.max(0, (0.7 - p) / 0.05));

        // Smoke
        const smokeThrust = p < 0.45 ? thrust : thrust * Math.max(0, 1 - (p - 0.45) / 0.35);
        this._updateSmoke(dt, nozzleX, nozzleY, smokeThrust);
        this.smkPts.geometry.attributes.position.needsUpdate = true;
        this.smkPts.material.visible = smokeThrust > 0.01;
        this.smkPts.material.opacity = 0.07 * smokeThrust;   // significantly reduced

        // Steam — disabled (no launch pad in this layout)
        this.stmPts.material.visible = false;

        /* ── Glow ── */
        const glowY = this.shuttleGroup.position.y - 3.0;
        const fl = thrust;

        this.glowCore.position.y   = glowY;
        this.glowCore.material.opacity = fl * 0.85;
        this.glowCore.scale.set(2, 3.5 + fl * 2, 1);

        this.glowOrange.position.y  = glowY - 0.5;
        this.glowOrange.material.opacity = fl * 0.55;
        this.glowOrange.scale.set(4 + fl * 3, 8 + fl * 6, 1);

        const gdActive = p < 0.3;
        this.glowGround.material.opacity = gdActive ? fl * 0.35 : 0;
        this.glowGround.scale.set(10 + fl * 8, 2.5, 1);

        /* ── Dynamic fire lights ── */
        this.fireLight1.intensity = fl * 12;
        this.fireLight1.position.y = glowY + 1;
        this.fireLight2.intensity = fl * 7;
        this.fireLight2.position.y = glowY - 1;

        /* ── Bloom strength reacts accurately to thrust ── */
        if (this.bloomPass) {
            this.bloomPass.strength = 0.5 + fl * 0.7; // Fixed severe overexposure bug
        }

        /* No ground mesh to update */

        this.composer.render();
    }

    /* ── Generic particle update helper ── */
    _updateParticles(pos, vel, life, count, dt, thrust, lifeRate, emitX, emitY, emitR, resetFn) {
        for (let i = 0; i < count; i++) {
            life[i] += dt * lifeRate;
            if (life[i] >= 1) {
                resetFn(i);
                pos[i*3]   += emitX;
                pos[i*3+1] += emitY;
                // z remains unchanged; local trajectory is handled gracefully by resetFn
                continue;
            }
            pos[i*3]   += vel[i*3]   * dt;
            pos[i*3+1] += vel[i*3+1] * dt * (thrust * 0.4 + 0.6);
            pos[i*3+2] += vel[i*3+2] * dt;
        }
    }

    _updateSmoke(dt, emitX, emitY, smokeThrust) {
        for (let i = 0; i < this.SMK_N; i++) {
            this.smkLifeArr[i] += dt * 0.18;
            if (this.smkLifeArr[i] >= 1) {
                this._resetSmoke(i);
                this.smkPosArr[i*3]   += emitX;
                this.smkPosArr[i*3+1] += emitY;
                continue;
            }
            this.smkPosArr[i*3]   += this.smkVelArr[i*3]   * dt;
            this.smkPosArr[i*3+1] += this.smkVelArr[i*3+1] * dt;
            this.smkPosArr[i*3+2] += this.smkVelArr[i*3+2] * dt;
        }
    }

    _updateSteam(dt, steamLevel) {
        for (let i = 0; i < this.STM_N; i++) {
            this.stmLifeArr[i] += dt * 0.25;
            if (this.stmLifeArr[i] >= 1) {
                this._resetSteam(i);
                continue;
            }
            this.stmPosArr[i*3]   += this.stmVelArr[i*3]   * dt * steamLevel;
            this.stmPosArr[i*3+1] += this.stmVelArr[i*3+1] * dt * steamLevel;
            this.stmPosArr[i*3+2] += this.stmVelArr[i*3+2] * dt * steamLevel;
        }
    }

    /* ── Resize ── */
    onResize() {
        const W = window.innerWidth, H = window.innerHeight;
        this.camera.aspect = W / H;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(W, H);
        this.composer.setSize(W, H);
    }

    /* ── Timer ── */
    startTimer() {
        let s = 0;
        setInterval(() => {
            s++;
            const h = String(Math.floor(s / 3600)).padStart(2, '0');
            const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
            const sec = String(s % 60).padStart(2, '0');
            if (this.timerElem) this.timerElem.innerText = `T-PLUS ${h}:${m}:${sec}`;
        }, 1000);
    }
}

/* ────────────────────────────────────────────────────────────────
   BOOT: Load Three.js + GLTFLoader + Post-processing, then start
──────────────────────────────────────────────────────────────── */
(function () {
    const CDN = 'https://cdn.jsdelivr.net/npm/three@0.128.0';

    // Inject scripts sequentially: Three → GLTFLoader → addons → boot
    function loadScript(src, cb) {
        if (document.querySelector(`script[src="${src}"]`)) { cb(); return; }
        const s = document.createElement('script');
        s.src = src; s.onload = cb;
        document.head.appendChild(s);
    }

    function boot() {
        document.addEventListener('DOMContentLoaded', () => new LaunchExperience());
    }

    // If THREE is already on the page (loaded via home.html <script> tag), just boot
    if (typeof THREE !== 'undefined' &&
        typeof THREE.GLTFLoader !== 'undefined' &&
        typeof THREE.EffectComposer !== 'undefined') {
        boot();
        return;
    }

    // Otherwise load dependencies in order
    loadScript(`${CDN}/build/three.min.js`, () => {
        loadScript(`${CDN}/examples/js/loaders/GLTFLoader.js`, () => {
            loadScript(`${CDN}/examples/js/postprocessing/EffectComposer.js`, () => {
                loadScript(`${CDN}/examples/js/postprocessing/RenderPass.js`, () => {
                    loadScript(`${CDN}/examples/js/postprocessing/ShaderPass.js`, () => {
                        loadScript(`${CDN}/examples/js/shaders/LuminosityHighPassShader.js`, () => {
                            loadScript(`${CDN}/examples/js/shaders/CopyShader.js`, () => {
                                loadScript(`${CDN}/examples/js/postprocessing/UnrealBloomPass.js`, () => {
                                    boot();
                                });
                            });
                        });
                    });
                });
            });
        });
    });
})();
