/** Fail visibly if XR setup stalls or the render callback throws before returning
 * to Three's scheduler. Flat-screen and phone rendering stay out of this path. */
export function guardXRFrames(onFailure, timeoutMs = 12000) {
    let stopped = false;
    const timer = setTimeout(() => fail(new Error('The headset did not provide a usable VR frame.')), timeoutMs);

    function stop() {
        stopped = true;
        clearTimeout(timer);
    }

    function fail(error) {
        if (stopped) return;
        stop();
        onFailure(error);
    }

    return {
        stop,
        fail,
        render(draw) {
            if (stopped) return;
            try {
                if (draw()) clearTimeout(timer);
            } catch (error) {
                fail(error);
            }
        }
    };
}
