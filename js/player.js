/* Aurora Keys — motor do jogo: notas caindo, teclado, pontuação e partículas */
(function (global) {
  'use strict';

  const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
  const isBlack = (m) => BLACK[((m % 12) + 12) % 12];
  const NAMES = {
    letters: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
    solfege: ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si']
  };
  const noteName = (m, style, oct) => NAMES[style || 'solfege'][m % 12] + (oct ? Math.floor(m / 12) - 1 : '');

  const HANDS = {
    right: { light: '#b7fff4', base: '#2ee6d6', dark: '#0a8fa8', rgb: '46,230,214', key: ['#7cf7ea', '#14b8c4'] },
    left: { light: '#ffd0ec', base: '#ff5fb1', dark: '#b3127a', rgb: '255,95,177', key: ['#ff9fd2', '#e0368f'] },
    background: { light: '#ddd3ff', base: '#9b7bff', dark: '#5a35d6', rgb: '155,123,255', key: ['#c4b2ff', '#7c5cf0'] },
    wrong: { light: '#ffd9c2', base: '#ff8a4c', dark: '#c2410c', rgb: '255,138,76', key: ['#ffb38a', '#f06a2a'] },
    neutral: { light: '#e6ecff', base: '#a9b8ff', dark: '#5865c9', rgb: '169,184,255', key: ['#c9d3ff', '#7d8cf0'] },
    missed: { light: '#6b7280', base: '#4b5263', dark: '#2b303c', rgb: '120,128,150' }
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function lowerBound(arr, t, key) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m][key] < t) lo = m + 1; else hi = m; }
    return lo;
  }

  function rrect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function rrectBottom(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.closePath();
  }

  class Player {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.synth = opts.synth;
      this.settings = opts.settings;      // função que devolve as preferências
      this.midiOut = opts.midiOut;        // função que devolve a saída MIDI (ou null)
      this.onFinish = opts.onFinish || (() => {});
      this.onStats = opts.onStats || (() => {});
      this.song = null;
      this.notes = [];
      this.userNotes = [];
      this.keyDown = new Map();
      this.particles = [];
      this.popups = [];
      this.freeBars = [];
      this.autoVoices = [];
      this.speed = 1;
      this.t = 0;
      this.playing = false;
      this.loopA = null;
      this.loopB = null;
      this.gradCache = new Map();
      this.lastFrame = 0;
      this.running = false;
      this.resize();
      new ResizeObserver(() => this.resize()).observe(canvas);
    }

    /* ---------- Carregamento ---------- */
    load(song, cfg) {
      this.song = song;
      this.free = !!song.free;
      this.mode = this.free ? 'listen' : cfg.mode;
      this.hands = cfg.hands;
      const notes = [];
      (song.parts || []).forEach((p, pi) => {
        const hand = (cfg.partHands && cfg.partHands[pi]) || p.hand || 'background';
        if (hand === 'hidden') return;
        p.notes.forEach(n => notes.push({
          midi: n.midi, start: n.start, end: n.start + n.dur, vel: n.vel, hand, part: pi,
          hit: false, missed: false, user: false
        }));
      });
      notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
      this.notes = notes;
      this.maxDur = notes.reduce((m, n) => Math.max(m, n.end - n.start), 0.1);
      this.duration = this.free ? Infinity : Math.max(song.duration || 0, notes.length ? notes[notes.length - 1].end : 0);
      this.firstStart = notes.length ? notes[0].start : 0;
      this.loopA = this.loopB = null;
      this.finished = false;
      this.freeBars = [];
      this.particles = [];
      this.popups = [];
      this.computeUser();
      this.layout();
      this.restart();
    }

    computeUser() {
      for (const n of this.notes) {
        n.user = this.mode !== 'listen' && ((n.hand === 'left' && this.hands.left) || (n.hand === 'right' && this.hands.right));
      }
      this.userNotes = this.notes.filter(n => n.user);
    }

    setMode(mode) {
      if (this.free) return;
      this.mode = mode;
      this.computeUser();
      this.resetStats();
      this.seek(this.t);
    }

    setHands(h) {
      this.hands = h;
      this.computeUser();
      this.resetStats();
      this.seek(this.t);
    }

    get leadIn() { return clamp(this.hitY / this.pps * 0.85, 1.5, 4); }

    restart() {
      this.resetStats();
      this.finished = false;
      this.seek(this.free ? 0 : Math.min(0, this.firstStart) - this.leadIn);
      this.playing = false;
    }

    resetStats() {
      this.stats = { hits: 0, perfect: 0, good: 0, missed: 0, wrong: 0, combo: 0, maxCombo: 0, score: 0, total: this.userNotes.length };
      this.onStats(this.stats);
    }

    seek(t) {
      if (!this.free) t = clamp(t, -this.leadIn - 1, this.duration);
      this.t = t;
      for (const n of this.notes) if (n.start >= t - 0.001) { n.hit = false; n.missed = false; }
      this.autoIdx = lowerBound(this.notes, t - 0.0005, 'start');
      this.pendIdx = lowerBound(this.userNotes, t - 0.0005, 'start');
      this.missIdx = this.pendIdx;
      this.stopAuto();
      if (t < this.duration) this.finished = false;
    }

    play() {
      if (this.free) return;
      if (this.finished || this.t >= this.duration) this.restart();
      this.synth.init();
      this.playing = true;
    }
    pause() { this.playing = false; this.stopAuto(); }
    toggle() { this.playing ? this.pause() : this.play(); }

    setSpeed(s) { this.speed = clamp(Math.round(s * 100) / 100, 0.1, 2); }

    stopAuto() {
      this.autoVoices.forEach(v => this.synth.release(v));
      this.autoVoices = [];
      const out = this.midiOut();
      if (out) { try { for (let c = 0; c < 16; c++) out.send([0xb0 | c, 123, 0]); } catch (e) {} }
    }

    /* ---------- Layout ---------- */
    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      this.W = Math.max(200, r.width);
      this.H = Math.max(200, r.height);
      this.dpr = dpr;
      this.canvas.width = Math.round(this.W * dpr);
      this.canvas.height = Math.round(this.H * dpr);
      this.layout();
    }

    range() {
      const s = this.settings();
      if (s.keyRange === 'full') return [21, 108];
      const narrow = this.W < 720;
      if (!this.notes.length) return narrow ? [48, 72] : (this.W < 1100 ? [36, 84] : [36, 96]);
      let lo = 127, hi = 0;
      for (const n of this.notes) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; }
      lo -= 2; hi += 2;
      const minSpan = narrow ? 24 : 36;
      while (hi - lo < minSpan) { lo--; hi++; }
      lo = Math.max(21, lo); hi = Math.min(108, hi);
      if (isBlack(lo)) lo--;
      if (isBlack(hi)) hi++;
      return [lo, hi];
    }

    layout() {
      if (!this.W) return;
      const [lo, hi] = this.range();
      this.lo = lo; this.hi = hi;
      const whites = [];
      for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites.push(m);
      const ww = this.W / whites.length;
      this.whiteW = ww;
      const kbH = Math.round(clamp(Math.min(this.H * 0.26, ww * 6.4), 70, 230));
      this.kbH = kbH;
      this.feltH = 5;
      this.hitY = this.H - kbH;
      this.blackH = Math.round((kbH - this.feltH) * 0.62);
      const keys = {};
      let wi = 0;
      const off = { 1: -0.12, 3: 0.12, 6: -0.16, 8: 0, 10: 0.16 };
      const bw = ww * 0.6;
      for (let m = lo; m <= hi; m++) {
        if (!isBlack(m)) { keys[m] = { x: wi * ww, w: ww, black: false }; wi++; }
        else keys[m] = { x: wi * ww - bw / 2 + off[m % 12] * bw, w: bw, black: true };
      }
      this.keys = keys;
      this.pps = (this.hitY / 3.1) * (this.settings().fallSpeed || 1);
      this.gradCache.clear();
      const ctx = this.ctx;
      const top = this.hitY + this.feltH;
      this.gWhite = ctx.createLinearGradient(0, top, 0, this.H);
      this.gWhite.addColorStop(0, '#d9dbe6');
      this.gWhite.addColorStop(0.06, '#f6f7fb');
      this.gWhite.addColorStop(0.85, '#ffffff');
      this.gWhite.addColorStop(1, '#e4e6ef');
      this.gBlack = ctx.createLinearGradient(0, top, 0, top + this.blackH);
      this.gBlack.addColorStop(0, '#0a0a12');
      this.gBlack.addColorStop(0.75, '#22232f');
      this.gBlack.addColorStop(0.9, '#363847');
      this.gBlack.addColorStop(1, '#14151d');
      this.gBg = ctx.createLinearGradient(0, 0, 0, this.hitY);
      this.gBg.addColorStop(0, '#05060e');
      this.gBg.addColorStop(1, '#0d0b1e');
      this.gAurora = ctx.createLinearGradient(0, 0, this.W, 0);
      this.gAurora.addColorStop(0, '#2ee6d6');
      this.gAurora.addColorStop(0.5, '#8b7bff');
      this.gAurora.addColorStop(1, '#ff5fb1');
      this.pressGrad = {};
      for (const h in HANDS) {
        if (!HANDS[h].key) continue;
        const gw = ctx.createLinearGradient(0, top, 0, this.H);
        gw.addColorStop(0, HANDS[h].key[1]);
        gw.addColorStop(1, HANDS[h].key[0]);
        const gb = ctx.createLinearGradient(0, top, 0, top + this.blackH);
        gb.addColorStop(0, HANDS[h].dark);
        gb.addColorStop(1, HANDS[h].base);
        this.pressGrad[h] = { w: gw, b: gb };
      }
    }

    keyAt(x, y) {
      if (y < this.hitY) return null;
      if (y < this.hitY + this.feltH + this.blackH) {
        for (let m = this.lo; m <= this.hi; m++) {
          const k = this.keys[m];
          if (k.black && x >= k.x && x <= k.x + k.w) return m;
        }
      }
      for (let m = this.lo; m <= this.hi; m++) {
        const k = this.keys[m];
        if (!k.black && x >= k.x && x < k.x + k.w) return m;
      }
      return null;
    }

    /* ---------- Entrada do usuário ---------- */
    userNoteOn(midi, vel) {
      const info = { hand: 'neutral' };
      if (this.free) {
        this.freeBars.push({ midi, t0: performance.now() / 1000, t1: null, vel });
        info.hand = midi >= 60 ? 'right' : 'left';
        this.keyDown.set(midi, info);
        this.burst(midi, info.hand, 8);
        return;
      }
      this.keyDown.set(midi, info);
      if (this.mode === 'listen') return;

      const tolBack = this.mode === 'practice' ? 0.25 : 0.2 * Math.max(this.speed, 0.35);
      const tolAhead = this.mode === 'practice' ? 0.35 * Math.max(this.speed, 0.5) : 0.2 * Math.max(this.speed, 0.35);
      let best = null, bestD = Infinity;
      let i = lowerBound(this.userNotes, this.t - tolBack, 'start');
      for (; i < this.userNotes.length; i++) {
        const n = this.userNotes[i];
        if (n.start > this.t + tolAhead) break;
        if (n.midi !== midi || n.hit || n.missed) continue;
        const dd = Math.abs(n.start - this.t);
        if (dd < bestD) { bestD = dd; best = n; }
      }
      const s = this.stats;
      if (best) {
        best.hit = true;
        info.hand = best.hand;
        s.hits++;
        s.combo++;
        s.maxCombo = Math.max(s.maxCombo, s.combo);
        const real = bestD / this.speed;
        const perfect = this.mode === 'practice' ? real < 0.12 : real < 0.07;
        if (perfect) s.perfect++; else s.good++;
        s.score += Math.round((perfect ? 100 : 60) * (1 + Math.min(s.combo, 50) / 25));
        this.burst(midi, best.hand, perfect ? 18 : 10);
        if (this.mode === 'play') this.popup(midi, perfect ? 'Perfeito!' : 'Bom', HANDS[best.hand].light);
        if (s.combo > 0 && s.combo % 25 === 0) this.popup(midi, s.combo + ' combo!', '#ffffff', true);
      } else {
        info.hand = 'wrong';
        s.wrong++;
        if (this.mode === 'play') s.combo = 0;
      }
      this.onStats(s);
    }

    userNoteOff(midi) {
      this.keyDown.delete(midi);
      if (this.free) {
        for (let i = this.freeBars.length - 1; i >= 0; i--) {
          const b = this.freeBars[i];
          if (b.midi === midi && b.t1 === null) { b.t1 = performance.now() / 1000; break; }
        }
      }
    }

    /* ---------- Atualização ---------- */
    update(dt) {
      this.waiting = null;
      if (!this.playing || this.free) return;
      let nt = this.t + dt * this.speed;

      if (this.mode === 'practice') {
        while (this.pendIdx < this.userNotes.length && this.userNotes[this.pendIdx].hit) this.pendIdx++;
        const w = this.userNotes[this.pendIdx];
        if (w && w.start <= nt) {
          nt = Math.max(this.t, w.start);
          const list = [];
          for (let i = this.pendIdx; i < this.userNotes.length; i++) {
            const n = this.userNotes[i];
            if (n.start > w.start + 0.03) break;
            if (!n.hit) list.push(n);
          }
          this.waiting = list;
        }
      }

      this.runAuto(this.t, nt);

      if (this.mode === 'play') {
        const tol = 0.2 * Math.max(this.speed, 0.35);
        while (this.missIdx < this.userNotes.length && this.userNotes[this.missIdx].start + tol < nt) {
          const n = this.userNotes[this.missIdx++];
          if (!n.hit && !n.missed) {
            n.missed = true;
            this.stats.missed++;
            this.stats.combo = 0;
            this.onStats(this.stats);
          }
        }
      }

      this.t = nt;

      if (this.loopB !== null && this.loopA !== null && this.t >= this.loopB) {
        this.seek(this.loopA);
      }

      if (!this.finished && this.t > this.duration + 0.8) {
        this.finished = true;
        this.playing = false;
        this.stopAuto();
        this.onFinish(this.stats);
      }
    }

    runAuto(t0, t1) {
      const out = this.midiOut();
      const s = this.settings();
      while (this.autoIdx < this.notes.length && this.notes[this.autoIdx].start < t1) {
        const n = this.notes[this.autoIdx++];
        if (n.start < t0 - 0.05 || n.user) continue;
        const dur = (n.end - n.start) / this.speed;
        const vel = n.hand === 'background' ? n.vel * 0.8 : n.vel;
        if (out) {
          try {
            const now = performance.now();
            out.send([0x90, n.midi, Math.round(clamp(vel, 0.05, 1) * 127)], now);
            out.send([0x80, n.midi, 0], now + dur * 1000);
          } catch (e) {}
          if (!s.autoSoundWithOut) continue;
        }
        const v = this.synth.play(n.midi, vel, dur);
        if (v) this.autoVoices.push(v);
      }
      if (this.autoVoices.length > 160) this.autoVoices = this.autoVoices.slice(-100);
    }

    /* ---------- Efeitos ---------- */
    burst(midi, hand, count) {
      if (!this.settings().particles) return;
      const k = this.keys && this.keys[midi];
      if (!k) return;
      const c = HANDS[hand] || HANDS.neutral;
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
        const sp = 80 + Math.random() * 260;
        this.particles.push({
          x: k.x + k.w / 2 + (Math.random() - 0.5) * k.w * 0.5,
          y: this.hitY,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0, max: 0.4 + Math.random() * 0.6,
          size: 1 + Math.random() * 2.4, rgb: Math.random() < 0.3 ? '255,255,255' : c.rgb
        });
      }
    }

    popup(midi, text, color, big) {
      const k = this.keys && this.keys[midi];
      if (!k) return;
      this.popups.push({ x: k.x + k.w / 2, y: this.hitY - 30, text, color, life: 0, big: !!big });
      if (this.popups.length > 12) this.popups.shift();
    }

    /* ---------- Renderização ---------- */
    noteGrad(hand, w, state) {
      const key = hand + '|' + Math.round(w) + '|' + state;
      let g = this.gradCache.get(key);
      if (g) return g;
      const c = state === 'missed' ? HANDS.missed : (HANDS[hand] || HANDS.neutral);
      g = this.ctx.createLinearGradient(0, 0, w, 0);
      if (state === 'active') {
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.35, c.light);
        g.addColorStop(1, c.base);
      } else {
        g.addColorStop(0, c.light);
        g.addColorStop(0.28, c.base);
        g.addColorStop(1, c.dark);
      }
      this.gradCache.set(key, g);
      return g;
    }

    frame(now) {
      const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0;
      this.lastFrame = now;
      this.update(dt);
      this.render(dt);
    }

    render(dt) {
      const ctx = this.ctx, W = this.W, H = this.H, hitY = this.hitY, pps = this.pps, t = this.t;
      const s = this.settings();
      const style = s.noteNames;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      // Fundo
      ctx.fillStyle = this.gBg;
      ctx.fillRect(0, 0, W, hitY);

      // Faixas das teclas pretas e linhas de oitava
      ctx.fillStyle = 'rgba(255,255,255,0.018)';
      for (let m = this.lo; m <= this.hi; m++) {
        const k = this.keys[m];
        if (k.black) ctx.fillRect(k.x, 0, k.w, hitY);
      }
      for (let m = this.lo; m <= this.hi; m++) {
        const pc = m % 12;
        if (pc === 0 || pc === 5) {
          const k = this.keys[m];
          ctx.fillStyle = pc === 0 ? 'rgba(255,255,255,0.075)' : 'rgba(255,255,255,0.03)';
          ctx.fillRect(Math.round(k.x), 0, 1, hitY);
        }
      }

      // Linhas de compasso
      const bars = this.song && this.song.bars;
      if (bars && bars.length && !this.free) {
        const view = hitY / pps;
        ctx.fillStyle = 'rgba(255,255,255,0.055)';
        ctx.font = '500 10px Inter, system-ui, sans-serif';
        for (let b = 0; b < bars.length; b++) {
          const bt = bars[b];
          if (bt < t - 0.01) continue;
          if (bt > t + view) break;
          const y = Math.round(hitY - (bt - t) * pps);
          ctx.fillRect(0, y, W, 1);
          if (s.barNumbers !== false) {
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            ctx.fillText(String(b + 1), 6, y - 4);
          }
          ctx.fillStyle = 'rgba(255,255,255,0.055)';
        }
      }

      // Brilho sob teclas ativas
      const active = new Map();
      const hint = new Map();
      if (!this.free) {
        let i = lowerBound(this.notes, t - this.maxDur - 0.01, 'start');
        for (; i < this.notes.length; i++) {
          const n = this.notes[i];
          if (n.start > t) break;
          if (n.end <= t) continue;
          if (!n.user) active.set(n.midi, n.hand);
          else if (!n.hit && !n.missed && this.mode === 'play') hint.set(n.midi, n.hand);
        }
      }
      if (this.waiting) this.waiting.forEach(n => hint.set(n.midi, n.hand));

      const glowKeys = new Map(active);
      this.keyDown.forEach((v, m) => glowKeys.set(m, v.hand));
      ctx.globalCompositeOperation = 'lighter';
      glowKeys.forEach((hand, m) => {
        const k = this.keys[m];
        if (!k) return;
        const c = HANDS[hand] || HANDS.neutral;
        const g = ctx.createLinearGradient(0, hitY - 160, 0, hitY);
        g.addColorStop(0, 'rgba(' + c.rgb + ',0)');
        g.addColorStop(1, 'rgba(' + c.rgb + ',0.28)');
        ctx.fillStyle = g;
        ctx.fillRect(k.x - k.w * 0.3, hitY - 160, k.w * 1.6, 160);
      });
      ctx.globalCompositeOperation = 'source-over';

      // Notas
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, hitY);
      ctx.clip();
      if (!this.free) this.drawNotes(ctx, t, hitY, pps, style, s);
      else this.drawFreeBars(ctx, hitY);
      ctx.restore();

      // Feltro + linha aurora
      ctx.fillStyle = '#3a0a1f';
      ctx.fillRect(0, hitY, W, this.feltH);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, hitY + this.feltH - 1, W, 1);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = this.gAurora;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(0, hitY - 1, W, 2);
      ctx.globalAlpha = 0.18;
      ctx.fillRect(0, hitY - 6, W, 6);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      this.drawKeyboard(ctx, active, hint, style, s);
      this.drawParticles(ctx, dt, glowKeys, s);
      this.drawPopups(ctx, dt);
      if (this.waiting && this.waiting.length) this.drawWaiting(ctx, style);
    }

    drawNotes(ctx, t, hitY, pps, style, s) {
      const view = hitY / pps;
      let i = lowerBound(this.notes, t - this.maxDur - 0.05, 'start');
      const showLabels = s.noteLabels;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      for (; i < this.notes.length; i++) {
        const n = this.notes[i];
        if (n.start > t + view) break;
        if (n.end < t - 0.02) continue;
        const k = this.keys[n.midi];
        if (!k) continue;
        const yb = hitY - (n.start - t) * pps;
        const yt = hitY - (n.end - t) * pps;
        const h = Math.max(4, yb - yt);
        const w = k.black ? k.w * 0.9 : k.w * 0.8;
        const x = k.x + (k.w - w) / 2;
        const isActive = n.start <= t && n.end > t && (!n.user || n.hit);
        const state = n.missed ? 'missed' : (isActive || (n.user && n.hit) ? 'active' : 'idle');
        const r = Math.min(7, w * 0.32);

        ctx.globalAlpha = n.hand === 'background' ? 0.55 : 1;
        if (isActive && n.hand !== 'background') {
          ctx.shadowColor = 'rgba(' + HANDS[n.hand].rgb + ',0.85)';
          ctx.shadowBlur = 22;
        }
        ctx.translate(x, 0);
        ctx.fillStyle = this.noteGrad(n.hand, w, state);
        if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(0, yt, w, h, r); }
        else rrect(ctx, 0, yt, w, h, r);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
        ctx.lineWidth = 1;
        ctx.strokeStyle = state === 'active' ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.22)';
        ctx.stroke();

        if (showLabels && h > 16 && w > 13) {
          const fs = Math.min(12, Math.max(8, w * 0.42));
          ctx.font = '700 ' + fs + 'px Outfit, Inter, system-ui, sans-serif';
          ctx.fillStyle = state === 'missed' ? 'rgba(255,255,255,0.5)' : 'rgba(6,12,30,0.72)';
          const label = noteName(n.midi, style, false).replace('#', '♯');
          ctx.fillText(label.length > 3 && w < 22 ? label.slice(0, 2) : label, w / 2, yb - 5);
        }
        ctx.translate(-x, 0);
        ctx.globalAlpha = 1;
      }
    }

    drawFreeBars(ctx, hitY) {
      const now = performance.now() / 1000;
      const sp = 150;
      this.freeBars = this.freeBars.filter(b => b.t1 === null || hitY - (now - b.t1) * sp > -10);
      for (const b of this.freeBars) {
        const k = this.keys[b.midi];
        if (!k) continue;
        const hand = b.midi >= 60 ? 'right' : 'left';
        const yt = hitY - (now - b.t0) * sp;
        const yb = b.t1 === null ? hitY : hitY - (now - b.t1) * sp;
        const w = k.black ? k.w * 0.9 : k.w * 0.8;
        const x = k.x + (k.w - w) / 2;
        ctx.translate(x, 0);
        ctx.fillStyle = this.noteGrad(hand, w, b.t1 === null ? 'active' : 'idle');
        if (b.t1 === null) { ctx.shadowColor = 'rgba(' + HANDS[hand].rgb + ',0.8)'; ctx.shadowBlur = 18; }
        rrect(ctx, 0, yt, w, Math.max(4, yb - yt), Math.min(7, w * 0.32));
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.translate(-x, 0);
      }
    }

    drawKeyboard(ctx, active, hint, style, s) {
      const top = this.hitY + this.feltH;
      const H = this.H;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
      const stateOf = (m) => {
        const d = this.keyDown.get(m);
        if (d) return d.hand;
        return active.get(m) || null;
      };

      // brancas
      for (let m = this.lo; m <= this.hi; m++) {
        const k = this.keys[m];
        if (k.black) continue;
        const st = stateOf(m);
        const x = k.x + 0.5, w = k.w - 1;
        const press = st ? 2 : 0;
        ctx.fillStyle = st ? this.pressGrad[st].w : this.gWhite;
        rrectBottom(ctx, x, top, w, H - top - 2 + press, Math.min(5, w * 0.2));
        ctx.fill();
        const hh = hint.get(m);
        if (hh && !st) {
          ctx.fillStyle = 'rgba(' + HANDS[hh].rgb + ',' + (0.25 + pulse * 0.35) + ')';
          ctx.fill();
        }
        // sombra do feltro
        const sh = ctx.createLinearGradient(0, top, 0, top + 12);
        sh.addColorStop(0, 'rgba(0,0,0,0.35)');
        sh.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sh;
        ctx.fillRect(x, top, w, 12);
        if (!st) {
          ctx.fillStyle = 'rgba(0,0,0,0.08)';
          ctx.fillRect(x, H - 6, w, 4);
        }
        // rótulos
        const showLbl = s.keyLabels === 'all' || (s.keyLabels === 'c' && m % 12 === 0);
        if (showLbl && k.w > 11) {
          const fs = Math.min(11, Math.max(7, k.w * 0.36));
          ctx.font = '600 ' + fs + 'px Inter, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = st ? 'rgba(10,15,35,0.8)' : (m % 12 === 0 ? 'rgba(70,74,110,0.85)' : 'rgba(110,114,150,0.7)');
          const lbl = noteName(m, style, m % 12 === 0 || s.keyLabels === 'all' && k.w > 22);
          ctx.fillText(k.w < 18 && lbl.length > 3 ? lbl.slice(0, 2) : lbl, k.x + k.w / 2, H - 10);
        }
      }
      // separadores
      ctx.fillStyle = 'rgba(20,20,40,0.18)';
      for (let m = this.lo; m <= this.hi; m++) {
        const k = this.keys[m];
        if (!k.black) ctx.fillRect(Math.round(k.x), top, 1, H - top);
      }
      // pretas
      for (let m = this.lo; m <= this.hi; m++) {
        const k = this.keys[m];
        if (!k.black) continue;
        const st = stateOf(m);
        const bh = this.blackH - (st ? 3 : 0);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        rrectBottom(ctx, k.x + 1, top, k.w, bh + 3, 3);
        ctx.fill();
        ctx.fillStyle = st ? this.pressGrad[st].b : this.gBlack;
        rrectBottom(ctx, k.x, top, k.w, bh, 3);
        ctx.fill();
        const hh = hint.get(m);
        if (hh && !st) {
          ctx.fillStyle = 'rgba(' + HANDS[hh].rgb + ',' + (0.35 + pulse * 0.4) + ')';
          ctx.fill();
        }
        if (!st) {
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          ctx.fillRect(k.x + k.w * 0.18, top + 2, k.w * 0.64, bh * 0.78);
          ctx.fillStyle = 'rgba(255,255,255,0.16)';
          ctx.fillRect(k.x + 2, top + bh - 8, k.w - 4, 5);
        }
        if (s.keyLabels === 'all' && k.w > 14) {
          ctx.font = '600 ' + Math.min(9, k.w * 0.34) + 'px Inter, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          const lbl = noteName(m, style, false).replace('#', '♯');
          ctx.fillText(lbl.length > 3 ? lbl.slice(0, 3) : lbl, k.x + k.w / 2, top + bh - 12);
        }
      }
    }

    drawParticles(ctx, dt, glowKeys, s) {
      if (s.particles && this.keys) {
        glowKeys.forEach((hand, m) => {
          const k = this.keys[m];
          if (!k || Math.random() > 0.55) return;
          const c = HANDS[hand] || HANDS.neutral;
          this.particles.push({
            x: k.x + k.w / 2 + (Math.random() - 0.5) * k.w * 0.6,
            y: this.hitY - 2,
            vx: (Math.random() - 0.5) * 40, vy: -(50 + Math.random() * 140),
            life: 0, max: 0.5 + Math.random() * 0.8, size: 0.8 + Math.random() * 2,
            rgb: Math.random() < 0.25 ? '255,255,255' : c.rgb
          });
        });
      }
      if (this.particles.length > 700) this.particles.splice(0, this.particles.length - 700);
      ctx.globalCompositeOperation = 'lighter';
      const keep = [];
      for (const p of this.particles) {
        p.life += dt;
        if (p.life >= p.max) continue;
        p.vy += 120 * dt;
        p.vx *= 0.985;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y > this.hitY) continue;
        const a = 1 - p.life / p.max;
        ctx.fillStyle = 'rgba(' + p.rgb + ',' + (a * 0.9).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.6 + a * 0.6), 0, Math.PI * 2);
        ctx.fill();
        keep.push(p);
      }
      this.particles = keep;
      ctx.globalCompositeOperation = 'source-over';
    }

    drawPopups(ctx, dt) {
      if (!this.popups.length) return;
      ctx.textAlign = 'center';
      this.popups = this.popups.filter(p => (p.life += dt) < 0.9);
      for (const p of this.popups) {
        const a = 1 - p.life / 0.9;
        ctx.globalAlpha = a;
        ctx.font = (p.big ? '800 22px ' : '700 14px ') + 'Outfit, Inter, system-ui, sans-serif';
        ctx.fillStyle = p.color;
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 8;
        ctx.fillText(p.text, p.x, p.y - p.life * 60 - (p.big ? 30 : 0));
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
    }

    drawWaiting(ctx, style) {
      const names = this.waiting.slice(0, 6).map(n => noteName(n.midi, style, true)).join('  ·  ');
      const text = 'Toque  ' + names;
      ctx.font = '600 13px Inter, system-ui, sans-serif';
      const tw = ctx.measureText(text).width + 28;
      const x = this.W / 2 - tw / 2, y = this.hitY - 52;
      ctx.fillStyle = 'rgba(10,10,28,0.72)';
      rrect(ctx, x, y, tw, 30, 15);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.stroke();
      ctx.fillStyle = '#e8ecff';
      ctx.textAlign = 'center';
      ctx.fillText(text, this.W / 2, y + 20);
    }
  }

  Player.noteName = noteName;
  Player.HANDS = HANDS;
  global.Player = Player;
})(window);
