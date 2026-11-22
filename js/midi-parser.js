/* Aurora Keys — leitor de arquivos MIDI (Standard MIDI File, formatos 0, 1 e 2) */
(function (global) {
  'use strict';

  const GM_FAMILIES = [
    'Piano', 'Percussão cromática', 'Órgão', 'Violão', 'Baixo', 'Cordas', 'Ensemble', 'Metais',
    'Palhetas', 'Flauta', 'Synth Lead', 'Synth Pad', 'Synth FX', 'Étnico', 'Percussão', 'Efeitos'
  ];

  function findHeader(bytes) {
    for (let i = 0; i < Math.min(bytes.length - 4, 4096); i++) {
      if (bytes[i] === 0x4d && bytes[i + 1] === 0x54 && bytes[i + 2] === 0x68 && bytes[i + 3] === 0x64) return i;
    }
    return -1;
  }

  function parseMidi(buffer) {
    const bytes = new Uint8Array(buffer);
    const d = new DataView(buffer);
    const start = findHeader(bytes);
    if (start < 0) throw new Error('Arquivo não parece ser um MIDI válido.');

    let p = start + 4;
    const u8 = () => d.getUint8(p++);
    const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
    const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
    const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p++)); return s; };
    const vlq = () => { let v = 0, b, guard = 0; do { b = u8(); v = (v << 7) | (b & 0x7f); } while ((b & 0x80) && ++guard < 4); return v; };
    const text = (s, l) => { let r = ''; for (let i = 0; i < l; i++) r += String.fromCharCode(bytes[s + i]); try { return decodeURIComponent(escape(r)); } catch (e) { return r; } };

    const hdrLen = u32();
    const hdrEnd = p + hdrLen;
    const format = u16();
    const ntrks = u16();
    const division = u16();
    p = hdrEnd;

    const smpte = (division & 0x8000) !== 0;
    const ppq = smpte ? 0 : division;
    const smpteRate = smpte ? (-(((division >> 8) & 0xff) << 24 >> 24)) * (division & 0xff) : 0;

    const tempos = [];
    const timeSigs = [];
    const raw = new Map(); // `${track}:${ch}` -> { track, ch, notes: [] }
    const trackNames = [];
    const programs = {};
    let lastTick = 0;

    let ti = 0;
    while (ti < ntrks && p + 8 <= d.byteLength) {
      const id = str(4);
      const len = u32();
      const end = Math.min(p + len, d.byteLength);
      if (id !== 'MTrk') { p = end; continue; }

      let tick = 0, status = 0;
      const open = new Map();
      while (p < end) {
        tick += vlq();
        if (p >= end) break;
        const b = d.getUint8(p);
        if (b === 0xff) {
          p++;
          const mt = u8();
          const ml = vlq();
          const ms = p;
          if (mt === 0x51 && ml === 3) {
            tempos.push({ tick, uspq: (bytes[ms] << 16) | (bytes[ms + 1] << 8) | bytes[ms + 2] });
          } else if (mt === 0x58 && ml >= 2) {
            timeSigs.push({ tick, num: bytes[ms], den: Math.pow(2, bytes[ms + 1]) });
          } else if ((mt === 0x03) && trackNames[ti] === undefined) {
            const name = text(ms, ml).trim();
            if (name) trackNames[ti] = name;
          }
          p = ms + ml;
          continue;
        }
        if (b === 0xf0 || b === 0xf7) { p++; const l = vlq(); p += l; continue; }
        if (b & 0x80) { status = b; p++; }
        if (!status) { p++; continue; }
        const type = status & 0xf0, ch = status & 0x0f;
        if (type === 0x90 || type === 0x80) {
          const note = u8() & 0x7f, vel = u8() & 0x7f;
          const k = ch * 128 + note;
          if (type === 0x90 && vel > 0) {
            if (!open.has(k)) open.set(k, []);
            open.get(k).push({ tick, vel });
          } else {
            const q = open.get(k);
            if (q && q.length) {
              const on = q.shift();
              addNote(ti, ch, note, on.tick, tick, on.vel);
            }
          }
        } else if (type === 0xc0) {
          const prog = u8();
          const key = ti + ':' + ch;
          if (programs[key] === undefined) programs[key] = prog;
        } else if (type === 0xd0) {
          p += 1;
        } else {
          p += 2;
        }
      }
      // fecha notas sem note-off
      open.forEach((q, k) => q.forEach(on => addNote(ti, k >> 7, k & 127, on.tick, Math.max(tick, on.tick + (ppq || 96)), on.vel)));
      lastTick = Math.max(lastTick, tick);
      p = end;
      ti++;
    }

    function addNote(track, ch, midi, t0, t1, vel) {
      const key = track + ':' + ch;
      if (!raw.has(key)) raw.set(key, { track, ch, notes: [] });
      raw.get(key).notes.push({ midi, t0, t1, vel });
    }

    // Mapa de tempo
    tempos.sort((a, b) => a.tick - b.tick);
    if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, uspq: 500000 });
    let sec = 0;
    for (let i = 0; i < tempos.length; i++) {
      if (i > 0) sec += (tempos[i].tick - tempos[i - 1].tick) * tempos[i - 1].uspq / 1e6 / ppq;
      tempos[i].sec = sec;
    }
    const toSec = (tick) => {
      if (smpte) return tick / smpteRate;
      let lo = 0, hi = tempos.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tempos[m].tick <= tick) lo = m; else hi = m - 1; }
      const t = tempos[lo];
      return t.sec + (tick - t.tick) * t.uspq / 1e6 / ppq;
    };

    // Partes
    const multiCh = {};
    raw.forEach(r => { multiCh[r.track] = (multiCh[r.track] || 0) + 1; });
    const parts = [];
    let duration = 0;
    raw.forEach(r => {
      const prog = programs[r.track + ':' + r.ch];
      const isDrum = r.ch === 9;
      let name = trackNames[r.track];
      if (!name) name = isDrum ? 'Bateria' : (prog !== undefined ? GM_FAMILIES[prog >> 3] : 'Faixa ' + (r.track + 1));
      if (multiCh[r.track] > 1) name += ' · canal ' + (r.ch + 1);
      const notes = r.notes.map(n => {
        const s = toSec(n.t0);
        const e = toSec(n.t1);
        duration = Math.max(duration, e);
        return { midi: n.midi, start: s, dur: Math.max(0.04, e - s), vel: n.vel / 127 };
      }).sort((a, b) => a.start - b.start || a.midi - b.midi);
      parts.push({ name, channel: r.ch, program: prog, isDrum, notes });
    });
    parts.sort((a, b) => a.channel - b.channel);

    // Linhas de compasso
    const bars = [];
    if (!smpte && ppq) {
      timeSigs.sort((a, b) => a.tick - b.tick);
      if (!timeSigs.length || timeSigs[0].tick > 0) timeSigs.unshift({ tick: 0, num: 4, den: 4 });
      const endTick = lastTick;
      let tk = 0, si = 0, guard = 0;
      while (tk <= endTick && guard++ < 20000) {
        while (si + 1 < timeSigs.length && timeSigs[si + 1].tick <= tk) si++;
        bars.push(toSec(tk));
        const ts = timeSigs[si];
        tk += Math.max(1, Math.round(ts.num * ppq * 4 / ts.den));
      }
    }

    return {
      format,
      parts: parts.filter(pt => pt.notes.length),
      duration,
      bpm: Math.round(60e6 / tempos[0].uspq),
      bars
    };
  }

  global.parseMidi = parseMidi;
})(window);
