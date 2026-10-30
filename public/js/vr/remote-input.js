/** Bluetooth HID inputs, separate from tracked WebXR controllers. No Bluetooth permissions needed. */
export const REMOTE_ACTIONS = {
    primary: 'Fly / stop · Ride pause / resume', scan: 'Scan the world at the centre',
    recenter: 'Recentre view', menu: 'Return to menu',
    forward: 'Forward while held / scrolling', backward: 'Backward while held / scrolling',
    left: 'Left while held', right: 'Right while held'
};
const MOVEMENT = new Set(['forward', 'backward', 'left', 'right']);
const STORAGE = 'spaceverse.remote.v1';
const validToken = token => typeof token === 'string' && token.length <= 512 &&
    /^(key:.+|mouse:[0-4]|wheel:(up|down|left|right)|pad:.+:(button:\d+|axis:\d+:[+-]))$/.test(token);

export function inputLabel(token) {
    if (!token) return 'Not assigned';
    if (token.startsWith('pad:')) return 'Gamepad ' + token.slice(token.lastIndexOf(':button:') > -1
        ? token.lastIndexOf(':button:') + 1 : token.lastIndexOf(':axis:') + 1).replaceAll(':', ' ');
    return token.replace(':', ' ');
}

/** Small, renderer-independent state machine: one action per input; holds never retrigger toggles. */
export class RemoteBindings {
    constructor(saved = {}, onAction = () => {}) {
        this.map = {};
        this.held = new Map();
        this.cooldowns = new Map();
        this.onAction = onAction;
        for (const action of Object.keys(REMOTE_ACTIONS)) {
            if (validToken(saved?.[action])) this.assign(action, saved[action]);
        }
    }
    assign(action, token) {
        if (!Object.hasOwn(REMOTE_ACTIONS, action) || !validToken(token)) return false;
        for (const key of Object.keys(this.map)) if (this.map[key] === token) delete this.map[key];
        this.map[action] = token;
        this.releaseAll();
        return true;
    }
    actionFor(token) { return Object.keys(this.map).find(action => this.map[action] === token); }
    press(token, now, pulse = false, dispatch = true) {
        const action = this.actionFor(token);
        if (!action) return false;
        const wasHeld = this.held.has(token);
        this.held.set(token, pulse ? now + 180 : Infinity);
        if (!dispatch) return true;
        if (MOVEMENT.has(action)) return true;
        if ((!wasHeld || pulse) && now >= (this.cooldowns.get(action) || 0)) {
            this.cooldowns.set(action, now + 600);
            this.onAction(action);
        }
        return true;
    }
    release(token) { this.held.delete(token); }
    releaseAll() { this.held.clear(); }
    movement(now) {
        const result = { x: 0, z: 0 };
        for (const [token, until] of this.held) {
            if (now >= until) { this.held.delete(token); continue; }
            const action = this.actionFor(token);
            if (action === 'forward') result.z -= 1;
            if (action === 'backward') result.z += 1;
            if (action === 'left') result.x -= 1;
            if (action === 'right') result.x += 1;
        }
        return result;
    }
}

export class RemoteInput {
    constructor({ canvas, onAction, active, onSuspend }) {
        this.canvas = canvas;
        this.active = active;
        this.onSuspend = onSuspend;
        this.dialog = document.getElementById('remote-dialog');
        this.pad = document.getElementById('remote-test-pad');
        this.log = document.getElementById('remote-log');
        this.status = document.getElementById('remote-status');
        this.gamepads = document.getElementById('remote-gamepads');
        this.learning = null;
        this.previous = new Set();
        this.blockedKeys = new Set();
        this.blockedMouse = new Set();
        this.events = [];
        this.counts = { key: 0, mouse: 0, wheel: 0, pad: 0 };
        let saved;
        try { saved = JSON.parse(localStorage.getItem(STORAGE) || '{}'); } catch { /* private mode or corrupt settings */ }
        this.bindings = new RemoteBindings(saved, onAction);
        this.buildRows();
        document.getElementById('btn-remote').onclick = () => this.open();
        document.getElementById('remote-close').onclick = () => this.dialog.close();
        document.getElementById('remote-cancel').onclick = () => this.cancelLearning();
        document.getElementById('remote-reset').onclick = () => {
            this.bindings.map = {}; this.bindings.releaseAll(); this.cancelLearning(); this.save(); this.refreshRows();
        };
        document.getElementById('remote-scroll-preset').onclick = () => {
            this.cancelLearning();
            this.bindings.assign('forward', 'wheel:up');
            this.bindings.assign('backward', 'wheel:down');
            this.save(); this.refreshRows();
            this.status.textContent = 'Scroll assigned: up = forward, down = backward. Movement stops when scrolling stops.';
        };
        this.dialog.addEventListener('close', () => { this.cancelLearning(); this.suspend(); });
        // Capture only the test pad or actual experience, never text entered in other UI.
        window.addEventListener('keydown', e => this.keyDown(e), true);
        window.addEventListener('keyup', e => {
            const token = this.keyToken(e);
            this.bindings.release(token);
            if (this.blockedKeys.delete(token)) this.consume(e);
        }, true);
        window.addEventListener('mousedown', e => {
            if (!this.isSurface(e.target) || e.sourceCapabilities?.firesTouchEvents) return;
            const token = `mouse:${e.button}`;
            if (this.receive(token, false, false)) { this.blockedMouse.add(e.button); this.consume(e); }
        }, true);
        window.addEventListener('mouseup', e => {
            this.bindings.release(`mouse:${e.button}`);
            if (this.blockedMouse.has(e.button)) this.consume(e);
        }, true);
        window.addEventListener('click', e => {
            if (this.blockedMouse.delete(e.button)) this.consume(e);
        }, true);
        window.addEventListener('contextmenu', e => {
            if (this.isSurface(e.target) && (this.dialog.open || this.bindings.actionFor('mouse:2'))) this.consume(e);
        }, true);
        window.addEventListener('wheel', e => {
            if (!this.isSurface(e.target) || (!e.deltaX && !e.deltaY)) return;
            const direction = Math.abs(e.deltaY) >= Math.abs(e.deltaX)
                ? (e.deltaY < 0 ? 'up' : 'down') : (e.deltaX < 0 ? 'left' : 'right');
            if (this.receive(`wheel:${direction}`, true, false)) this.consume(e);
        }, { capture: true, passive: false });
        this.pad.addEventListener('mousemove', () => {
            const now = performance.now();
            if (now - (this.lastMove || 0) > 500) {
                this.lastMove = now;
                this.record('mouse', 'Pointer movement detected (not assignable)');
            }
        });
        window.addEventListener('blur', () => { this.blurred = true; this.suspend(); });
        window.addEventListener('focus', () => { this.blurred = false; });
        document.addEventListener('visibilitychange', () => { if (document.hidden) this.suspend(); });
    }
    keyToken(e) { return `key:${e.code || e.key}`; }
    consume(e) { if (e.cancelable) e.preventDefault(); e.stopImmediatePropagation(); }
    isSurface(target) {
        return this.dialog.open ? this.pad.contains(target) : this.active() && target === this.canvas;
    }
    keyDown(e) {
        if (e.key === 'Escape' && this.dialog.open) { this.dialog.close(); this.consume(e); return; }
        const control = e.target.closest?.('input,textarea,select,button,a,[contenteditable="true"]');
        if (this.dialog.open ? !this.pad.contains(e.target) :
            !this.active() || (control && control.getClientRects().length)) return;
        const token = this.keyToken(e);
        if (this.receive(token, false, e.repeat)) { this.blockedKeys.add(token); this.consume(e); }
    }
    receive(token, pulse = false, repeat = false) {
        const testing = this.dialog.open;
        if (testing && !repeat) this.record(token.split(':')[0], inputLabel(token));
        if (testing) {
            if (this.learning && !repeat) {
                const action = this.learning;
                this.bindings.assign(action, token);
                const saved = this.save(); this.cancelLearning(); this.refreshRows();
                this.status.textContent = `${REMOTE_ACTIONS[action]} assigned to ${inputLabel(token)}. Close this panel to try it.`
                    + (saved ? '' : ' Saving is blocked: this mapping lasts for this visit only.');
            }
            return true; // testing/learning must never move the ship or run shortcuts
        }
        if (!this.active()) return false;
        return this.bindings.press(token, performance.now(), pulse);
    }
    record(kind, message) {
        this.counts[kind]++;
        this.events.unshift(message);
        this.events.length = Math.min(12, this.events.length);
        this.log.textContent = this.events.join('\n');
        document.getElementById('remote-counts').textContent =
            `Detected — keys: ${this.counts.key} · mouse: ${this.counts.mouse} · scroll: ${this.counts.wheel} · gamepad: ${this.counts.pad}`;
    }
    save() {
        try { localStorage.setItem(STORAGE, JSON.stringify(this.bindings.map)); return true; }
        catch { this.status.textContent = 'Mappings work for this visit, but this browser could not save them.'; return false; }
    }
    buildRows() {
        const rows = document.getElementById('remote-mappings');
        this.labels = {};
        for (const [action, title] of Object.entries(REMOTE_ACTIONS)) {
            const row = document.createElement('div'); row.className = 'remote-row';
            const text = document.createElement('div');
            const name = document.createElement('strong'); name.textContent = title;
            const label = document.createElement('small'); this.labels[action] = label;
            text.append(name, label);
            const learn = document.createElement('button'); learn.className = 'chip'; learn.textContent = 'Assign';
            learn.setAttribute('aria-label', `Assign ${title}`);
            learn.dataset.remoteAction = action;
            learn.onclick = () => {
                this.cancelLearning(); this.learning = action; this.bindings.releaseAll();
                this.status.textContent = `Waiting for ${title}: press a remote button, move its stick or scroll over the test area. (15 seconds)`;
                document.getElementById('remote-cancel').hidden = false;
                this.pad.focus();
                this.learnTimer = setTimeout(() => {
                    this.cancelLearning();
                    this.status.textContent = 'No input received for assignment. Try another remote mode; Bluetooth pairing alone is not enough.';
                }, 15000);
            };
            const clear = document.createElement('button'); clear.className = 'chip ghost'; clear.textContent = 'Clear';
            clear.setAttribute('aria-label', `Clear ${title}`);
            clear.onclick = () => { this.cancelLearning(); delete this.bindings.map[action]; this.bindings.releaseAll(); this.save(); this.refreshRows(); };
            row.append(text, learn, clear); rows.append(row);
        }
        this.refreshRows();
    }
    refreshRows() {
        for (const [action, label] of Object.entries(this.labels)) label.textContent = inputLabel(this.bindings.map[action]);
    }
    cancelLearning() {
        clearTimeout(this.learnTimer); this.learning = null;
        document.getElementById('remote-cancel').hidden = true;
    }
    suspend() {
        this.bindings.releaseAll(); this.blockedKeys.clear(); this.blockedMouse.clear();
        this.onSuspend();
    }
    open() {
        this.suspend(); this.dialog.showModal(); this.pad.focus();
        this.status.textContent = 'Test first: use the joystick, A and trigger. Inputs appear below only if the browser receives them.';
    }
    update() {
        // Tracked WebXR sources remain owned by VRApp; do not double-handle them.
        if (this.blurred || document.hidden || (!this.dialog.open && !this.active())) { this.bindings.releaseAll(); return; }
        let pads = [];
        try { pads = Array.from(navigator.getGamepads?.() || []).filter(Boolean); } catch { /* insecure/blocked API */ }
        const description = pads.length
            ? `Browser gamepads: ${pads.map(p => p.id).join(', ')}. Connected does not mean a button was received.`
            : 'No browser gamepad exposed. Your remote may still send keyboard, mouse or scroll events.';
        if (this.dialog.open && this.gamepads.textContent !== description) this.gamepads.textContent = description;
        const current = new Set();
        for (const pad of pads) {
            const prefix = `pad:${encodeURIComponent(pad.id).slice(0, 380)}`;
            pad.buttons.forEach((button, i) => { if (button.pressed || button.value > 0.55) current.add(`${prefix}:button:${i}`); });
            pad.axes.forEach((value, i) => {
                for (const sign of ['+', '-']) {
                    const token = `${prefix}:axis:${i}:${sign}`;
                    // Hysteresis prevents stick jitter from repeating toggle actions.
                    if (value * (sign === '+' ? 1 : -1) > (this.previous.has(token) ? 0.3 : 0.65)) current.add(token);
                }
            });
        }
        for (const token of this.previous) if (!current.has(token)) this.bindings.release(token);
        for (const token of current) if (!this.previous.has(token)) this.receive(token);
        this.previous = current;
    }
    movement() { return this.dialog.open ? { x: 0, z: 0 } : this.bindings.movement(performance.now()); }
}
