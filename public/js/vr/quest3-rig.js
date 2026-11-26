import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createGlowTexture, createHexShieldTexture, safeCanvas } from './quest-assets.js?v=20261125-q3';

const HANDED_DEFAULT = ['left', 'right'];

function buildTouchPlusModel(side, envMap = null) {
    const root = new THREE.Group();
    const isLeft = side === 'left';
    const mirror = isLeft ? 1 : -1;

    const mShell = new THREE.MeshStandardMaterial({
        color: 0xe6ecf5,
        roughness: 0.42,
        metalness: 0.14,
        envMap
    });
    const mFace = new THREE.MeshStandardMaterial({
        color: 0x161b24,
        roughness: 0.55,
        metalness: 0.2,
        envMap
    });
    const mDark = new THREE.MeshStandardMaterial({
        color: 0x262e3c,
        roughness: 0.48,
        metalness: 0.35,
        envMap
    });
    const mAccent = new THREE.MeshBasicMaterial({ color: 0x64ffda });
    const mBtnA = new THREE.MeshStandardMaterial({ color: 0x3b485e, emissive: 0x062029, emissiveIntensity: 0.4, roughness: 0.35 });
    const mBtnB = new THREE.MeshStandardMaterial({ color: 0x3b485e, emissive: 0x062029, emissiveIntensity: 0.4, roughness: 0.35 });

    // Ergonomic Touch Plus angled pistol grip
    const gripBody = new THREE.Mesh(new RoundedBoxGeometry(0.036, 0.105, 0.044, 3, 0.012), mShell);
    gripBody.position.set(0, -0.042, 0.022);
    gripBody.rotation.x = 0.48;
    root.add(gripBody);

    // Ringless contoured top tracking faceplate (Meta Quest 3 Touch Plus signature silhouette)
    const faceplate = new THREE.Mesh(new RoundedBoxGeometry(0.052, 0.022, 0.068, 3, 0.01), mFace);
    faceplate.position.set(0, 0.008, -0.004);
    faceplate.rotation.x = -0.18;
    root.add(faceplate);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.0022, 6, 28), mAccent);
    rim.rotation.x = Math.PI / 2 - 0.18;
    rim.position.set(0, 0.012, -0.004);
    root.add(rim);

    // Thumbstick (pivots with stick X/Y)
    const stickPivot = new THREE.Group();
    stickPivot.position.set(mirror * 0.009, 0.02, -0.014);
    root.add(stickPivot);
    const stickStem = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.005, 0.014, 10), mDark);
    stickStem.position.y = 0.006;
    stickPivot.add(stickStem);
    const stickCap = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.009, 0.005, 16), mDark);
    stickCap.position.y = 0.013;
    stickPivot.add(stickCap);

    // Primary & secondary face buttons (X/Y on left, A/B on right)
    const btnPrimary = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.006, 14), mBtnA);
    btnPrimary.position.set(-mirror * 0.011, 0.019, 0.006);
    root.add(btnPrimary);
    const btnSecondary = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.006, 14), mBtnB);
    btnSecondary.position.set(-mirror * 0.013, 0.019, -0.011);
    root.add(btnSecondary);

    // Analog index trigger (pivots backward as trigger pulls)
    const triggerPivot = new THREE.Group();
    triggerPivot.position.set(0, -0.008, -0.03);
    root.add(triggerPivot);
    const triggerMesh = new THREE.Mesh(new RoundedBoxGeometry(0.016, 0.026, 0.012, 2, 0.004), mDark);
    triggerMesh.position.set(0, -0.012, -0.004);
    triggerMesh.rotation.x = 0.25;
    triggerPivot.add(triggerMesh);

    // Analog side squeeze grip button (slides inward on squeeze)
    const gripBtn = new THREE.Mesh(new RoundedBoxGeometry(0.01, 0.038, 0.016, 2, 0.004), mDark);
    gripBtn.position.set(-mirror * 0.018, -0.036, 0.012);
    gripBtn.rotation.x = 0.48;
    root.add(gripBtn);

    return {
        root,
        stickPivot,
        triggerPivot,
        gripBtn,
        btnPrimary,
        btnSecondary,
        mBtnA,
        mBtnB,
        mAccent,
        mirror
    };
}

function buildToolAttachments(side, envMap = null) {
    const group = new THREE.Group();
    const isLeft = side === 'left';
    const tools = {};

    const mGunMetal = new THREE.MeshStandardMaterial({ color: 0x3b485e, metalness: 0.8, roughness: 0.3, envMap });
    const mDarkMetal = new THREE.MeshStandardMaterial({ color: 0x161d2b, metalness: 0.65, roughness: 0.42, envMap });
    const mCyanGlow = new THREE.MeshBasicMaterial({ color: 0x64ffda });
    const mAmberGlow = new THREE.MeshBasicMaterial({ color: 0xffb454 });
    const mVioletGlow = new THREE.MeshBasicMaterial({ color: 0xc084fc });

    if (isLeft) {
        // 1. Deployable Hexagonal Aegis Holo-Shield (Orbital Intercept & Asteroid Dodge)
        const shieldGroup = new THREE.Group();
        shieldGroup.position.set(0, 0.02, -0.14);
        shieldGroup.visible = false;
        const shieldTex = createHexShieldTexture();
        const shieldDisc = new THREE.Mesh(
            new THREE.CircleGeometry(0.32, 32),
            new THREE.MeshBasicMaterial({
                map: shieldTex,
                color: 0x70f8ff,
                transparent: true,
                opacity: 0.84,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            })
        );
        shieldGroup.add(shieldDisc);
        const emitter = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.007, 8, 24), mGunMetal);
        emitter.position.z = 0.06;
        shieldGroup.add(emitter);
        const emitterCore = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 10), mCyanGlow);
        emitterCore.position.z = 0.06;
        shieldGroup.add(emitterCore);
        group.add(shieldGroup);
        tools.shield = { group: shieldGroup, disc: shieldDisc, core: emitterCore, flash: 0 };

        // 2. Magnetic Grapple Claw + Physical Carried Spare Module (Satellite Repair)
        const clawGroup = new THREE.Group();
        clawGroup.position.set(0, 0.01, -0.07);
        clawGroup.visible = false;
        for (const angle of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
            const prong = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.012, 0.07, 2, 0.003), mGunMetal);
            prong.position.set(Math.cos(angle) * 0.028, Math.sin(angle) * 0.028, -0.02);
            clawGroup.add(prong);
        }
        const carriedSpare = new THREE.Mesh(
            new RoundedBoxGeometry(0.078, 0.052, 0.058, 2, 0.008),
            new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0x7c4808, emissiveIntensity: 0.5, metalness: 0.6, roughness: 0.35 })
        );
        carriedSpare.position.set(0, 0, -0.085);
        carriedSpare.visible = false;
        clawGroup.add(carriedSpare);
        group.add(clawGroup);
        tools.claw = { group: clawGroup, spare: carriedSpare };

        // 3. MMU Thruster Indicator Pod (Space Rescue)
        const mmuGroup = new THREE.Group();
        mmuGroup.position.set(0, 0.02, -0.05);
        mmuGroup.visible = false;
        const mmuBody = new THREE.Mesh(new RoundedBoxGeometry(0.056, 0.024, 0.056, 2, 0.006), mDarkMetal);
        mmuGroup.add(mmuBody);
        const mmuLed = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), mCyanGlow);
        mmuLed.position.set(0, 0.016, -0.01);
        mmuGroup.add(mmuLed);
        group.add(mmuGroup);
        tools.mmu = { group: mmuGroup, led: mmuLed };
    } else {
        // 1. Twin-Barrel Plasma Pulse Blaster (Orbital Intercept & Asteroid Dodge)
        const blasterGroup = new THREE.Group();
        blasterGroup.position.set(0, 0.018, -0.05);
        blasterGroup.visible = false;
        const receiver = new THREE.Mesh(new RoundedBoxGeometry(0.044, 0.046, 0.145, 3, 0.009), mDarkMetal);
        receiver.position.z = -0.04;
        blasterGroup.add(receiver);
        for (const bx of [-0.012, 0.012]) {
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.009, 0.14, 12), mGunMetal);
            barrel.rotation.x = Math.PI / 2;
            barrel.position.set(bx, 0.006, -0.14);
            blasterGroup.add(barrel);
        }
        const sightRing = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0022, 6, 20), mCyanGlow);
        sightRing.position.set(0, 0.036, -0.06);
        blasterGroup.add(sightRing);
        const chargeStrip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.11), mVioletGlow);
        chargeStrip.position.set(0, 0.024, -0.09);
        blasterGroup.add(chargeStrip);
        const muzzleFlash = new THREE.Mesh(
            new THREE.SphereGeometry(0.028, 10, 8),
            new THREE.MeshBasicMaterial({ color: 0x99f6ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })
        );
        muzzleFlash.position.set(0, 0.006, -0.22);
        muzzleFlash.visible = false;
        blasterGroup.add(muzzleFlash);
        const muzzleAnchor = new THREE.Object3D();
        muzzleAnchor.position.set(0, 0.006, -0.22);
        blasterGroup.add(muzzleAnchor);
        group.add(blasterGroup);
        tools.blaster = { group: blasterGroup, muzzleAnchor, muzzleFlash, chargeStrip, recoil: 0, flashT: 0 };

        // 2. Plasma Welder Multi-Tool (Satellite Repair)
        const welderGroup = new THREE.Group();
        welderGroup.position.set(0, 0.015, -0.05);
        welderGroup.visible = false;
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.14, 14), mDarkMetal);
        body.rotation.x = Math.PI / 2;
        body.position.z = -0.05;
        welderGroup.add(body);
        const collar = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 8, 20), mAmberGlow);
        collar.position.z = -0.11;
        welderGroup.add(collar);
        const arcTip = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), mCyanGlow);
        arcTip.position.z = -0.14;
        welderGroup.add(arcTip);
        group.add(welderGroup);
        tools.welder = { group: welderGroup, collar, arcTip };

        // 3. Electromagnetic Tether Harpoon Launcher (Space Rescue)
        const harpoonGroup = new THREE.Group();
        harpoonGroup.position.set(0, 0.015, -0.05);
        harpoonGroup.visible = false;
        const rail = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.032, 0.18, 2, 0.007), mGunMetal);
        rail.position.z = -0.07;
        harpoonGroup.add(rail);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.055, 6), mCyanGlow);
        tip.rotation.x = -Math.PI / 2;
        tip.position.z = -0.185;
        harpoonGroup.add(tip);
        const muzzleHarpoon = new THREE.Object3D();
        muzzleHarpoon.position.set(0, 0, -0.2);
        harpoonGroup.add(muzzleHarpoon);
        group.add(harpoonGroup);
        tools.harpoon = { group: harpoonGroup, tip, muzzleAnchor: muzzleHarpoon };
    }

    return { group, tools };
}

function buildWristHUD() {
    const surface = safeCanvas(512, 224);
    const tex = surface ? new THREE.CanvasTexture(surface.canvas) : null;
    if (tex) {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
    }
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.145, 0.064),
        new THREE.MeshBasicMaterial({
            map: tex,
            color: tex ? 0xffffff : 0x071324,
            transparent: true,
            opacity: 0.94,
            depthWrite: false,
            toneMapped: false
        })
    );
    // Positioned ergonomically like a holographic smartwatch above the left Touch Plus grip
    mesh.position.set(0.03, 0.062, 0.025);
    mesh.rotation.set(-0.55, 0.32, 0.14);
    mesh.visible = false;

    let lastKey = '';
    const update = (title = '', status = '', hint = '') => {
        if (!surface || !tex) return;
        const key = `${title}|${status}|${hint}`;
        if (key === lastKey) return;
        lastKey = key;
        const { ctx, canvas } = surface;
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(6, 14, 28, 0.92)';
        ctx.fillRect(3, 3, w - 6, h - 6);
        ctx.strokeStyle = '#64ffda';
        ctx.lineWidth = 4;
        ctx.strokeRect(3, 3, w - 6, h - 6);

        ctx.fillStyle = '#64ffda';
        ctx.font = 'bold 28px Inter, system-ui, sans-serif';
        ctx.fillText(String(title).slice(0, 26), 18, 42, w - 36);

        ctx.fillStyle = '#f0f7ff';
        ctx.font = '24px Inter, system-ui, sans-serif';
        ctx.fillText(String(status).slice(0, 38), 18, 102, w - 36);

        if (hint) {
            ctx.fillStyle = '#93c5fd';
            ctx.font = '20px Inter, system-ui, sans-serif';
            ctx.fillText(String(hint).slice(0, 44), 18, 168, w - 36);
        }
        tex.needsUpdate = true;
    };

    return { mesh, update };
}

export class Quest3Rig {
    constructor({ renderer, dolly, envMap = null, onSelect, onSqueeze } = {}) {
        this.renderer = renderer;
        this.dolly = dolly;
        this.envMap = envMap;
        this.profile = 'default';
        this.controllers = [];
        this.slots = [];
        this.leftHand = null;
        this.rightHand = null;
        this.raycaster = new THREE.Raycaster();
        this.wristHud = buildWristHUD();
        this._tmpVec = new THREE.Vector3();
        this._tmpDir = new THREE.Vector3();
        this._tmpQuat = new THREE.Quaternion();
        this._initXRSlots(onSelect, onSqueeze);
    }

    _initXRSlots(onSelect, onSqueeze) {
        const xr = this.renderer?.xr;
        const rayGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, -1)
        ]);
        const dotTex = createGlowTexture('rgba(160,255,240,1)', 'rgba(100,255,218,0)');

        for (let i = 0; i < 2; i++) {
            const controller = xr?.getController ? xr.getController(i) : new THREE.Object3D();
            const grip = xr?.getControllerGrip ? xr.getControllerGrip(i) : new THREE.Object3D();

            const lineMat = new THREE.LineBasicMaterial({
                color: 0x64ffda,
                transparent: true,
                opacity: 0.72
            });
            const rayLine = new THREE.Line(rayGeo, lineMat);
            rayLine.scale.z = 5.5;
            controller.add(rayLine);

            const hitDot = new THREE.Mesh(
                new THREE.SphereGeometry(0.011, 10, 8),
                new THREE.MeshBasicMaterial({
                    color: 0x99ffea,
                    map: dotTex || null,
                    transparent: true,
                    opacity: 0.9,
                    toneMapped: false
                })
            );
            hitDot.position.z = -5.5;
            controller.add(hitDot);

            const leftRig = buildTouchPlusModel('left', this.envMap);
            const rightRig = buildTouchPlusModel('right', this.envMap);
            const leftTools = buildToolAttachments('left', this.envMap);
            const rightTools = buildToolAttachments('right', this.envMap);

            // Attach models onto grip if WebXR provides controllerGrip, else controller
            const mount = xr?.getControllerGrip ? grip : controller;
            mount.add(leftRig.root);
            mount.add(rightRig.root);
            mount.add(leftTools.group);
            mount.add(rightTools.group);

            const defaultHand = HANDED_DEFAULT[i];
            leftRig.root.visible = defaultHand === 'left';
            rightRig.root.visible = defaultHand === 'right';
            leftTools.group.visible = defaultHand === 'left';
            rightTools.group.visible = defaultHand === 'right';

            if (defaultHand === 'left') {
                mount.add(this.wristHud.mesh);
            }

            const slot = {
                index: i,
                controller,
                grip,
                mount,
                handedness: defaultHand,
                rayLine,
                hitDot,
                models: { left: leftRig, right: rightRig },
                tools: { left: leftTools, right: rightTools }
            };

            if (typeof controller.addEventListener === 'function') {
                controller.addEventListener('connected', ev => {
                    const h = ev?.data?.handedness === 'left' || ev?.data?.handedness === 'right'
                        ? ev.data.handedness
                        : defaultHand;
                    this._assignSlotHand(slot, h);
                });
                controller.addEventListener('disconnected', () => {
                    if (this.leftHand === slot) this.leftHand = null;
                    if (this.rightHand === slot) this.rightHand = null;
                });
                if (onSelect) controller.addEventListener('selectstart', () => onSelect(controller, slot));
                if (onSqueeze) controller.addEventListener('squeezestart', () => onSqueeze(controller, slot));
            }

            if (this.dolly) {
                this.dolly.add(controller);
                if (grip !== controller) this.dolly.add(grip);
            }

            this.controllers.push(controller);
            this.slots.push(slot);
            if (defaultHand === 'left') this.leftHand = slot;
            if (defaultHand === 'right') this.rightHand = slot;
        }

        this.setToolProfile(this.profile);
    }

    _assignSlotHand(slot, handedness) {
        slot.handedness = handedness;
        slot.models.left.root.visible = handedness === 'left';
        slot.models.right.root.visible = handedness === 'right';
        slot.tools.left.group.visible = handedness === 'left';
        slot.tools.right.group.visible = handedness === 'right';
        if (handedness === 'left') {
            this.leftHand = slot;
            slot.mount.add(this.wristHud.mesh);
        } else {
            this.rightHand = slot;
        }
    }

    setToolProfile(slug = 'default') {
        this.profile = slug;
        for (const slot of this.slots) {
            const lt = slot.tools.left.tools;
            const rt = slot.tools.right.tools;
            lt.shield.group.visible = slug === 'orbital-intercept' || slug === 'asteroid-dodge';
            lt.claw.group.visible = slug === 'satellite-repair';
            lt.mmu.group.visible = slug === 'space-rescue';
            rt.blaster.group.visible = slug === 'orbital-intercept' || slug === 'asteroid-dodge';
            rt.welder.group.visible = slug === 'satellite-repair';
            rt.harpoon.group.visible = slug === 'space-rescue';

            // Keep aiming ray subtle when holding physical blaster/welder
            const combatRight = slug === 'orbital-intercept' || slug === 'asteroid-dodge';
            slot.rayLine.material.opacity = combatRight ? 0.35 : 0.72;
        }
        this.wristHud.mesh.visible = Boolean(slug && slug !== 'default');
    }

    setRayDistance(hand, distance = 5.5) {
        const slot = hand === 'left' ? this.leftHand : this.rightHand;
        if (!slot) return;
        const d = Math.max(0.25, Math.min(20, distance));
        slot.rayLine.scale.z = d;
        slot.hitDot.position.z = -d;
    }

    triggerBlasterRecoil(charged = false) {
        const blaster = this.rightHand?.tools?.right?.tools?.blaster;
        if (!blaster) return;
        blaster.recoil = charged ? 0.055 : 0.028;
        blaster.flashT = charged ? 0.14 : 0.07;
    }

    triggerShieldBlock() {
        const shield = this.leftHand?.tools?.left?.tools?.shield;
        if (shield) shield.flash = 1;
    }

    getMuzzlePose() {
        const slot = this.rightHand;
        const controller = slot?.controller;
        if (!controller) return null;
        controller.updateWorldMatrix(true, false);
        const anchor = slot.tools?.right?.tools?.blaster?.muzzleAnchor;
        if (anchor && slot.tools.right.tools.blaster.group.visible) {
            anchor.updateWorldMatrix(true, false);
            anchor.getWorldPosition(this._tmpVec);
        } else {
            this._tmpVec.setFromMatrixPosition(controller.matrixWorld);
        }
        controller.getWorldQuaternion(this._tmpQuat);
        this._tmpDir.set(0, 0, -1).applyQuaternion(this._tmpQuat).normalize();
        return {
            position: this._tmpVec.clone(),
            direction: this._tmpDir.clone()
        };
    }

    getShieldPose() {
        const slot = this.leftHand;
        const shield = slot?.tools?.left?.tools?.shield;
        if (!slot || !shield || !shield.group.visible) return null;
        shield.disc.updateWorldMatrix(true, false);
        const position = new THREE.Vector3();
        shield.disc.getWorldPosition(position);
        const quat = new THREE.Quaternion();
        shield.disc.getWorldQuaternion(quat);
        const normal = new THREE.Vector3(0, 0, -1).applyQuaternion(quat).normalize();
        const scale = shield.group.scale.x || 0.25;
        return {
            position,
            normal,
            radius: 0.34 * scale,
            active: scale > 0.55
        };
    }

    update(dt = 0.016, questInput = null, info = {}) {
        const leftInput = questInput?.left;
        const rightInput = questInput?.right;

        for (const slot of this.slots) {
            const isLeft = slot.handedness === 'left';
            const handData = isLeft ? leftInput : rightInput;
            const model = isLeft ? slot.models.left : slot.models.right;
            const tools = isLeft ? slot.tools.left.tools : slot.tools.right.tools;

            const sx = handData?.stick?.x || 0;
            const sy = handData?.stick?.y || 0;
            const trig = handData?.trigger || 0;
            const grip = handData?.grip || 0;

            model.stickPivot.rotation.z = -sx * 0.35;
            model.stickPivot.rotation.x = sy * 0.35;
            model.triggerPivot.rotation.x = trig * 0.45;
            model.gripBtn.position.x = -model.mirror * (0.018 - grip * 0.006);
            model.btnPrimary.position.y = handData?.primary ? 0.016 : 0.019;
            model.btnSecondary.position.y = handData?.secondary ? 0.016 : 0.019;
            model.mBtnA.emissive.setHex(handData?.primary ? 0x64ffda : 0x062029);
            model.mBtnB.emissive.setHex(handData?.secondary ? 0xfbbf24 : 0x062029);

            if (isLeft && tools.shield?.group.visible) {
                const wantScale = handData?.triggerPressed ? 1.35 : 0.28;
                const s = tools.shield.group.scale.x + (wantScale - tools.shield.group.scale.x) * Math.min(1, dt * 14);
                tools.shield.group.scale.setScalar(s);
                tools.shield.disc.rotation.z += dt * (handData?.triggerPressed ? 0.85 : 0.2);
                tools.shield.flash = Math.max(0, tools.shield.flash - dt * 4);
                tools.shield.disc.material.opacity = (handData?.triggerPressed ? 0.82 : 0.24) + tools.shield.flash * 0.18;
                tools.shield.disc.material.color.setHex(tools.shield.flash > 0.1 ? 0xffffff : 0x70f8ff);
            }

            if (isLeft && tools.claw?.group.visible) {
                const spare = info.run?.carryingSpare;
                tools.claw.spare.visible = Boolean(spare);
                if (spare) {
                    const col = spare === 'POWER' ? 0xfbbf24 : spare === 'COMMS' ? 0x38bdf8 : 0xc084fc;
                    tools.claw.spare.material.color.setHex(col);
                    tools.claw.spare.rotation.y += dt * 1.4;
                }
            }

            if (isLeft && tools.mmu?.group.visible) {
                const matched = Boolean(info.run?.matched);
                tools.mmu.led.material.color.setHex(matched ? 0x34d399 : info.run?.canMatch ? 0xfbbf24 : 0x38bdf8);
            }

            if (!isLeft && tools.blaster?.group.visible) {
                tools.blaster.recoil = Math.max(0, tools.blaster.recoil - dt * 0.25);
                tools.blaster.flashT = Math.max(0, tools.blaster.flashT - dt);
                tools.blaster.group.position.z = -0.05 + tools.blaster.recoil;
                tools.blaster.muzzleFlash.visible = tools.blaster.flashT > 0;
                if (tools.blaster.flashT > 0) {
                    tools.blaster.muzzleFlash.scale.setScalar(0.8 + Math.random() * 0.5);
                }
                const charged = grip > 0.3;
                tools.blaster.chargeStrip.material.color.setHex(charged ? 0x64ffda : 0xc084fc);
            }

            if (!isLeft && tools.welder?.group.visible) {
                tools.welder.collar.rotation.z += dt * (trig > 0.2 ? 9 : 1.5);
                tools.welder.arcTip.material.color.setHex(trig > 0.2 ? 0xffffff : 0x64ffda);
            }
        }

        if (this.wristHud.mesh.visible && info.hudTitle) {
            this.wristHud.update(info.hudTitle, info.hudStatus || '', info.hudHint || '');
        }
    }
}
