/* Aurora Keys — teclado fixo no rodapé do site e notas que sobem pela página */
(function (global) {
  'use strict';

  const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
  const isBlack = (m) => BLACK[m % 12];
  const NAMES = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // ciano nos graves → violeta → rosa nos agudos
  const hueOf = (m) => 172 + clamp((m - 21) / 87, 0, 1) * 160;

  class AmbientKeys {
    constructor(opts) {
      this.fx = opts.fx;
      this.kb = opts.kb;
      this.fxc = this.fx.getContext('2d');
      this.kbc = this.kb.getContext('2d');
      this.onPress = opts.onPress;
      this.onRelease = opts.onRelease;
      this.labels = opts.labels || (() => true);
      this.down = new Map();
      this.bars = [];
      this.particles = [];
      this.ripples = [];
      this.collapsed = false;
      this.active = true;
      this.offset = 0; // deslocamento em oitavas quando o teclado não tem 88 teclas
      this.last = 0;
      this.dirty = true;
      this.resize();
      global.addEventListener('resize', () => this.resize());
      this.bindPointer();
    }

    resize() {
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      this.dpr = dpr;
      this.W = global.innerWidth;
      this.H = global.innerHeight;
      this.kbH = this.W < 640 ? 78 : 104;
      this.fx.width = Math.round(this.W * dpr);
      this.fx.height = Math.round(this.H * dpr);
      this.kb.width = Math.round(this.W * dpr);
      this.kb.height = Math.round(this.kbH * dpr);
      this.kb.style.height = this.kbH + 'px';
      document.documentElement.style.setProperty('--kb-h', this.kbH + 'px');
      this.layout();
    }

    layout() {
      const whites = clamp(Math.floor(this.W / 25), 15, 52);
      let lo, hi;
      if (whites >= 52) { lo = 21; hi = 108; this.offset = 0; }
      else {
        // centraliza no Dó central e conta as brancas
        const half = Math.floor(whites / 2);
        lo = 60; let n = 0;
        while (n < half) { lo--; if (!isBlack(lo)) n++; }
        lo += this.offset * 12;
        lo = clamp(lo, 21, 108);
        if (isBlack(lo)) lo--;
        hi = lo; n = 1;
        while (n < whites && hi < 108) { hi++; if (!isBlack(hi)) n++; }
      }
      this.lo = lo; this.hi = hi;
      const list = [];
      for (let m = lo; m <= hi; m++) if (!isBlack(m)) list.push(m);
      const ww = this.W / list.length;
      const bw = ww * 0.6;
      const off = { 1: -0.12, 3: 0.12, 6: -0.16, 8: 0, 10: 0.16 };
      this.keys = {};
      let wi = 0;
      for (let m = lo; m <= hi; m++) {
        if (!isBlack(m)) { this.keys[m] = { x: wi * ww, w: ww, black: false }; wi++; }
        else this.keys[m] = { x: wi * ww - bw / 2 + off[m % 12] * bw, w: bw, black: true };
      }
      this.blackH = Math.round((this.kbH - 6) * 0.6);
      this.dirty = true;
    }

    ensureVisible(midi) {
      if (this.lo === 21 && this.hi === 108) return;
      let moved = false;
      while (midi < this.lo && this.lo > 21) { this.offset--; this.layout(); moved = true; }
      while (midi > this.hi && this.hi < 108) { this.offset++; this.layout(); moved = true; }
      if (moved) this.bars = this.bars.filter(b => this.keys[b.midi]);
    }

    get baseY() { return this.H - (this.collapsed ? 0 : this.kbH); }

    noteOn(midi, vel) {
      this.ensureVisible(midi);
      const k = this.keys[midi];
      if (!k) return;
      const now = performance.now() / 1000;
      this.down.set(midi, { t0: now, vel });
      this.bars.push({ midi, t0: now, t1: null, vel: vel || 0.7 });
      if (this.bars.length > 160) this.bars.shift();
      this.ripples.push({ x: k.x + k.w / 2, t0: now, hue: hueOf(midi), vel: vel || 0.7 });
      this.burst(k, midi, 10 + Math.round((vel || 0.7) * 14));
      this.dirty = true;
    }

    noteOff(midi) {
      this.down.delete(midi);
      const now = performance.now() / 1000;
      for (let i = this.bars.length - 1; i >= 0; i--) {
        const b = this.bars[i];
        if (b.midi === midi && b.t1 === null) { b.t1 = now; break; }
      }
      this.dirty = true;
    }

    releaseAll() { Array.from(this.down.keys()).forEach(m => this.noteOff(m)); }

    burst(k, midi, n) {
      const hue = hueOf(midi);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
        const sp = 60 + Math.random() * 240;
        this.particles.push({
          x: k.x + k.w / 2 + (Math.random() - 0.5) * k.w * 0.5, y: 0, // y relativo à base
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.5 + Math.random() * 0.8,
          size: 0.8 + Math.random() * 2.2, hue: Math.random() < 0.25 ? -1 : hue
        });
      }
      if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
    }

    /* ---------- entrada por toque/mouse ---------- */
    keyAt(x, y) {
      if (y < this.blackH + 6) {
        for (let m = this.lo; m <= this.hi; m++) { const k = this.keys[m]; if (k.black && x >= k.x && x <= k.x + k.w) return m; }
      }
      for (let m = this.lo; m <= this.hi; m++) { const k = this.keys[m]; if (!k.black && x >= k.x && x < k.x + k.w) return m; }
      return null;
    }

    bindPointer() {
      const ptrs = new Map();
      const pos = (e) => { const r = this.kb.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      this.kb.addEventListener('pointerdown', (e) => {
        const m = this.keyAt(...pos(e));
        if (m === null) return;
        e.preventDefault();
        this.kb.setPointerCapture(e.pointerId);
        ptrs.set(e.pointerId, m);
        this.onPress(m, 0.75);
      });
      this.kb.addEventListener('pointermove', (e) => {
        if (!ptrs.has(e.pointerId)) return;
        const m = this.keyAt(...pos(e));
        const prev = ptrs.get(e.pointerId);
        if (m !== null && m !== prev) { this.onRelease(prev); ptrs.set(e.pointerId, m); this.onPress(m, 0.7); }
      });
      const end = (e) => { if (ptrs.has(e.pointerId)) { this.onRelease(ptrs.get(e.pointerId)); ptrs.delete(e.pointerId); } };
      this.kb.addEventListener('pointerup', end);
      this.kb.addEventListener('pointercancel', end);
    }

    /* ---------- desenho ---------- */
    frame(nowMs) {
      if (!this.active) return;
      const now = nowMs / 1000;
      const dt = this.last ? Math.min(0.05, now - this.last) : 0;
      this.last = now;
      const busy = this.bars.length || this.particles.length || this.ripples.length || this.down.size;
      if (busy || this.dirty) this.drawFx(now, dt);
      if (this.dirty || this.down.size || this.lastDown) { this.drawKeys(); this.lastDown = this.down.size; }
      this.dirty = false;
    }

    drawFx(now, dt) {
      const c = this.fxc, W = this.W, H = this.H, base = this.baseY;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      const speed = Math.max(170, H * 0.32);

      // pilares de luz nas teclas pressionadas
      c.globalCompositeOperation = 'lighter';
      this.down.forEach((d, m) => {
        const k = this.keys[m];
        if (!k) return;
        const h = hueOf(m);
        const g = c.createLinearGradient(0, base - 220, 0, base);
        g.addColorStop(0, 'hsla(' + h + ',95%,65%,0)');
        g.addColorStop(1, 'hsla(' + h + ',95%,65%,0.32)');
        c.fillStyle = g;
        c.fillRect(k.x - k.w * 0.5, base - 220, k.w * 2, 220);
      });

      // notas subindo
      this.bars = this.bars.filter(b => b.t1 === null || base - (now - b.t1) * speed > -40);
      for (const b of this.bars) {
        const k = this.keys[b.midi];
        if (!k) continue;
        const top = base - (now - b.t0) * speed;
        const bot = b.t1 === null ? base : base - (now - b.t1) * speed;
        const h = Math.max(6, bot - top);
        const w = (k.black ? k.w * 0.9 : k.w * 0.74) * (0.85 + b.vel * 0.3);
        const x = k.x + (k.w - w) / 2;
        const hue = hueOf(b.midi);
        const fade = clamp(bot / (H * 0.9), 0, 1);
        const g = c.createLinearGradient(0, top, 0, bot);
        g.addColorStop(0, 'hsla(' + hue + ',95%,70%,' + (0.15 * fade) + ')');
        g.addColorStop(0.6, 'hsla(' + hue + ',95%,62%,' + (0.65 * fade) + ')');
        g.addColorStop(1, 'hsla(' + (hue + 12) + ',100%,' + (b.t1 === null ? 88 : 70) + '%,' + (0.95 * fade) + ')');
        c.fillStyle = g;
        c.shadowColor = 'hsla(' + hue + ',100%,60%,' + (0.9 * fade) + ')';
        c.shadowBlur = 26;
        const r = Math.min(w / 2, 10);
        c.beginPath();
        if (c.roundRect) c.roundRect(x, top, w, h, r); else c.rect(x, top, w, h);
        c.fill();
        // núcleo brilhante
        c.shadowBlur = 0;
        c.fillStyle = 'hsla(' + hue + ',100%,92%,' + (0.35 * fade) + ')';
        c.fillRect(x + w * 0.38, top + r, w * 0.24, Math.max(0, h - r * 2));
      }
      c.shadowBlur = 0;

      // ondas na base
      this.ripples = this.ripples.filter(r => now - r.t0 < 0.9);
      for (const r of this.ripples) {
        const p = (now - r.t0) / 0.9;
        c.strokeStyle = 'hsla(' + r.hue + ',100%,70%,' + ((1 - p) * 0.6 * r.vel) + ')';
        c.lineWidth = 2 * (1 - p) + 0.5;
        c.beginPath();
        c.ellipse(r.x, base, 10 + p * 90, 3 + p * 16, 0, Math.PI, Math.PI * 2);
        c.stroke();
      }

      // faíscas
      const keep = [];
      for (const p of this.particles) {
        p.life += dt;
        if (p.life >= p.max) continue;
        p.vy += 140 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y > 0) continue;
        const a = 1 - p.life / p.max;
        c.fillStyle = p.hue < 0 ? 'rgba(255,255,255,' + a + ')' : 'hsla(' + p.hue + ',100%,70%,' + a + ')';
        c.beginPath();
        c.arc(p.x, base + p.y, p.size * (0.5 + a * 0.7), 0, Math.PI * 2);
        c.fill();
        keep.push(p);
      }
      this.particles = keep;
      c.globalCompositeOperation = 'source-over';
    }

    drawKeys() {
      const c = this.kbc, W = this.W, H = this.kbH;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      const top = 4;
      // linha aurora
      const ga = c.createLinearGradient(0, 0, W, 0);
      ga.addColorStop(0, '#2ee6d6'); ga.addColorStop(0.5, '#8b7bff'); ga.addColorStop(1, '#ff5fb1');
      c.fillStyle = ga;
      c.fillRect(0, 0, W, 2);
      c.fillStyle = '#2a0a1c';
      c.fillRect(0, 2, W, top - 2);

      const gw = c.createLinearGradient(0, top, 0, H);
      gw.addColorStop(0, '#cfd2e0'); gw.addColorStop(0.08, '#f4f5fa'); gw.addColorStop(1, '#ffffff');
      const gb = c.createLinearGradient(0, top, 0, top + this.blackH);
      gb.addColorStop(0, '#08080f'); gb.addColorStop(0.8, '#23242f'); gb.addColorStop(1, '#15161e');
      const showLabels = this.labels();

      for (let m = this.lo; m <= this.hi; m++) {
        const k = this.keys[m];
        if (k.black) continue;
        const on = this.down.has(m);
        if (on) {
          const hue = hueOf(m);
          const g = c.createLinearGradient(0, top, 0, H);
          g.addColorStop(0, 'hsl(' + hue + ',85%,52%)');
          g.addColorStop(1, 'hsl(' + hue + ',95%,80%)');
          c.fillStyle = g;
        } else c.fillStyle = gw;
        c.fillRect(k.x + 0.5, top, k.w - 1, H - top);
        const sh = c.createLinearGradient(0, top, 0, top + 10);
        sh.addColorStop(0, 'rgba(0,0,0,.3)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = sh;
        c.fillRect(k.x + 0.5, top, k.w - 1, 10);
        if (showLabels && m % 12 === 0 && k.w > 14) {
          c.font = '600 ' + Math.min(10, k.w * 0.38) + 'px Inter, system-ui, sans-serif';
          c.textAlign = 'center';
          c.fillStyle = on ? 'rgba(10,12,30,.8)' : 'rgba(80,84,120,.8)';
          c.fillText(NAMES[0] + (Math.floor(m / 12) - 1), k.x + k.w / 2, H - 8);
        }
      }
      c.fillStyle = 'rgba(20,20,40,.18)';
      for (let m = this.lo; m <= this.hi; m++) { const k = this.keys[m]; if (!k.black) c.fillRect(Math.round(k.x), top, 1, H - top); }
      for (let m = this.lo; m <= this.hi; m++) {
        const k = this.keys[m];
        if (!k.black) continue;
        const on = this.down.has(m);
        const bh = this.blackH - (on ? 2 : 0);
        c.fillStyle = 'rgba(0,0,0,.35)';
        c.fillRect(k.x + 1, top, k.w, bh + 3);
        if (on) {
          const hue = hueOf(m);
          const g = c.createLinearGradient(0, top, 0, top + bh);
          g.addColorStop(0, 'hsl(' + hue + ',80%,30%)');
          g.addColorStop(1, 'hsl(' + hue + ',90%,58%)');
          c.fillStyle = g;
        } else c.fillStyle = gb;
        c.beginPath();
        if (c.roundRect) c.roundRect(k.x, top, k.w, bh, [0, 0, 3, 3]); else c.rect(k.x, top, k.w, bh);
        c.fill();
        if (!on) {
          c.fillStyle = 'rgba(255,255,255,.09)';
          c.fillRect(k.x + k.w * 0.2, top + 2, k.w * 0.6, bh * 0.75);
        }
      }
    }
  }

  global.AmbientKeys = AmbientKeys;
})(window);
