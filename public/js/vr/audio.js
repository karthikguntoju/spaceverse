/**
 * Procedural audio for the VR solar system + roller-coaster ride.
 * Everything is synthesised with the WebAudio API so the experience ships
 * with zero audio assets and works offline / inside a headset browser.
 *
 * The AudioContext can only be created from a user gesture, so init() is
 * called when the visitor presses "Launch" / "Start ride".
 */
export class SpaceAudio {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.muted = false;
        this.noiseBuf = null;
        this.engine = null;      // { gain, filter, src }
        this.pad = null;
    }

    init() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') this.ctx.resume();
            return;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try {
            this.ctx = new AC();
        } catch (e) {
            // no audio device (headless / locked-down browser) — run silent
            console.warn('[vr] audio unavailable:', e.message);
            this.ctx = null;
            return;
        }
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.85;
        this.master.connect(this.ctx.destination);

        // 2s of brown-ish noise reused by every rumble / whoosh voice
        const len = this.ctx.sampleRate * 2;
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) {
            const white = Math.random() * 2 - 1;
            last = (last + 0.02 * white) / 1.02;
            d[i] = last * 3.5;
        }
        this.noiseBuf = buf;

        this._buildEngine();
        this._buildPad();
    }

    setMuted(m) {
        this.muted = m;
        if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
    }

    get ready() { return !!this.ctx; }

    /* ── sustained thruster rumble, gain driven by ride speed ── */
    _buildEngine() {
        const c = this.ctx;
        const src = c.createBufferSource();
        src.buffer = this.noiseBuf;
        src.loop = true;

        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 140;
        lp.Q.value = 1.4;

        const gain = c.createGain();
        gain.gain.value = 0;

        // low sine underlay gives the rumble some body
        const osc = c.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 44;
        const oscGain = c.createGain();
        oscGain.gain.value = 0.25;

        src.connect(lp).connect(gain).connect(this.master);
        osc.connect(oscGain).connect(gain);
        src.start();
        osc.start();
        this.engine = { gain, lp, osc };
    }

    /* level 0..1 — call every frame with normalised speed */
    setEngine(level) {
        if (!this.engine) return;
        const t = this.ctx.currentTime;
        this.engine.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.5, t, 0.25);
        this.engine.lp.frequency.setTargetAtTime(110 + level * 320, t, 0.3);
        this.engine.osc.frequency.setTargetAtTime(38 + level * 26, t, 0.4);
    }

    /* ── slow ambient drone for free-explore mode ── */
    _buildPad() {
        const c = this.ctx;
        const g = c.createGain();
        g.gain.value = 0;
        g.connect(this.master);
        [55, 82.4, 110, 164.8].forEach((f, i) => {
            const o = c.createOscillator();
            o.type = i % 2 ? 'sine' : 'triangle';
            o.frequency.value = f;
            const og = c.createGain();
            og.gain.value = 0.06 / (i + 1);
            // slow detune drift keeps the pad from sounding static
            const lfo = c.createOscillator();
            lfo.frequency.value = 0.03 + i * 0.017;
            const lfoG = c.createGain();
            lfoG.gain.value = 1.2;
            lfo.connect(lfoG).connect(o.detune);
            o.connect(og).connect(g);
            o.start(); lfo.start();
        });
        this.pad = g;
    }

    setPad(level) {
        if (!this.pad) return;
        this.pad.gain.setTargetAtTime(level, this.ctx.currentTime, 0.8);
    }

    /* ── one-shot: rock tearing past the canopy ── */
    whoosh(dur = 1.1, pan = 0, intensity = 1) {
        if (!this.ctx) return;
        const c = this.ctx, t = c.currentTime;
        const src = c.createBufferSource();
        src.buffer = this.noiseBuf;
        src.playbackRate.value = 0.8 + Math.random() * 0.5;

        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 1.1;
        // doppler-ish sweep up then down as the rock passes
        bp.frequency.setValueAtTime(180, t);
        bp.frequency.exponentialRampToValueAtTime(2200, t + dur * 0.55);
        bp.frequency.exponentialRampToValueAtTime(240, t + dur);

        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.7 * intensity, t + dur * 0.55);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

        const p = c.createStereoPanner ? c.createStereoPanner() : null;
        if (p) {
            p.pan.setValueAtTime(-pan, t);
            p.pan.linearRampToValueAtTime(pan, t + dur);
            src.connect(bp).connect(g).connect(p).connect(this.master);
        } else {
            src.connect(bp).connect(g).connect(this.master);
        }
        src.start(t);
        src.stop(t + dur + 0.05);
    }

    /* ── one-shot: hull strike / debris crack ── */
    impact(intensity = 1) {
        if (!this.ctx) return;
        const c = this.ctx, t = c.currentTime;

        // noise burst body
        const src = c.createBufferSource();
        src.buffer = this.noiseBuf;
        src.playbackRate.value = 1.6;
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(3200, t);
        lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
        const g = c.createGain();
        g.gain.setValueAtTime(0.9 * intensity, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
        src.connect(lp).connect(g).connect(this.master);
        src.start(t); src.stop(t + 0.7);

        // sub thump
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(120, t);
        o.frequency.exponentialRampToValueAtTime(28, t + 0.45);
        const og = c.createGain();
        og.gain.setValueAtTime(0.9 * intensity, t);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        o.connect(og).connect(this.master);
        o.start(t); o.stop(t + 0.65);

        // metallic ring so it reads as "something hit the ship"
        const m = c.createOscillator();
        m.type = 'square';
        m.frequency.setValueAtTime(880 + Math.random() * 400, t);
        m.frequency.exponentialRampToValueAtTime(300, t + 0.3);
        const mg = c.createGain();
        mg.gain.setValueAtTime(0.14 * intensity, t);
        mg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        m.connect(mg).connect(this.master);
        m.start(t); m.stop(t + 0.4);
    }

    /* ── proximity alarm before a near miss ── */
    alarm(beeps = 3) {
        if (!this.ctx) return;
        const c = this.ctx;
        for (let i = 0; i < beeps; i++) {
            const t = c.currentTime + i * 0.22;
            const o = c.createOscillator();
            o.type = 'square';
            o.frequency.value = 1180;
            const g = c.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
            o.connect(g).connect(this.master);
            o.start(t); o.stop(t + 0.16);
        }
    }

    /* ── warp / jump-to-light-speed swell ── */
    warp(dur = 2.4) {
        if (!this.ctx) return;
        const c = this.ctx, t = c.currentTime;
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(60, t);
        o.frequency.exponentialRampToValueAtTime(1400, t + dur);
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(300, t);
        lp.frequency.exponentialRampToValueAtTime(6000, t + dur);
        lp.Q.value = 8;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.3, t + dur * 0.8);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.4);
        o.connect(lp).connect(g).connect(this.master);
        o.start(t); o.stop(t + dur + 0.5);
    }

    /* ── UI blip ── */
    blip(freq = 660) {
        if (!this.ctx) return;
        const c = this.ctx, t = c.currentTime;
        const o = c.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(freq, t);
        o.frequency.exponentialRampToValueAtTime(freq * 1.6, t + 0.09);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.14, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.connect(g).connect(this.master);
        o.start(t); o.stop(t + 0.18);
    }

    /* ── Quest 3 arcade spatial effects ── */
    _connectPan(node, pan = 0) {
        const c = this.ctx;
        const p = c.createStereoPanner ? c.createStereoPanner() : null;
        if (p) {
            p.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), c.currentTime);
            node.connect(p).connect(this.master);
        } else {
            node.connect(this.master);
        }
    }

    rcsPuff(pan = 0, intensity = 0.5) {
        if (!this.ctx || !this.noiseBuf) return;
        const c = this.ctx, t = c.currentTime;
        const src = c.createBufferSource();
        src.buffer = this.noiseBuf;
        src.playbackRate.value = 1.4 + Math.random() * 0.35;
        const hp = c.createBiquadFilter();
        hp.type = 'bandpass';
        hp.frequency.setValueAtTime(1600, t);
        hp.Q.value = 1.2;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.28 * Math.max(0.1, intensity), t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        src.connect(hp).connect(g);
        this._connectPan(g, pan);
        src.start(t);
        src.stop(t + 0.16);
    }

    laser(pitch = 780, pan = 0.2) {
        if (!this.ctx) return;
        const c = this.ctx, t = c.currentTime;
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(pitch * 1.45, t);
        o.frequency.exponentialRampToValueAtTime(Math.max(110, pitch * 0.24), t + 0.14);
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(3600, t);
        lp.frequency.exponentialRampToValueAtTime(600, t + 0.14);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.18, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        o.connect(lp).connect(g);
        this._connectPan(g, pan);
        o.start(t);
        o.stop(t + 0.16);
    }

    railgun() {
        if (!this.ctx) return;
        const c = this.ctx, t = c.currentTime;
        const sub = c.createOscillator();
        sub.type = 'sawtooth';
        sub.frequency.setValueAtTime(220, t);
        sub.frequency.exponentialRampToValueAtTime(42, t + 0.36);
        const ring = c.createOscillator();
        ring.type = 'sine';
        ring.frequency.setValueAtTime(1680, t);
        ring.frequency.exponentialRampToValueAtTime(340, t + 0.28);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.32, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
        sub.connect(g);
        ring.connect(g);
        g.connect(this.master);
        sub.start(t); sub.stop(t + 0.4);
        ring.start(t); ring.stop(t + 0.32);
    }

    explosion(size = 1, pan = 0) {
        if (!this.ctx || !this.noiseBuf) return;
        const c = this.ctx, t = c.currentTime;
        const amp = Math.max(0.25, Math.min(1.4, size));
        const src = c.createBufferSource();
        src.buffer = this.noiseBuf;
        src.playbackRate.value = 0.75;
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1900, t);
        lp.frequency.exponentialRampToValueAtTime(95, t + 0.55);
        const g = c.createGain();
        g.gain.setValueAtTime(0.45 * amp, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
        src.connect(lp).connect(g);
        this._connectPan(g, pan);
        src.start(t); src.stop(t + 0.65);

        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(115, t);
        o.frequency.exponentialRampToValueAtTime(30, t + 0.42);
        const og = c.createGain();
        og.gain.setValueAtTime(0.42 * amp, t);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        o.connect(og);
        this._connectPan(og, pan);
        o.start(t); o.stop(t + 0.48);
    }

    shieldBlock(pan = -0.35) {
        if (!this.ctx) return;
        const c = this.ctx, t = c.currentTime;
        [520, 780, 1240].forEach((freq, i) => {
            const o = c.createOscillator();
            o.type = i === 0 ? 'triangle' : 'sine';
            o.frequency.setValueAtTime(freq, t);
            o.frequency.exponentialRampToValueAtTime(freq * 1.18, t + 0.14);
            const g = c.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.11 / (i + 1), t + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
            o.connect(g);
            this._connectPan(g, pan);
            o.start(t); o.stop(t + 0.26);
        });
    }

    weldSpark(pan = 0.25) {
        if (!this.ctx || !this.noiseBuf) return;
        const c = this.ctx, t = c.currentTime;
        const src = c.createBufferSource();
        src.buffer = this.noiseBuf;
        src.playbackRate.value = 2.1;
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(2800 + Math.random() * 1400, t);
        bp.Q.value = 2.4;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
        src.connect(bp).connect(g);
        this._connectPan(g, pan);
        src.start(t); src.stop(t + 0.1);
    }

    lockChord(ok = true) {
        if (!this.ctx) return;
        const c = this.ctx, t = c.currentTime;
        const freqs = ok ? [523.25, 659.25, 783.99] : [220, 196];
        freqs.forEach((f, i) => {
            const o = c.createOscillator();
            o.type = ok ? 'triangle' : 'sawtooth';
            o.frequency.value = f;
            const g = c.createGain();
            const start = t + i * 0.045;
            g.gain.setValueAtTime(0.0001, start);
            g.gain.exponentialRampToValueAtTime(ok ? 0.11 : 0.1, start + 0.012);
            g.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
            o.connect(g).connect(this.master);
            o.start(start); o.stop(start + 0.26);
        });
    }

    countdown(final = false) {
        if (!this.ctx) return;
        const c = this.ctx, t = c.currentTime;
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.value = final ? 880 : 440;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(final ? 0.2 : 0.12, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + (final ? 0.28 : 0.14));
        o.connect(g).connect(this.master);
        o.start(t); o.stop(t + (final ? 0.3 : 0.16));
    }

    fanfare(won = true) {
        if (!this.ctx) return;
        const c = this.ctx, t = c.currentTime;
        const notes = won ? [523.25, 659.25, 783.99, 1046.5] : [349.23, 293.66, 220];
        notes.forEach((f, i) => {
            const o = c.createOscillator();
            o.type = won ? 'triangle' : 'sawtooth';
            const st = t + i * 0.095;
            o.frequency.value = f;
            const g = c.createGain();
            g.gain.setValueAtTime(0.0001, st);
            g.gain.exponentialRampToValueAtTime(won ? 0.13 : 0.09, st + 0.015);
            g.gain.exponentialRampToValueAtTime(0.0001, st + 0.38);
            o.connect(g).connect(this.master);
            o.start(st); o.stop(st + 0.4);
        });
    }
}
