/** Keep only a visible Phone VR session awake; never override OS power policy. */
export class ScreenAwake {
    constructor({ onChange = () => {}, doc = document, nav = navigator, win = window } = {}) {
        this.doc = doc;
        this.nav = nav;
        this.win = win;
        this.onChange = onChange;
        this.enabled = false;
        this.pageActive = true;
        this.lock = null;
        this.pending = null;
        this.generation = 0;
        doc.addEventListener('visibilitychange', () => {
            if (doc.visibilityState === 'visible') this.request();
            else this.suspend();
        });
        win.addEventListener('pagehide', () => { this.pageActive = false; this.suspend(); });
        win.addEventListener('pageshow', () => { this.pageActive = true; this.request(); });
    }
    start() {
        this.enabled = true;
        return this.request();
    }
    stop() {
        this.enabled = false;
        this.suspend();
        this.onChange('off', 'Screen awake is off');
    }
    suspend() {
        this.generation++;
        const lock = this.lock;
        this.lock = null;
        if (lock) this.release(lock);
    }
    async release(lock) {
        try { await lock.release(); } catch (_) { /* already released by OS */ }
    }
    request() {
        if (!this.enabled || !this.pageActive || this.doc.visibilityState !== 'visible') return Promise.resolve();
        if (this.lock && !this.lock.released) return Promise.resolve();
        if (this.pending) return this.pending;
        if (!this.win.isSecureContext) {
            this.onChange('unavailable', 'Screen may sleep — trusted HTTPS required');
            return Promise.resolve();
        }
        if (!this.nav.wakeLock?.request) {
            this.onChange('unavailable', 'Screen may sleep — wake lock unavailable in this browser');
            return Promise.resolve();
        }
        const generation = this.generation;
        this.onChange('requesting', 'Keeping screen awake…');
        // Serialize requests, including a hide/exit while permission is pending.
        this.pending = Promise.resolve().then(() => this.nav.wakeLock.request('screen'))
            .then(async lock => {
                if (!this.enabled || !this.pageActive || this.doc.visibilityState !== 'visible' || generation !== this.generation) {
                    await this.release(lock);
                    return;
                }
                this.lock = lock;
                lock.addEventListener('release', () => {
                    if (this.lock !== lock) return;
                    this.lock = null;
                    if (this.enabled && this.doc.visibilityState === 'visible') {
                        this.onChange('unavailable', 'Screen may sleep — phone released wake lock; tap to retry');
                    }
                });
                this.onChange(lock.released ? 'unavailable' : 'awake',
                    lock.released ? 'Screen may sleep — tap to retry' : 'Screen awake');
            })
            .catch(() => {
                if (this.enabled && this.doc.visibilityState === 'visible' && generation === this.generation) {
                    this.onChange('unavailable', 'Screen may sleep — check power saving/browser permission; tap to retry');
                }
            })
            .finally(() => {
                this.pending = null;
                // Retry a stale request after returning/re-entering, not after
                // an OS denial. This avoids battery-draining retry loops.
                if (generation !== this.generation) this.request();
            });
        return this.pending;
    }
}
