import * as THREE from '/lib/three/three.module.js';
import { immersiveVRStatus } from '../vr/xr-support.js';
import { arcadeKeys, arcadeShortcuts } from './quest-input.js';

const WIDTH = 1280;
const MAX_GAME_HEIGHT = 780;
const HEADER = 66;
const FOOTER = 114;
const HEIGHT = HEADER + MAX_GAME_HEIGHT + FOOTER;
const ACTIONS = ['play', 'mute', 'recenter', 'exit'];

export async function attachQuestScreen(arcade, button, status) {
    const xr = navigator.xr;
    const support = await immersiveVRStatus(xr, window.isSecureContext);
    button.textContent = support.available ? 'Play in headset VR' : support.label;
    button.disabled = !support.available;
    if (!support.available) return;
    button.onclick = async () => {
        button.disabled = true;
        status.textContent = 'Opening headset VR…';
        let session, theater;
        try {
            arcade.prepareAudio();
            session = await xr.requestSession('immersive-vr', { optionalFeatures: ['hand-tracking'] });
            theater = new QuestScreen(arcade, session, () => {
                button.disabled = false;
                status.textContent = '';
            });
            await theater.start();
            status.textContent = '';
        } catch {
            if (session) {
                try { await session.end(); } catch { /* already ended */ }
            }
            theater?.dispose();
            button.disabled = false;
            status.textContent = 'Could not open headset VR. Try again, or play on this screen.';
        }
    };
}

class QuestScreen {
    constructor(arcade, session, onEnd) {
        this.arcade = arcade;
        this.session = session;
        this.onEnd = onEnd;
        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.renderer.xr.enabled = true;
        this.renderer.xr.setReferenceSpaceType('local');
        this.renderer.xr.setFramebufferScaleFactor(0.8);
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x070d1a);
        this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 20);
        this.surface = document.createElement('canvas');
        this.surface.width = WIDTH;
        this.surface.height = HEIGHT;
        this.ctx = this.surface.getContext('2d');
        this.texture = new THREE.CanvasTexture(this.surface);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.generateMipmaps = false;
        this.texture.minFilter = THREE.LinearFilter;
        const material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
        this.screen = new THREE.Mesh(new THREE.PlaneGeometry(2.35, 1), material);
        this.screen.visible = false;
        this.scene.add(this.screen);
        this.cursor = new THREE.Mesh(new THREE.RingGeometry(0.009, 0.014, 32),
            new THREE.MeshBasicMaterial({ color: 0x6cffe2, depthTest: false }));
        this.cursor.visible = false;
        this.cursor.renderOrder = 1;
        this.scene.add(this.cursor);
        this.ray = new THREE.Raycaster();
        this.keyboard = new Set();
        this.target = null;
        this.drag = null;
        this.needsCenter = true;
        this.lastFrame = -Infinity;
        this.shortcutHint = arcadeShortcuts(arcade.cfg.slug);
        this.controllers = Array.from({ length: 2 }, (_, index) => {
            const controller = this.renderer.xr.getController(index);
            controller.addEventListener('connected', ({ data }) => { controller.userData.source = data; });
            controller.addEventListener('disconnected', () => {
                if (this.drag?.controller === controller) this.release();
                delete controller.userData.source;
            });
            controller.addEventListener('selectstart', () => this.select(controller));
            controller.addEventListener('selectend', () => {
                if (this.drag?.controller === controller) this.release();
            });
            controller.addEventListener('squeezestart', () => {
                if (!this.arcade.g.running) return;
                this.release();
                this.arcade.pause();
            });
            this.scene.add(controller);
            return controller;
        });
        this.visibilityChanged = () => {
            if (session.visibilityState === 'visible') {
                this.lastFrame = -Infinity;
                return;
            }
            this.release();
            this.updateKeys(new Set());
            if (arcade.snapshot().playing) arcade.pause();
        };
        this.end = () => queueMicrotask(() => this.dispose());
        session.addEventListener('visibilitychange', this.visibilityChanged);
        session.addEventListener('end', this.end, { once: true });
    }

    async start() {
        await this.renderer.xr.setSession(this.session);
        if (this.disposed) return;
        this.arcade.setImmersive(true);
        this.renderer.setAnimationLoop((time, frame) => this.frame(time, frame));
    }

    layout() {
        const gameAspect = Math.max(1, this.arcade.g.w) / Math.max(1, this.arcade.g.h);
        const gameHeight = Math.max(1, Math.min(MAX_GAME_HEIGHT, Math.round(WIDTH / gameAspect)));
        const gameWidth = Math.max(1, Math.min(WIDTH, Math.round(gameHeight * gameAspect)));
        return { x: (WIDTH - gameWidth) / 2, y: HEADER + (MAX_GAME_HEIGHT - gameHeight) / 2, width: gameWidth, height: gameHeight };
    }

    center(frame) {
        const reference = this.renderer.xr.getReferenceSpace();
        const pose = reference && frame?.getViewerPose(reference);
        if (!pose) return;
        const { orientation, position } = pose.transform;
        const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().copy(orientation), 'YXZ').y;
        this.screen.rotation.set(0, yaw, 0, 'YXZ');
        this.screen.position.copy(position).addScaledVector(
            new THREE.Vector3(0, 0, -1).applyQuaternion(this.screen.quaternion), 2.45
        );
        this.screen.visible = true;
        this.screen.updateWorldMatrix(true, false);
        this.needsCenter = false;
    }

    hit(controller) {
        if (!controller?.visible || !this.screen.visible) return null;
        controller.updateWorldMatrix(true, false);
        this.ray.setFromXRController(controller);
        const hit = this.ray.intersectObject(this.screen, false)[0];
        if (!hit) return null;
        return { x: hit.uv.x * WIDTH, y: (1 - hit.uv.y) * HEIGHT, point: hit.point };
    }

    gameCoordinates(hit) {
        if (!hit) return null;
        const { x, y, width, height } = this.layout();
        const u = (hit.x - x) / width, v = (hit.y - y) / height;
        return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? { u, v } : null;
    }

    pointer(type, coords, down = false) {
        const canvas = this.arcade.canvas;
        const rect = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new PointerEvent(type, {
            bubbles: true, pointerType: 'mouse', isPrimary: true, pointerId: 1,
            button: type === 'pointermove' ? -1 : 0, buttons: down ? 1 : 0,
            clientX: rect.left + rect.width * coords.u, clientY: rect.top + rect.height * coords.v
        }));
    }

    release() {
        if (!this.drag) return;
        this.pointer('pointerup', this.drag.coords);
        this.drag = null;
    }

    select(controller) {
        if (this.session.visibilityState !== 'visible' || this.drag) return;
        const hit = this.hit(controller);
        if (!hit) return;
        const button = this.actionAt(hit);
        if (button === 'play') {
            const state = this.arcade.snapshot();
            if (state.playing || state.paused) this.arcade.pause();
            else this.arcade.start();
            return;
        }
        if (button === 'mute') { this.arcade.mute(); return; }
        if (button === 'recenter') { this.needsCenter = true; return; }
        if (button === 'exit') { this.session.end().catch(() => {}); return; }
        const coords = this.gameCoordinates(hit);
        if (!coords || !this.arcade.snapshot().playing) return;
        this.drag = { controller, coords };
        this.pointer('pointerdown', coords, true);
    }

    actionAt(hit) {
        if (!hit) return null;
        const top = HEIGHT - FOOTER + 11;
        if (hit.y < top || hit.y > top + 48) return null;
        const i = Math.floor((hit.x - 28) / 309);
        return i >= 0 && i < ACTIONS.length && hit.x - (28 + i * 309) <= 296 ? ACTIONS[i] : null;
    }

    updateKeys(next) {
        for (const code of this.keyboard) {
            if (!next.has(code)) window.dispatchEvent(new KeyboardEvent('keyup', { code, cancelable: true }));
        }
        for (const code of next) {
            if (!this.keyboard.has(code)) window.dispatchEvent(new KeyboardEvent('keydown', { code, cancelable: true }));
        }
        this.keyboard = next;
    }

    frame(time, frame) {
        if (this.disposed || this.session.visibilityState === 'hidden') return;
        if (this.needsCenter) this.center(frame);
        const layout = this.layout();
        this.screen.scale.y = 2.35 * HEIGHT / WIDTH;
        this.screen.updateWorldMatrix(true, false);
        if (this.session.visibilityState === 'visible') {
            const [first, second] = this.controllers;
            const preferred = first.userData.source?.handedness === 'right' ? first : second;
            const other = preferred === first ? second : first;
            this.target = this.drag ? this.hit(this.drag.controller) : this.hit(preferred) || this.hit(other);
            const coords = this.gameCoordinates(this.target);
            if (coords) {
                if (this.drag) this.drag.coords = coords;
                this.pointer('pointermove', coords, Boolean(this.drag));
            }
            this.updateKeys(this.arcade.isPaused() ? new Set() : arcadeKeys(this.session.inputSources, this.arcade.cfg.slug));
        } else this.target = null;
        this.cursor.visible = Boolean(this.target);
        if (this.target) {
            this.cursor.position.copy(this.target.point).addScaledVector(
                new THREE.Vector3(0, 0, 1).applyQuaternion(this.screen.quaternion), 0.004
            );
            this.cursor.quaternion.copy(this.screen.quaternion);
        }
        // Keep headset tracking at the native refresh rate. Canvas work and
        // texture uploads run at a lower rate than tracking on mobile GPUs.
        if (time - this.lastFrame >= 22) {
            this.lastFrame = time;
            this.arcade.xrFrame(time);
            this.paint(layout);
        }
        this.renderer.render(this.scene, this.camera);
    }

    paint(layout) {
        const c = this.ctx;
        const s = this.arcade.snapshot();
        c.fillStyle = '#0f1b30';
        c.fillRect(0, 0, WIDTH, HEIGHT);
        c.drawImage(this.arcade.canvas, layout.x, layout.y, layout.width, layout.height);
        c.fillStyle = '#f2f7ff';
        c.font = 'bold 30px system-ui';
        c.fillText(this.arcade.cfg.title, 28, 43, 615);
        c.textAlign = 'right';
        c.fillText('SCORE ' + s.score.toLocaleString() + '   ·   BEST ' + s.best.toLocaleString(), WIDTH - 28, 43, 570);
        c.textAlign = 'left';
        c.font = '600 22px system-ui';
        if (s.playing && s.stats) {
            const lines = s.stats.trim().split(/\n+/).slice(0, 5);
            c.fillStyle = 'rgba(5, 12, 24, 0.84)';
            c.fillRect(layout.x + 10, layout.y + 10, Math.min(580, layout.width - 20), lines.length * 27 + 14);
            c.fillStyle = '#e2efff';
            lines.forEach((line, i) => c.fillText(line, layout.x + 20, layout.y + 36 + i * 27, Math.min(550, layout.width - 40)));
        } else if (!s.playing) {
            const y = layout.y + layout.height / 2;
            c.fillStyle = 'rgba(5, 12, 24, 0.9)';
            c.fillRect(110, y - 78, WIDTH - 220, 156);
            c.textAlign = 'center';
            c.font = 'bold 34px system-ui';
            c.fillStyle = '#9bfce7';
            c.fillText(s.paused ? 'Game paused' : s.finished ? 'Run complete' : 'Ready to play', WIDTH / 2, y - 20);
            c.font = '24px system-ui';
            c.fillStyle = '#f2f7ff';
            c.fillText(s.finished ? s.result : 'Point at the controls below and pull the trigger.', WIDTH / 2, y + 19, 1000);
            if (s.finished && s.medal) c.fillText(s.medal, WIDTH / 2, y + 53, 1000);
            c.textAlign = 'left';
        }
        const labels = [s.playing ? 'Pause' : s.paused ? 'Resume' : s.finished ? 'Play again' : 'Play',
            s.muted ? 'Unmute' : 'Mute', 'Recenter screen', 'Exit headset VR'];
        const hover = this.actionAt(this.target);
        const y = HEIGHT - FOOTER + 11;
        c.font = 'bold 25px system-ui';
        c.textAlign = 'center';
        ACTIONS.forEach((action, i) => {
            const x = 28 + i * 309;
            c.fillStyle = action === hover ? '#adebe0' : '#203858';
            c.fillRect(x, y, 296, 48);
            c.fillStyle = action === hover ? '#061424' : '#f2f7ff';
            c.fillText(labels[i], x + 148, y + 32);
        });
        c.font = '22px system-ui';
        c.fillStyle = '#b5cde8';
        c.fillText('Trigger: point / drag · Left stick: move · A: action · Grip: pause' +
            (this.shortcutHint ? '  |  ' + this.shortcutHint : ''), WIDTH / 2, HEIGHT - 19, WIDTH - 56);
        c.textAlign = 'left';
        this.texture.needsUpdate = true;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.session.removeEventListener('end', this.end);
        this.session.removeEventListener('visibilitychange', this.visibilityChanged);
        this.release();
        this.updateKeys(new Set());
        if (this.arcade.snapshot().playing) this.arcade.pause();
        this.arcade.setImmersive(false);
        this.renderer.setAnimationLoop(null);
        this.texture.dispose();
        this.scene.traverse(obj => {
            obj.geometry?.dispose();
            obj.material?.dispose();
        });
        this.renderer.dispose();
        this.onEnd();
    }
}
