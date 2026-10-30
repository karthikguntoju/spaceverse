import * as THREE from 'three';

/** One activation per uninterrupted look. No wall-clock jumps after tab hiding. */
export class DwellSelector {
    constructor(duration = 1.4) {
        this.duration = duration;
        this.reset();
    }
    reset(requireLookAway = false) {
        this.key = null;
        this.elapsed = 0;
        this.done = false;
        this.blocked = requireLookAway;
    }
    update(key, dt) {
        if (!key) {
            this.reset();
            return { progress: 0, activate: false };
        }
        // When a menu replaces another panel, require a deliberate new look.
        if (this.blocked) return { progress: 0, activate: false };
        if (key !== this.key) {
            this.key = key;
            this.elapsed = 0;
            this.done = false;
        }
        this.elapsed += Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.05)) : 0;
        const progress = Math.min(1, this.elapsed / this.duration);
        const activate = progress >= 1 && !this.done;
        if (activate) this.done = true;
        return { progress, activate };
    }
}

/** Canvas-backed controls, anchored to the cabin, NOT to the moving head. */
export class GazeControls {
    constructor(parent) {
        this.group = new THREE.Group();
        this.group.visible = false;
        parent.add(this.group);
        this.items = [];
        this.signature = '';
    }
    anchor(camera) {
        this.group.position.copy(camera.position);
        // A fixed downward dock, independent of head pitch/roll. Never put
        // navigation panels over the forward view or chase the user's gaze.
        const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
        this.group.quaternion.setFromEuler(new THREE.Euler(-55 * Math.PI / 180, yaw, 0, 'YXZ'));
    }
    lookPitch(camera) {
        return new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').x;
    }
    updateDock(camera, expanded) {
        // Closed dock is available in whichever horizontal direction you face.
        // Once open, leave its targets still so they can be selected reliably.
        if (!expanded) this.anchor(camera);
        this.group.visible = expanded || this.lookPitch(camera) < -35 * Math.PI / 180;
    }
    setOptions(options) {
        const signature = JSON.stringify(options);
        if (signature === this.signature) return;
        this.signature = signature;
        for (const item of this.items) {
            this.group.remove(item);
            item.geometry.dispose();
            item.material.map.dispose();
            item.material.dispose();
        }
        this.items = options.map(({ action, title, hint }, i) => {
            const canvas = document.createElement('canvas');
            canvas.width = 1024; canvas.height = 512;
            const ctx = canvas.getContext('2d');
            ctx.scale(2, 2);
            ctx.fillStyle = '#091526';
            ctx.fillRect(0, 0, 512, 256);
            ctx.strokeStyle = '#64ffda'; ctx.lineWidth = 5;
            ctx.strokeRect(3, 3, 506, 250);
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 54px system-ui, sans-serif';
            ctx.fillText(title, 256, 112, 470);
            ctx.fillStyle = '#a9ccd9';
            ctx.font = '32px system-ui, sans-serif';
            ctx.fillText(hint || 'Hold gaze to select', 256, 172, 470);
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.generateMipmaps = false;
            texture.minFilter = THREE.LinearFilter;
            const grid = options.length > 3;
            const item = new THREE.Mesh(new THREE.PlaneGeometry(grid ? 0.54 : 0.44, 0.22),
                new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
            item.position.set(grid ? ((i % 2) - 0.5) * 0.58 : (i - (options.length - 1) / 2) * 0.47,
                grid ? 0.14 - Math.floor(i / 2) * 0.28 : 0, -1.6);
            item.renderOrder = 998;
            item.userData.action = action;
            this.group.add(item);
            return item;
        });
    }
    hit(raycaster, layer = 0) {
        if (!this.group.visible) return null;
        this.group.updateWorldMatrix(true, true);
        const mask = raycaster.layers.mask;
        try {
            raycaster.layers.set(layer);
            return raycaster.intersectObjects(this.items, false)[0] || null;
        } finally {
            raycaster.layers.mask = mask;
        }
    }
    highlight(item) {
        for (const button of this.items) {
            button.material.color.set(button === item ? 0x64ffda : 0xffffff);
        }
    }
}
