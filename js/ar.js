/* Aurora Keys — Palco 3D: realidade aumentada sobre o teclado de verdade.
 * A câmera filma o teclado, o app procura as teclas pretas, encaixa o modelo escolhido
 * (quantas teclas, onde começa) e calcula a posição da câmera. Cada nota tocada vira
 * uma coluna de luz que nasce da tecla certa e sobe flutuando em 3D (Three.js). */
(function (global) {
  'use strict';

  /* ================= Modelos de teclado ================= */
  const MODEL_GROUPS = [
    ['88 teclas', 88, 21, [
      ['yamaha-p', 'Yamaha P-45 / P-125 / P-143 / P-145 / P-225'],
      ['yamaha-arius', 'Yamaha Arius YDP / Clavinova / DGX-670'],
      ['casio-cdp', 'Casio CDP-S110 / CDP-S160 / CDP-S360'],
      ['casio-privia', 'Casio Privia PX-S1100 / PX-S3100 / PX-770 / PX-870'],
      ['roland-fp', 'Roland FP-10 / FP-30X / FP-60X / FP-90X'],
      ['roland-home', 'Roland RP / HP / F701 / LX'],
      ['kawai', 'Kawai ES120 / ES520 / ES920 / KDP'],
      ['korg', 'Korg B2 / Liano / SV-2 / D1'],
      ['alesis', 'Alesis Recital / Prestige / Virtue'],
      ['nord88', 'Nord Piano / Stage 88'],
      ['generic88', 'Outro piano digital de 88 teclas']
    ]],
    ['76 teclas', 76, 28, [
      ['yamaha-ew', 'Yamaha PSR-EW425 / EW320 / EW310'],
      ['casio-76', 'Casio CT-X5000 / WK-6600 / LK-S450'],
      ['generic76', 'Outro teclado de 76 teclas']
    ]],
    ['73 teclas', 73, 28, [
      ['nord73', 'Nord Electro / Stage 73'],
      ['generic73', 'Outro teclado de 73 teclas']
    ]],
    ['61 teclas', 61, 36, [
      ['yamaha-psr', 'Yamaha PSR-E373 / E383 / E473 / SX600'],
      ['casio-cts', 'Casio CT-S1 / CT-S300 / CT-S500 / CT-X700'],
      ['roland-go', 'Roland GO:KEYS / JUNO-DS61 / E-X10'],
      ['korg61', 'Korg Kross 61 / Krome 61'],
      ['ctrl61', 'Controlador MIDI 61 (Keystation, KeyLab, Launchkey)'],
      ['generic61', 'Outro teclado de 61 teclas']
    ]],
    ['49 teclas', 49, 36, [
      ['ctrl49', 'Controlador MIDI 49 (Keystation, KeyLab, Launchkey)'],
      ['generic49', 'Outro teclado de 49 teclas']
    ]],
    ['37 teclas', 37, 48, [
      ['ctrl37', 'Arturia KeyStep 37 / Launchkey 37 / MPK Mini Plus'],
      ['generic37', 'Outro teclado de 37 teclas']
    ]],
    ['32 teclas', 32, 41, [
      ['ctrl32', 'Teclado de 32 teclas (Fá a Dó)']
    ]],
    ['25 teclas', 25, 48, [
      ['ctrl25', 'Akai MPK Mini / Arturia MiniLab / Launchkey Mini'],
      ['generic25', 'Outro teclado de 25 teclas']
    ]]
  ];

  const MODELS = {};
  MODEL_GROUPS.forEach(([, keys, low, list]) => list.forEach(([id, name]) => { MODELS[id] = { id, name, keys, low }; }));
  MODELS.custom = { id: 'custom', name: 'Personalizado', keys: 61, low: 36 };

  /* ================= Geometria do teclado (mm) ================= */
  const WW = 23.5;          // largura de uma tecla branca
  const WL = 150;           // comprimento visível da tecla branca
  const BW = 13.7;          // largura da preta
  const BL = 95;            // comprimento da preta (a partir do fundo)
  const BH = 11;            // altura da preta acima das brancas
  const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
  const WPOS = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
  const BX = { 1: 0.9, 3: 2.1, 6: 3.857, 8: 5.0, 10: 6.143 }; // centro da preta, em brancas a partir do Dó
  const isBlack = (m) => BLACK[m % 12];
  const absWhite = (m) => Math.floor(m / 12) * 7 + WPOS[m % 12];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hueOf = (m) => 172 + clamp((m - 21) / 87, 0, 1) * 160;

  function buildGeom(keys, low) {
    if (isBlack(low)) low--;
    const hi = low + keys - 1;
    const w0 = absWhite(low);
    const list = [];
    for (let m = low; m <= hi; m++) {
      if (isBlack(m)) {
        const cx = (Math.floor(m / 12) * 7 + BX[m % 12] - w0) * WW;
        list.push({ m, black: true, x0: cx - BW / 2, x1: cx + BW / 2, cx, y0: WL - BL, y1: WL });
      } else {
        const i = absWhite(m) - w0;
        list.push({ m, black: false, x0: i * WW, x1: (i + 1) * WW, cx: (i + 0.5) * WW, y0: 0, y1: WL });
      }
    }
    const whites = list.filter(k => !k.black).length;
    const map = new Map(list.map(k => [k.m, k]));
    return { low, hi, keys: list, map, whites, blacks: list.filter(k => k.black), W: whites * WW, L: WL };
  }

  /* ================= Álgebra: homografia e pose ================= */
  function solve(A, b) {
    const n = b.length;
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-12) return null;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        if (!f) continue;
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    return b.map((v, i) => v / A[i][i]);
  }

  // src[i] = [X, Y] → dst[i] = [u, v]; devolve matriz 3x3 em linha
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [X, Y] = src[i], [u, v] = dst[i];
      A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]); b.push(u);
      A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]); b.push(v);
    }
    const h = solve(A, b);
    return h ? [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] : null;
  }
  const applyH = (H, X, Y) => {
    const w = H[6] * X + H[7] * Y + H[8];
    return [(H[0] * X + H[1] * Y + H[2]) / w, (H[3] * X + H[4] * Y + H[5]) / w];
  };
  function inv3(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-12) return null;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
      B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
      C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }
  const norm = (v) => Math.hypot(v[0], v[1], v[2]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

  // Distância focal a partir de um retângulo (restrições de ortogonalidade e mesma escala)
  function estimateFocal(Hc) {
    const [h11, h12, , h21, h22, , h31, h32] = Hc;
    const out = [];
    const den1 = h31 * h32;
    if (Math.abs(den1) > 1e-14) { const f2 = -(h11 * h12 + h21 * h22) / den1; if (f2 > 0) out.push(Math.sqrt(f2)); }
    const den2 = h31 * h31 - h32 * h32;
    if (Math.abs(den2) > 1e-14) { const f2 = (h12 * h12 + h22 * h22 - h11 * h11 - h21 * h21) / den2; if (f2 > 0) out.push(Math.sqrt(f2)); }
    return out;
  }

  // Pose da câmera (OpenCV: x direita, y baixo, z frente) a partir da homografia centrada
  function poseFromH(Hc, f) {
    const m1 = [Hc[0] / f, Hc[3] / f, Hc[6]];
    const m2 = [Hc[1] / f, Hc[4] / f, Hc[7]];
    const m3 = [Hc[2] / f, Hc[5] / f, Hc[8]];
    let lam = 2 / (norm(m1) + norm(m2));
    if (m3[2] * lam < 0) lam = -lam;
    let r1 = scale(m1, lam), r2 = scale(m2, lam);
    const t = scale(m3, lam);
    // Gram-Schmidt simétrico
    r1 = scale(r1, 1 / norm(r1));
    r2 = scale(r2, 1 / norm(r2));
    const mid = [r1[0] + r2[0], r1[1] + r2[1], r1[2] + r2[2]];
    const n3 = cross(r1, r2);
    const a = scale(mid, 1 / norm(mid));
    const bb = cross(scale(n3, 1 / norm(n3)), a);
    const s = Math.SQRT1_2;
    r1 = [(a[0] - bb[0]) * s, (a[1] - bb[1]) * s, (a[2] - bb[2]) * s];
    r2 = [(a[0] + bb[0]) * s, (a[1] + bb[1]) * s, (a[2] + bb[2]) * s];
    const r3 = cross(r1, r2);
    return { r1, r2, r3, t };
  }

  /* ================= Detecção automática ================= */
  // Procura a faixa de linhas onde aparece o padrão "claro-escuro-claro" das teclas pretas
  function detectKeyboard(video, geom, work) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const w = 640, h = Math.round(vh * w / vw);
    if (work.width !== w || work.height !== h) { work.width = w; work.height = h; }
    const ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;

    const hist = new Uint32Array(256);
    const rows = new Array(h);
    const score = new Float32Array(h);
    const maxRun = w * 0.05, maxGap = w * 0.09;
    for (let y = 2; y < h - 2; y++) {
      const o = y * w;
      hist.fill(0);
      for (let x = 0; x < w; x++) hist[gray[o + x]]++;
      let acc = 0, p15 = -1, p85 = -1;
      for (let v = 0; v < 256; v++) {
        acc += hist[v];
        if (p15 < 0 && acc >= w * 0.15) p15 = v;
        if (p85 < 0 && acc >= w * 0.85) { p85 = v; break; }
      }
      if (p85 - p15 < 45) continue;
      const thr = (p15 + p85) / 2;
      // runs
      const runs = [];
      let x = 0;
      while (x < w) {
        const dark = gray[o + x] < thr;
        let e = x + 1;
        while (e < w && (gray[o + e] < thr) === dark) e++;
        runs.push([x, e, dark]);
        x = e;
      }
      const centers = [];
      for (let i = 1; i < runs.length - 1; i++) {
        const [a, e, dark] = runs[i];
        if (!dark) continue;
        const len = e - a;
        const L = runs[i - 1], R = runs[i + 1];
        if (len < 3 || len > maxRun) continue;
        if (L[1] - L[0] < 2 || R[1] - R[0] < 2) continue;
        if (L[1] - L[0] > maxGap || R[1] - R[0] > maxGap) continue;
        centers.push({ c: (a + e) / 2, len });
      }
      // maior cadeia de pretas vizinhas
      let best = [], cur = [];
      for (let i = 0; i < centers.length; i++) {
        if (cur.length && centers[i].c - cur[cur.length - 1].c > maxGap + maxRun) { if (cur.length > best.length) best = cur; cur = []; }
        cur.push(centers[i]);
      }
      if (cur.length > best.length) best = cur;
      // larguras parecidas: descarta cadeias com pretas de tamanhos muito diferentes
      if (best.length >= 4) {
        const lens = best.map(c => c.len).sort((p, q) => p - q);
        const med = lens[lens.length >> 1];
        best = best.filter(c => c.len > med * 0.5 && c.len < med * 1.8);
      }
      rows[y] = best;
      score[y] = best.length;
    }
    const sm = new Float32Array(h);
    for (let y = 1; y < h - 1; y++) sm[y] = (score[y - 1] + score[y] + score[y + 1]) / 3;
    let yb = 0;
    for (let y = 0; y < h; y++) if (sm[y] > sm[yb]) yb = y;
    const smax = sm[yb];
    const need = Math.max(4, Math.min(10, Math.round(geom.blacks.length * 0.45)));
    if (smax < need) return null;
    let yT = yb, yB = yb, miss = 0;
    while (yT > 2 && miss < 3) { yT--; if (sm[yT] < smax * 0.55) miss++; else miss = 0; }
    yT += miss;
    miss = 0;
    while (yB < h - 3 && miss < 3) { yB++; if (sm[yB] < smax * 0.55) miss++; else miss = 0; }
    yB -= miss;
    const bandH = yB - yT;
    if (bandH < 5) return null;

    // Ajusta o modelo (centros das pretas em mm) às pretas vistas em duas linhas
    const bx = geom.blacks.map(k => k.cx);
    function fitRow(y) {
      let r = rows[y];
      for (let d = 1; (!r || r.length < need) && d < 4; d++) r = rows[y + d] || rows[y - d];
      if (!r || r.length < 2) return null;
      const cs = r.map(c => c.c);
      let a, b;
      if (cs.length === bx.length) {
        // mínimos quadrados: px = a + b·mm
        let sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (let i = 0; i < cs.length; i++) { sx += bx[i]; sy += cs[i]; sxx += bx[i] * bx[i]; sxy += bx[i] * cs[i]; }
        const n = cs.length;
        b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
        a = (sy - b * sx) / n;
      } else {
        b = (cs[cs.length - 1] - cs[0]) / (bx[bx.length - 1] - bx[0]);
        a = cs[0] - b * bx[0];
      }
      return { y, l: a, r: a + b * geom.W, n: cs.length };
    }
    const f1 = fitRow(Math.round(yT + bandH * 0.3));
    const f2 = fitRow(Math.round(yB - bandH * 0.3));
    if (!f1 || !f2 || f2.y === f1.y) return null;
    const lx = (y) => f1.l + (f2.l - f1.l) * (y - f1.y) / (f2.y - f1.y);
    const rx = (y) => f1.r + (f2.r - f1.r) * (y - f1.y) / (f2.y - f1.y);

    // Fundo e ponta das pretas como retas (aceita teclado um pouco inclinado na imagem)
    const bins = new Map();
    for (let y = Math.max(2, yT - bandH); y <= Math.min(h - 3, yB + bandH); y++) {
      (rows[y] || []).forEach(c => {
        const k = Math.round(c.c / 5);
        let b = bins.get(k) || bins.get(k - 1) || bins.get(k + 1);
        if (!b) { b = { k, xs: 0, n: 0, y0: y, y1: y }; bins.set(k, b); }
        b.xs += c.c; b.n++; b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
      });
    }
    const cols = Array.from(bins.values()).filter(b => b.n >= bandH * 0.5).map(b => ({ x: b.xs / b.n, y0: b.y0, y1: b.y1 }));
    function fitLine(key, fallback) {
      let pts = cols.map(c => [c.x, c[key]]);
      for (let it = 0; it < 3 && pts.length >= 4; it++) {
        let sx = 0, sy = 0, sxx = 0, sxy = 0;
        pts.forEach(([x, y]) => { sx += x; sy += y; sxx += x * x; sxy += x * y; });
        const n = pts.length, d = n * sxx - sx * sx;
        if (Math.abs(d) < 1e-9) break;
        const b = (n * sxy - sx * sy) / d, a = (sy - b * sx) / n;
        if (it === 2 || Math.abs(b) > 0.35) return Math.abs(b) > 0.35 ? (() => fallback) : (x) => a + b * x;
        const res = pts.map(([x, y]) => Math.abs(y - (a + b * x))).sort((p, q) => p - q);
        const lim = Math.max(2, res[Math.floor(res.length * 0.7)] * 1.5);
        pts = pts.filter(([x, y]) => Math.abs(y - (a + b * x)) <= lim);
      }
      return () => fallback;
    }
    const top = cols.length >= 4 ? fitLine('y0', yT) : () => yT;
    const tip = cols.length >= 4 ? fitLine('y1', yB) : () => yB;
    const front = (x) => tip(x) + (tip(x) - top(x)) * (WL - BL) / BL;
    // canto = encontro da borda lateral com a reta do fundo / da frente
    const meet = (edge, line) => { let y = line(edge(yT)); for (let i = 0; i < 4; i++) y = line(edge(y)); return [edge(y), Math.min(h - 1, y)]; };
    const corners = [meet(lx, front), meet(rx, front), meet(rx, top), meet(lx, top)].map(([x, y]) => [x / w, y / h]);
    if (corners.some(([x, y]) => !isFinite(x) || !isFinite(y))) return null;
    if (corners[1][0] - corners[0][0] < 0.15) return null;
    return { corners, seen: Math.round((f1.n + f2.n) / 2), expected: geom.blacks.length };
  }

  /* ================= Textura de brilho ================= */
  function glowTexture(THREE) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,255,255,.55)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    return t;
  }
  function curtainTexture(THREE) {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const g = c.getContext('2d');
    c.width = 64;
    const r = g.createLinearGradient(0, 256, 0, 0);
    r.addColorStop(0, 'rgba(139,123,255,.7)');
    r.addColorStop(0.05, 'rgba(46,230,214,.22)');
    r.addColorStop(0.35, 'rgba(139,123,255,.05)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 256);
    // apaga as laterais
    g.globalCompositeOperation = 'destination-in';
    const sdx = g.createLinearGradient(0, 0, 64, 0);
    sdx.addColorStop(0, 'rgba(0,0,0,0)'); sdx.addColorStop(0.12, '#000'); sdx.addColorStop(0.88, '#000'); sdx.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sdx;
    g.fillRect(0, 0, 64, 256);
    return new THREE.CanvasTexture(c);
  }

  let threePromise = null;
  function loadThree() {
    if (global.THREE) return Promise.resolve(global.THREE);
    if (threePromise) return threePromise;
    threePromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/three.min.js?v=149';
      s.onload = () => global.THREE ? res(global.THREE) : rej(new Error('Three.js não carregou'));
      s.onerror = () => { threePromise = null; rej(new Error('Não consegui carregar o motor 3D')); };
      document.head.appendChild(s);
    });
    return threePromise;
  }

  /* ================= Palco ================= */
  const STORE_KEY = 'aurora-keys-ar';
  const RISE = 240;      // mm/s
  const MAX_H = 950;     // mm

  class ARStage {
    constructor(opts) {
      this.opts = opts;
      this.root = opts.root;
      this.video = opts.root.querySelector('#arVideo');
      this.gl = opts.root.querySelector('#arGL');
      this.ov = opts.root.querySelector('#arOverlay');
      this.ovc = this.ov.getContext('2d');
      this.loupe = opts.root.querySelector('#arLoupe');
      this.handles = Array.from(opts.root.querySelectorAll('.ar-handle'));
      this.work = document.createElement('canvas');
      this.cfg = this.load();
      this.geom = buildGeom(this.cfg.keys, this.cfg.low);
      this.phase = 'off';
      this.stream = null;
      this.notes = [];
      this.held = new Map();
      this.lights = new Map();
      this.raf = 0;
      this.scan = null;
      this.demo = null;
      this.waitLowest = false;
      this.touchDown = new Map();
      this.bindHandles();
      this.bindTouch();
      global.addEventListener('resize', () => { if (this.phase !== 'off') this.layout(); });
    }

    load() {
      let c = {};
      try { c = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { c = {}; }
      const model = MODELS[c.model] || MODELS['yamaha-p'];
      return {
        model: model.id,
        keys: c.keys || model.keys,
        low: c.low != null ? c.low : model.low,
        corners: Array.isArray(c.corners) && c.corners.length === 4 ? c.corners : null,
        fovMul: c.fovMul || 1,
        grid: c.grid != null ? c.grid : false,
        names: c.names != null ? c.names : true,
        facing: c.facing || 'environment'
      };
    }
    save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(this.cfg)); } catch (e) { /* sem armazenamento */ } }

    setModel(id, keys, low) {
      const m = MODELS[id] || MODELS.custom;
      const changed = this.cfg.model !== id || this.cfg.keys !== (keys || m.keys) || this.cfg.low !== (low != null ? low : m.low);
      this.cfg.model = id;
      this.cfg.keys = keys || m.keys;
      this.cfg.low = low != null ? low : m.low;
      if (changed) this.cfg.corners = null;
      this.geom = buildGeom(this.cfg.keys, this.cfg.low);
      this.save();
    }
    shiftOctave(d) {
      const low = clamp(this.cfg.low + d * 12, 0, 127 - this.cfg.keys);
      if (low === this.cfg.low) return;
      this.cfg.low = low;
      this.geom = buildGeom(this.cfg.keys, low);
      this.save();
      this.rebuildStatic();
      this.status();
    }

    /* ---------- câmera ---------- */
    async open() {
      this.root.hidden = false;
      document.body.classList.add('ar-open');
      this.setPhase('loading');
      this.status('Abrindo a câmera…', 'Permita o acesso à câmera quando o navegador pedir.');
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw Object.assign(new Error('sem camera'), { name: global.isSecureContext ? 'NotFoundError' : 'InsecureError' });
        }
        const [THREE] = await Promise.all([loadThree(), this.startCamera()]);
        this.THREE = THREE;
        this.initGL();
        this.layout();
        this.setPhase(this.cfg.corners ? 'live' : 'scan');
        this.loop();
      } catch (e) {
        console.warn(e);
        this.setPhase('error');
        const msg = e.name === 'NotAllowedError' ? ['Câmera bloqueada', 'Libere a câmera para este site nas permissões do navegador e tente de novo.']
          : e.name === 'InsecureError' ? ['Precisa de https', 'A câmera só funciona com o site aberto em https:// (como no GitHub Pages) ou em localhost.']
          : e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ? ['Nenhuma câmera encontrada', 'Este aparelho não tem câmera disponível para o navegador.']
          : ['Não deu para abrir', e.message || 'Erro desconhecido'];
        this.status(msg[0], msg[1]);
      }
    }

    async startCamera() {
      this.stopCamera();
      const want = { facingMode: { ideal: this.cfg.facing }, width: { ideal: 1920 }, height: { ideal: 1080 } };
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: want }); }
      catch (e) {
        if (e.name === 'NotAllowedError' || e.name === 'SecurityError') throw e;
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }
      this.stream = stream;
      this.video.srcObject = stream;
      this.video.setAttribute('playsinline', '');
      this.video.muted = true;
      await this.video.play().catch(() => {});
      if (!this.video.videoWidth) await new Promise(r => this.video.addEventListener('loadedmetadata', r, { once: true }));
      this.root.classList.toggle('mirror', this.cfg.facing === 'user');
    }

    stopCamera() {
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
      this.video.srcObject = null;
    }

    async flip() {
      this.cfg.facing = this.cfg.facing === 'user' ? 'environment' : 'user';
      this.save();
      try { await this.startCamera(); this.layout(); } catch (e) { this.opts.toast && this.opts.toast('Não consegui trocar de câmera', 'err'); }
    }

    close() {
      this.stopDemo();
      this.releaseAll();
      this.stopCamera();
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.phase = 'off';
      this.root.hidden = true;
      document.body.classList.remove('ar-open');
    }

    /* ---------- fases ---------- */
    setPhase(p) {
      this.phase = p;
      this.root.dataset.phase = p;
      if (p === 'scan') {
        this.scan = { t0: performance.now(), last: 0, hist: [], best: null };
        this.status('Escaneando o teclado…', 'Enquadre o teclado inteiro, na horizontal, com boa luz. Segure firme.');
      } else if (p === 'adjust') {
        if (!this.cfg.corners) this.cfg.corners = [[0.1, 0.72], [0.9, 0.72], [0.87, 0.56], [0.13, 0.56]];
        this.status('Confira os cantos', 'Arraste os 4 pontos até as quinas das teclas: frente embaixo, fundo em cima.');
      } else if (p === 'live') {
        this.status();
      }
      this.placeHandles();
      this.rebuildStatic();
      this.drawOverlay();
    }

    status(title, hint) {
      const t = this.root.querySelector('#arTitle'), h = this.root.querySelector('#arHint');
      if (title === undefined && this.phase === 'live') {
        const N = this.opts.noteName;
        title = this.opts.modelLabel ? this.opts.modelLabel(this.cfg) : 'Palco 3D';
        hint = this.cfg.keys + ' teclas · ' + N(this.geom.low, true) + ' a ' + N(this.geom.hi, true) + ' · toque no teclado';
      }
      if (t) t.textContent = title || '';
      if (h) h.textContent = hint || '';
    }

    /* ---------- layout ---------- */
    layout() {
      const W = global.innerWidth, H = global.innerHeight;
      const vw = this.video.videoWidth || 16, vh = this.video.videoHeight || 9;
      const s = Math.max(W / vw, H / vh);
      this.view = { W, H, vw, vh, s, ox: (W - vw * s) / 2, oy: (H - vh * s) / 2 };
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      this.dpr = dpr;
      this.ov.width = Math.round(W * dpr); this.ov.height = Math.round(H * dpr);
      if (this.renderer) { this.renderer.setPixelRatio(dpr); this.renderer.setSize(W, H, false); }
      this.placeHandles();
      this.updatePose();
      this.drawOverlay();
    }
    toScreen(n, raw) {
      const v = this.view;
      let x = n[0];
      if (this.cfg.facing === 'user' && !raw) x = 1 - x;
      return [v.ox + x * v.vw * v.s, v.oy + n[1] * v.vh * v.s];
    }
    toNorm(p) {
      const v = this.view;
      let x = (p[0] - v.ox) / (v.vw * v.s);
      if (this.cfg.facing === 'user') x = 1 - x;
      return [clamp(x, -0.2, 1.2), clamp((p[1] - v.oy) / (v.vh * v.s), -0.2, 1.2)];
    }

    updatePose() {
      this.H = null; this.Hinv = null; this.pose = null;
      const c = this.cfg.corners;
      if (!c || !this.view) return;
      const g = this.geom, v = this.view;
      const pts = c.map(n => this.toScreen(n));
      const plane = [[0, 0], [g.W, 0], [g.W, g.L], [0, g.L]];
      const H = homography(plane, pts);
      if (!H) return;
      this.H = H;
      this.Hinv = inv3(H);
      // a pose sai da imagem real (sem o espelho da câmera frontal); o espelho entra na projeção
      const Hr = this.cfg.facing === 'user' ? homography(plane, c.map(n => this.toScreen(n, true))) : H;
      if (!Hr) return;
      // homografia centrada no ponto principal (centro da imagem = centro da tela, em "cover")
      const cx = v.W / 2, cy = v.H / 2;
      const Hc = [Hr[0] - cx * Hr[6], Hr[1] - cx * Hr[7], Hr[2] - cx * Hr[8], Hr[3] - cy * Hr[6], Hr[4] - cy * Hr[7], Hr[5] - cy * Hr[8], Hr[6], Hr[7], Hr[8]];
      // focal padrão: câmera traseira de celular ~ 64° no lado maior
      const fDef = 0.8 * Math.max(v.vw, v.vh) * v.s;
      let f = fDef;
      const est = estimateFocal(Hc).filter(x => x > fDef * 0.6 && x < fDef * 1.7);
      if (est.length) f = Math.sqrt(fDef * est.reduce((a, b) => a + b, 0) / est.length);
      f *= this.cfg.fovMul;
      this.focal = f;
      this.pose = poseFromH(Hc, f);
      this.applyCamera();
    }

    /* ---------- Three.js ---------- */
    initGL() {
      if (this.renderer) return;
      const THREE = this.THREE;
      this.renderer = new THREE.WebGLRenderer({ canvas: this.gl, alpha: true, antialias: true, premultipliedAlpha: true });
      this.renderer.setClearColor(0x000000, 0);
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(50, 1, 10, 20000);
      this.camera.matrixAutoUpdate = false;
      this.glow = glowTexture(THREE);
      this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
      this.boxGeo.translate(0, 0, 0.5); // base na origem, cresce em +Z
      this.edgeGeo = new THREE.EdgesGeometry(this.boxGeo);
      this.planeGeo = new THREE.PlaneGeometry(1, 1);
      this.board = new THREE.Group();
      this.scene.add(this.board);
      this.fxGroup = new THREE.Group();
      this.board.add(this.fxGroup);
      // partículas
      const N = 1600;
      this.pN = N;
      this.pPos = new Float32Array(N * 3);
      this.pCol = new Float32Array(N * 3);
      this.pVel = new Float32Array(N * 3);
      this.pLife = new Float32Array(N);
      this.pBase = new Float32Array(N * 3);
      this.pNext = 0;
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
      pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
      this.points = new THREE.Points(pg, new THREE.PointsMaterial({
        size: 9, map: this.glow, vertexColors: true, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, sizeAttenuation: true
      }));
      this.points.frustumCulled = false;
      this.board.add(this.points);
      this.labelCache = new Map();
    }

    applyCamera() {
      if (!this.camera || !this.pose || !this.view) return;
      const THREE = this.THREE;
      const { r1, r2, r3, t } = this.pose;
      // mundo → câmera (OpenCV), depois troca para a convenção do Three (y para cima, z para trás)
      const V = new THREE.Matrix4().set(
        r1[0], r2[0], r3[0], t[0],
        -r1[1], -r2[1], -r3[1], -t[1],
        -r1[2], -r2[2], -r3[2], -t[2],
        0, 0, 0, 1);
      this.camera.matrix.copy(V).invert();
      this.camera.updateMatrixWorld(true);
      const v = this.view;
      this.camera.fov = 2 * Math.atan(v.H / 2 / this.focal) * 180 / Math.PI;
      this.camera.aspect = v.W / v.H;
      this.camera.updateProjectionMatrix();
      if (this.cfg.facing === 'user') {
        // vídeo espelhado na tela: espelha a projeção também
        this.camera.projectionMatrix.elements[0] *= -1;
        this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
      }
    }

    rebuildStatic() {
      if (!this.scene) return;
      const THREE = this.THREE;
      if (this.staticGroup) {
        this.board.remove(this.staticGroup);
        this.staticGroup.traverse(o => { if (o.material) o.material.dispose(); if (o.geometry && o.geometry !== this.planeGeo && o.geometry !== this.boxGeo && o.geometry !== this.edgeGeo) o.geometry.dispose(); });
      }
      this.lights.forEach(l => l.mesh.material.dispose());
      this.lights.clear();
      const g = this.geom;
      const grp = new THREE.Group();
      // cortina de luz atrás das teclas
      if (!this.curtainTex) this.curtainTex = curtainTexture(THREE);
      const cur = new THREE.Mesh(this.planeGeo, new THREE.MeshBasicMaterial({
        map: this.curtainTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0.55
      }));
      cur.scale.set(g.W + 80, 520, 1);
      cur.rotation.x = Math.PI / 2;
      cur.position.set(g.W / 2, g.L + 8, 260);
      grp.add(cur);
      // linha de base brilhante
      const baseGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-10, g.L + 2, 1), new THREE.Vector3(g.W + 10, g.L + 2, 1)]);
      grp.add(new THREE.Line(baseGeo, new THREE.LineBasicMaterial({ color: 0x8fe9ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })));
      // pilares de teste nos Dós durante o ajuste (mostram se a perspectiva está certa)
      if (this.phase === 'adjust') {
        g.keys.filter(k => k.m % 12 === 0).forEach(k => {
          const col = new THREE.Color().setHSL(hueOf(k.m) / 360, 0.95, 0.62);
          const m = new THREE.Mesh(this.boxGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
          m.scale.set(18, 14, 160);
          m.position.set(k.cx, WL - 28, 0);
          grp.add(m);
          const e = new THREE.LineSegments(this.edgeGeo, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9 }));
          e.scale.copy(m.scale); e.position.copy(m.position);
          grp.add(e);
        });
      }
      this.staticGroup = grp;
      this.board.add(grp);
    }

    /* ---------- notas ---------- */
    noteOn(midi, vel = 0.8) {
      if (this.waitLowest) {
        this.waitLowest = false;
        this.root.classList.remove('waiting');
        let low = midi;
        if (isBlack(low)) low--;
        this.cfg.low = clamp(low, 0, 127 - this.cfg.keys);
        this.geom = buildGeom(this.cfg.keys, this.cfg.low);
        this.save();
        this.rebuildStatic();
        this.drawOverlay();
        this.opts.toast && this.opts.toast('Pronto: a tecla mais grave é ' + this.opts.noteName(this.geom.low, true));
        if (this.phase === 'adjust') this.status('Confira os cantos', 'Agora o teclado começa em ' + this.opts.noteName(this.geom.low, true) + '.');
        else this.status();
      }
      if (this.phase !== 'live' || !this.scene) return;
      const k = this.geom.map.get(midi);
      if (!k) return;
      const THREE = this.THREE;
      const prev = this.held.get(midi);
      if (prev) this.releaseNote(prev);
      const col = new THREE.Color().setHSL(hueOf(midi) / 360, 0.95, k.black ? 0.6 : 0.64);
      const now = performance.now() / 1000;
      const bw = k.black ? 11 : 18, bd = k.black ? 11 : 14;
      const by = k.black ? WL - 6 : WL - 26, bz = k.black ? BH : 0;
      const body = new THREE.Mesh(this.boxGeo, new THREE.MeshBasicMaterial({
        color: col, transparent: true, opacity: 0.42 + vel * 0.25, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      const edges = new THREE.LineSegments(this.edgeGeo, new THREE.LineBasicMaterial({ color: col.clone().lerp(new THREE.Color(1, 1, 1), 0.45), transparent: true, opacity: 1, blending: THREE.AdditiveBlending }));
      const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      const grp = new THREE.Group();
      grp.add(body, edges, head);
      grp.position.set(k.cx, by, bz);
      this.fxGroup.add(grp);
      let label = null;
      if (this.cfg.names) {
        label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.labelTex(midi), transparent: true, depthWrite: false }));
        label.scale.set(46, 23, 1);
        grp.add(label);
      }
      const n = { midi, k, grp, body, edges, head, label, bw, bd, bz, t0: now, t1: 0, vel, col };
      this.notes.push(n);
      this.held.set(midi, n);
      this.light(k, col, 1);
      this.burst(k.cx, by, bz + 2, col, 14 + Math.round(vel * 18));
    }

    noteOff(midi) {
      const n = this.held.get(midi);
      if (n) this.releaseNote(n);
    }
    releaseNote(n) {
      if (!n.t1) n.t1 = performance.now() / 1000;
      if (this.held.get(n.midi) === n) this.held.delete(n.midi);
      const l = this.lights.get(n.midi);
      if (l) l.hold = false;
    }
    releaseAll() { Array.from(this.held.values()).forEach(n => this.releaseNote(n)); }

    labelTex(midi) {
      const key = midi + '|' + this.opts.noteName(0, false);
      if (this.labelCache.has(key)) return this.labelCache.get(key);
      const c = document.createElement('canvas');
      c.width = 256; c.height = 128;
      const g = c.getContext('2d');
      g.font = '700 64px Outfit, Inter, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const txt = this.opts.noteName(midi, false).replace('#', '♯');
      g.shadowColor = 'hsla(' + hueOf(midi) + ',100%,60%,.9)';
      g.shadowBlur = 18;
      g.fillStyle = '#fff';
      g.fillText(txt, 128, 66);
      const t = new this.THREE.CanvasTexture(c);
      this.labelCache.set(key, t);
      return t;
    }

    light(k, col, a) {
      const THREE = this.THREE;
      let l = this.lights.get(k.m);
      if (!l) {
        const mesh = new THREE.Mesh(this.planeGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
        mesh.scale.set(k.x1 - k.x0 - 1.5, k.y1 - k.y0 - 2, 1);
        mesh.position.set((k.x0 + k.x1) / 2, (k.y0 + k.y1) / 2, (k.black ? BH : 0) + 0.6);
        this.board.add(mesh);
        l = { mesh, a: 0, hold: true };
        this.lights.set(k.m, l);
      }
      l.mesh.material.color.copy(col);
      l.a = a; l.hold = true;
    }

    burst(x, y, z, col, count) {
      for (let i = 0; i < count; i++) {
        const j = this.pNext; this.pNext = (this.pNext + 1) % this.pN;
        const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 120;
        this.pPos[j * 3] = x; this.pPos[j * 3 + 1] = y; this.pPos[j * 3 + 2] = z;
        this.pVel[j * 3] = Math.cos(a) * sp * 0.7;
        this.pVel[j * 3 + 1] = Math.sin(a) * sp * 0.4;
        this.pVel[j * 3 + 2] = 90 + Math.random() * 260;
        this.pLife[j] = 0.7 + Math.random() * 0.8;
        this.pBase[j * 3] = col.r; this.pBase[j * 3 + 1] = col.g; this.pBase[j * 3 + 2] = col.b;
      }
    }

    /* ---------- demo ---------- */
    toggleDemo() {
      if (this.demo) { this.stopDemo(); return false; }
      const list = (this.opts.songs ? this.opts.songs() : []).filter(s => s.builtin && s.id !== 'builtin-escala');
      if (!list.length) return false;
      this.demoIdx = ((this.demoIdx == null ? -1 : this.demoIdx) + 1) % list.length;
      const song = list[this.demoIdx];
      const notes = [];
      song.parts.forEach(p => p.notes.forEach(n => notes.push(n)));
      notes.sort((a, b) => a.start - b.start);
      // transpõe por oitavas até caber no teclado
      const g = this.geom;
      const fit = (m) => { while (m < g.low) m += 12; while (m > g.hi) m -= 12; return m; };
      this.demo = { notes: notes.map(n => ({ midi: fit(n.midi), start: n.start, end: n.start + n.dur, vel: n.vel, on: false, off: false })), t0: performance.now() / 1000 + 0.4, title: song.title };
      this.opts.toast && this.opts.toast('Demonstração: ' + song.title);
      return true;
    }
    stopDemo() {
      if (!this.demo) return;
      this.demo.notes.forEach(n => { if (n.on && !n.off) this.opts.onRelease(n.midi); });
      this.demo = null;
      this.root.querySelector('#arDemo') && this.root.querySelector('#arDemo').classList.remove('on');
    }
    stepDemo(now) {
      const d = this.demo;
      if (!d) return;
      const t = now - d.t0;
      let left = 0;
      for (const n of d.notes) {
        if (!n.on && t >= n.start) { n.on = true; this.opts.onPress(n.midi, n.vel || 0.7); }
        if (n.on && !n.off && t >= n.end) { n.off = true; this.opts.onRelease(n.midi); }
        if (!n.off) left++;
      }
      if (!left) { this.demo = null; this.root.querySelector('#arDemo').classList.remove('on'); }
    }

    /* ---------- laço ---------- */
    loop() {
      cancelAnimationFrame(this.raf);
      let last = performance.now() / 1000;
      const tick = () => {
        if (this.phase === 'off') return;
        const now = performance.now() / 1000;
        const dt = Math.min(0.05, now - last); last = now;
        if (this.phase === 'scan') this.stepScan(now * 1000);
        this.stepDemo(now);
        this.stepNotes(now, dt);
        if (this.renderer && this.pose && (this.phase === 'live' || this.phase === 'adjust')) {
          this.renderer.render(this.scene, this.camera);
        } else if (this.renderer) this.renderer.clear();
        if (this.phase === 'scan' || this.dragging != null) this.drawOverlay();
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }

    stepNotes(now, dt) {
      if (!this.scene) return;
      for (let i = this.notes.length - 1; i >= 0; i--) {
        const n = this.notes[i];
        const top = (now - n.t0) * RISE;
        const bot = n.t1 ? (now - n.t1) * RISE : 0;
        if (bot > MAX_H) {
          this.fxGroup.remove(n.grp);
          n.body.material.dispose(); n.edges.material.dispose(); n.head.material.dispose();
          if (n.label) n.label.material.dispose();
          this.notes.splice(i, 1);
          continue;
        }
        const len = Math.max(2, top - bot);
        const fade = clamp(1 - (bot - MAX_H * 0.45) / (MAX_H * 0.55), 0, 1);
        n.body.scale.set(n.bw, n.bd, len);
        n.body.position.z = bot;
        n.edges.scale.copy(n.body.scale);
        n.edges.position.z = bot;
        n.body.material.opacity = (0.4 + n.vel * 0.25) * fade;
        n.edges.material.opacity = fade;
        // cabeça brilhante: acompanha o topo enquanto segura, depois some
        const pulse = n.t1 ? Math.max(0, 1 - (now - n.t1) * 2.5) : 0.85 + Math.sin(now * 14) * 0.15;
        n.head.position.z = n.t1 ? top : 4;
        n.head.scale.setScalar((n.t1 ? 60 : 70) * (0.6 + n.vel * 0.6));
        n.head.material.opacity = pulse * fade;
        if (n.label) { n.label.position.z = top + 26; n.label.material.opacity = fade; }
        // faíscas subindo junto com a coluna
        if (!n.t1 && Math.random() < dt * 30) this.burst(n.k.cx + (Math.random() - 0.5) * n.bw, n.grp.position.y, n.bz + 2, n.col, 1);
      }
      // luz nas teclas
      this.lights.forEach(l => {
        if (!l.hold) l.a = Math.max(0, l.a - dt * 3.2);
        l.mesh.material.opacity = l.a * 0.75;
        l.mesh.visible = l.a > 0.01;
      });
      // partículas
      const P = this.pPos, V = this.pVel, L = this.pLife, C = this.pCol, B = this.pBase;
      for (let j = 0; j < this.pN; j++) {
        if (L[j] <= 0) { C[j * 3] = C[j * 3 + 1] = C[j * 3 + 2] = 0; continue; }
        L[j] -= dt;
        V[j * 3] *= 1 - dt * 1.5; V[j * 3 + 1] *= 1 - dt * 1.5; V[j * 3 + 2] *= 1 - dt * 0.6;
        P[j * 3] += V[j * 3] * dt; P[j * 3 + 1] += V[j * 3 + 1] * dt; P[j * 3 + 2] += V[j * 3 + 2] * dt;
        const a = clamp(L[j], 0, 1);
        C[j * 3] = B[j * 3] * a; C[j * 3 + 1] = B[j * 3 + 1] * a; C[j * 3 + 2] = B[j * 3 + 2] * a;
      }
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }

    stepScan(ms) {
      const sc = this.scan;
      if (!sc || ms - sc.last < 220 || !this.video.videoWidth) return;
      sc.last = ms;
      let r = null;
      try { r = detectKeyboard(this.video, this.geom, this.work); } catch (e) { console.warn(e); }
      sc.cand = r;
      if (r) {
        sc.best = r;
        sc.hist.push(r);
        if (sc.hist.length > 3) sc.hist.shift();
        const stable = sc.hist.length === 3 && sc.hist.every(h => h.corners.every((c, i) => Math.hypot(c[0] - r.corners[i][0], c[1] - r.corners[i][1]) < 0.025));
        if (stable) {
          // média das três leituras
          this.cfg.corners = r.corners.map((_, i) => [0, 1].map(d => sc.hist.reduce((s, h) => s + h.corners[i][d], 0) / 3));
          this.save();
          this.updatePose();
          this.setPhase('adjust');
          const miss = Math.abs(r.seen - r.expected);
          this.status('Teclado encontrado!', miss <= 1
            ? 'Vi ' + r.seen + ' teclas pretas, bate com o modelo. Ajuste os cantos se precisar e toque em Pronto.'
            : 'Vi ' + r.seen + ' pretas (o modelo tem ' + r.expected + '). Confira se os cantos estão nas quinas certas.');
          if (navigator.vibrate) navigator.vibrate(30);
          return;
        }
      } else sc.hist.length = 0;
      if (ms - sc.t0 > 9000) {
        if (sc.best) this.cfg.corners = sc.best.corners;
        this.updatePose();
        this.setPhase('adjust');
        this.status('Não consegui travar sozinho', 'Arraste os 4 pontos até as quinas das teclas. Frente embaixo, fundo em cima.');
      }
    }

    /* ---------- overlay 2D ---------- */
    drawOverlay() {
      const c = this.ovc, v = this.view;
      if (!v) return;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, v.W, v.H);
      if (this.phase === 'scan') {
        const sc = this.scan, cand = sc && sc.cand;
        if (cand) this.drawQuad(cand.corners.map(n => this.toScreen(n)), 'rgba(46,230,214,.9)', true);
        return;
      }
      if (!this.H) return;
      const showGrid = this.phase === 'adjust' || this.cfg.grid;
      if (!showGrid) return;
      const P = (X, Y) => applyH(this.H, X, Y);
      const g = this.geom;
      c.lineWidth = 1;
      c.strokeStyle = this.phase === 'adjust' ? 'rgba(46,230,214,.75)' : 'rgba(139,123,255,.45)';
      c.beginPath();
      for (let i = 0; i <= g.whites; i++) { const a = P(i * WW, 0), b = P(i * WW, WL); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
      c.stroke();
      c.fillStyle = this.phase === 'adjust' ? 'rgba(10,10,30,.45)' : 'rgba(10,10,30,.25)';
      g.blacks.forEach(k => {
        const q = [P(k.x0, k.y0), P(k.x1, k.y0), P(k.x1, k.y1), P(k.x0, k.y1)];
        c.beginPath(); q.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath();
        c.fill(); c.stroke();
      });
      this.drawQuad([P(0, 0), P(g.W, 0), P(g.W, WL), P(0, WL)], this.phase === 'adjust' ? 'rgba(255,255,255,.95)' : 'rgba(139,123,255,.7)', false);
      // nomes nos Dós
      c.font = '600 11px Inter, sans-serif';
      c.textAlign = 'center';
      g.keys.forEach(k => {
        if (k.m % 12) return;
        const p = P(k.cx, 14);
        c.fillStyle = 'rgba(255,255,255,.9)';
        c.fillText(this.opts.noteName(k.m, true), p[0], p[1]);
      });
    }
    drawQuad(q, color, dashed) {
      const c = this.ovc;
      c.save();
      c.strokeStyle = color; c.lineWidth = 2;
      c.shadowColor = color; c.shadowBlur = 12;
      if (dashed) c.setLineDash([8, 6]);
      c.beginPath(); q.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath();
      c.stroke();
      c.restore();
    }

    /* ---------- alças dos cantos ---------- */
    placeHandles() {
      const show = this.phase === 'adjust' && this.cfg.corners && this.view;
      this.handles.forEach((h, i) => {
        h.hidden = !show;
        if (!show) return;
        const p = this.toScreen(this.cfg.corners[i]);
        h.style.transform = 'translate(' + p[0] + 'px,' + p[1] + 'px)';
      });
    }
    bindHandles() {
      this.handles.forEach((h, i) => {
        let off = [0, 0];
        h.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          h.setPointerCapture(e.pointerId);
          const p = this.toScreen(this.cfg.corners[i]);
          off = [p[0] - e.clientX, p[1] - e.clientY];
          this.dragging = i;
          h.classList.add('drag');
        });
        h.addEventListener('pointermove', (e) => {
          if (this.dragging !== i) return;
          const p = [e.clientX + off[0], e.clientY + off[1]];
          this.cfg.corners[i] = this.toNorm(p);
          this.placeHandles();
          this.updatePose();
          this.drawLoupe(p);
        });
        const end = () => {
          if (this.dragging !== i) return;
          this.dragging = null;
          h.classList.remove('drag');
          this.loupe.classList.remove('show');
          this.save();
          this.drawOverlay();
        };
        h.addEventListener('pointerup', end);
        h.addEventListener('pointercancel', end);
      });
    }
    drawLoupe(p) {
      const L = this.loupe, c = L.getContext('2d'), v = this.view;
      const S = L.width, zoom = 3;
      L.classList.add('show');
      L.classList.toggle('right', p[0] < v.W / 2);
      const n = this.toNorm(p);
      const span = S / zoom / v.s; // em pixels do vídeo
      const sx = n[0] * v.vw - span / 2, sy = n[1] * v.vh - span / 2;
      c.save();
      c.clearRect(0, 0, S, S);
      if (this.cfg.facing === 'user') { c.translate(S, 0); c.scale(-1, 1); }
      c.drawImage(this.video, sx, sy, span, span, 0, 0, S, S);
      c.restore();
      c.strokeStyle = '#2ee6d6'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(S / 2 - 14, S / 2); c.lineTo(S / 2 + 14, S / 2); c.moveTo(S / 2, S / 2 - 14); c.lineTo(S / 2, S / 2 + 14); c.stroke();
    }

    /* ---------- tocar nas teclas pela tela ---------- */
    keyAt(x, y) {
      if (!this.Hinv) return null;
      const [X, Y] = applyH(this.Hinv, x, y);
      const g = this.geom;
      if (X < 0 || X > g.W || Y < -10 || Y > WL + 10) return null;
      if (Y > WL - BL) {
        const b = g.blacks.find(k => X >= k.x0 && X <= k.x1);
        if (b) return b.m;
      }
      const w = g.keys.find(k => !k.black && X >= k.x0 && X < k.x1);
      return w ? w.m : null;
    }
    bindTouch() {
      const el = this.gl;
      el.addEventListener('pointerdown', (e) => {
        if (this.phase !== 'live') return;
        const m = this.keyAt(e.clientX, e.clientY);
        if (m == null) return;
        e.preventDefault();
        this.touchDown.set(e.pointerId, m);
        this.opts.onPress(m, 0.75);
      });
      const up = (e) => {
        const m = this.touchDown.get(e.pointerId);
        if (m == null) return;
        this.touchDown.delete(e.pointerId);
        this.opts.onRelease(m);
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    }

    /* ---------- ações dos botões ---------- */
    rescan() { this.cfg.corners = null; this.H = null; this.pose = null; this.setPhase('scan'); }
    adjust() { this.setPhase('adjust'); }
    done() { this.save(); this.setPhase('live'); }
    askLowest() {
      this.waitLowest = !this.waitLowest;
      this.root.classList.toggle('waiting', this.waitLowest);
      if (this.waitLowest) this.status('Aperte a tecla mais grave', 'Toque a primeira tecla da esquerda do seu teclado MIDI.');
      else if (this.phase === 'live') this.status();
      else this.setPhase(this.phase);
    }
    setFov(mul) { this.cfg.fovMul = mul; this.updatePose(); this.save(); }
    toggle(key) { this.cfg[key] = !this.cfg[key]; this.save(); this.drawOverlay(); return this.cfg[key]; }
  }


  /* ================= Prévia animada (página do Palco 3D) ================= */
  // Desenho leve em canvas 2D com projeção em perspectiva feita à mão (não carrega o Three.js)
  class ARPreview {
    constructor(canvas) {
      this.c = canvas;
      this.g = canvas.getContext('2d');
      this.geom = buildGeom(36, 48);
      this.notes = [];
      this.next = 0;
      this.step = 0;
      this.raf = 0;
      const tick = (t) => { this.raf = requestAnimationFrame(tick); if (this.c.offsetParent) this.frame(t / 1000); };
      this.raf = requestAnimationFrame(tick);
    }
    project(X, Y, Z) {
      // câmera à frente e acima do teclado, olhando para o meio dele
      const g = this.geom, cx = g.W / 2;
      const eye = [cx, -620, 560], at = [cx, 160, 170];
      const f = [at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]];
      const fn = norm(f); f[0] /= fn; f[1] /= fn; f[2] /= fn;
      let r = cross(f, [0, 0, 1]); const rn = norm(r); r = scale(r, 1 / rn);
      const u = cross(r, f);
      const d = [X - eye[0], Y - eye[1], Z - eye[2]];
      const x = dot(d, r), y = dot(d, u), z = dot(d, f);
      const F = this.F;
      return [this.w / 2 + x * F / z, this.h * 0.39 - y * F / z];
    }
    poly(pts, fill, stroke) {
      const g = this.g;
      g.beginPath();
      pts.forEach((p, i) => { const q = this.project(p[0], p[1], p[2]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); });
      g.closePath();
      if (fill) { g.fillStyle = fill; g.fill(); }
      if (stroke) { g.strokeStyle = stroke; g.stroke(); }
    }
    frame(t) {
      const c = this.c, dpr = Math.min(global.devicePixelRatio || 1, 2);
      const w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) return;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      this.w = w; this.h = h;
      this.F = Math.min(w * 1.45, h * 2.6);
      const g = this.g, geom = this.geom;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      // melodia automática: arpejos que sobem e descem
      const ARP = [0, 4, 7, 12, 16, 19, 24, 19, 16, 12, 7, 4];
      const ROOTS = [48, 53, 55, 50];
      if (t > this.next) {
        const root = ROOTS[Math.floor(this.step / 12) % 4];
        const m = root + ARP[this.step % 12];
        this.step++;
        this.next = t + 0.19;
        if (geom.map.has(m)) this.notes.push({ m, t0: t, t1: t + 0.17 });
        if (this.step % 12 === 1 && geom.map.has(root)) this.notes.push({ m: root, t0: t, t1: t + 1.4, bass: true });
      }
      this.notes = this.notes.filter(n => (t - n.t1) * RISE < 700);
      const lit = new Map();
      this.notes.forEach(n => { if (t < n.t1 + 0.25) lit.set(n.m, Math.max(lit.get(n.m) || 0, t < n.t1 ? 1 : 1 - (t - n.t1) / 0.25)); });
      // corpo e teclas
      const W = geom.W;
      this.poly([[-30, WL, 0], [W + 30, WL, 0], [W + 30, WL + 90, 8], [-30, WL + 90, 8]], '#15152b');
      this.poly([[-30, -8, -22], [W + 30, -8, -22], [W + 30, -8, 0], [-30, -8, 0]], '#0b0b18');
      geom.keys.forEach(k => {
        if (k.black) return;
        const a = lit.get(k.m) || 0;
        const col = a ? 'hsl(' + hueOf(k.m) + ',90%,' + (92 - a * 22) + '%)' : '#eceef8';
        this.poly([[k.x0 + 0.8, 0, 0], [k.x1 - 0.8, 0, 0], [k.x1 - 0.8, WL, 0], [k.x0 + 0.8, WL, 0]], col);
        this.poly([[k.x0 + 0.8, 0, -14], [k.x1 - 0.8, 0, -14], [k.x1 - 0.8, 0, 0], [k.x0 + 0.8, 0, 0]], a ? col : '#b9bcd6');
      });
      geom.blacks.forEach(k => {
        const a = lit.get(k.m) || 0;
        const col = a ? 'hsl(' + hueOf(k.m) + ',90%,' + (30 + a * 30) + '%)' : '#17172a';
        this.poly([[k.x0, k.y0, 0], [k.x1, k.y0, 0], [k.x1, k.y0, BH], [k.x0, k.y0, BH]], '#05050c');
        this.poly([[k.x0, k.y0, BH], [k.x1, k.y0, BH], [k.x1, k.y1, BH], [k.x0, k.y1, BH]], col);
      });
      // colunas de luz
      g.globalCompositeOperation = 'lighter';
      this.notes.forEach(n => {
        const k = geom.map.get(n.m);
        const top = Math.min(t - n.t0, 99) * RISE, bot = t > n.t1 ? (t - n.t1) * RISE : 0;
        const z0 = (k.black ? BH : 0) + bot, z1 = (k.black ? BH : 0) + Math.max(bot + 4, top);
        const hw = k.black ? 5.5 : 9, y = k.black ? WL - 6 : WL - 26, d = 7;
        const fade = clamp(1 - (bot - 250) / 450, 0, 1);
        const hue = hueOf(n.m);
        const fill = 'hsla(' + hue + ',100%,62%,' + (0.5 * fade) + ')';
        const edge = 'hsla(' + hue + ',100%,82%,' + fade + ')';
        this.poly([[k.cx - hw, y - d, z0], [k.cx + hw, y - d, z0], [k.cx + hw, y - d, z1], [k.cx - hw, y - d, z1]], fill, edge);
        this.poly([[k.cx - hw, y - d, z1], [k.cx + hw, y - d, z1], [k.cx + hw, y + d, z1], [k.cx - hw, y + d, z1]], fill, edge);
        if (t < n.t1 + 0.3) {
          const p = this.project(k.cx, y, k.black ? BH : 0);
          const rg = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], 34);
          rg.addColorStop(0, 'hsla(' + hue + ',100%,70%,.85)');
          rg.addColorStop(1, 'hsla(' + hue + ',100%,60%,0)');
          g.fillStyle = rg;
          g.fillRect(p[0] - 34, p[1] - 34, 68, 68);
        }
      });
      g.globalCompositeOperation = 'source-over';
    }
  }

  ARStage.Preview = ARPreview;
  ARStage.MODEL_GROUPS = MODEL_GROUPS;
  ARStage.MODELS = MODELS;
  ARStage.buildGeom = buildGeom;
  ARStage._test = { homography, applyH, inv3, poseFromH, estimateFocal, detectKeyboard };
  global.ARStage = ARStage;
})(window);
