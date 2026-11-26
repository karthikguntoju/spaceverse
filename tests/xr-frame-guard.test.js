let guardXRFrames;
beforeAll(async () => {
    ({ guardXRFrames } = await import('../public/js/vr/xr-frame-guard.js'));
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('exits a session that never reaches a usable headset frame', () => {
    const report = vi.fn();
    const guard = guardXRFrames(report, 100);
    guard.render(() => false);
    vi.advanceTimersByTime(100);
    expect(report).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: expect.stringContaining('usable VR frame') }));
    const lateFrame = vi.fn();
    guard.render(lateFrame);
    expect(lateFrame).not.toHaveBeenCalled();
});

it('lets a valid first frame clear startup and reports later render errors', () => {
    const report = vi.fn();
    const guard = guardXRFrames(report, 100);
    guard.render(() => true);
    vi.advanceTimersByTime(200);
    expect(report).not.toHaveBeenCalled();
    const error = new Error('XR framebuffer lost');
    expect(() => guard.render(() => { throw error; })).not.toThrow();
    expect(report).toHaveBeenCalledExactlyOnceWith(error);
    guard.fail(new Error('duplicate'));
    expect(report).toHaveBeenCalledOnce();
});

it('does not report a black screen after the user leaves VR normally', () => {
    const report = vi.fn();
    guardXRFrames(report, 100).stop();
    vi.advanceTimersByTime(100);
    expect(report).not.toHaveBeenCalled();
});
