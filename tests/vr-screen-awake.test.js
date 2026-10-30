let ScreenAwake;
beforeAll(async () => ({ ScreenAwake } = await import('../public/js/vr/screen-awake.js')));

function sentinel() {
    const lock = new EventTarget();
    lock.released = false;
    lock.release = vi.fn(async () => {
        lock.released = true;
        lock.dispatchEvent(new Event('release'));
    });
    return lock;
}
async function flush() { for (let i = 0; i < 25; i++) await Promise.resolve(); }

describe('Phone VR screen awake lifecycle', () => {
    let doc, win, nav, states, awake, locks;
    beforeEach(() => {
        doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
        win = Object.assign(new EventTarget(), { isSecureContext: true });
        locks = [];
        nav = { wakeLock: { request: vi.fn(async () => {
            const lock = sentinel(); locks.push(lock); return lock;
        }) } };
        states = vi.fn();
        awake = new ScreenAwake({ doc, win, nav, onChange: states });
    });
    it('acquires one screen lock and releases it when Phone VR exits', async () => {
        await awake.start();
        await awake.start();
        expect(nav.wakeLock.request).toHaveBeenCalledExactlyOnceWith('screen');
        expect(states).toHaveBeenLastCalledWith('awake', 'Screen awake');
        awake.stop();
        expect(locks[0].release).toHaveBeenCalledOnce();
        expect(awake.lock).toBeNull();
        expect(states).toHaveBeenLastCalledWith('off', 'Screen awake is off');
    });
    it('suspends when hidden and reacquires when returning to VR', async () => {
        await awake.start();
        doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
        expect(locks[0].released).toBe(true);
        doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange'));
        await flush();
        expect(nav.wakeLock.request).toHaveBeenCalledTimes(2);
        expect(awake.lock).toBe(locks[1]);
    });
    it('does not acquire in a background tab or after exiting VR', async () => {
        doc.visibilityState = 'hidden';
        await awake.start();
        expect(nav.wakeLock.request).not.toHaveBeenCalled();
        awake.stop();
        doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange'));
        win.dispatchEvent(new Event('pageshow'));
        await flush();
        expect(nav.wakeLock.request).not.toHaveBeenCalled();
    });
    it('releases for page navigation and restores on back-forward cache return', async () => {
        await awake.start();
        win.dispatchEvent(new Event('pagehide'));
        expect(locks[0].released).toBe(true);
        win.dispatchEvent(new Event('pageshow'));
        await flush();
        expect(awake.lock).toBe(locks[1]);
    });
    it('explains insecure HTTP without attempting restricted API access', async () => {
        win.isSecureContext = false;
        await awake.start();
        expect(nav.wakeLock.request).not.toHaveBeenCalled();
        expect(states).toHaveBeenLastCalledWith('unavailable', expect.stringContaining('HTTPS'));
    });
    it('handles browsers without the API', async () => {
        delete nav.wakeLock;
        await awake.start();
        expect(states).toHaveBeenLastCalledWith('unavailable', expect.stringContaining('unavailable'));
    });
    it('handles denial without a retry loop, but permits an explicit retry', async () => {
        nav.wakeLock.request.mockRejectedValueOnce(new Error('NotAllowedError'));
        await awake.start(); await flush();
        expect(nav.wakeLock.request).toHaveBeenCalledOnce();
        expect(states).toHaveBeenLastCalledWith('unavailable', expect.stringContaining('power saving'));
        await awake.request();
        expect(awake.lock).toBe(locks[0]);
    });
    it('reports OS revocation without claiming the screen is still awake', async () => {
        await awake.start();
        await locks[0].release(); await flush();
        expect(awake.lock).toBeNull();
        expect(states).toHaveBeenLastCalledWith('unavailable', expect.stringContaining('released wake lock'));
        expect(nav.wakeLock.request).toHaveBeenCalledOnce();
    });
    it('releases a pending grant arriving after exit and never revives it', async () => {
        let resolve;
        nav.wakeLock.request.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
        const request = awake.start();
        expect(awake.request()).toBe(request);
        await flush();
        awake.stop();
        const lateLock = sentinel(); resolve(lateLock);
        await request; await flush();
        expect(lateLock.released).toBe(true);
        expect(awake.lock).toBeNull();
        expect(nav.wakeLock.request).toHaveBeenCalledOnce();
        expect(states).toHaveBeenLastCalledWith('off', 'Screen awake is off');
    });
    it('reacquires safely if hide/show races with a pending permission request', async () => {
        let resolve;
        nav.wakeLock.request.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
        const request = awake.start(); await flush();
        doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
        doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange'));
        const stale = sentinel(); resolve(stale);
        await request; await flush();
        expect(stale.released).toBe(true);
        expect(nav.wakeLock.request).toHaveBeenCalledTimes(2);
        expect(awake.lock).toBe(locks[0]);
    });
    it('reacquires safely if exiting and re-entering races with a pending request', async () => {
        let resolve;
        nav.wakeLock.request.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
        const request = awake.start(); await flush();
        awake.stop(); awake.start();
        const stale = sentinel(); resolve(stale);
        await request; await flush();
        expect(stale.released).toBe(true);
        expect(awake.lock).toBe(locks[0]);
        expect(nav.wakeLock.request).toHaveBeenCalledTimes(2);
    });
    it('ignores a late rejection after exit', async () => {
        let reject;
        nav.wakeLock.request.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
        const request = awake.start(); await flush();
        awake.stop(); reject(new Error('Denied'));
        await request;
        expect(states).toHaveBeenLastCalledWith('off', 'Screen awake is off');
    });
    it('does not reacquire during navigation before visibility has changed', async () => {
        let resolve;
        nav.wakeLock.request.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
        const request = awake.start(); await flush();
        win.dispatchEvent(new Event('pagehide'));
        const stale = sentinel(); resolve(stale);
        await request; await flush();
        expect(stale.released).toBe(true);
        expect(nav.wakeLock.request).toHaveBeenCalledOnce();
        win.dispatchEvent(new Event('pageshow')); await flush();
        expect(nav.wakeLock.request).toHaveBeenCalledTimes(2);
    });
});
