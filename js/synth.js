/* Aurora Keys — sintetizador de piano em Web Audio */
(function (global) {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  class PianoSynth {
    constructor() {
      this.ctx = null;
      this.volume = 0.8;
      this.waves = new Map();
      this.voices = new Set();
    }

    init() {
      if (this.ctx) {
        if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
        return this.ctx;
      }
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      const ctx = this.ctx = new AC({ latencyHint: 'interactive' });

      this.master = ctx.createGain();
      this.master.gain.value = this.volume;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 14;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;

      this.bus = ctx.createGain();
      const rev = ctx.createConvolver();
      rev.buffer = this._impulse(2.6);
      const wet = ctx.createGain();
      wet.gain.value = 0.24;

      const warm = ctx.createBiquadFilter();
      warm.type = 'highshelf';
      warm.frequency.value = 6500;
      warm.gain.value = -5;

      this.bus.connect(warm);
      warm.connect(comp);
      warm.connect(rev);
      rev.connect(wet);
      wet.connect(comp);
      comp.connect(this.master);
      this.master.connect(ctx.destination);

      const len = Math.floor(ctx.sampleRate * 0.06);
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const nd = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      return ctx;
    }

    get time() { return this.ctx ? this.ctx.currentTime : 0; }

    setVolume(v) {
      this.volume = v;
      if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }

    _impulse(sec) {
      const r = this.ctx.sampleRate, len = Math.floor(r * sec);
      const b = this.ctx.createBuffer(2, len, r);
      for (let c = 0; c < 2; c++) {
        const data = b.getChannelData(c);
        for (let i = 0; i < len; i++) {
          const fadeIn = i < r * 0.008 ? i / (r * 0.008) : 1;
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.4) * fadeIn;
        }
      }
      return b;
    }

    _wave(midi) {
      const k = Math.round(midi / 3);
      if (this.waves.has(k)) return this.waves.get(k);
      const N = 32;
      const real = new Float32Array(N + 1);
      const imag = new Float32Array(N + 1);
      const m = k * 3;
      const bright = clamp((100 - m) / 64, 0.12, 1);
      for (let n = 1; n <= N; n++) {
        const hammer = 0.35 + 0.65 * Math.abs(Math.sin(Math.PI * n / 7.3));
        const amp = Math.pow(n, -1.15) * Math.exp(-(n - 1) * (1.15 - bright) * 0.55) * hammer;
        imag[n] = amp;
        real[n] = amp * 0.08 * (n % 2 ? 1 : -1);
      }
      const w = this.ctx.createPeriodicWave(real, imag);
      this.waves.set(k, w);
      return w;
    }

    /** Inicia uma nota; devolve a "voz" para ser liberada depois. */
    noteOn(midi, vel = 0.8, at) {
      const ctx = this.init();
      if (!ctx) return null;
      const t = Math.max(at || 0, ctx.currentTime);
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      const v = clamp(vel, 0.05, 1);

      const out = ctx.createGain();
      out.gain.value = 0;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.Q.value = 0.5;

      const wave = this._wave(midi);
      const o1 = ctx.createOscillator();
      o1.setPeriodicWave(wave);
      o1.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.setPeriodicWave(wave);
      o2.frequency.value = f;
      o2.detune.value = midi > 40 ? 3.5 : 1.5;
      const o3 = ctx.createOscillator();
      o3.type = 'sine';
      o3.frequency.value = f * 2.0018;
      const g2 = ctx.createGain(); g2.gain.value = 0.55;
      const g3 = ctx.createGain(); g3.gain.value = 0.12 * v;

      o1.connect(filt); o2.connect(g2); g2.connect(filt); o3.connect(g3); g3.connect(filt);
      filt.connect(out);
      out.connect(this.bus);

      const reg = midi < 40 ? 1.25 : midi > 84 ? 0.7 : 1;
      const peak = 0.2 * Math.pow(v, 1.4) * reg;
      const decay = clamp(3.6 - (midi - 21) * 0.042, 0.35, 3.6);

      const g = out.gain;
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(peak, t + 0.004);
      g.setTargetAtTime(peak * 0.42, t + 0.005, 0.08 + decay * 0.03);
      g.setTargetAtTime(0.00001, t + 0.3, decay);

      const startCut = Math.min(17000, f * (2.5 + v * 11) + 700);
      filt.frequency.setValueAtTime(startCut, t);
      filt.frequency.setTargetAtTime(Math.max(f * 1.6, 350), t + 0.01, 0.35 + decay * 0.35);

      // "martelo"
      const ns = ctx.createBufferSource();
      ns.buffer = this.noise;
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = clamp(f * 4, 800, 9000);
      nf.Q.value = 0.9;
      const ng = ctx.createGain();
      ng.gain.value = 0.045 * v * v;
      ns.connect(nf); nf.connect(ng); ng.connect(out);
      ns.start(t);

      o1.start(t); o2.start(t); o3.start(t);
      const stopAt = t + decay * 7 + 0.5;
      [o1, o2, o3].forEach(o => o.stop(stopAt));

      const voice = { midi, out, oscs: [o1, o2, o3], released: false, start: t };
      o1.onended = () => { try { out.disconnect(); } catch (e) {} this.voices.delete(voice); };
      this.voices.add(voice);

      if (this.voices.size > 80) {
        const oldest = this.voices.values().next().value;
        this.release(oldest);
      }
      return voice;
    }

    release(voice, at) {
      if (!voice || voice.released || !this.ctx) return;
      voice.released = true;
      const t = Math.max(at || 0, this.ctx.currentTime);
      const g = voice.out.gain;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(0, t, voice.midi < 48 ? 0.12 : 0.075);
      voice.oscs.forEach(o => { try { o.stop(t + 0.9); } catch (e) {} });
    }

    /** Toca uma nota com duração definida (segundos). */
    play(midi, vel, dur) {
      const v = this.noteOn(midi, vel);
      if (v) this.release(v, this.ctx.currentTime + Math.max(0.05, dur));
      return v;
    }

    allOff() {
      this.voices.forEach(v => this.release(v));
    }
  }

  global.PianoSynth = PianoSynth;
})(window);
