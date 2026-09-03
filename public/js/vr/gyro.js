/**
 * Phone gyroscope head-look.
 *
 * Turns DeviceOrientation (alpha/beta/gamma) into a camera quaternion, the
 * same maths three.js used in its old DeviceOrientationControls: hold the
 * phone up like a window and the view follows where the phone points, in
 * every direction. Screen rotation (portrait / landscape either way) is
 * compensated, so it works held sideways in a Cardboard viewer.
 *
 * Only the *camera* is driven, never the dolly. The dolly is what the ride
 * rails and free-flight move; the camera sitting inside it is the head. That
 * split is what lets the same code give a POV look-around on the coaster.
 *
 * Browser rules that shape this file:
 *   • iOS 13+ needs DeviceOrientationEvent.requestPermission() from a user
 *     gesture. enable() must therefore be called from a click/tap handler.
 *   • Both iOS Safari and Android Chrome only deliver orientation events on
 *     a secure context (https:// or localhost). Over plain http on a LAN IP
 *     nothing arrives — `available` reports that so the UI can explain.
 */
import * as THREE from 'three';

const ZEE = new THREE.Vector3(0, 0, 1);
const EULER = new THREE.Euler();
const Q0 = new THREE.Quaternion();
// -90° about X: device frame (screen up = +Z) → camera frame (look down -Z)
const Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const DEG = Math.PI / 180;

export class GyroLook {
    constructor() {
        this.enabled = false;
        this.hasReading = false;
        this.alpha = 0; this.beta = 0; this.gamma = 0;
        this.screenAngle = 0;
        this.yawOffset = 0;              // recenter: extra rotation about world Y
        this.smoothing = 0.35;           // 0 = raw, 1 = frozen
        this.q = new THREE.Quaternion(); // latest raw device quaternion
        this.out = new THREE.Quaternion();
        this._onOrient = e => this._read(e);
        this._onScreen = () => this._readScreen();
        this.onFirstReading = null;
    }

    /** true when the API exists and we are on a secure context */
    static get available() {
        return typeof window !== 'undefined' &&
            'DeviceOrientationEvent' in window &&
            (window.isSecureContext !== false);
    }

    /** why gyro cannot work here, or '' if it can */
    static get blockedReason() {
        if (typeof window === 'undefined') return 'no window';
        if (!('DeviceOrientationEvent' in window)) return 'This browser has no motion sensors API.';
        if (window.isSecureContext === false)
            return 'Motion sensors need HTTPS. Open this page over https:// (see README: HTTPS=true npm start).';
        return '';
    }

    /**
     * Must be called from a user gesture on iOS.
     * Resolves true when events are flowing (or at least permitted).
     */
    async enable() {
        if (this.enabled) return true;
        const DOE = window.DeviceOrientationEvent;
        if (!DOE) return false;
        if (typeof DOE.requestPermission === 'function') {
            try {
                const res = await DOE.requestPermission();
                if (res !== 'granted') return false;
            } catch (e) {
                return false;
            }
        }
        this._readScreen();
        window.addEventListener('deviceorientation', this._onOrient, true);
        window.addEventListener('orientationchange', this._onScreen);
        if (screen.orientation) screen.orientation.addEventListener('change', this._onScreen);
        this.enabled = true;
        this.hasReading = false;
        return true;
    }

    disable() {
        if (!this.enabled) return;
        window.removeEventListener('deviceorientation', this._onOrient, true);
        window.removeEventListener('orientationchange', this._onScreen);
        if (screen.orientation) screen.orientation.removeEventListener('change', this._onScreen);
        this.enabled = false;
        this.hasReading = false;
    }

    _readScreen() {
        const a = (screen.orientation && typeof screen.orientation.angle === 'number')
            ? screen.orientation.angle
            : (typeof window.orientation === 'number' ? window.orientation : 0);
        this.screenAngle = a * DEG;
    }

    _read(e) {
        if (e.alpha === null || e.alpha === undefined) return;
        this.alpha = e.alpha * DEG;
        this.beta = (e.beta || 0) * DEG;
        this.gamma = (e.gamma || 0) * DEG;
        // 'YXZ' — yaw about Y (alpha), pitch about X (beta), roll about Z (-gamma)
        EULER.set(this.beta, this.alpha, -this.gamma, 'YXZ');
        this.q.setFromEuler(EULER);
        this.q.multiply(Q1);
        this.q.multiply(Q0.setFromAxisAngle(ZEE, -this.screenAngle));
        if (!this.hasReading) {
            this.hasReading = true;
            // first frame: whatever way the phone points is "forward"
            this.recenter();
            if (this.onFirstReading) this.onFirstReading();
        }
    }

    /** heading (yaw about world Y) of the raw device quaternion, radians */
    _rawYaw() {
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.q);
        return Math.atan2(-f.x, -f.z);
    }

    /** make the direction the phone currently faces the forward direction */
    recenter() {
        if (!this.hasReading) return;
        this.yawOffset = -this._rawYaw();
    }

    /**
     * Blend the device pose into `target` (a Quaternion, normally
     * camera.quaternion). Returns false when there is nothing to apply yet.
     */
    apply(target, extraYaw = 0) {
        if (!this.enabled || !this.hasReading) return false;
        this.out.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yawOffset + extraYaw).multiply(this.q);
        if (this.smoothing > 0) target.slerp(this.out, 1 - this.smoothing);
        else target.copy(this.out);
        return true;
    }
}
