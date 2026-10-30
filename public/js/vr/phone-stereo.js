import { Color, PerspectiveCamera, StereoCamera, Vector2, Vector4 } from 'three';

export const PHONE_UI_LAYER = 3;
const originalLayers = new WeakMap();

export function normalizeViewerSettings(settings = {}) {
    const bounded = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
    return {
        spacing: bounded(settings?.spacing, 0.44, 0.34, 0.5),
        size: bounded(settings?.size, 0.96, 0.6, 0.98),
        shape: settings?.shape === 'circle' ? 'circle' : 'wide'
    };
}

/** Pixel-based optical layout, not physical millimetres or an Irusu lens profile. */
export function phoneEyeLayout(width, height, settings) {
    const { spacing, size, shape } = normalizeViewerSettings(settings);
    const separation = width * spacing;
    const diameter = Math.max(1, Math.min(height * size, separation - width * 0.02, width - separation - width * 0.04));
    const top = (height - diameter) / 2;
    return [-1, 1].map(side => ({
        x: (width + side * separation - diameter) / 2,
        y: shape === 'circle' ? top : height * (1 - size) / 2,
        width: diameter, height: shape === 'circle' ? diameter : height * size
    }));
}

/** Black surround with two circular apertures; coordinates share the render layout. */
export function phoneLensMask(width, height, eyes, settings) {
    let path = `M0 0H${width}V${height}H0Z`;
    for (const eye of eyes) {
        if (normalizeViewerSettings(settings).shape === 'wide') {
            const { x, y, width: w, height: h } = eye;
            const r = Math.min(w, h) * 0.12, right = x + w, bottom = y + h;
            path += ` M${x + r} ${y}H${right - r}Q${right} ${y} ${right} ${y + r}V${bottom - r}Q${right} ${bottom} ${right - r} ${bottom}H${x + r}Q${x} ${bottom} ${x} ${bottom - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
            continue;
        }
        const r = eye.width / 2, x = eye.x + r, y = eye.y + r;
        path += ` M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
    }
    return path;
}

/** Keep the same meshes/raycast targets; restore their layers on leaving Phone VR. */
export function setPhoneUILayer(root, enabled) {
    root.traverse(object => {
        if (enabled) {
            if (!originalLayers.has(object)) originalLayers.set(object, object.layers.mask);
            object.layers.set(PHONE_UI_LAYER);
        } else if (originalLayers.has(object)) {
            object.layers.mask = originalLayers.get(object);
            originalLayers.delete(object);
        }
    });
}

/** Stereo world, with a matching zero-disparity interface in each eye. */
export class PhoneStereoEffect {
    constructor(renderer) {
        this.renderer = renderer;
        this.world = new StereoCamera();
        this.worldCamera = new PerspectiveCamera();
        this.uiCamera = new PerspectiveCamera();
        this.settings = normalizeViewerSettings();
        this.size = new Vector2();
        this.viewport = new Vector4();
        this.scissor = new Vector4();
        this.clearColor = new Color();
    }
    setSize(width, height) { this.renderer.setSize(width, height); }
    setViewerSettings(settings) { this.settings = normalizeViewerSettings(settings); }
    layout(width, height) { return phoneEyeLayout(width, height, this.settings); }
    render(scene, camera) {
        const renderer = this.renderer;
        const autoClear = renderer.autoClear;
        const scissorTest = renderer.getScissorTest();
        const background = scene.background;
        const clearAlpha = renderer.getClearAlpha();
        renderer.getClearColor(this.clearColor);
        renderer.getViewport(this.viewport);
        renderer.getScissor(this.scissor);
        try {
            renderer.getSize(this.size);
            const eyes = this.layout(this.size.x, this.size.y);
            if (scene.matrixWorldAutoUpdate) scene.updateMatrixWorld();
            if (!camera.parent && camera.matrixWorldAutoUpdate) camera.updateMatrixWorld();
            const worldCamera = this.worldCamera;
            worldCamera.copy(camera, false);
            worldCamera.aspect = eyes[0].width / eyes[0].height;
            worldCamera.matrixWorld.copy(camera.matrixWorld);
            worldCamera.updateProjectionMatrix();
            this.world.update(worldCamera);
            renderer.autoClear = false;
            renderer.setScissorTest(false);
            renderer.setClearColor(0x000000, 1);
            renderer.clear();
            renderer.setScissorTest(true);
            // Each eye renders into its actual inset viewport, not a cropped
            // full-screen half. UI and scene use the same square projection.
            for (let eye = 0; eye < 2; eye++) {
                const rect = eyes[eye];
                renderer.setViewport(rect.x, rect.y, rect.width, rect.height);
                renderer.setScissor(rect.x, rect.y, rect.width, rect.height);
                renderer.render(scene, eye === 0 ? this.world.cameraL : this.world.cameraR);
            }
            const ui = this.uiCamera;
            ui.copy(camera, false);
            ui.aspect = worldCamera.aspect;
            ui.layers.set(PHONE_UI_LAYER);
            ui.matrixAutoUpdate = false;
            ui.matrixWorldAutoUpdate = false;
            ui.matrixWorld.copy(camera.matrixWorld);
            ui.matrixWorldInverse.copy(ui.matrixWorld).invert();
            ui.updateProjectionMatrix();
            scene.background = null;
            renderer.setScissorTest(true);
            // Identical pose and projection for text/buttons in BOTH eyes.
            // World objects retain the normal eye separation and 3D depth.
            for (let eye = 0; eye < 2; eye++) {
                const rect = eyes[eye];
                renderer.setViewport(rect.x, rect.y, rect.width, rect.height);
                renderer.setScissor(rect.x, rect.y, rect.width, rect.height);
                renderer.clearDepth();
                renderer.render(scene, ui);
            }
        } finally {
            scene.background = background;
            renderer.autoClear = autoClear;
            renderer.setClearColor(this.clearColor, clearAlpha);
            renderer.setViewport(this.viewport);
            renderer.setScissor(this.scissor);
            renderer.setScissorTest(scissorTest);
        }
    }
}
