import { readThumbstick } from '../vr/xr-support.js?v=20261125-xr1';

const SHORTCUTS = {
    'asteroid-miner': { B: ['ShiftLeft', 'Grab'] },
    'kessler-reversed': { B: ['ShiftLeft', 'Shunt'] },
    'last-station': { B: ['ShiftLeft', 'EMP'] },
    'orbit-weaver': { B: ['Backspace', 'Undo'] },
    'planet-defense': { X: ['Digit1', 'Laser'], Y: ['Digit2', 'Gravity well'], B: ['Digit3', 'Flak'] },
    'slingshot-golf': { B: ['KeyR', 'Recall'] },
    'solar-sailor': { B: ['ShiftLeft', 'Brake'] }
};

export function arcadeShortcuts(slug) {
    return Object.entries(SHORTCUTS[slug] || {}).map(([button, [, name]]) => button + ' ' + name).join(' · ');
}

export function arcadeKeys(sources, slug) {
    const keys = new Set();
    const shortcuts = SHORTCUTS[slug] || {};
    for (const { handedness, gamepad } of sources) {
        if (!gamepad) continue;
        const pressed = index => gamepad.buttons?.[index]?.pressed;
        if (handedness === 'left' || handedness === 'none') {
            const { x, y } = readThumbstick(gamepad);
            if (x < -0.4) keys.add('ArrowLeft');
            if (x > 0.4) keys.add('ArrowRight');
            if (y < -0.4) keys.add('ArrowUp');
            if (y > 0.4) keys.add('ArrowDown');
        }
        if (handedness === 'right' && pressed(4)) keys.add('Space');
        const auxiliary = handedness === 'right' ? [[5, 'B']] : [[4, 'X'], [5, 'Y']];
        for (const [index, name] of auxiliary) {
            if (pressed(index) && shortcuts[name]) keys.add(shortcuts[name][0]);
        }
    }
    return keys;
}
