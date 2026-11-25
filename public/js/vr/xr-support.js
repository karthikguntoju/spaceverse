export async function immersiveVRStatus(xr, secure) {
    if (!secure) return { label: 'Headset VR needs HTTPS', available: false };
    if (!xr) return { label: 'Headset VR unavailable in this browser', available: false };
    try {
        const available = await xr.isSessionSupported('immersive-vr');
        return { label: available ? 'Enter headset VR' : 'No compatible headset detected', available };
    } catch {
        // Some runtimes refuse capability polling but accept an explicit request.
        return { label: 'Try headset VR', available: typeof xr.requestSession === 'function' };
    }
}

export function readThumbstick(gamepad, deadzone = 0.18) {
    // xr-standard reserves axes 0/1 for the touchpad and 2/3 for the stick.
    // Accept the two-axis layout some nonstandard controllers expose.
    const axes = gamepad?.axes;
    const offset = axes?.length >= 4 ? 2 : 0;
    let x = axes?.[offset] || 0;
    let y = axes?.[offset + 1] || 0;
    if (Math.hypot(x, y) < deadzone) return { x: 0, y: 0 };
    return { x, y };
}
